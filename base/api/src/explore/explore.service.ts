import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Digimon } from '@prisma/client';
import { BATTLE_XP_REWARD, Combatant, findEnemy, simulateBattleAtb } from '../digimon/battle';
import type { OwnedDigimon } from '../digimon/digimon.types';
import { applyBattleReward, xpForLevel } from '../digimon/training';
import { PrismaService } from '../prisma/prisma.service';
import { findTile, WORLD_TILES } from './explore.map';
import { ExploreOutcomeView, TileView, toTileView } from './explore.types';

/**
 * Exploration domain logic (TASK-40, R-9) — the FIRST exploration write path and the
 * SMALLEST runnable slice of the "move across the world → trigger an encounter that
 * feeds combat" fantasy. A player fetches the server-authoritative procedural tile map
 * ({@link getMap}) and explores a tile ({@link exploreTile}); an encounter tile runs the
 * EXISTING pure {@link simulateBattle} against a wild Digimon and a WIN grants XP
 * (persisted, its level may tick up).
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link PvpService} /
 * {@link ShopService}, copied deliberately): the controller owns HTTP concerns (the
 * routes, the JwtAuthGuard), this owns the rules. It reaches the datastore ONLY through
 * the injected {@link PrismaService} (invariant 1) — nothing bypasses the provider; the
 * explored Digimon + the XP write are read/written only here.
 *
 * REUSE, ZERO NEW COMBAT MATH: the encounter maps the player Digimon to a
 * {@link Combatant} EXACTLY as `DigimonService.battle` does, runs the SAME
 * `simulateBattle`, and persists the win reward through the SAME `applyBattleReward`
 * curve — so exploration progression can never drift from PvE battle / PvP / training
 * (D-8 #1). XP is DOMAIN progression, NOT spendable value → invariant 3 is NOT triggered
 * (no ResourceBalance, no AuditLog row — exactly like R-7 battle / R-6 train; a
 * resource/item DROP loot reward is a carved ECONOMIC child, A-33).
 */
