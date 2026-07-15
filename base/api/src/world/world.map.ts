/**
 * The deterministic square-tile WORLD (TASK-46, R-17a) — the PURE, framework-free
 * generation rules for the server-authoritative Digiworld the Phaser client (TASK-47)
 * walks + streams chunk-by-chunk.
 *
 * WHY a pure module (no Prisma, no I/O, NO RNG): per the ARCHITECTURE MANDATE every
 * world rule is framework-free pure TS, mirroring {@link explore.map.ts} / battle.ts /
 * evolution.ts / training.ts — all the domain data + math lives in a plain module so the
 * feature module (`WorldModule`) stays a thin HTTP wrapper. The world is a PURE FUNCTION
 * of absolute integer tile coordinates: there is NO model, NO migration, NO stored state.
 * The same `(worldX, worldY)` ALWAYS yields the same tile, which is what makes the world
 * (a) exactly unit-testable, (b) infinitely + cheaply generable on demand, and (c)
 * SEAMLESS across chunk borders (a chunk boundary is just two adjacent absolute
 * coordinates that agree because they run through the same total function).
 *
 * SCOPE (A-36): the SMALLEST runnable slice of R-17a — a deterministic infinite biome
 * field + a chunk read. CARVED to later R-17 children: city spawn + biome-weighted
 * encounters (R-17b), the SMT+Pokémon combat engine (R-17c), the 5000×5000 real-scale
 * bound, sprites/tilesets, a per-player world SEED (this global field becomes one seeded
 * instance), dungeons/bosses/NPCs, and mountain-peak / river impassability (ocean is the
 * only impassable biome THIS slice).
 */

/** Tiles per side of a chunk; a chunk is `CHUNK_SIZE * CHUNK_SIZE` = 1024 tiles. */
export const CHUNK_SIZE = 32;

/**
 * The seven biome color labels named in the R-17a outcome. Plain string literals (L-6 —
 * the domain has no enums); the pure hash below maps any absolute coordinate into an
 * index of this array, so its LENGTH (7) is the modulus of the biome field.
 */
export const BIOMES = ['forest', 'ocean', 'desert', 'snow', 'mountain', 'swamp', 'barren'] as const;

export type Biome = (typeof BIOMES)[number];

/** One tile of the world: its biome + whether an entity may stand on it. */
export interface WorldTile {
  biome: Biome;
  walkable: boolean;
}

/**
 * A pure 32-bit integer hash of a single value, `Math.imul`-based (the standard
 * avalanche mixer). EXPORTED (TASK-48, R-17b): the city-lattice + spawn geometry below
 * reuse it to pick deterministic per-super-cell city anchors + per-player spawn start
 * coords, so the whole world (biomes AND cities) stays a pure function of one shared hash.
 * WHY `Math.imul` + `>>> 0`: it does the multiply/xor entirely in
 * 32-bit integer space and coerces back to an UNSIGNED 32-bit result on every step, so
 * the output is a stable non-negative integer that is identical across engines and does
 * NOT depend on float precision — the referential-transparency the seamless-border
 * guarantee rests on.
 */
export function hash32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/**
 * Deterministically map an ABSOLUTE integer tile coordinate to a biome. TOTAL over ℤ²
 * (any integer x/y, including negatives — the world is unbounded) and referentially
 * transparent: the same `(worldX, worldY)` ALWAYS yields the same biome. This is what
 * makes chunk borders seamless — tile `(31, y)` of chunk `(0, c)` and tile `(0, y)` of
 * chunk `(1, c)` are the SAME absolute coordinate `(32*1+0 == 32)` reached from two
 * chunks, so they necessarily agree. NO randomness, NO global mutable state.
 *
 * The two axes are hashed then combined with distinct odd multipliers before a final
 * mix, so the field is not merely `f(x) xor f(y)` (which would produce visible axis-
 * aligned banding); the result is reduced modulo `BIOMES.length` to pick the label.
 */
export function biomeAt(worldX: number, worldY: number): Biome {
  const x = worldX | 0;
  const y = worldY | 0;
  const combined = (Math.imul(hash32(x), 0x9e3779b1) ^ Math.imul(hash32(y), 0x85ebca77)) >>> 0;
  const index = hash32(combined) % BIOMES.length;
  return BIOMES[index];
}

