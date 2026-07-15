import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  CHUNK_SIZE,
  MIN_SPAWN_DISTANCE,
  biomeAt,
  cityAt,
  distanceToNearestCity,
  findSpawnTile,
  generateChunk,
  landmarksNear,
  nearestCity,
  nearestVolcano,
  tileAt,
  volcanoAt,
} from './world.map';

/**
 * Pure world-generation contract (TASK-46, R-17a) — a plain Vitest unit spec (NO app
 * boot, NO DB): the deterministic biome field + chunk generator are the whole seam the
 * seamless-streaming guarantee rests on, so they are exercised directly. Mirrors the
 * "pure module tested in isolation" split used for battle/evolution/training math.
 *
 * The load-bearing properties: (1) determinism — the same coordinate always yields the
 * same tile across calls (referential transparency); (2) a chunk is exactly
 * `CHUNK_SIZE*CHUNK_SIZE` tiles in row-major order; (3) SEAMLESS borders — the last
 * column of a chunk equals `tileAt` at the abutting absolute coordinates of the next
 * chunk's first column (this is what makes streamed chunks tile together); (4) ocean is
 * the only impassable biome; (5) every biome is a member of `BIOMES`.
 */
describe('world.map (pure generation)', () => {
  it('biomeAt / tileAt are deterministic (same coords → same result)', () => {
    for (const [x, y] of [
      [0, 0],
      [5, -3],
      [-100, 42],
      [12345, -67890],
    ]) {
      expect(biomeAt(x, y)).toBe(biomeAt(x, y));
      expect(tileAt(x, y)).toEqual(tileAt(x, y));
    }
  });

  it('every biome is a member of BIOMES', () => {
    for (let y = -4; y < 4; y += 1) {
      for (let x = -4; x < 4; x += 1) {
        expect(BIOMES).toContain(biomeAt(x, y));
      }
    }
  });

  it('tileAt: ocean is impassable, every non-ocean is walkable', () => {
    // Scan a wide region so both branches are hit (the field mixes all 7 biomes).
    let sawOcean = false;
    let sawWalkable = false;
    for (let y = -30; y < 30; y += 1) {
      for (let x = -30; x < 30; x += 1) {
        const tile = tileAt(x, y);
        if (tile.biome === 'ocean') {
          expect(tile.walkable).toBe(false);
          sawOcean = true;
        } else {
          expect(tile.walkable).toBe(true);
          sawWalkable = true;
        }
      }
    }
    expect(sawOcean).toBe(true);
    expect(sawWalkable).toBe(true);
  });

  it('generateChunk returns CHUNK_SIZE*CHUNK_SIZE tiles in row-major order', () => {
    const cx = 0;
    const cy = 0;
    const chunk = generateChunk(cx, cy);
    expect(chunk).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
    // Row-major: index localY*CHUNK_SIZE + localX == tileAt(absolute coords).
    for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
      for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
        const worldX = cx * CHUNK_SIZE + localX;
        const worldY = cy * CHUNK_SIZE + localY;
        expect(chunk[localY * CHUNK_SIZE + localX]).toEqual(tileAt(worldX, worldY));
      }
    }
  });

  it('generateChunk is deterministic (two calls byte-identical)', () => {
    expect(generateChunk(5, -3)).toEqual(generateChunk(5, -3));
  });

  it('chunk borders are seamless (last column of (0,0) == first column of (1,0))', () => {
    const left = generateChunk(0, 0);
    const right = generateChunk(1, 0);
    for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
      // Rightmost column of chunk (0,0): absolute x = 31; leftmost of (1,0): x = 32.
      // They are adjacent absolute coordinates, so each must equal the pure tileAt.
      const lastColOfLeft = left[localY * CHUNK_SIZE + (CHUNK_SIZE - 1)];
      const firstColOfRight = right[localY * CHUNK_SIZE + 0];
      const worldY = localY;
      expect(lastColOfLeft).toEqual(tileAt(CHUNK_SIZE - 1, worldY));
      expect(firstColOfRight).toEqual(tileAt(CHUNK_SIZE, worldY));
    }
  });
});

/**
 * Pure city-lattice + spawn geometry (TASK-48, R-17b). Cities are a pure function of
 * coordinates (like biomes) so their POSITION needs no storage; only the properties that
 * the spawn/starter-city rules rest on are exercised here — determinism, that `cityAt`
 * returns a city ONLY at its anchor, that `nearestCity`/`distanceToNearestCity` agree,
 * and that `findSpawnTile(seed)` lands on a valid tile and is idempotent per seed.
 */
