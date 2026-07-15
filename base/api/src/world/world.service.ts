import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  rollEncounterGroup,
  difficultyForBiome,
  wildEnemyScale,
  teamLevel as computeTeamLevel,
} from './encounter';
import {
  MIN_SPAWN_DISTANCE,
  distanceToNearestCity,
  findSpawnTile,
  hash32,
  landmarksNear,
  nearestCity,
  tileAt,
} from './world.map';
import type { EncounterView, WorldStateView } from './world.types';

/**
 * WorldService (TASK-48, R-17b) — the THIN persistence + boundary layer over the PURE
 * world rules ({@link world.map} + {@link encounter}). Everything the domain DECIDES
 * (city placement, a valid spawn tile, whether a step surfaces a foe) lives in the pure,
 * RNG-free modules; this service only (a) PERSISTS the per-player spawn and (b) draws the
 * server-side randomness at the encounter boundary. The controller stays thin — it
 * validates + delegates here.
 *
 * L-7/P-7: the `@Inject(PrismaService)` token is REQUIRED, not decorative — the
 * vitest/esbuild transform omits constructor `design:paramtypes`, so a bare
 * `private readonly prisma: PrismaService` injects `undefined` and the first call 500s.
 *
 * Invariant 3 is NOT triggered here: a spawn placement + an encounter roll move no
 * spendable value, so there is NO `ResourceBalance` read/write and NO `AuditLog` row —
 * exactly like XP/MMR (domain state, not economic value).
 */