/**
 * The full tile at an absolute coordinate: its biome + walkability. `walkable = biome
 * !== 'ocean'` — ocean is the ONLY impassable biome this slice (mountain-peak / river
 * impassability carve to a child). Pure + total, built straight on {@link biomeAt}.
 */
export function tileAt(worldX: number, worldY: number): WorldTile {
  const biome = biomeAt(worldX, worldY);
  return { biome, walkable: biome !== 'ocean' };
}

/**
 * Generate the `CHUNK_SIZE * CHUNK_SIZE` tiles of chunk `(cx, cy)` in ROW-MAJOR order:
 * index `= localY * CHUNK_SIZE + localX`, with absolute `worldX = cx*CHUNK_SIZE + localX`
 * and `worldY = cy*CHUNK_SIZE + localY`. `cx`/`cy` are UNBOUNDED integers (the infinite
 * deterministic world). Because every tile is generated through the total, pure
 * {@link tileAt}, two calls for the same chunk are byte-identical and abutting chunks
 * share an exact border.
 */
export function generateChunk(cx: number, cy: number): WorldTile[] {
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  const tiles: WorldTile[] = new Array<WorldTile>(CHUNK_SIZE * CHUNK_SIZE);
  for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      tiles[localY * CHUNK_SIZE + localX] = tileAt(baseX + localX, baseY + localY);
    }
  }
  return tiles;
}

/**
 * ============================================================================
 * TASK-48 (R-17b) — deterministic Starter-City lattice + per-player spawn geometry.
 * ============================================================================
 *
 * Cities, like biomes, are a PURE FUNCTION of coordinates — so a city's POSITION needs
 * NO storage (only the player's chosen spawn tile persists, in WorldService). The rules
 * here are framework-free, RNG-free, total over ℤ², and referentially transparent, so
 * they are exactly unit-testable and the same inputs always yield the same city/spawn.
 */

/**
 * Cities lie on a COARSE lattice: exactly one candidate city anchor per
 * `CITY_SPACING` × `CITY_SPACING` super-cell. A larger spacing = sparser cities. 64 tiles
 * (= two chunks) keeps cities far enough apart that the MIN_SPAWN_DISTANCE=30 spawn rule
 * is always satisfiable within the lattice.
 */
export const CITY_SPACING = 64;

/**
 * The R-17b outcome's rule: a player spawns at least this many tiles from the nearest
 * city (so the starting area is open wilderness, not on top of a city).
 */
export const MIN_SPAWN_DISTANCE = 30;

/**
 * A frozen pool of deterministic city NAMES. A city's name is a pure label off its
 * super-cell hash (index into this pool) — so it needs no storage and is stable forever.
 * A small pool is fine: two cities sharing a name is harmless flavour this slice.
 */
export const CITY_NAME_POOL = [
  'File City',
  'Server Continent',
  'Native Forest',
  'Freezeland',
  'Overdell',
  'Toy Town',
  'Gear Savanna',
  'Beetle Land',
] as const;

/** A city anchor point: its absolute tile coordinate + deterministic name. */
export interface CityPoint {
  x: number;
  y: number;
  name: string;
}

/**
 * Deterministically hash a super-cell (identified by its integer super-cell coords
 * `scx, scy`) to a stable 32-bit value. Combines the two axes with distinct odd
 * multipliers before a final mix (the same anti-banding technique {@link biomeAt} uses),
 * so anchors are well-scattered rather than axis-aligned.
 */
function superCellHash(scx: number, scy: number): number {
  const combined = (Math.imul(hash32(scx), 0x27d4eb2f) ^ Math.imul(hash32(scy), 0x165667b1)) >>> 0;
  return hash32(combined);
}