@Injectable()
export class ExploreService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike the
  // production `nest build` via tsc), so a bare `private readonly prisma` injects
  // `undefined` under the gate and the first request 500s. Naming the provider needs no
  // reflected metadata, so it resolves identically under esbuild (tests) and tsc (build).
  // NO other ctor param — the map is pure data; only the Digimon is reached via Prisma.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The world map (`GET /api/explore/map`) — the leak-safe {@link TileView}[]. Pure data
   * projected through {@link toTileView}, which DROPS each tile's server-only
   * `encounterEnemyId` (invariant 2 — the map reveals THAT a fight awaits, never WHICH
   * foe). No datastore access: the shared map is fixed this slice.
   */
  getMap(): TileView[] {
    return WORLD_TILES.map(toTileView);
  }

  /**
   * Explore ONE tile (`POST /api/explore/:tileId/explore`). Resolves the tile, then:
   *
   *  1. Unknown `tileId` → 404 BEFORE any read/tx (no partial exploration).
   *  2. Resolve the caller's STRONGEST owned, active Digimon (owner-scoped — invariant 2,
   *     `orderBy:[{level:'desc'},{id:'asc'}]`, the SAME champion pick PvP uses). None →
   *     422 (they have nothing to explore with).
   *  3. EMPTY tile (`encounterEnemyId === null`) → return `outcome:'empty'` with NO write.
   *  4. ENCOUNTER tile → resolve the wild enemy via {@link findEnemy} (a stale map id →
   *     422 pre-write, defensive), map the player Digimon to a {@link Combatant} EXACTLY
   *     as `DigimonService.battle` does, and run the pure RNG-free {@link simulateBattle}.
   *     - On a WIN: inside a `$transaction`, re-read the Digimon owner-scoped and absolute
   *       `update` its level/xp/stats via the SHARED {@link applyBattleReward} curve
   *       (mirrors `DigimonService.battle`'s win write 1:1). On a LOSS: write nothing.
   *
   * XP is domain progression → invariant 3 NOT triggered (no ResourceBalance/AuditLog).
   */
  async exploreTile(userId: string, tileId: string): Promise<ExploreOutcomeView> {
    // Unknown tile → 404 before ANY read (mirrors DigimonService resolving a bad id).
    const tile = findTile(tileId);
    if (tile === undefined) {
      throw new NotFoundException('Tile not found.');
    }

    // The explorer's champion (owner-scoped — invariant 2). None → 422: they have
    // nothing to field. Read outside a tx for the empty-tile / loss paths that write
    // nothing; the WIN path re-reads owner-scoped inside its own tx before writing.
    const digimon = await this.prisma.digimon.findFirst({
      where: { userId, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    if (digimon === null) {
      throw new UnprocessableEntityException('You have no Digimon to explore with.');
    }

    // Empty tile: safe travel — no encounter, no fight, NO write. The success path for
    // crossing a peaceful tile.
    if (tile.encounterEnemyId === null) {
      return { outcome: 'empty', turns: [], reward: { xpGained: 0 } };
    }

    // Encounter tile: resolve the wild enemy. A stale/removed map id → 422 pre-write
    // (defensive — the map should only ever reference live ENEMY_ROSTER ids, but never
    // start a partial encounter against a missing foe).
    const enemy = findEnemy(tile.encounterEnemyId);
    if (enemy === undefined) {
      throw new UnprocessableEntityException('Unknown encounter enemy.');
    }

    // Map the player Digimon to the combat projection EXACTLY as DigimonService.battle
    // does — the pure sim needs only these fields (no `level`). The enemy is already a
    // Combatant (+ id).
    const player: Combatant = {
      name: digimon.name,
      type: digimon.type,
      element: digimon.element,
      hp: digimon.hp,
      // TASK-126 (R-17c): maxHp = the player's FULL HP (the persisted `Digimon.hp` IS the full HP;
      // this fight-local projection never persists mid-fight HP), so `maxHp` inits from the SAME
      // `digimon.hp` with NO new column/migration — the substrate the execute finisher reads.
      maxHp: digimon.hp,
      atk: digimon.atk,
      def: digimon.def,
      spd: digimon.spd,
    };

    // The pure, RNG-free rule owns the WHOLE fight (turn order, matchup damage,
    // termination). Deterministic → the same roster vs the same tile always yields the
    // same outcome + turn log (the e2e asserts it exactly). TASK-156 (R-22 slice 17):
    // re-pointed to the byte-frozen ATB sibling `simulateBattleAtb` so a fast
    // explorer's banked capped mini-combo lands in a wild encounter exactly as it does
    // interactively and on the PvE auto-resolve path (TASK-155/D-318) — closing the
    // auto-vs-interactive ATB divergence on this remaining auto callsite. The FREE-XP
    // win `$transaction` below is UNCHANGED (invariant 3 untriggered: XP is domain
    // progression, no ResourceBalance/AuditLog).
    const result = simulateBattleAtb(player, enemy);
    const enemyView = {
      name: enemy.name,
      type: enemy.type,
      element: enemy.element,
    };

    // On a LOSS the Digimon is returned unchanged (no penalty this slice; nothing is
    // written) — the risk side of exploring.
    if (result.outcome === 'loss') {
      return {
        outcome: 'loss',
        turns: result.turns,
        reward: { xpGained: 0 },
        enemy: enemyView,
        digimon: toOwnedDigimon(digimon),
      };
    }

    // On a WIN, persist the reward through the SHARED level-up curve (no drift with
    // train/battle — applyBattleReward reuses applyXpGain). Re-read owner-scoped INSIDE
    // the tx so the write is atomic and scoped to the caller (invariant 2). This mirrors
    // DigimonService.battle's win-reward write 1:1.
    const rewardedDigimon = await this.prisma.$transaction(async (tx) => {
      const current = await tx.digimon.findFirst({
        where: { id: digimon.id, userId, deletedAt: null },
      });
      // The row we just read still exists (SQLite serializes writes); defensive 404 if a
      // concurrent soft-delete raced it away — better than writing a phantom reward.
      if (current === null) {
        throw new NotFoundException('Digimon not found.');
      }
      const next = applyBattleReward(
        {
          level: current.level,
          xp: current.xp,
          hp: current.hp,
          atk: current.atk,
          def: current.def,
          spd: current.spd,
          // Threaded through unchanged — an exploration win grants no Fire Data (only
          // training does), exactly like a PvE battle win.
          dataFire: current.dataFire,
        },
        BATTLE_XP_REWARD,
      );
      return tx.digimon.update({
        where: { id: current.id },
        data: {
          level: next.level,
          xp: next.xp,
          hp: next.hp,
          atk: next.atk,
          def: next.def,
          spd: next.spd,
        },
      });
    });

    return {
      outcome: 'win',
      turns: result.turns,
      reward: { xpGained: BATTLE_XP_REWARD },
      enemy: enemyView,
      digimon: toOwnedDigimon(rewardedDigimon),
    };
  }
}

/**
 * Project a persisted `Digimon` row to its public {@link OwnedDigimon} shape — naming
 * each field explicitly so internal/owner columns (`userId`, `createdAt`, `deletedAt`)
 * can NEVER leak across the API boundary. Reproduces `DigimonService.toOwnedDigimon`
 * (which is private to that service) byte-for-byte, including the derived `xpToNext`
 * from the SHARED training curve ({@link xpForLevel}) — so the explored Digimon is
 * returned in the SAME shape `GET /digimon` yields (invariant 5; no client-side curve
 * mirror, D-8 #1).
 */
function toOwnedDigimon(digimon: Digimon): OwnedDigimon {
  return {
    id: digimon.id,
    name: digimon.name,
    type: digimon.type,
    element: digimon.element,
    stage: digimon.stage,
    hp: digimon.hp,
    atk: digimon.atk,
    def: digimon.def,
    spd: digimon.spd,
    level: digimon.level,
    xp: digimon.xp,
    xpToNext: xpForLevel(digimon.level),
    dataFire: digimon.dataFire,
  };
}