@Injectable()
export class WorldService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The grant-on-first-read idiom (mirrors `FarmService.grantStartingBuildingsIfEmpty` /
   * `DigimonService.grantStarterRosterIfEmpty`): read the caller's persisted spawn; if
   * NULL, compute a valid spawn ONCE from a STABLE per-player seed and persist it, all in
   * ONE `$transaction` so a concurrent first-read can't grant two different spawns.
   *
   * The seed is `hash32` of the user-id string (via a stable char-sum) — deterministic,
   * so `findSpawnTile` yields the SAME tile even if the persist race were re-run; the
   * persisted value is then authoritative and a re-read never moves the spawn.
   *
   * The returned `city` is the nearest city to the spawn = the "Starter City". Owner-
   * scoped: a player only ever sees their OWN spawn (invariant 2); cities/biomes are
   * public terrain (no leak).
   */
  async getStateForUser(userId: string): Promise<WorldStateView> {
    const { x, y } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { spawnX: true, spawnY: true },
      });
      // A JWT-guarded caller always resolves to a real, active user; the null-guard is
      // defensive (a deleted account mid-request) and falls through to computing a spawn.
      if (user && user.spawnX !== null && user.spawnY !== null) {
        return { x: user.spawnX, y: user.spawnY };
      }
      const spawn = findSpawnTile(seedFromUserId(userId));
      await tx.user.update({
        where: { id: userId },
        data: { spawnX: spawn.x, spawnY: spawn.y },
      });
      return spawn;
    });

    const city = nearestCity(x, y);
    return {
      spawn: { x, y },
      city: { x: city.x, y: city.y, name: city.name },
      // TASK-124 (R-20): serve the keyed landmark collection ADDITIVELY from the SAME
      // reference tile the legacy `city` uses. `landmarks[0]` is the `city` entry
      // (coordinate-equal to `city` above); `city` stays byte-identical (invariant 5).
      landmarks: landmarksNear(x, y),
      minSpawnDistance: MIN_SPAWN_DISTANCE,
    };
  }

  /**
   * Resolve the wild encounter (if any) for a step at `(worldX, worldY)`. Reads the PURE
   * biome, draws two `[0,1)` values SERVER-SIDE (the client never supplies the roll —
   * server-authoritative), and delegates the DECISION to the pure {@link rollEncounter}.
   * NO state change, NO audit — a look at a tile moves no value.
   */
  rollEncounterAt(worldX: number, worldY: number, teamLevel = 1): EncounterView {
    const { biome } = tileAt(worldX, worldY);
    const roll = Math.random();
    const pick = Math.random();
    // TASK-273 (R-44a): draw a THIRD `[0,1)` value at the HTTP boundary (LIVE randomness here only —
    // the pure `rollEncounterGroup` stays RNG-free) that decides whether a SECOND distinct enemy joins
    // in the wilder biomes. The FRONT species is byte-identical to `rollEncounter(biome, roll, pick)`,
    // so a single-enemy roll is unchanged (invariant 5); `group[0]` IS the scalar `encounter` below.
    const sizeRoll = Math.random();
    const group = rollEncounterGroup(biome, roll, pick, sizeRoll);
    const species = group.length > 0 ? group[0] : null;
    return {
      encounter: species ? { name: species.name, enemyId: species.enemyId } : null,
      biome,
      // TASK-167 (R-22 slice 28): a non-empty encounter carries a biome-derived
      // difficulty so the interactive fight opens against the matching enemy AI; an
      // empty roll OMITS it (no foe → no difficulty). Pure/deterministic — no engine
      // code, no Math.random beyond the existing roll above (invariant 5, A-42 held).
      ...(species ? { difficulty: difficultyForBiome(biome) } : {}),
      // TASK-168 (slice 29) + TASK-169 (slice 30) + TASK-170 (slice 31): a non-empty
      // encounter ALSO carries a wild-enemy STRENGTH SCALE (>= 1) so the interactive fight
      // can multiply the foe's stat block once at the rebuild seam. Slice 29 keyed it on the
      // biome; slice 30 COMPOUNDS the tile's DISTANCE from the nearest safe city; slice 31
      // compounds the PLAYER'S own team level (via the pure `wildEnemyScale` combinator's
      // back-compat-defaulted `teamLevel` term) — so a levelled player meets a proportionally
      // tougher foe on the SAME tile than a beginner (`teamLevel === 1` is the identity floor
      // = byte-unchanged from slice 30). An empty roll OMITS it (no foe → no scale).
      // Pure/deterministic — no new Math.random, no engine code (invariant 5, A-42).
      ...(species
        ? {
            enemyScale: wildEnemyScale(biome, distanceToNearestCity(worldX, worldY), teamLevel),
          }
        : {}),
      // TASK-273 (R-44a): surface the ENEMY GROUP when a PACK of >1 rolled, so the /battle hand-off
      // can field a multi-enemy fight. OMITTED for a single-enemy roll (the scalar `encounter` alone
      // drives today's 1v1 — the length-1 identity anchor, invariant 5). `enemies[0]` === `encounter`.
      ...(group.length > 1
        ? { enemies: group.map((s) => ({ name: s.name, enemyId: s.enemyId })) }
        : {}),
    };
  }

  /**
   * TASK-170 (R-22 slice 31) — resolve the wild encounter for the AUTHENTICATED player,
   * seeding the enemy strength scale with that player's team level. Owner-scoped +
   * soft-delete-aware (mirrors `getRosterForUser`'s `deletedAt: null` filter, invariant 2):
   * reads ONLY the caller's own Digimon levels, reduces them to a representative team level
   * (the roster MAX; empty roster → identity `1`), and threads it into the pure combinator.
   * A pure READ — no state change, no audit (a look at a tile moves no value, invariant 3).
   */
  async rollEncounterForUser(
    userId: string,
    worldX: number,
    worldY: number,
  ): Promise<EncounterView> {
    const roster = await this.prisma.digimon.findMany({
      where: { userId, deletedAt: null },
      select: { level: true },
    });
    return this.rollEncounterAt(worldX, worldY, computeTeamLevel(roster));
  }
}

/**
 * A stable integer seed from a user id STRING (cuid). A plain char-code sum folded
 * through the shared `hash32` avalanche mixer: deterministic (same id → same seed →
 * same spawn) and framework-free. Collisions across users are harmless (two players
 * merely share a spawn tile), and the spawn is persisted after the first read anyway.
 */
function seedFromUserId(userId: string): number {
  let acc = 0;
  for (let i = 0; i < userId.length; i += 1) {
    acc = (Math.imul(acc, 31) + userId.charCodeAt(i)) | 0;
  }
  return hash32(acc);
}