/**
 * Return the city anchor of the super-cell that CONTAINS `(worldX, worldY)`, ALWAYS (it
 * exists whether or not the point itself is the anchor). The anchor is the super-cell's
 * base corner offset by a hash-derived `(dx, dy)` in `[0, CITY_SPACING)`, nudged if
 * needed onto the FIRST walkable tile (a city can't sit on ocean). Pure + total.
 *
 * `Math.floor` (not integer truncation) is used for the super-cell index so NEGATIVE
 * coordinates map correctly (e.g. `-1` lives in super-cell `-1`, not `0`).
 */
function cityAnchorForSuperCell(scx: number, scy: number): CityPoint {
  const h = superCellHash(scx, scy);
  const baseX = scx * CITY_SPACING;
  const baseY = scy * CITY_SPACING;
  let ax = baseX + (h % CITY_SPACING);
  let ay = baseY + (Math.floor(h / CITY_SPACING) % CITY_SPACING);
  // A city must be walkable. If the hashed anchor lands on ocean, walk forward
  // (bounded by CITY_SPACING probes) to the first walkable tile in the super-cell —
  // deterministic because it is a fixed scan from a deterministic start.
  for (let probe = 0; probe < CITY_SPACING; probe += 1) {
    if (tileAt(ax, ay).walkable) break;
    ax = baseX + ((ax - baseX + 1) % CITY_SPACING);
    if (ax === baseX) ay = baseY + ((ay - baseY + 1) % CITY_SPACING);
  }
  const name = CITY_NAME_POOL[h % CITY_NAME_POOL.length];
  return { x: ax, y: ay, name };
}

/**
 * The super-cell index containing an absolute coordinate. `Math.floor` so negatives map
 * to the correct (negative) super-cell.
 */
function superCellIndex(world: number): number {
  return Math.floor(world / CITY_SPACING);
}

/**
 * Return the {@link CityPoint} IFF `(worldX, worldY)` IS its super-cell's city anchor,
 * else `null`. Deterministic + total over ℤ² — the client/server can ask "is a city
 * here?" for any tile and get a stable answer with no lookup table.
 */
export function cityAt(worldX: number, worldY: number): CityPoint | null {
  const x = worldX | 0;
  const y = worldY | 0;
  const anchor = cityAnchorForSuperCell(superCellIndex(x), superCellIndex(y));
  return anchor.x === x && anchor.y === y ? anchor : null;
}

/**
 * Euclidean tile distance between two points (used for the spawn rule + nearest-city).
 * Chosen over Manhattan so "≥30 tiles away" reads as a true radial ring around a city.
 */
function tileDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The city nearest to `(worldX, worldY)`. Scans the 3×3 block of super-cells around the
 * point's super-cell and returns the closest anchor. The lattice (one anchor per
 * super-cell) guarantees at least one anchor within that block, so a nearest city ALWAYS
 * exists. Pure + total + deterministic.
 */
export function nearestCity(worldX: number, worldY: number): CityPoint {
  const x = worldX | 0;
  const y = worldY | 0;
  const scx = superCellIndex(x);
  const scy = superCellIndex(y);
  let best: CityPoint | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dscy = -1; dscy <= 1; dscy += 1) {
    for (let dscx = -1; dscx <= 1; dscx += 1) {
      const anchor = cityAnchorForSuperCell(scx + dscx, scy + dscy);
      const d = tileDistance(x, y, anchor.x, anchor.y);
      if (d < bestDist) {
        bestDist = d;
        best = anchor;
      }
    }
  }
  // `best` is non-null: the 3×3 block always yields ≥1 anchor (a lattice invariant).
  return best as CityPoint;
}

/** Distance from `(worldX, worldY)` to the nearest city. Pure. */
export function distanceToNearestCity(worldX: number, worldY: number): number {
  const c = nearestCity(worldX, worldY);
  return tileDistance(worldX | 0, worldY | 0, c.x, c.y);
}

/**
 * ============================================================================
 * TASK-124 (R-20) — generalize the lone `city` into a keyed `landmarks[]` collection.
 * ============================================================================
 *
 * The FIRST time a SECOND world-marker instance arrives (a volcano), we stop special-
 * casing "the city" and model landmarks as DATA: a `kind`-tagged {@link LandmarkPoint}
 * (the keyed typed collection move — A-36 #3 / L-16). The city stays BYTE-UNCHANGED
 * (`cityAt`/`nearestCity`/`cityAnchorForSuperCell` are untouched above); the volcano is
 * PURE ADDITION — its own deterministic coordinate function on its OWN lattice phase, so
 * a volcano and a city can never land on the same tile. Still pure, RNG-free, total.
 */