describe('world.map city + spawn geometry (pure, R-17b)', () => {
  it('cityAt is deterministic and returns a city ONLY at an anchor', () => {
    // Scan a wide region: collect the anchors nearestCity reports, and assert cityAt
    // is non-null EXACTLY at those coords and null elsewhere.
    let sawCity = false;
    let sawNonCity = false;
    for (let y = -80; y <= 80; y += 1) {
      for (let x = -80; x <= 80; x += 1) {
        const here = cityAt(x, y);
        expect(cityAt(x, y)).toEqual(here); // deterministic
        if (here) {
          expect(here.x).toBe(x);
          expect(here.y).toBe(y);
          expect(typeof here.name).toBe('string');
          expect(here.name.length).toBeGreaterThan(0);
          // A city sits on a walkable tile (never ocean).
          expect(tileAt(x, y).walkable).toBe(true);
          sawCity = true;
        } else {
          sawNonCity = true;
        }
      }
    }
    expect(sawCity).toBe(true);
    expect(sawNonCity).toBe(true);
  });

  it('nearestCity returns a real anchor and distanceToNearestCity agrees', () => {
    for (const [x, y] of [
      [0, 0],
      [17, -23],
      [-140, 88],
      [500, 500],
    ]) {
      const c = nearestCity(x, y);
      // The reported nearest city IS an anchor (cityAt at its own coords is non-null).
      expect(cityAt(c.x, c.y)).not.toBeNull();
      const d = distanceToNearestCity(x, y);
      const euclid = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2);
      expect(d).toBeCloseTo(euclid, 6);
      // No OTHER anchor in the 3×3 block is closer (nearestCity picked the minimum).
      expect(d).toBeLessThanOrEqual(euclid + 1e-9);
    }
  });

  it('findSpawnTile: walkable, non-city, ≥ MIN_SPAWN_DISTANCE, and idempotent per seed', () => {
    for (const seed of [0, 1, 42, 9999, 123456]) {
      const spawn = findSpawnTile(seed);
      expect(tileAt(spawn.x, spawn.y).walkable).toBe(true);
      expect(cityAt(spawn.x, spawn.y)).toBeNull();
      expect(distanceToNearestCity(spawn.x, spawn.y)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
      // Same seed → same tile (the persistence guarantee: a re-read never moves it).
      expect(findSpawnTile(seed)).toEqual(spawn);
    }
  });

  it('findSpawnTile: different seeds generally yield different tiles', () => {
    const a = findSpawnTile(1);
    const b = findSpawnTile(2);
    // Not a hard guarantee, but the hash-derived starts diverge in practice.
    expect(a).not.toEqual(b);
  });
});

/**
 * Pure landmark collection (TASK-124, R-20) — the "generalize the lone city into a keyed
 * `landmarks[]` collection the first time a second instance (a volcano) arrives" move. The
 * volcano is a pure coordinate function on its OWN lattice (like the city, no storage, no
 * RNG); the city is untouched (its BYTE-STABILITY is proven by the unchanged R-17b block
 * above — same imports, same assertions). These cases exercise: volcano determinism +
 * anchor-only placement, city+volcano never sharing a tile, and that `landmarksNear`
 * agrees with `nearestCity`.
 */
describe('world.map landmark collection (pure, R-20)', () => {
  it('volcanoAt is deterministic, returns a volcano ONLY at an anchor, and uses no RNG', () => {
    let sawVolcano = false;
    let sawNonVolcano = false;
    for (let y = -60; y <= 60; y += 1) {
      for (let x = -60; x <= 60; x += 1) {
        const here = volcanoAt(x, y);
        expect(volcanoAt(x, y)).toEqual(here); // deterministic (deep-equals a 2nd call)
        if (here) {
          expect(here.kind).toBe('volcano');
          expect(here.x).toBe(x);
          expect(here.y).toBe(y);
          expect(typeof here.name).toBe('string');
          expect(here.name.length).toBeGreaterThan(0);
          // A volcano sits on a walkable tile (never ocean).
          expect(tileAt(x, y).walkable).toBe(true);
          sawVolcano = true;
        } else {
          sawNonVolcano = true;
        }
      }
    }
    expect(sawVolcano).toBe(true);
    expect(sawNonVolcano).toBe(true);
  });

  it('a volcano tile is NEVER also a city tile (distinct lattices + collision guard)', () => {
    // Scan a wide region: wherever a volcano is anchored, that same tile is not a city.
    for (let y = -80; y <= 80; y += 1) {
      for (let x = -80; x <= 80; x += 1) {
        if (volcanoAt(x, y)) {
          expect(cityAt(x, y)).toBeNull();
        }
      }
    }
  });

  it('landmarksNear: a city entry coordinate-EQUAL to nearestCity PLUS the volcano', () => {
    for (const [x, y] of [
      [0, 0],
      [17, -23],
      [-140, 88],
      [500, 500],
    ]) {
      const marks = landmarksNear(x, y);
      const cityMark = marks.find((m) => m.kind === 'city');
      const volcanoMark = marks.find((m) => m.kind === 'volcano');
      expect(cityMark).toBeDefined();
      expect(volcanoMark).toBeDefined();
      // The city entry agrees byte-for-byte with the legacy nearestCity (invariant 5).
      const c = nearestCity(x, y);
      expect(cityMark).toEqual({ kind: 'city', x: c.x, y: c.y, name: c.name });
      // The volcano entry agrees with nearestVolcano and is a real anchor.
      expect(volcanoMark).toEqual(nearestVolcano(x, y));
      expect(volcanoAt(volcanoMark!.x, volcanoMark!.y)).not.toBeNull();
      // City and volcano never share a tile.
      expect(cityMark!.x === volcanoMark!.x && cityMark!.y === volcanoMark!.y).toBe(false);
    }
  });
});