/** The known kinds of on-world landmark. A `city` and (TASK-124) a `volcano`. */
export type LandmarkKind = 'city' | 'volcano';

/** A keyed landmark point: which KIND, where, and its deterministic name. */
export interface LandmarkPoint {
  kind: LandmarkKind;
  x: number;
  y: number;
  name: string;
}

/**
 * Volcanoes lie on their OWN coarse lattice — a distinct spacing from `CITY_SPACING` so
 * the two lattices are incommensurate and, combined with the distinct super-cell hash
 * salt + the tile-collision guard in {@link volcanoAnchorForSuperCell}, a volcano tile is
 * never a city tile. 48 tiles keeps volcanoes visibly sparser-than-but-interleaved-with
 * the 64-tile city lattice.
 */
export const VOLCANO_SPACING = 48;

/**
 * A frozen pool of deterministic volcano NAMES (a volcano's name is a pure label off its
 * super-cell hash — no storage, stable forever), mirroring {@link CITY_NAME_POOL}.
 */
export const VOLCANO_NAME_POOL = [
  'Mount Panjyamon',
  'Infinity Mountain',
  'Ember Ridge',
  'Cinder Caldera',
  'Magma Spire',
  'Ashfall Peak',
] as const;

/**
 * Deterministically hash a VOLCANO super-cell to a stable 32-bit value. Uses DISTINCT odd
 * multipliers (a different salt) from {@link superCellHash} so the volcano lattice is
 * decorrelated from the city lattice — volcanoes scatter independently of cities.
 */
function volcanoSuperCellHash(scx: number, scy: number): number {
  const combined = (Math.imul(hash32(scx), 0x2545f491) ^ Math.imul(hash32(scy), 0x9e3779b1)) >>> 0;
  return hash32(combined);
}

/**
 * The volcano super-cell index containing an absolute coordinate (own `VOLCANO_SPACING`).
 * `Math.floor` so negatives map to the correct (negative) super-cell.
 */
function volcanoSuperCellIndex(world: number): number {
  return Math.floor(world / VOLCANO_SPACING);
}

/**
 * The volcano anchor of the super-cell containing `(worldX, worldY)`, ALWAYS. Mirrors
 * {@link cityAnchorForSuperCell}: the super-cell base corner offset by a hash-derived
 * `(dx, dy)` in `[0, VOLCANO_SPACING)`, nudged onto the first walkable tile (a volcano
 * can't sit on ocean), then — the collision guard — nudged forward once more if the tile
 * is ALSO a city anchor, so a volcano and a city never share a tile. Pure + total.
 */
function volcanoAnchorForSuperCell(scx: number, scy: number): LandmarkPoint {
  const h = volcanoSuperCellHash(scx, scy);
  const baseX = scx * VOLCANO_SPACING;
  const baseY = scy * VOLCANO_SPACING;
  let ax = baseX + (h % VOLCANO_SPACING);
  let ay = baseY + (Math.floor(h / VOLCANO_SPACING) % VOLCANO_SPACING);
  // Deterministic forward scan (bounded by the super-cell) to the first tile that is both
  // walkable AND not a city anchor — so a volcano is a walkable, distinct-from-city tile.
  for (let probe = 0; probe < VOLCANO_SPACING; probe += 1) {
    if (tileAt(ax, ay).walkable && cityAt(ax, ay) === null) break;
    ax = baseX + ((ax - baseX + 1) % VOLCANO_SPACING);
    if (ax === baseX) ay = baseY + ((ay - baseY + 1) % VOLCANO_SPACING);
  }
  const name = VOLCANO_NAME_POOL[h % VOLCANO_NAME_POOL.length];
  return { kind: 'volcano', x: ax, y: ay, name };
}

/**
 * Return the {@link LandmarkPoint} IFF `(worldX, worldY)` IS its volcano super-cell's
 * anchor, else `null` — the volcano twin of {@link cityAt}. Deterministic + total over ℤ².
 */
export function volcanoAt(worldX: number, worldY: number): LandmarkPoint | null {
  const x = worldX | 0;
  const y = worldY | 0;
  const anchor = volcanoAnchorForSuperCell(volcanoSuperCellIndex(x), volcanoSuperCellIndex(y));
  return anchor.x === x && anchor.y === y ? anchor : null;
}

/**
 * The volcano nearest to `(worldX, worldY)` — scans the 3×3 block of volcano super-cells
 * (the lattice guarantees ≥1 anchor within it). The volcano twin of {@link nearestCity}.
 */
export function nearestVolcano(worldX: number, worldY: number): LandmarkPoint {
  const x = worldX | 0;
  const y = worldY | 0;
  const scx = volcanoSuperCellIndex(x);
  const scy = volcanoSuperCellIndex(y);
  let best: LandmarkPoint | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dscy = -1; dscy <= 1; dscy += 1) {
    for (let dscx = -1; dscx <= 1; dscx += 1) {
      const anchor = volcanoAnchorForSuperCell(scx + dscx, scy + dscy);
      const d = tileDistance(x, y, anchor.x, anchor.y);
      if (d < bestDist) {
        bestDist = d;
        best = anchor;
      }
    }
  }
  return best as LandmarkPoint;
}

/**
 * The keyed landmark collection visible near `(worldX, worldY)`: the nearest city (keyed
 * `{kind:'city', ...}`) PLUS the nearest volcano. Deterministic, pure, RNG-free. The
 * `city` entry is coordinate-EQUAL to what {@link nearestCity} returns at the same tile,
 * so the `landmarks[]` view and the legacy `city` view always agree (invariant 5). Adding
 * a third kind later is pure addition (append another `...At`/`nearest...` pair).
 */
export function landmarksNear(worldX: number, worldY: number): LandmarkPoint[] {
  const city = nearestCity(worldX, worldY);
  const volcano = nearestVolcano(worldX, worldY);
  return [{ kind: 'city', x: city.x, y: city.y, name: city.name }, volcano];
}

/**
 * Find a valid PLAYER SPAWN tile from an integer `seed` (WorldService passes a stable
 * per-player value — e.g. `hash32` of the user id — so a re-read never moves the spawn).
 * PURE + deterministic: same `seed` → same tile.
 *
 * A valid spawn tile is one that is (a) `walkable`, (b) NOT itself a `cityAt` anchor, and
 * (c) at least {@link MIN_SPAWN_DISTANCE} tiles from the nearest city — open wilderness
 * near, but not in, the Starter City. We search OUTWARD from a hash-derived start along a
 * bounded spiral of probes; the lattice guarantees a qualifying tile quickly. The probe
 * count is capped; on the (practically impossible) exhaustion we return the last probed
 * tile so the function is total.
 */
export function findSpawnTile(seed: number): { x: number; y: number } {
  const startX = (hash32(seed) % 4096) - 2048;
  const startY = (hash32(seed ^ 0x9e3779b9) % 4096) - 2048;
  const MAX_RADIUS = 64;
  const valid = (x: number, y: number): boolean =>
    tileAt(x, y).walkable &&
    cityAt(x, y) === null &&
    distanceToNearestCity(x, y) >= MIN_SPAWN_DISTANCE;
  if (valid(startX, startY)) return { x: startX, y: startY };
  // Expanding-ring scan outward from the start: for each radius r, scan the square
  // ring of tiles at Chebyshev distance r in a fixed (deterministic) order and return
  // the first qualifying tile. Bounded by MAX_RADIUS; the lattice guarantees a hit
  // well within it. Deterministic scan order → same seed → same tile.
  for (let r = 1; r <= MAX_RADIUS; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        // Only the ring perimeter at radius r (interior already scanned at smaller r).
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = startX + dx;
        const y = startY + dy;
        if (valid(x, y)) return { x, y };
      }
    }
  }
  // Practically unreachable (a qualifying tile always exists within MAX_RADIUS given
  // the lattice); return the start so the function stays total.
  return { x: startX, y: startY };
}
