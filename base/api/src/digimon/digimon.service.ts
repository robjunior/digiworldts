import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Digimon, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STARTER_DIGIMON } from './digimon.seed';
import type { BattleOutcomeView, BattleTurnView, OwnedDigimon } from './digimon.types';
import {
  resolveEvolutionBranch,
  pickEvolution,
  pickEvolutionVariant,
  EVOLUTION_LINES,
  type EvolutionBranch,
} from './evolution';
import {
  applyBattleReward,
  applyLossPenalty,
  lossPenaltyFor,
  applyTraining,
  applyTimedTraining,
  evolutionTrainingBonus,
  xpForLevel,
} from './training';
import {
  activeControlLock,
  ATB_THRESHOLD,
  BATTLE_XP_REWARD,
  BATTLE_LOOT_RESOURCE,
  battleLootAmount,
  chooserForDifficulty,
  chooseSkill,
  COMBATANT_SKILLS,
  createFightState,
  createPartyFightState,
  deserializeFightState,
  effectiveSpd,
  energyAtTurnStart,
  findCombatantSkill,
  findEnemy,
  scaleEnemy,
  scaledBattleReward,
  MAX_ATB_BONUS_ACTIONS,
  projectedBonusActions,
  resolveActorTurn,
  resolveInteractivePartyExchange,
  resolveTurnOrder,
  serializeFightState,
  simulateBattleAtb,
  type Combatant,
  type Difficulty,
  type Enemy,
  type Skill,
  type SideState,
  type TurnLogEntry,
  type SerializedFightState,
} from './battle';
import { DEFAULT_RNG, fleeSucceeds, rollLootRarity, type Rng } from './rng';
import { rollLootResource, lootRarityForBiome, BIOMES } from '../world/encounter';
import type { Biome } from '../world/world.map';

/**
 * Roster domain logic (TASK-8, R-3) — the server-authoritative source of a
 * player's owned Digimon.
 *
 * House feature-service shape (P-1, like {@link AuthService}): the controller owns
 * HTTP concerns (route, the guard), this owns the rules. It reaches the datastore
 * ONLY through the injected {@link PrismaService} (invariant 1) — nothing bypasses
 * the provider — and never issues a hard delete (invariant 2: reads filter
 * `deletedAt: null`; no delete path exists this slice at all).
 *
 * The one non-obvious rule here is the STARTER GRANT (A-8): a brand-new account
 * owns nothing, but the R-3 headline is "a logged-in player views a roster of
 * owned Digimon rendered from a seeded database" — so the roster must never be
 * empty for a real user. Rather than a migrate-time `prisma db seed` (which would
 * need a `ts-node` runner for one constant array, and could not know WHICH user to
 * grant to) or a boot hook, we materialize the starters server-side on the FIRST
 * empty read, idempotently. This keeps the seed definition pure (digimon.seed.ts)
 * and puts the single write path behind the provider, here.
 */
@Injectable()
export class DigimonService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7):
  // the vitest/esbuild transform does NOT emit constructor `design:paramtypes`
  // (unlike the production `nest build` via tsc), so bare `private readonly
  // prisma: PrismaService` injects `undefined` under the gate and the first
  // `GET /digimon` 500s. Naming the provider needs no reflected metadata, so it
  // resolves identically under esbuild (tests) and tsc (build). The e2e's 200
  // assertion is the guard against a regression here.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Return the signed-in player's roster, granting the starter roster on the
   * first empty read.
   *
   * Steps:
   *  1. Read the owner's active roster (owner-scoped + soft-delete-aware —
   *     invariant 2). Ordered by `createdAt` (then `id` as a stable tiebreaker for
   *     rows granted in the same `createMany` with identical timestamps) so the
   *     client sees a deterministic order across reads.
   *  2. If it is empty, grant `STARTER_DIGIMON` once and re-read (see
   *     {@link grantStarterRosterIfEmpty}).
   *  3. Project rows → {@link OwnedDigimon}, dropping internal columns.
   */
  async getRosterForUser(userId: string): Promise<OwnedDigimon[]> {
    let roster = await this.prisma.digimon.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (roster.length === 0) {
      roster = await this.grantStarterRosterIfEmpty(userId);
    }

    return roster.map((digimon) => this.toOwnedDigimon(digimon));
  }

  /**
   * Evolve one of `userId`'s owned Digimon in place (TASK-18, R-8) AND charge its
   * resource cost (TASK-24, R-8b) — the FIRST domain-state mutation on a
   * player-owned record, and now the game's FIRST economic SPEND (a DEBIT).
   *
   * The whole operation runs INSIDE a single interactive `$transaction` so
   * "find the eligible row → check affordability → debit the balance → advance the
   * form → append the audit row" is ATOMIC: two concurrent evolve requests for the
   * SAME Digimon cannot both read the pre-evolution form and both apply the step
   * (double-advance / double-spend), and — critically for invariant 3 — an
   * insufficient-balance throw rolls back EVERYTHING, so there is never a partial
   * spend, a debited balance with an un-advanced form, or an orphan audit row. On
   * SQLite the writer is serialized, so a second transaction observes the first's
   * committed update + debit and re-derives its own outcome from the now-current
   * row + balance.
   *
   * Steps (all inside the one tx):
   *  1. OWNER-SCOPED find (`{ id, userId, deletedAt: null }`) — the same three
   *     filters the reads use. A `null` result means the id is bad OR the Digimon
   *     belongs to another player OR it is soft-deleted; all three collapse to a
   *     404 with a generic message, which proves per-user isolation WITHOUT leaking
   *     whether that id exists for someone else (invariant 2; no existence oracle).
   *  2. Ask the PURE {@link resolveEvolution} (TASK-17) whether this name+level may
   *     evolve. The level/chain rules and the human-readable block `reason` live
   *     there; on `ok` it ALSO returns the step's `cost` (TASK-24) so this method
   *     knows the resource + amount to charge without re-deriving it.
   *  3. On a level/chain block (terminal form, or under-level), throw 422
   *     `UnprocessableEntityException` carrying that verbatim `reason` — well-formed
   *     and authorized (so not 400/401/403) but not in an evolvable state.
   *  4. AFFORDABILITY GUARD (the DEBIT half, R-8b — invariant 3). Read the owner's
   *     spendable {@link ResourceBalance} for the cost resource (the
   *     `@@unique([userId, resource])` composite accessor is `userId_resource`). If
   *     there is NO row yet OR its `amount < cost.amount`, throw a 422 with a
   *     player-facing "Requires N <resource>" reason. This is a pure DEBIT, so —
   *     unlike collect's CREDIT (which upserts) — it NEVER creates a row: a debit
   *     needs an existing balance, which this guard proves before the decrement
   *     (task friction #1). A fresh account that never collected has no Meat row, so
   *     it fails here — evolution is no longer free.
   *  5. DEBIT: capture `amountBefore` = the balance, `amountAfter` = it minus the
   *     cost, then `update({ amount: { decrement: cost.amount } })` (NOT an upsert).
   *  6. ADVANCE the form: `update` ONLY the derived attributes (`name`/`stage`/
   *     stats) to the step's ABSOLUTE new values (`into` is absolute, not a delta —
   *     see evolution.ts). `type`/`element`/`level`/`userId`/timestamps untouched.
   *  7. APPEND the invariant-3 audit row inside the SAME tx (copied from
   *     {@link FarmService.collectForUser}, the L-13 template — INVERTED to a
   *     debit): `action:'evolve'`, `entity:'Digimon'`, `entityId`, `resource`,
   *     `amountBefore`→`amountAfter` (the delta is NEGATIVE — a spend). Append-only:
   *     the only write to the ledger from evolve, never updated/deleted.
   *
   * The `update`s' `where: { id }` are safe though they drop the ownership filter:
   * the same-transaction find already proved this exact id is the caller's active
   * Digimon, and SQLite's serialized writer means no interleaving write can have
   * changed ownership between the find and the updates within one transaction.
   *
   * Returns the evolved row projected through the EXISTING {@link toOwnedDigimon}
   * (same shape as `GET /digimon` — invariant 5), so `userId`/`createdAt`/
   * `deletedAt` never leak. The DEBITED balance is deliberately NOT part of this
   * response (invariant 5 keeps `OwnedDigimon` byte-unchanged) — it is observed via
   * the EXISTING `GET /farm` (TASK-25's UI refetches it after a successful evolve).
   */
  async evolve(
    userId: string,
    digimonId: string,
    branch: EvolutionBranch = 'linear',
    rng: Rng = DEFAULT_RNG,
  ): Promise<OwnedDigimon> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        // Bad id, another player's Digimon, or soft-deleted — all one generic 404
        // so the response never reveals whether the id exists for someone else.
        throw new NotFoundException('Digimon not found.');
      }

      // Branch-aware resolution (TASK-30, R-16). `'linear'` (the default when the
      // evolve body is absent/empty) is byte-behaviour-identical to the old
      // resolveEvolution; `'variant'` additionally gates on accumulated `dataFire`.
      // Either way the resolved `choice` carries the target form + the price to
      // charge, so the DEBIT path below is IDENTICAL for both branches (a variant is
      // just another priced step — invariant 3 unchanged).
      const resolved = resolveEvolutionBranch(
        { name: found.name, level: found.level, dataFire: found.dataFire },
        branch,
      );
      if (!resolved.ok) {
        // 422: authorized + well-formed, but this Digimon can't evolve on this branch
        // right now (terminal form, under-level, no variant, or not enough Fire Data).
        // `reason` is the player-facing message.
        throw new UnprocessableEntityException(resolved.reason);
      }

      const sourceCost = resolved.choice.cost;

      // TASK-188 (R-27) — RANDOM VALID DIGIVOLUTION. On the LINEAR branch, resolve WHICH
      // valid champion form is applied by DRAWING one of the species' seeded next forms
      // through the injected `rng` seam (fed `LIVE_RNG` at the HTTP boundary), instead of
      // the single fixed `resolved.choice.into`. `pickEvolution` reuses the proven
      // injected-RNG recipe: a single `rng()` draw, and at `rng()===0` (`DEFAULT_RNG`,
      // every no-rng caller/fixture) it returns `intoOptions[0]` === the fixed `into`
      // verbatim — so the existing evolve fixtures stay byte-identical (invariant 5). A
      // species with no seeded `intoOptions` keeps its single `into`. TASK-215 (R-27a)
      // — the `variant` branch now ALSO draws a random valid Champion, via the twin
      // `pickEvolutionVariant`, mirroring the linear identity-anchor discipline: at
      // `rng()===0` (`DEFAULT_RNG`, the HTTP boundary for this seam) the variant draw
      // returns `intoOptions[0]` === Meramon verbatim, so every existing variant/adaptive
      // fixture stays byte-identical (invariant 5). `.variant!` is guaranteed present on
      // the variant branch — `resolveEvolutionBranch` already returned `ok` for it.
      const into =
        resolved.choice.branch === 'linear'
          ? pickEvolution(EVOLUTION_LINES[found.name], rng)
          : pickEvolutionVariant(EVOLUTION_LINES[found.name].variant!, rng);

      // TASK-213 (R-27a) — PER-TARGET DIVERGENT COST. The price follows the DRAWN form:
      // an option may carry its OWN `cost` (a rarer/stronger champion costs more);
      // absent an override it falls back to the source-step cost, so every
      // species/option without an override debits EXACTLY as before (invariant 5 — the
      // fallback is the byte-proof). The `variant` branch keeps its own already-
      // per-target cost (resolved.choice.cost) untouched. Everything downstream (the
      // balance read, sufficiency guard, decrement, and AuditLog row) keeps using this
      // single `cost` variable UNCHANGED, so they automatically reflect the effective
      // cost of whichever form actually landed.
      const cost =
        resolved.choice.branch === 'linear'
          ? (into.cost ?? sourceCost)
          : sourceCost;

      // ── The DEBIT half (TASK-24, R-8b — the FIRST economic SPEND; invariant 3) ──
      // Read the owner's spendable balance for the cost resource. The composite
      // `@@unique([userId, resource])` accessor is `userId_resource` (a wrong name
      // is a tsc error). Owner-scoped by `userId`, so a player can only ever spend
      // their OWN balance (invariant 2).
      const balance = await tx.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: cost.resource } },
      });

      // Sufficiency guard. A pure DEBIT must NOT upsert (that would silently create
      // a row at a negative/absent balance — task friction #1): if there is no
      // balance row yet OR it can't cover the cost, block with a 422 carrying a
      // player-facing reason. Reuses the same UnprocessableEntityException as the
      // level/terminal block (well-formed + authorized, but not affordable). A fresh
      // account that never collected has no row → it fails here (evolution is no
      // longer free). Throwing inside the tx rolls back EVERYTHING, so no partial
      // spend and no orphan audit row (the insufficient-balance e2e proves it).
      if (balance === null || balance.amount < cost.amount) {
        throw new UnprocessableEntityException(
          `Requires ${cost.amount} ${cost.resource} to evolve ${found.name}.`,
        );
      }

      // before → after for the audit ledger (both halves stored, not a delta — the
      // row is self-contained). The delta is NEGATIVE here: a spend, vs collect's
      // credit (this is the L-13 template inverted).
      const amountBefore = balance.amount;
      const amountAfter = amountBefore - cost.amount;

      // Debit (NOT an upsert — the guard just proved a coverable row exists). The
      // `decrement` mirrors collect's `increment`, inverted.
      await tx.resourceBalance.update({
        where: { userId_resource: { userId, resource: cost.resource } },
        data: { amount: { decrement: cost.amount } },
      });

      // Advance the form (unchanged from R-8): absolute new attributes, PLUS the
      // training-derived bonus (TASK-195, R-26a slice 54 — "trained evolves stronger").
      // `found.level` (grown by training, already read in this tx) IS the training
      // signal; `evolutionTrainingBonus` maps it to a small per-stat bonus ADDED on top
      // of the absolute `into` catalog stats. At the base level (`level <= 1`, untrained)
      // the bonus is `{0,0,0,0}` so an untrained evolve writes the verbatim catalog
      // stats — byte-identical to R-8/TASK-188 (invariant-5 identity; no fixture re-pin).
      // A trained creature evolves measurably stronger. The bonus moves NO spendable
      // value (stats are domain progression, not currency), so the ResourceBalance debit
      // + AuditLog row below are BYTE-UNCHANGED (invariant 3 shape unchanged).
      const bonus = evolutionTrainingBonus(found.level);
      const updated = await tx.digimon.update({
        where: { id: digimonId },
        data: {
          name: into.name,
          stage: into.stage,
          hp: into.hp + bonus.hp,
          atk: into.atk + bonus.atk,
          def: into.def + bonus.def,
          spd: into.spd + bonus.spd,
        },
      });

      // Invariant 3: append the immutable audit row for THIS economic mutation,
      // inside the SAME transaction as the balance debit + form advance (atomic —
      // all commit or none). Append-only: the ledger's 2nd action ('evolve', after
      // collect's 'collect'), never updated/deleted. `entity`/`entityId` reference
      // the Digimon without a hard FK (the ledger spans many entity kinds). The
      // shape is copied verbatim from FarmService.collectForUser.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'evolve',
          entity: 'Digimon',
          entityId: digimonId,
          resource: cost.resource,
          amountBefore,
          amountAfter,
        },
      });

      return updated;
    });

    return this.toOwnedDigimon(updated);
  }

  /**
   * Train one of `userId`'s owned Digimon (TASK-29, R-6) — the FIRST feature that
   * moves `level`. A discrete server-authoritative train action: grant a fixed XP
   * amount and, if that crosses the per-level threshold, level it up with a flat stat
   * gain. Mirrors {@link evolve}'s shape 1:1 (owner-scoped find inside a
   * `$transaction`, then an absolute `update` of the pure rule's result) MINUS the
   * economic half: training grants XP for FREE, so there is NO `ResourceBalance`
   * read/write and NO `AuditLog` row (invariant 3 is NOT triggered — XP is domain
   * progression, not a spendable resource; a future training-COST slice would add
   * the DEBIT + audit row). Leveling here feeds R-8's level-gated evolution
   * (`resolveEvolution` already READS `level`), so training is the progression sink
   * evolution was waiting on.
   *
   * The `$transaction` makes "find the owned row → compute the new state → write it"
   * ATOMIC, exactly as evolve does: two concurrent train requests for the SAME
   * Digimon can't both read the pre-train XP and both apply the grant (a lost update
   * / double-count). On SQLite the writer is serialized, so a second transaction
   * observes the first's committed XP/level and re-derives its own outcome.
   *
   * Steps (all inside the one tx):
   *  1. OWNER-SCOPED find (`{ id, userId, deletedAt: null }`) — a `null` result (bad
   *     id, another player's Digimon, or soft-deleted) collapses to a generic 404, so
   *     the response never reveals whether the id exists for someone else (invariant
   *     2). A player trains ONLY their own Digimon.
   *  2. Compute the new ABSOLUTE progression via the PURE {@link applyTraining} (the
   *     single source of the leveling math — the service never re-derives it).
   *  3. `update` the derived progression columns (`level`/`xp`/stats) to their new
   *     absolute values. `type`/`element`/`name`/`stage`/`userId`/timestamps untouched
   *     (training advances stats+level, not the form — evolution owns the form).
   *
   * The `update`'s `where: { id }` safely drops the ownership filter: the
   * same-transaction find already proved this id is the caller's active Digimon, and
   * SQLite's serialized writer means no interleaving write changed ownership within
   * the tx (same reasoning as evolve). Returns the trained row projected through the
   * EXISTING {@link toOwnedDigimon} (now additively carrying `xp`/`xpToNext` —
   * invariant 5).
   */
  async train(userId: string, digimonId: string): Promise<OwnedDigimon> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        // Bad id, another player's Digimon, or soft-deleted — all one generic 404.
        throw new NotFoundException('Digimon not found.');
      }

      // The pure rule owns the whole leveling math (XP grant + threshold carry +
      // per-level stat gains); the service just writes its absolute result.
      const next = applyTraining({
        level: found.level,
        xp: found.xp,
        hp: found.hp,
        atk: found.atk,
        def: found.def,
        spd: found.spd,
        // TASK-30 (R-16): fold the Fire-Data grant into the same train action — the
        // pure rule increments it; still FREE (no economy). This is the ONLY new
        // Data source in the slice (no themed building/feeding yet).
        dataFire: found.dataFire,
      });

      return tx.digimon.update({
        where: { id: digimonId },
        data: {
          level: next.level,
          xp: next.xp,
          hp: next.hp,
          atk: next.atk,
          def: next.def,
          spd: next.spd,
          // Write the accumulated Fire Data (TASK-30, R-16) — non-economic, no
          // ResourceBalance/AuditLog (invariant 3 untriggered).
          dataFire: next.dataFire,
        },
      });
    });

    return this.toOwnedDigimon(updated);
  }

  /**
   * DURATION-BASED training — START (TASK-189, R-26 slice 48). Stamp the
   * server-authoritative training-start timestamp on one of `userId`'s OWN Digimon so
   * the elapsed-scaled reward can be collected later. The first half of the split that
   * replaces the old instant flat {@link train}: `startTraining` opens a session,
   * {@link collectTraining} closes it and pays out `applyTimedTraining(elapsedMs)`.
   *
   * Mirrors {@link train}'s owner-scoped-find + absolute-`update` shape inside ONE
   * `$transaction`: an owner-scoped `findFirst({ id, userId, deletedAt: null })` (a
   * `null` result → generic 404, no existence leak — invariant 2), then stamp
   * `trainingStartedAt = new Date()` (SERVER clock — invariant 1). Idempotency guard: a
   * digimon ALREADY training (`trainingStartedAt !== null`) 422s rather than silently
   * resetting the clock (which would DISCARD already-accrued elapsed). Moves DOMAIN
   * progression only — no ResourceBalance/AuditLog (invariant 3 untriggered).
   */
  async startTraining(userId: string, digimonId: string): Promise<OwnedDigimon> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        throw new NotFoundException('Digimon not found.');
      }
      if (found.trainingStartedAt !== null) {
        // Already training: refuse to reset the clock (would drop accrued elapsed).
        throw new UnprocessableEntityException('Digimon is already training.');
      }

      return tx.digimon.update({
        where: { id: digimonId },
        data: { trainingStartedAt: new Date() },
      });
    });

    return this.toOwnedDigimon(updated);
  }

  /**
   * Set or clear which PARTY SLOT one of the signed-in player's OWN Digimon occupies
   * (TASK-255, R-31a) — the persisted, value-persisting MUTATION core of R-31a's
   * add/remove party strand. A player can now CHOOSE their party (up to 3) instead of
   * getting the first three they happened to collect (the read-only `slice(0,3)` view
   * the Party rail shipped with — TASK-243/L-149).
   *
   * Mirrors {@link startTraining}'s owner-scoped-find + `update` inside ONE
   * `$transaction`: an owner-scoped `findFirst({ id, userId, deletedAt: null })` (a
   * `null` result → generic 404, no existence leak — invariant 2), then guard the slot
   * (`null` = clear, else an int in `[1,3]` → else 422). When ASSIGNING a slot, first
   * CLEAR any OTHER of this user's Digimon holding that slot (`updateMany` scoped to
   * `{ userId, partySlot: slot, deletedAt: null, NOT: { id } }`) so the party stays a
   * valid set of ≤3 distinct slots (one Digimon per slot), then persist the new slot.
   *
   * Party is DOMAIN state, NOT spendable value → NO ResourceBalance/AuditLog (invariant
   * 3 untriggered, exactly like training/mmr/spawn). `partySlot` is surfaced on
   * `GET /digimon` via {@link toOwnedDigimon} so the choice is observable.
   */
  async setPartySlot(
    userId: string,
    digimonId: string,
    slot: number | null,
  ): Promise<OwnedDigimon> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        throw new NotFoundException('Digimon not found.');
      }
      // Guard the slot server-side (holds even on the direct-service path, and even if
      // the DTO pipe is bypassed): null = clear, else an integer in [1,3].
      if (slot !== null && (!Number.isInteger(slot) || slot < 1 || slot > 3)) {
        throw new UnprocessableEntityException(
          'Party slot must be null or an integer in [1,3].',
        );
      }
      // When ASSIGNING a slot, free any OTHER of this user's Digimon currently holding
      // it first (owner-scoped) so a party slot is occupied by at most one Digimon.
      if (slot !== null) {
        await tx.digimon.updateMany({
          where: { userId, partySlot: slot, deletedAt: null, NOT: { id: digimonId } },
          data: { partySlot: null },
        });
      }
      return tx.digimon.update({
        where: { id: digimonId },
        data: { partySlot: slot },
      });
    });

    return this.toOwnedDigimon(updated);
  }

  /**
   * DURATION-BASED training — COLLECT (TASK-189, R-26 slice 48). Close a training
   * session opened by {@link startTraining} and pay out an ELAPSED-TIME-SCALED gain, so
   * a digimon left training LONGER banks a measurably greater stat/XP gain than a short
   * one — the R-26 payoff a player can SEE.
   *
   * Inside ONE `$transaction`, mirroring {@link train}: owner-scoped
   * `findFirst({ id, userId, deletedAt: null })` (`null` → 404, invariant 2); 422 if the
   * digimon is NOT currently training (`trainingStartedAt === null`); then compute
   * `elapsedMs = Date.now() - trainingStartedAt.getTime()` — the SERVER-authoritative
   * elapsed (invariant 1, NEVER a client-supplied duration) — apply the PURE
   * {@link applyTimedTraining} (the elapsed-scaled level-up math), write its absolute
   * result, AND clear `trainingStartedAt` back to `null` in the SAME update so the
   * session is closed atomically (a second concurrent collect finds no active session
   * and 422s, never double-paying). FREE progression — no ResourceBalance/AuditLog
   * (invariant 3 untriggered), like {@link train}.
   */
  async collectTraining(userId: string, digimonId: string): Promise<OwnedDigimon> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        throw new NotFoundException('Digimon not found.');
      }
      if (found.trainingStartedAt === null) {
        throw new UnprocessableEntityException('Digimon is not training.');
      }

      // SERVER-authoritative elapsed (invariant 1): computed from the stored start, not
      // trusted from the client. The pure rule owns the elapsed→XP→level→stat math.
      const elapsedMs = Date.now() - found.trainingStartedAt.getTime();
      const next = applyTimedTraining(
        {
          level: found.level,
          xp: found.xp,
          hp: found.hp,
          atk: found.atk,
          def: found.def,
          spd: found.spd,
          dataFire: found.dataFire,
        },
        elapsedMs,
      );

      return tx.digimon.update({
        where: { id: digimonId },
        data: {
          level: next.level,
          xp: next.xp,
          hp: next.hp,
          atk: next.atk,
          def: next.def,
          spd: next.spd,
          dataFire: next.dataFire,
          // Close the session atomically with the payout.
          trainingStartedAt: null,
        },
      });
    });

    return this.toOwnedDigimon(updated);
  }

  /**
   * Fight one of `userId`'s owned Digimon against ONE fixed PvE enemy (TASK-32, R-7)
   * — the turn-based combat core R-12 PvP and R-9 encounters later reuse. The server
   * SIMULATES the whole deterministic fight and, on a WIN, grants a FREE fixed XP
   * reward through the SAME level-up rule `train` uses (no divergent progression math).
   *
   * Mirrors {@link train}'s owner-scoped-find + pure-rule + absolute-update shape —
   * NOT the guarded-economic-mutation DEBIT/audit shape: the win reward is XP/level/
   * stats (DOMAIN progression, not spendable value), so there is NO ResourceBalance
   * read/write and NO AuditLog row (invariant 3 is NOT triggered; L-12 — the ledger
   * is for value-moving mutations, and a free XP grant moves none). A resource/item
   * DROP reward would be economic and is carved to a later R-7 child slice.
   *
   * The whole operation runs INSIDE one `$transaction` so "find the owned row →
   * resolve the enemy → simulate → (on a win) persist the reward" is ATOMIC, exactly
   * as train/evolve are: two concurrent battles for the SAME Digimon can't both read
   * the pre-battle XP and both apply a reward (a lost update / double-count). On
   * SQLite the writer is serialized, so a second transaction observes the first's
   * committed XP/level and re-derives its own outcome. The unknown-enemy check runs
   * BEFORE any write, so a bad enemyId rejects with no partial battle.
   *
   * Steps (all inside the one tx):
   *  1. OWNER-SCOPED find (`{ id, userId, deletedAt: null }`) — a `null` result (bad
   *     id, another player's Digimon, or soft-deleted) collapses to a generic 404, so
   *     the response never reveals whether the id exists for someone else (invariant
   *     2). A player battles ONLY their own Digimon.
   *  2. Resolve the fixed enemy by id via the pure {@link findEnemy}; an unknown id
   *     throws a clear 422 BEFORE any write (no partial battle, no reward).
   *  3. Build the player {@link Combatant} from the found row + `simulateBattle` (the
   *     pure, RNG-free rule owns the whole fight math). Compute `xpGained` = the fixed
   *     reward on a win, else 0.
   *  4. On a WIN, apply the reward via the SHARED level-up rule ({@link
   *     applyBattleReward}, reusing training's curve) and `update` the absolute
   *     level/xp/stats. `dataFire` is untouched by battle (only training grants Data).
   *     On a LOSS, write NOTHING (no penalty this slice).
   *
   * The `update`'s `where: { id }` safely drops the ownership filter (same reasoning
   * as train/evolve: the same-tx find already proved this id is the caller's active
   * Digimon; SQLite's serialized writer means no interleaving write changed ownership
   * within the tx). Returns the additive {@link BattleOutcomeView} — the outcome, the
   * turn log, the reward, the enemy, and the (updated-or-original) Digimon projected
   * through the EXISTING {@link toOwnedDigimon} (so `GET /digimon`'s shape is reused,
   * invariant 5). `GET /digimon`/`OwnedDigimon` are byte-unchanged.
   */
  async battle(userId: string, digimonId: string, enemyId: string): Promise<BattleOutcomeView> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        // Bad id, another player's Digimon, or soft-deleted — all one generic 404.
        throw new NotFoundException('Digimon not found.');
      }

      // Resolve the fixed enemy BEFORE any write. An unknown id is well-formed +
      // authorized but not a valid target → 422 with a clear reason (no partial
      // battle, no reward). Reuses the same status family as an ineligible evolve.
      const enemy = findEnemy(enemyId);
      if (enemy === undefined) {
        throw new UnprocessableEntityException('Unknown enemy.');
      }

      // The player's combat projection — exactly the fields the pure simulation
      // needs; the enemy is already a Combatant (+ id).
      const player: Combatant = {
        name: found.name,
        type: found.type,
        element: found.element,
        hp: found.hp,
        // TASK-126 (R-17c): maxHp = the player's FULL HP. The persisted `Digimon.hp` row IS the
        // starting/full HP (this fight-local projection never persists mid-fight HP), so `maxHp`
        // initializes from the SAME `found.hp` with NO new Prisma column and NO migration. It is
        // the substrate the pure engine's execute finisher reads (percent-of-MAX-HP).
        maxHp: found.hp,
        atk: found.atk,
        def: found.def,
        spd: found.spd,
      };

      // The pure, RNG-free rule owns the WHOLE fight (turn order, matchup damage,
      // termination). Deterministic → the e2e asserts an exact win/loss + turn log.
      // TASK-155 (R-22 slice 16): re-pointed simulateBattle → simulateBattleAtb so the
      // AUTO-resolved PvE fight now HONORS the banked ATB mini-combo, closing the
      // auto-vs-interactive divergence (a Digimon that banks ATB lands its capped bonus
      // action on BOTH paths now — present ≠ observable, L-17). simulateBattleAtb REUSES the
      // byte-frozen resolveActorTurn/effectiveSpd/ATB_THRESHOLD/MAX_ATB_BONUS_ACTIONS/chooseSkill:
      // NO new mechanic/RNG, Math.random count STAYS 0; a fight that banks NO ATB is
      // byte-identical to simulateBattle. Two-way door: re-pointing to simulateBattle restores
      // prior auto behavior, zero migration. PvP + explore callsites stay on simulateBattle
      // (their own Elo/encounter fixture churn — a carved follow-on wave, A-138). The owner-scoped
      // $transaction + FREE-XP reward path are UNCHANGED (invariant 2/3 untouched).
      const result = simulateBattleAtb(player, enemy);
      const xpGained = result.outcome === 'win' ? BATTLE_XP_REWARD : 0;

      // On a WIN, persist the reward through the SHARED level-up curve (no drift with
      // train — applyBattleReward reuses applyXpGain). On a LOSS, bleed a meaningful XP
      // chunk (TASK-249, R-31e) so losing has a real, felt consequence. The penalty is a
      // PERSISTED-STATE rule that resolves AFTER the fight (in the pure training.ts curve),
      // NEVER a combat mechanic inside battle.ts — the engine stays byte-frozen (invariant 5).
      let digimonRow = found;
      if (result.outcome === 'win') {
        const next = applyBattleReward(
          {
            level: found.level,
            xp: found.xp,
            hp: found.hp,
            atk: found.atk,
            def: found.def,
            spd: found.spd,
            // Threaded through unchanged — a battle grants no Fire Data.
            dataFire: found.dataFire,
          },
          BATTLE_XP_REWARD,
        );
        digimonRow = await tx.digimon.update({
          where: { id: digimonId },
          data: {
            level: next.level,
            xp: next.xp,
            hp: next.hp,
            atk: next.atk,
            def: next.def,
            spd: next.spd,
          },
        });
      } else if (result.outcome === 'loss') {
        // lossPenaltyFor(found.level) scales the XP penalty with the loser's level (TASK-267,
        // R-31e) — a lvl-1 loss still loses exactly BATTLE_LOSS_XP_PENALTY (20), higher levels
        // lose MORE. applyLossPenalty floors xp at 0 and leaves level + all stats UNCHANGED (a
        // loss never de-levels). Pass only the fields the pure rule reads (hp/atk/def/spd are
        // threaded through untouched); persist ONLY level+xp (level is unchanged, so this
        // is an xp-only write — no stat mutation).
        const penalized = applyLossPenalty(
          {
            level: found.level,
            xp: found.xp,
            hp: found.hp,
            atk: found.atk,
            def: found.def,
            spd: found.spd,
          },
          lossPenaltyFor(found.level),
        );
        digimonRow = await tx.digimon.update({
          where: { id: digimonId },
          data: { level: penalized.level, xp: penalized.xp },
        });
        // Invariant-3 posture: a persisted player-state mutation carries an append-only
        // audit row recording the before→after, even though NO spendable ResourceBalance
        // moves (resource: null — only the player's OWN XP changes). Mirrors the shipped
        // daily-claim/shop-purchase auditLog.create shape (D-8 #1).
        await tx.auditLog.create({
          data: {
            userId,
            action: 'battle-loss',
            entity: 'Digimon',
            entityId: digimonId,
            resource: null,
            amountBefore: found.xp,
            amountAfter: penalized.xp,
          },
        });
        // TASK-266 (R-31e first slice): the roguelike ON-LOSS INVENTORY WIPE. Beyond the
        // XP chunk, a PvE loss now DESTROYS the loser's WHOLE inventory (A-248 — the whole
        // pack, no refund), so a defeat has real, felt stakes. Hooked INSIDE this same loss
        // `$transaction` (never a second tx) so the XP penalty + every stack destruction +
        // every audit row commit together or not at all. One-way door HANDLED: SOFT
        // (quantity→0, the read hides zero rows), FULLY AUDITED (a `battle-loss-wipe` row per
        // stack), PvE-scoped (PvP loss stays MMR-only), and code-revertible (drop this call).
        // Owner-scoped by the authed battle-owner `userId` — a loss wipes ONLY the loser's own
        // inventory (invariant 2). Reuses the shipped discard soft-zero + audit idiom
        // (`InventoryService.discardItemForUser`), inlined here to stay in the ONE loss tx.
        await this.wipeInventoryForUser(tx, userId);
      }

      return {
        outcome: result.outcome,
        turns: result.turns,
        reward: { xpGained },
        enemy: { id: enemy.id, name: enemy.name },
        digimon: this.toOwnedDigimon(digimonRow),
      };
    });
  }

  /**
   * TASK-266 (R-31e): SOFT-WIPE the whole inventory of the loser of a PvE battle, inside
   * the caller's loss `$transaction` (invariant 3 — every destruction commits atomically
   * with the XP penalty). Owner-scoped by `userId` (invariant 2 — only the loser's own
   * stacks). Mirrors the shipped `InventoryService.discardItemForUser` idiom.
   *
   *  - Owner-scoped re-read every OWNED stack (`quantity > 0`) of the loser.
   *  - For EACH stack: soft-zero its `quantity` (owner-scoped `update`, NOT a hard row
   *    DELETE — the inventory read hides zero rows so the pack reads empty), and append an
   *    append-only `battle-loss-wipe` `AuditLog` row recording the prior quantity → 0.
   *  - A loser with NO owned stacks is a NO-OP (no rows, no audit, no error).
   *
   * `resource` is NULL (an owned stack is not a `ResourceBalance` currency — a wipe is a
   * pure penalty, no refund/no balance move). Takes the tx client so it shares the loss
   * transaction (never opens a second one).
   *
   * TASK-269 (R-31e fourth slice): RETURNS the number of stacks it soft-zeroed (0 on a NO-OP
   * empty pack). Pure ADDITIVE return — the auto-path caller (~:738) ignores it, so its
   * behaviour is byte-frozen; the interactive-loss branch uses `count > 0` to populate the
   * additive-optional `reward.inventoryWiped` flag so the player can be TOLD their pack was
   * wiped. No behaviour change to the soft-zero / `battle-loss-wipe` audit.
   */
  private async wipeInventoryForUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    // Owner-scoped re-read the loser's OWNED (non-empty) stacks. An empty result set makes
    // the loop below a clean NO-OP (no writes, no audit rows, no error).
    const stacks = await tx.inventoryItem.findMany({
      where: { userId, quantity: { gt: 0 } },
    });

    for (const stack of stacks) {
      // Soft-zero the stack (owner-scoped, NEVER a hard delete — the read hides 0-quantity
      // stacks so it vanishes from the rail and frees its slot). Capture the prior quantity
      // for the audit before it is overwritten.
      await tx.inventoryItem.update({
        where: { userId_itemId: { userId, itemId: stack.itemId } },
        data: { quantity: 0 },
      });
      // Append THIS destruction's immutable audit row inside the SAME loss tx (atomic — the
      // zero-out and its ledger row commit or roll back together with the XP penalty). No
      // refund → `resource` NULL; the required Int columns record before → after (0).
      await tx.auditLog.create({
        data: {
          userId,
          action: 'battle-loss-wipe',
          entity: 'InventoryItem',
          entityId: stack.itemId,
          resource: null,
          amountBefore: stack.quantity,
          amountAfter: 0,
        },
      });
    }

    // TASK-269: the count of stacks actually soft-zeroed (0 when the pack was already empty).
    return stacks.length;
  }

  /**
   * Resolve ONE interactive combat turn (TASK-140, R-22) — the player-agency seam.
   *
   * Unlike {@link battle} (which resolves the WHOLE fight server-side), this advances the
   * fight ONE player turn at a time: the client posts the player's CHOSEN `skillId` (+ the
   * mid-fight `state` it is carrying — A-123, there is no server session store this slice),
   * the server validates + resolves that player turn via the pure {@link resolveActorTurn},
   * then — if the fight is not yet decided — runs the ENEMY's automatic turn (via the
   * matchup-aware {@link chooseSkillMatchup} enemy AI) so control returns to the player. It returns the
   * carried-forward `state` (or `null` when the fight ended), ONLY this exchange's log
   * `entries` (the client APPENDS them — contained-refetch), and the affordable-skill MENU
   * for the next player turn.
   *
   * Server-authoritative throughout (never trusts the client's carried stats): the player's
   * `Combatant` is rebuilt from the DB row every turn, and the chosen skill must be in the
   * palette AND affordable at the start of the player's turn → else 422 with the fight state
   * UNCHANGED. The win reward (FREE XP — invariant 3 untriggered) is granted through the SAME
   * {@link applyBattleReward} curve as the whole-fight route, EXACTLY ONCE, on the turn that
   * ends the fight with a win (loss/ongoing = no write), inside the same `$transaction`.
   */
  async battleTurn(
    userId: string,
    digimonId: string,
    enemyId: string,
    skillId: string | undefined,
    carried: BattleTurnView['state'] | undefined,
    action?: 'flee' | 'pass' | 'timeout',
    // TASK-158 (R-22 slice 19): the INJECTABLE RNG seam for the flee-success roll.
    // TASK-159 (R-22 slice 20): the SAME seam now ALSO drives the CRITICAL-HIT roll —
    // it is threaded into the player-turn `resolveActorTurn` calls (normal + bonus
    // actions) so a player's strike can crit for multiplied damage.
    // Optional, DEFAULTS to the deterministic `DEFAULT_RNG` (a constant 0) so the
    // production controller (which passes no rng) and every existing fixture stay
    // byte-identical — flee still deterministically SUCCEEDS and NO strike crits
    // (critRoll(()=>0) is false). A test injects a fixed `rng` to force a FAILED flee or
    // an always-crit strike WITHOUT `Math.random`. The pure whole-fight engine stays
    // RNG-free by default (its `Math.random` count STAYS 0). Two-way door: drop this arg
    // to reverse (zero migration, zero auto-path impact).
    rng: Rng = DEFAULT_RNG,
    // TASK-165 (R-22 slice 26): the player-selected enemy DIFFICULTY for a FRESH fight. Only
    // meaningful on an OPENING turn (no carried state) — it seeds `createFightState`. On a
    // CONTINUING turn the carried `state.difficulty` (deserialized, `?? 'hard'`) wins, so the
    // choice persists across the round-trip with no client bookkeeping. Optional; absent →
    // 'hard' (today's full-banking enemy) so every existing caller/fixture is byte-identical.
    difficulty?: Difficulty,
    // TASK-168 (R-22 slice 29): the biome-derived enemy STRENGTH SCALE for a FRESH fight. Only
    // meaningful on an OPENING turn (no carried state) — it scales the foe's stat block ONCE
    // (via `scaleEnemy`) and is recorded on `createFightState` so a CONTINUING turn (carried
    // `state.enemyScale`, deserialized `?? 1`) rebuilds the SAME scaled foe. Optional; absent →
    // 1 (the byte-identical baseline block) so every existing caller/fixture is unchanged. The
    // AUTO/PvP/explore paths pass nothing → `scaleEnemy(...,1)` returns the roster block verbatim.
    enemyScale?: number,
    // TASK-174 (R-22 slice 35): the biome the wild encounter was rolled in, handed off from
    // `/world`. Only meaningful on a WIN — it selects WHICH spendable resource the loot credit
    // banks (`lootResourceForBiome`), so a win's loot KIND depends on where it was won. Optional;
    // absent/unknown → the shipped `BATTLE_LOOT_RESOURCE` (back-compat: safe/PvP/auto paths and
    // every existing caller/fixture bank the byte-identical resource). It touches NO combat state
    // (A-42 held) and does not change the credit SHAPE (invariant 3) — only the resource string.
    biome?: string,
    // TASK-180 (R-23a slice 41): the INJECTED opponent `Combatant` override, so the shared
    // interactive turn engine can be driven against ANOTHER PLAYER'S Digimon (PvP) and not only a
    // static wild-roster species. `Enemy` is already `Combatant & { id: string }` — exactly what a
    // PvP opponent maps to (PvP's own `toCombatant` produces that shape). When supplied it SUPERSEDES
    // the `findEnemy(enemyId)` roster lookup at the foe-resolution seam; when absent (the PvE
    // controller, every existing caller/e2e/fixture) the roster path runs BYTE-IDENTICALLY. Optional,
    // trailing, defaults to `undefined` so every current call site compiles and behaves unchanged.
    // Everything downstream (`scaleEnemy`, `createFightState`, `resolveActorTurn`, the reward/audit
    // `$transaction`) is already opponent-agnostic, consuming a plain `Combatant`. Two-way door: drop
    // the param + restore the unconditional `findEnemy(enemyId)` — zero migration, PvP not yet
    // re-routed through the seam (the deliberately-separated next slice).
    foe?: Enemy,
    // TASK-182 (R-23a2 slice 43): SUPPRESS the win's ECONOMIC reward when this turn drives an
    // INTERACTIVE PvP duel (the PvP caller passes `true`). A PvP duel moves NO spendable value —
    // MMR/Elo is the domain progression, applied ONCE by the PvP service on the ending turn (the
    // byte-unchanged Elo `$transaction`, no `AuditLog`/`ResourceBalance`). So on a PvP win we skip
    // the loot credit + the `battle_loot` audit row AND the challenger's Digimon XP/level
    // persistence (a ranked duel neither pays materials nor levels the fighter — that would be a
    // second, undocumented value move; invariant 3 stays UNTRIGGERED). Optional, trailing, DEFAULTS
    // to `false` so every existing PvE caller/e2e/fixture is BYTE-IDENTICAL: the wild-win branch
    // (loot + XP) runs exactly as before. Two-way door: the PvP caller drops the flag and the
    // whole-duel `challenge` route still works. It touches only WHETHER the win's economic writes
    // fire — NO combat state (A-42 held), NO engine rule (`battle.ts` absent from the diff).
    skipEconomicReward = false,
    // TASK-272 (R-44c — team-battle interactive DRIVE): the acting party member's 1-based slot
    // (mirrors the persisted `partySlot`). Names WHICH living party member's turn this request
    // drives (that member casts `skillId`; the rest cast the server default). Absent → the FRONT
    // living member, so a client that posts only a `skillId` (today's 1v1) drives the front member
    // exactly as before (the length-1 identity anchor). The PvP/auto callers omit it → front
    // member, and PvP has no party (length-1) so its behaviour is byte-unchanged. Optional,
    // trailing, defaults undefined so every existing caller/fixture compiles & behaves unchanged.
    memberSlot?: number,
    // TASK-273 (R-44a — multi-enemy encounter groups): the ordered ENEMY GROUP's roster ids (handed
    // off from `/world`'s `enemies[]`), sent on the OPENING turn. Names WHICH wild species the fight
    // fields as a PACK; the server rebuilds each enemy's authoritative Combatant from the roster each
    // turn (never trusts the wire for stats — invariant 2). `enemyIds[0]` is the front foe (= the
    // scalar `enemyId`). ABSENT / length ≤1 → the single `enemyId` foe (the length-1 identity anchor),
    // so every existing caller/e2e/fixture (auto/PvP/1v1) is BYTE-IDENTICAL. Optional, trailing.
    enemyIds?: string[],
    // TASK-274 (R-44b first slice — per-member PICKED enemy target): the 0-based living-enemy index
    // the acting party member targets THIS turn. Names WHICH living enemy the acting member (`memberSlot`
    // or the front member) attacks when a GROUP (R-44a) is fielded. ABSENT/invalid → the FRONT living
    // enemy (the TASK-273 behaviour = the length-1/no-target identity anchor), so every existing caller/
    // e2e/fixture (auto/PvP/1v1/single-enemy) is BYTE-IDENTICAL. Validated below against the CURRENT
    // living enemy set (never trusted raw — invariant 2; a bad index 422s the fight UNCHANGED). Optional,
    // trailing.
    targetEnemyIndex?: number,
    // TASK-275 (R-44b — team PvP party-vs-party FIRST slice): the ordered ENEMY GROUP as an INJECTED
    // `Enemy[]` — the PvP path's analogue of the single `foe`. When the PvP service reads the
    // opponent's persisted party (>1 rows) it maps each row to an `Enemy` and passes the list here;
    // the fight then fields the OPPONENT'S WHOLE PARTY (each member rebuilt server-side by the PvP
    // service, never trusted from the wire — invariant 2). It SUPERSEDES the wild-roster `enemyIds`
    // build (a duel is not map-fielded), mirroring how the single `foe` supersedes `findEnemy`. A duel
    // is NOT map-scaled → each member passes through `scaleEnemy(e, 1)` (identity, same object), exactly
    // as the single PvP `foe` is passed unscaled. ABSENT / length ≤1 → the single `foe` / roster path
    // is BYTE-IDENTICAL (the single-champion identity anchor), so every existing caller/e2e/fixture
    // (auto/PvE/1v1/single-champion PvP) compiles & behaves unchanged. Optional, trailing.
    foeGroup?: Enemy[],
    // TASK-277 (R-31e — PvP-loss XP penalty, challenger only, XP-only, no wipe): when the PvP
    // caller sets this, a challenger's interactive-duel LOSS applies the SAME level-scaled+capped
    // xp-only penalty a PvE loss applies (`lossPenaltyFor(found.level)` via `applyLossPenalty`) +
    // the SAME `battle-loss` audit row — but does NOT wipe inventory (the destructive pack-wipe is
    // a deferred one-way child; it stays PvE-only). Owner-scoped by the authed `userId`/`found`
    // (invariant 2). It rides ALONGSIDE `skipEconomicReward === true` (PvP keeps MMR-only reward +
    // no win-loot), so xp is FREE progress — invariant 3 UNTRIGGERED (no `ResourceBalance` move).
    // Optional, trailing, DEFAULTS to `false` so EVERY existing caller (PvE `!skipEconomicReward`,
    // auto `battle()`, PvP-no-penalty) is BYTE-IDENTICAL: the loss branch below only fires the new
    // arm when `skipEconomicReward && pvpLossXpPenalty`, which no current caller passes. A-42 held
    // (xp only, floored by `applyLossPenalty`, never de-levels, no HP); `battle.ts` NOT touched
    // (engine `Math.random` STAYS 0). One-way door HANDLED: soft/audited/challenger-scoped and
    // code-revertible (pass false / drop the flag → PvP loss back to MMR-only).
    pvpLossXpPenalty = false,
    // TASK-312 (R-44b — live-opponent action seam): the INJECTED opponent's chosen skill, so a
    // LIVE HUMAN opponent's move drives THEIR champion's turn in place of the engine AI. This is
    // the two-sided-PvP analogue of `foe` (TASK-180): a single override at the enemy-turn CHOICE
    // seam. When supplied AND the named skill is a legal, affordable pick for the opponent's live
    // `state.enemy` (validated below against the SAME `COMBATANT_SKILLS`/energy rules the AI
    // honors — NEVER trust the wire), the enemy's `resolveActorTurn` resolves THAT skill instead
    // of `enemyChooser(...)`'s AI pick. When ABSENT (every PvE caller + the untouched AI-PvP
    // path) → the AI chooser runs exactly as today (the invariant-5 identity anchor). An
    // INVALID/unaffordable supplied skill → the fight is UNCHANGED and the turn is refused (422,
    // the `memberSlot`/`targetEnemyIndex` bad-pick precedent) — NEVER a silent AI fallback that
    // would let a bad wire value pass. `battle.ts` is NOT touched: the supplied skill is handed to
    // the SAME `resolveActorTurn` the AI pick feeds; the seam is purely the service's CHOICE of
    // which `Skill` to hand it. Invariant 2 held (only the *choice of skill* is supplied — the
    // opponent's champion STATS are rebuilt DB-authoritatively via `foe`/`foeGroup`, never from
    // the wire). Optional, trailing, defaults undefined so every existing caller compiles &
    // behaves byte-identically. Two-way door: drop the param → the AI-resolved opponent turn IS
    // today's duel.
    enemyAction?: { skillId: string },
  ): Promise<BattleTurnView> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (found === null) {
        // Bad id, another player's Digimon, or soft-deleted — one generic 404 (invariant 2).
        throw new NotFoundException('Digimon not found.');
      }

      // TASK-271 (R-44 slice — team battle): read the authed user's ordered PARTY (the
      // `partySlot`-non-null owned Digimon, ≤3, sorted by slot) so the fight can SURFACE the whole
      // team on the `/world` combat overlay. Owner-scoped (invariant 2 — only the authed user's own
      // rows). ADDITIVE: when the user has NO party set, `partyMembers` is `undefined` and every
      // return OMITS it (spread-guarded) → the wire is byte-identical to today's 1v1 (the front/
      // active Digimon is `found`, carried on `digimon`/`state.player` exactly as before). This slice
      // SURFACES the party (observable); the multi-member interactive DRIVE stays the identity path —
      // the enemy still fights the front member, so a length-1 party is byte-for-byte today's fight.
      const partyRows = await tx.digimon.findMany({
        where: { userId, deletedAt: null, partySlot: { not: null } },
        orderBy: [{ partySlot: 'asc' }],
      });
      const partyMembers: { id: string; name: string }[] | undefined =
        partyRows.length > 0 ? partyRows.map((row) => ({ id: row.id, name: row.name })) : undefined;
      // Spread-guarded so an absent party OMITS the field entirely (additive/back-compat).
      const partyField = partyMembers !== undefined ? { partyMembers } : {};

      // TASK-180 (R-23a slice 41): the foe is the INJECTED opponent `Combatant` when provided (the
      // PvP path — a plain player-derived `Enemy`), else the static wild-roster species keyed by
      // `enemyId` (the PvE path, byte-identical to before). With a `foe` supplied an unknown/garbage
      // `enemyId` still resolves (the override supersedes the lookup); absent `foe` + unknown
      // `enemyId` → the same 422 as today.
      const enemy = foe ?? findEnemy(enemyId);
      if (enemy === undefined) {
        throw new UnprocessableEntityException('Unknown enemy.');
      }

      // TASK-168 (R-22 slice 29): resolve the ACTIVE enemy STRENGTH SCALE for this turn — the
      // fresh-request `enemyScale` on an OPENING turn, else the CARRIED `state.enemyScale`
      // (deserialized `?? 1`) so a continuing turn rebuilds the SAME scaled foe. Absent → 1 (the
      // byte-identical baseline). `scaleEnemy` multiplies the roster block ONCE (its `scale === 1`
      // identity guard returns the block verbatim for a safe biome / no-scale fight). This is the
      // INTERACTIVE seam ONLY — the AUTO/PvP/explore paths never pass a scale.
      const activeEnemyScale =
        enemyScale ??
        (carried !== undefined && carried !== null
          ? ((carried as SerializedFightState).enemyScale ?? 1)
          : 1);
      const scaledEnemy = scaleEnemy(enemy, activeEnemyScale);

      // Server-authoritative stats — rebuilt from the DB row + roster EVERY turn; the
      // client's carried `state` supplies only the mutable hp/energy/statuses, never stats.
      const player: Combatant = {
        name: found.name,
        type: found.type,
        element: found.element,
        hp: found.hp,
        maxHp: found.hp,
        atk: found.atk,
        def: found.def,
        spd: found.spd,
      };
      const combatant = { player, enemy: scaledEnemy };

      // TASK-272 (R-44c — team-battle interactive DRIVE): build the ordered PLAYER PARTY's
      // server-authoritative Combatant list from the already-read `partyRows` (partySlot-non-null,
      // ≤3, sorted by slot). A MULTI-member party (>1) drives the interactive fight as a team; a
      // 0/1-member party is the IDENTITY path — `partyCombatants` is undefined and every seam below
      // runs the byte-frozen single-`player` code exactly as before (invariant 5). Stats are
      // rebuilt from the DB rows each turn (never trusted from the wire — invariant 2, mirroring the
      // single-player rebuild above). The FRONT member is slot-1; per the TASK-271 contract that is
      // the same Digimon carried on `digimon`/`state.player` (`found`).
      const partyCombatants: Combatant[] | undefined =
        partyRows.length > 1
          ? partyRows.map((row) => ({
              name: row.name,
              type: row.type,
              element: row.element,
              hp: row.hp,
              maxHp: row.hp,
              atk: row.atk,
              def: row.def,
              spd: row.spd,
            }))
          : undefined;

      // TASK-273 (R-44a — multi-enemy encounter groups): build the ordered ENEMY GROUP's
      // server-authoritative Combatant list from the handed-off `enemyIds` (front = `enemyId`, ≤2
      // distinct wild species). A group of >1 fields a PACK; an absent / length-1 group is the
      // IDENTITY path — `enemyGroupCombatants` is undefined and every seam below fights the single
      // `scaledEnemy` exactly as before (invariant 5). Each foe's stats are rebuilt from the roster
      // and scaled ONCE by the SAME `activeEnemyScale` as the front (never trusted from the wire —
      // invariant 2, mirroring the single-enemy rebuild above). `enemyGroupCombatants[0]` is the FRONT
      // foe = `scaledEnemy` (the identity anchor carried on the scalar `enemy`). A member id that is
      // not a real roster foe is dropped (defensive); a group that collapses to ≤1 real foe → the
      // identity path.
      //
      // TASK-275 (R-44b — team PvP party-vs-party): when an INJECTED `foeGroup` of >1 members is
      // supplied (the PvP path — the opponent's persisted party mapped to `Enemy[]` by the PvP
      // service), it SUPERSEDES the wild-roster `enemyIds` build entirely (a duel is not
      // map-fielded), mirroring how the single `foe` supersedes `findEnemy(enemyId)`. `foeGroup`
      // absent / length ≤1 → the wild-roster / single-`foe` path is byte-identical (the identity
      // anchor). A duel is NOT map-scaled — each member is passed through `scaleEnemy(e, 1)` (identity,
      // same object), exactly as the single PvP `foe` is passed unscaled downstream.
      const enemyGroupRoster: Enemy[] | undefined =
        foeGroup !== undefined && foeGroup.length > 1
          ? foeGroup
          : foe === undefined && enemyIds !== undefined && enemyIds.length > 1
            ? (() => {
                const built = enemyIds
                  .map((id) => findEnemy(id))
                  .filter((e): e is Enemy => e !== undefined);
                return built.length > 1 ? built : undefined;
              })()
            : undefined;
      const enemyGroupCombatants: Combatant[] | undefined =
        enemyGroupRoster !== undefined
          ? enemyGroupRoster.map((e) => scaleEnemy(e, activeEnemyScale))
          : undefined;

      // Absent carried state = a FRESH fight (seed server-side); present = resume it.
      const state =
        carried === undefined || carried === null
          ? partyCombatants !== undefined || enemyGroupCombatants !== undefined
            ? // A multi-member party AND/OR a multi-enemy group opens a TEAM/PACK fight: seed the
              // generalized FightState (the front player member + front enemy are ALSO mirrored into
              // the scalar `player`/`enemy`, so every single reader is byte-unaffected). A length-1
              // party OR length-1 group each collapse cleanly to today's single-side seed.
              createPartyFightState(
                partyCombatants ?? [player],
                enemyGroupCombatants !== undefined ? enemyGroupCombatants[0] : scaledEnemy,
                difficulty ?? 'hard',
                activeEnemyScale,
                enemyGroupCombatants,
              )
            : createFightState(player, scaledEnemy, difficulty ?? 'hard', activeEnemyScale)
          : deserializeFightState(carried as SerializedFightState);

      // Spread-guarded ENEMY GROUP wire field (mirror of `partyField`): surface the pack on the turn
      // view when a group of >1 is fielded, OMITTED for a single-enemy fight (the identity fallback).
      const enemyMembers: { id: string; name: string }[] | undefined =
        enemyGroupRoster !== undefined
          ? enemyGroupRoster.map((e) => ({ id: e.id, name: e.name }))
          : undefined;
      const enemyField = enemyMembers !== undefined ? { enemyMembers } : {};

      // TASK-165 (R-22 slice 26): select the enemy chooser ONCE for this whole turn from the
      // ACTIVE difficulty — the fresh-request `difficulty` on an opening turn, else the carried
      // `state.difficulty` (deserialized `?? 'hard'`) on a continuing turn. `chooserForDifficulty`
      // maps it to an EXISTING byte-frozen selector ('easy' → flat chooseSkill, 'hard' → the full
      // banking chain), so every enemy seam site plays at the chosen smartness. Because the
      // telegraph reads the SAME `enemyChooser`, the enemy-intent preview stays HONEST at whatever
      // difficulty is active (an easy enemy telegraphs its flat pick; a hard enemy its banking pick).
      const enemyChooser = chooserForDifficulty(state.difficulty ?? 'hard');

      // TASK-312 (R-44b — live-opponent action seam): when a LIVE opponent supplies their chosen
      // skill (`enemyAction`), validate it ONCE server-side against the SAME palette + energy rules
      // the AI honors (invariant 2 — never trust the wire), BEFORE any mutation, so an
      // invalid/unaffordable pick refuses the turn with the fight state UNCHANGED (422, mirroring
      // the player-side pick guard + the `memberSlot`/`targetEnemyIndex` bad-pick precedent). A
      // valid pick yields the concrete `Skill`; absent → `undefined` (the AI path is byte-identical).
      let suppliedEnemySkill: Skill | undefined;
      if (enemyAction !== undefined) {
        const validatedEnemy = findCombatantSkill(enemyAction.skillId);
        if (validatedEnemy === undefined) {
          throw new UnprocessableEntityException(
            `Unknown opponent skill: ${enemyAction.skillId}.`,
          );
        }
        if (validatedEnemy.energyCost > energyAtTurnStart(state.enemy.energy)) {
          throw new UnprocessableEntityException(
            `Opponent has not enough energy for ${validatedEnemy.name}.`,
          );
        }
        suppliedEnemySkill = validatedEnemy;
      }

      // The enemy-turn CHOICE seam: return the LIVE opponent's supplied skill when present (TASK-312),
      // else the AI `enemyChooser` pick (byte-identical to today). Every enemy-turn RESOLUTION site
      // below routes through this so a two-sided PvP duel drives the opponent's champion by the human's
      // choice, while every PvE/auto/AI-PvP caller (no `enemyAction`) keeps the AI pick verbatim. The
      // telegraph seam is left on the AI chooser (it PREVIEWS the AI's intent; the human's actual pick
      // supersedes only the resolution). NO `battle.ts` change — the returned `Skill` feeds the SAME
      // `resolveActorTurn` the AI pick did.
      const resolveEnemyPick = (me: SideState, them: SideState): Skill =>
        suppliedEnemySkill ?? enemyChooser(me, them, combatant.enemy, combatant.player);

      // CONTROL-LOCK detection (TASK-153, R-22 slice 14). Read the player's ALREADY-in-scope
      // carried `statuses` at THIS interactive seam to detect a stun/freeze/sleep the engine will
      // force-skip this turn — the SAME set `resolveActorTurn`'s `stunnedThisTurn` guard skips.
      // Non-null ONLY on a LIVE fight where the player is locked; `null` once decided or unlocked.
      // A NEW pure export (`battle.ts` bytes unchanged for existing rules — invariant 5 holds); no
      // rule reads it. This makes the already-built control-lock family HONEST on the path the
      // player plays: the menu becomes empty (nothing pickable), the client shows the lock banner,
      // and the turn advances as a forced skip regardless of any posted skill (present → observable,
      // L-17). `null` when the fight has decided (mirrors nextEnemy/nextPlayer).
      const lockFor = (): BattleTurnView['playerControlLock'] =>
        state.decided !== null ? null : activeControlLock(state.player.statuses);

      // The affordable-skill MENU for the player's upcoming turn (empty once decided, or when the
      // player is control-locked — the whole turn is a forced skip so nothing is pickable).
      const menuFor = (): BattleTurnView['playerSkills'] =>
        state.decided !== null || lockFor() !== null
          ? []
          : COMBATANT_SKILLS.map((skill) => ({
              id: skill.id,
              name: skill.name,
              energyCost: skill.energyCost,
              affordable: skill.energyCost <= energyAtTurnStart(state.player.energy),
              // R-34 / TASK-205 — copy the catalog element tag through so the menu can
              // GROUP by element (display-only; no rule reads it). Omitted when a row
              // carries no element (the decoupled probe rows), so the wire stays additive.
              ...(skill.element ? { element: skill.element } : {}),
            }));

      // TELEGRAPH (TASK-142): the enemy's NEXT intended skill on a LIVE fight — REUSE the
      // pure, non-mutating enemy selector (A-36 #3 / L-16). `null` once the fight has
      // decided (nothing more to telegraph). Reading state does not mutate it.
      // TASK-144 (R-22 slice 5): use the MATCHUP-AWARE chooser so the telegraph stays
      // CONSISTENT with what the enemy actually casts (the enemy-reply below uses the SAME
      // matchup closure). The enemy presses a type/element advantage — the telegraph now
      // previews a foe worth reading.
      // TASK-162 (R-22 slice 23): the enemy AI is now FINISHER-PREFERRING —
      // `chooseSkillFinisher` WRAPS `chooseSkillMatchup`, returning a LETHAL skill when the
      // player is in KILL RANGE and delegating to the matchup pick otherwise. The telegraph
      // reads the SAME finisher selector as the enemy reply, so when the player is one hit
      // from dead the previewed intent HONESTLY shows the enemy going for the kill.
      const telegraphFor = (): BattleTurnView['nextEnemy'] => {
        if (state.decided !== null) return null;
        const pick = enemyChooser(state.enemy, state.player, combatant.enemy, combatant.player);
        // TASK-151 (R-22 slice 12): project HOW MANY actions the enemy will take next turn from
        // its carried post-drain residual `atb` + its next effective SPD, via the pure
        // `projectedBonusActions` helper (the SAME `min(cap, floor(...))` bound the drain-loop
        // applies — telegraph and resolution cannot drift). Read `state.enemy.atb` at THIS
        // interactive telegraph seam ONLY; display-only, additive, no rule reads it (invariant 5).
        const projectedActions = projectedBonusActions(
          state.enemy.atb,
          effectiveSpd(combatant.enemy, state.enemy.statuses),
        );
        return { skillId: pick.id, name: pick.name, projectedActions };
      };

      // ENEMY-side control-lock TELEGRAPH (TASK-154, R-22 slice 15): the exact enemy-side MIRROR of
      // the player-side `lockFor` (TASK-153). When the enemy carries a stun/freeze/sleep into its
      // upcoming turn, `resolveActorTurn`'s actor-SYMMETRIC `stunnedThisTurn` guard SILENTLY DISCARDS
      // the enemy's action — it forgoes its turn — yet `telegraphFor()` still shows "Enemy intends:
      // {skill}". That is a silent lie on the path the player plays (present ≠ observable, L-17). READ
      // the ALREADY-in-scope `state.enemy.statuses` via the EXISTING side-agnostic pure export
      // `activeControlLock` (added for TASK-153 — reused as-is on the enemy's array; NO new export, NO
      // battle.ts byte change, invariant 5 holds). Non-null ONLY on a LIVE fight where the enemy is
      // locked; `null` once decided (mirrors nextEnemy/nextPlayer/playerControlLock). We do NOT
      // suppress `nextEnemy`: a locked enemy still has a "next intended" pick the guard will discard,
      // so showing BOTH the intent AND "is locked — skips this turn" is honest (matches player-side).
      // NO combat rule reads this lock (A-42: no HP/round bound altered; A-36 #3 / L-16: client renders
      // the server-derived lock, computes no rule).
      const enemyLockFor = (): BattleTurnView['nextEnemyControlLock'] =>
        state.decided !== null ? null : activeControlLock(state.enemy.statuses);

      // Effective SPD for BOTH sides at the CURRENT state (TASK-147, R-22 slice 8). The
      // same `effectiveSpd(...)` the turn-order compare below already computes — threaded onto
      // the serialized snapshot so the client can render a magnitude-faithful relative SPD
      // gauge (A-130 #1). Display-only, no new computation: `resolveTurnOrder` re-uses the
      // player/enemy values via the same call. Computed fresh from `state.*.statuses` so it
      // reflects any SPD-affecting status carried on the current turn.
      const effSpdFor = (): { player: number; enemy: number } => ({
        player: effectiveSpd(combatant.player, state.player.statuses),
        enemy: effectiveSpd(combatant.enemy, state.enemy.statuses),
      });

      // PLAYER-side mini-combo FORECAST (TASK-152, R-22 slice 13). Symmetric to the enemy
      // telegraph above: project HOW MANY bonus actions the PLAYER will take next turn from
      // their carried post-drain residual `atb` + their next effective SPD, via the SAME pure
      // `projectedBonusActions` helper (the SAME drain-loop bound — forecast and resolution
      // cannot drift, and it never over-promises past MAX_ATB_BONUS_ACTIONS). The player has no
      // telegraphed "next skill" (they CHOOSE), so this carries ONLY the count on a smaller
      // `nextPlayer` sibling. Read `state.player.atb` at THIS interactive seam ONLY; display-only,
      // additive, NO rule reads it (invariant 5). `null` once the fight has decided (nothing to
      // forecast). A forecast is intent, not a contract (A-135): the player's pick may change
      // their own SPD, or the fight may end first, so next turn may differ — exactly like nextEnemy.
      const playerTelegraphFor = (): BattleTurnView['nextPlayer'] => {
        if (state.decided !== null) return null;
        const projectedActions = projectedBonusActions(
          state.player.atb,
          effectiveSpd(combatant.player, state.player.statuses),
        );
        return { projectedActions };
      };

      // FLEE (TASK-143, R-22 slice 4; the SUCCESS-ROLL added TASK-158, R-22 slice 19):
      // the first NON-skill turn action. On a LIVE fight the player attempts to
      // disengage — but flee is NO LONGER a guaranteed escape. We ROLL the pure,
      // injected-RNG `fleeSucceeds(playerSpd, enemySpd, rng)`: the escape chance rises
      // with the player's SPD relative to the enemy's (a slow Digimon fleeing a fast
      // enemy can FAIL). The rule lives on the SERVER (never the client, A-36 #3 / L-16)
      // and the ONLY entropy is the injected `rng` — production uses the deterministic
      // `DEFAULT_RNG` (flee still succeeds; the pre-D-322 fixtures are byte-preserved),
      // tests inject a fixed stub. Flee (win or lose) grants NOTHING and persists NOTHING
      // (invariant 3 untriggered — no ResourceBalance / AuditLog). Only meaningful on an
      // undecided fight; on an already-decided fight it falls through to normal handling.
      const fleeing = action === 'flee' && state.decided === null;
      const fleeFailed =
        fleeing &&
        !fleeSucceeds(
          effectiveSpd(combatant.player, state.player.statuses),
          effectiveSpd(combatant.enemy, state.enemy.statuses),
          rng,
        );
      if (fleeing && !fleeFailed) {
        // SUCCESS — byte-identical to the pre-D-322 flee contract: end the fight with
        // outcome 'fled', return the END literal WITHOUT running the enemy's reply.
        state.decided = 'fled';
        const fleeEntry: TurnLogEntry = {
          round: state.round,
          actor: 'player',
          damage: 0,
          defenderHpAfter: state.enemy.hp,
          statusEvents: ['You fled the battle.'],
        };
        return {
          state: null,
          entries: [fleeEntry],
          outcome: 'fled',
          reward: { xpGained: 0 },
          playerSkills: [],
          enemy: { id: enemy.id, name: enemy.name },
          // The UN-persisted current row — fleeing raises no XP/level (nothing written).
          digimon: this.toOwnedDigimon(found),
          nextEnemy: null,
          nextPlayer: null,
          playerControlLock: null,
          nextEnemyControlLock: null,
          // TASK-271 (R-44): surface the player party (omitted when none is set — additive).
          ...partyField,
          // TASK-273 (R-44a): surface the enemy group (omitted when a single enemy — additive).
          ...enemyField,
        };
      }

      // FLEE FAILED (TASK-158, R-22 slice 19): the escape roll MISSED. The flee attempt is
      // a WASTED action — the player forgoes their turn, but the enemy still takes its normal
      // reply and the fight CONTINUES with the carried live `state`. We express the failure
      // through the existing `entries[]` (a "You failed to flee!" `statusEvents` entry,
      // `damage:0`) + the returned live `state` — NO new wire field (D-8 #1: prefer no wire
      // change; the FE already renders `statusEvents`). This mirrors the normal exchange's
      // shape but resolves ONLY the enemy side: ATB accrues for BOTH (SPD banks regardless of
      // whether an actor acts — same pre-loop accrual as the normal turn), then the enemy
      // acts + cashes any banked bonus actions, then the round advances. The pure whole-fight
      // engine (`resolveActorTurn`/`chooseSkillMatchup`/`effectiveSpd`) is reused UNCHANGED —
      // invariant 5 holds. Invariant 3 UNtriggered (flee persists nothing, win-only reward
      // below is guarded on `outcome === 'win'`, which a flee-fail turn can reach if the enemy
      // KO's the player → outcome 'loss', never 'win', so no reward branch fires).
      if (fleeFailed) {
        const entries: TurnLogEntry[] = [];
        entries.push({
          round: state.round,
          actor: 'player',
          damage: 0,
          defenderHpAfter: state.enemy.hp,
          statusEvents: ['You failed to flee!'],
        });

        // ATB accrues for BOTH sides this turn (identical to the normal exchange's pre-loop
        // accrual — banked SPD does not depend on which actor acts). No rule change.
        const effSpd = effSpdFor();
        state.player.atb += effSpd.player;
        state.enemy.atb += effSpd.enemy;

        // Only the ENEMY acts (the player's turn was spent on the failed flee). Same
        // finisher-preferring chooser closure as the normal loop's enemy branch (TASK-162).
        // TASK-312: routes through `resolveEnemyPick` so a live opponent's supplied skill drives
        // the enemy turn (absent → the AI pick, byte-identical).
        const enemySelect = (me: SideState, them: SideState): Skill =>
          resolveEnemyPick(me, them);
        if (state.decided === null) {
          const res = resolveActorTurn(state, 'enemy', combatant, enemySelect, entries);
          if (res.decided !== null) state.decided = res.decided;
        }

        // The enemy cashes any banked ATB bonus actions (same capped drain-loop as the
        // normal exchange, enemy-only this turn).
        const bonusActions = { player: 0, enemy: 0 };
        while (
          state.decided === null &&
          state.enemy.atb >= ATB_THRESHOLD &&
          bonusActions.enemy < MAX_ATB_BONUS_ACTIONS
        ) {
          state.enemy.atb -= ATB_THRESHOLD;
          bonusActions.enemy += 1;
          const res = resolveActorTurn(state, 'enemy', combatant, enemySelect, entries);
          if (res.decided !== null) state.decided = res.decided;
        }
        const extraActed = {
          player: bonusActions.player > 0,
          enemy: bonusActions.enemy > 0,
        };

        if (state.decided === null) state.round += 1;
        const outcome = state.decided;

        // A flee-fail turn can only ever end in a 'loss' (the enemy KO's the player) or stay
        // undecided — NEVER a 'win' (the player did not attack) — so the win-reward branch
        // never fires here (invariant 3 stays untriggered; nothing is persisted).
        return {
          state:
            outcome === null ? serializeFightState(state, effSpd, extraActed, bonusActions) : null,
          entries,
          outcome,
          reward: { xpGained: 0 },
          playerSkills: menuFor(),
          enemy: { id: enemy.id, name: enemy.name },
          digimon: this.toOwnedDigimon(found),
          nextEnemy: telegraphFor(),
          nextPlayer: playerTelegraphFor(),
          playerControlLock: lockFor(),
          nextEnemyControlLock: enemyLockFor(),
          // TASK-271 (R-44): surface the player party (omitted when none is set — additive).
          ...partyField,
          // TASK-273 (R-44a): surface the enemy group (omitted when a single enemy — additive).
          ...enemyField,
        };
      }

      // CONTROL-LOCKED turn (TASK-153, R-22 slice 14): the player is stunned/frozen/asleep and the
      // engine will force-skip their action step this turn (via `resolveActorTurn`'s `stunnedThisTurn`
      // guard) REGARDLESS of any posted skill. Advance the turn WITHOUT the palette/affordability
      // validation below — a locked player has an EMPTY menu (nothing to validate against) and would
      // otherwise 422 on any skillId. The client posts `action:'pass'` (the honest no-op behind the
      // "Continue" control) OR any skillId; either way we bypass validation here and use an arbitrary
      // in-palette skill as the (discarded) `chosen` so the shared resolve loop below still type-checks.
      // NO combat rule reads the lock — the turn resolution is exactly what the auto path would do for
      // a locked actor (invariant 5): the skill is never cast, HP stays monotone (A-42).
      const playerLocked =
        skillId !== undefined || action === 'pass' || action === 'timeout'
          ? activeControlLock(state.player.statuses) !== null
          : false;

      // START PREVIEW (TASK-140): no skillId → open the fight and return the INITIAL
      // menu WITHOUT resolving a turn. The player picks their FIRST turn from this menu.
      // Resolves nothing, persists nothing (an ongoing fight grants no reward).
      // A `pass` (locked no-op) is NOT a preview — it advances the turn — so it falls through.
      // A `'timeout'` (TASK-185) likewise ADVANCES the turn (the server picks the move via
      // `chooseSkill` in the resolution seam below), so it too falls through the preview guard.
      if (skillId === undefined && action !== 'pass' && action !== 'timeout') {
        return {
          state: serializeFightState(state, effSpdFor()),
          entries: [],
          outcome: null,
          reward: { xpGained: 0 },
          playerSkills: menuFor(),
          enemy: { id: enemy.id, name: enemy.name },
          digimon: this.toOwnedDigimon(found),
          nextEnemy: telegraphFor(),
          nextPlayer: playerTelegraphFor(),
          playerControlLock: lockFor(),
          nextEnemyControlLock: enemyLockFor(),
          // TASK-271 (R-44): surface the player party (omitted when none is set — additive).
          ...partyField,
          // TASK-273 (R-44a): surface the enemy group (omitted when a single enemy — additive).
          ...enemyField,
        };
      }

      // Validate the CHOSEN skill server-side (a menu cannot cast outside the palette or
      // beyond the player's affordable energy for THIS turn). Reject BEFORE any mutation,
      // so the fight state is left UNCHANGED on a bad pick. SKIPPED entirely when the player is
      // control-locked (the forced skip discards the pick — see `playerLocked` above): a locked
      // player must NOT 422 for an unknown/unaffordable skill on a turn they cannot act.
      let chosen: Skill;
      // TASK-272 (R-44c): resolve WHICH living party member this request drives. `memberSlot` is
      // 1-based (mirrors `partySlot`); the party members are `state.players` in slot order. Default
      // (absent slot, or single-player fight) → the FRONT living member. For the single-player path
      // `actingIdx` is 0 and `actingMember` IS `state.player`, so validation/behaviour is
      // byte-identical to before (the length-1 identity anchor).
      const partyMemberStates = state.players;
      const livingIdx =
        partyMemberStates !== undefined
          ? partyMemberStates
              .map((s, i) => (s.hp > 0 ? i : -1))
              .filter((i) => i >= 0)
          : [0];
      const frontLivingIdx = livingIdx.length > 0 ? livingIdx[0] : 0;
      const requestedIdx =
        partyMemberStates !== undefined && memberSlot !== undefined ? memberSlot - 1 : frontLivingIdx;
      // A bad/dead-member pick (out of range or a downed member) → 422 with the fight UNCHANGED.
      if (
        partyMemberStates !== undefined &&
        memberSlot !== undefined &&
        (requestedIdx < 0 ||
          requestedIdx >= partyMemberStates.length ||
          partyMemberStates[requestedIdx].hp <= 0)
      ) {
        throw new UnprocessableEntityException(`Invalid or downed party member: slot ${memberSlot}.`);
      }
      const actingIdx = partyMemberStates !== undefined ? requestedIdx : 0;
      // TASK-274 (R-44b first slice): validate the per-member picked enemy target BEFORE any mutation,
      // mirroring the `memberSlot` bad-pick guard above. When `targetEnemyIndex` is provided it must be
      // an in-range index of the CURRENT living `state.enemies` set (a group must be fielded, and the
      // named enemy must be alive) — else 422 with the fight state UNCHANGED (no persist, no reward,
      // invariant 2). ABSENT → the engine falls back to `frontLivingEnemy()` (the TASK-273 identity
      // anchor). A single-enemy fight (`state.enemies` undefined) with a target pick is also a bad pick.
      if (targetEnemyIndex !== undefined) {
        const enemyStatesForPick = state.enemies;
        if (
          enemyStatesForPick === undefined ||
          !Number.isInteger(targetEnemyIndex) ||
          targetEnemyIndex < 0 ||
          targetEnemyIndex >= enemyStatesForPick.length ||
          enemyStatesForPick[targetEnemyIndex].hp <= 0
        ) {
          throw new UnprocessableEntityException(
            `Invalid or downed target enemy: index ${targetEnemyIndex}.`,
          );
        }
      }
      // The acting member's live SideState — the one whose energy gates affordability + who casts.
      const actingMember =
        partyMemberStates !== undefined ? partyMemberStates[actingIdx] : state.player;
      if (playerLocked) {
        // The player's normal turn is a FORCED SKIP (the engine's `stunnedThisTurn` guard discards
        // this pick). We hand it the FREE `attack` skill so any ATB-bonus strike the player is owed
        // this turn stays energy-free — byte-identical to the prior interactive behavior where a
        // control-locked player who posted an arbitrary affordable skill kept the free-attack
        // discard on the normal turn (no regression to the drain-loop/energy accounting).
        chosen = findCombatantSkill('attack') ?? COMBATANT_SKILLS[0];
      } else if (action === 'timeout') {
        // TASK-185 (R-24 slice 45a): the player's per-action clock expired with NO pick. Resolve
        // the turn with the engine's OWN server-authoritative default — the pure, side-agnostic
        // `chooseSkill(me, them)` (a deterministic affordable pick that falls back to the free
        // `attack` by Rule 2), the SAME default the enemy side already uses. There is no `skillId`
        // to validate, so a `'timeout'` NEVER 422s: the SERVER picks the move (invariant 1 — the
        // client cannot clock-game into a better skill). Everything downstream of `chosen` runs
        // BYTE-IDENTICALLY to a normal skill turn — a timeout is just "the server chose for you".
        // (A-42: reuses an existing affordable pick — no new mechanic, HP stays monotone.)
        chosen = chooseSkill(actingMember, state.enemy);
      } else {
        const validated = findCombatantSkill(skillId as string);
        if (validated === undefined) {
          throw new UnprocessableEntityException(`Unknown skill: ${skillId}.`);
        }
        if (validated.energyCost > energyAtTurnStart(actingMember.energy)) {
          throw new UnprocessableEntityException(`Not enough energy for ${validated.name}.`);
        }
        chosen = validated;
      }

      const entries: TurnLogEntry[] = [];

      // TASK-272 (R-44c — team-battle interactive DRIVE): the per-turn display-only ATB fields.
      // For the party drive they are inert (ATB banking stays a single-fighter affordance, deferred
      // for the team path); for the single-player path they are computed by the exchange block below.
      let effSpd: { player: number; enemy: number };
      let extraActed = { player: false, enemy: false };
      let bonusActions = { player: 0, enemy: 0 };

      // TASK-272: when a MULTI-member party is set, resolve this exchange through the pure
      // `resolveInteractivePartyExchange` primitive — the acting member casts `chosen`, every OTHER
      // living member casts the server default `chooseSkill`, and the enemy targets the FRONT living
      // member. The single-member/no-party fight falls to the byte-frozen single-`player` block in
      // the `else` (the length-1 identity anchor — invariant 5). BOTH paths then share the reward/
      // loss/return tail below unchanged.
      // TASK-272 / TASK-273: when a MULTI-member party AND/OR a MULTI-enemy group is fielded, resolve
      // this exchange through the pure `resolveInteractivePartyExchange` primitive — the acting member
      // casts `chosen`, every OTHER living member casts the server default `chooseSkill`, each enemy
      // targets the FRONT living player member, and the player hits the FRONT living enemy. A
      // single-member party + single enemy falls to the byte-frozen single-`player` block in the
      // `else` (the length-1 identity anchor — invariant 5). BOTH paths share the reward/loss/return
      // tail below unchanged. `enemyGroupCombatants` (>1) threads the enemy PACK into the exchange.
      if (
        (partyCombatants !== undefined && state.players !== undefined) ||
        (enemyGroupCombatants !== undefined && state.enemies !== undefined)
      ) {
        const enemySelectParty = (me: SideState, them: SideState): Skill =>
          resolveEnemyPick(me, them);
        const selectDefault = (me: SideState, them: SideState): Skill => chooseSkill(me, them);
        effSpd = effSpdFor();
        resolveInteractivePartyExchange(
          state,
          partyCombatants ?? [player],
          combatant.enemy,
          actingIdx,
          chosen,
          selectDefault,
          enemySelectParty,
          entries,
          rng,
          enemyGroupCombatants,
          targetEnemyIndex,
        );
      } else {

      // TURN ORDER by SPD (TASK-145, R-22 slice 6). The interactive path was hardcoded
      // player-first; the pure auto-driver `simulateBattle` instead orders each round by
      // effective SPD via `resolveTurnOrder(effectiveSpd(player,…), effectiveSpd(enemy,…))`
      // (player-first on ties — `>=`). REUSE that already-shipped, unit-tested pure helper
      // at THIS seam so a FASTER combatant strikes FIRST on the fight the player actually
      // plays — the SPD stat (inert here until now) becomes OBSERVABLE. We write NO ordering
      // logic of our own (single-sourced, A-36 #3 / L-16); `effectiveSpd` equals raw `spd`
      // when no SPD status is present (every shipped fight today), so this adds no behaviour
      // beyond raw-spd order and stays byte-parity with simulateBattle. RNG-free: a pure
      // `>=` comparison, no roll (A-53 NOT re-opened). Reordering two turns within a round
      // changes neither the round cap (MAX_ROUNDS) nor HP direction (monotone, A-42).
      // The effective SPDs THIS turn (captured BEFORE the turns resolve — the values
      // `resolveTurnOrder` uses and the gauge shows). Reused for the serialized snapshot below.
      effSpd = effSpdFor();
      const order = resolveTurnOrder(effSpd.player, effSpd.enemy);

      // TASK-148 (R-22 slice 9): GROW the carried ATB accumulator by each side's effective
      // SPD this turn, BEFORE the actor loop resolves. This is the slice's ONLY behavioural
      // add — it accrues + persists a carried number (round-tripped via serializeFightState
      // below) so the web `/battle` gauge fills across turns, the faster side faster. It
      // changes NO turn order and NO combat rule: `resolveTurnOrder`/`resolveActorTurn`/
      // `effectiveSpd`/`simulateBattle` NEVER read `atb`. Pure integer addition, no roll
      // (Math.random count in the battle engine stays 0). Uncapped here (the gauge caps its
      // FILL at 100% regardless). Turn-order AUTHORITY is a deliberately-deferred later wave.
      state.player.atb += effSpd.player;
      state.enemy.atb += effSpd.enemy;

      // Each actor resolves in SPD order via the pure, actor-parametric resolveActorTurn.
      // The player casts their validated pick (`() => chosen`); the enemy replies with the
      // MATCHUP-AWARE chooser (TASK-144) via a CLOSURE capturing the two Combatants (the
      // type/element the bare `(me, them) => Skill` seam does not carry) — NO change to
      // resolveActorTurn's signature or the seam type, consistent with the telegraph above.
      // A KO short-circuits the second actor (`state.decided !== null`), so the finishing
      // turn is still detected by `state.decided` regardless of who acted first — the
      // XP-grant-exactly-once-on-a-win logic below is unaffected.
      for (const actor of order) {
        if (state.decided !== null) break;
        const select: (me: SideState, them: SideState) => Skill =
          actor === 'player'
            ? () => chosen
            : (me, them) => resolveEnemyPick(me, them);
        const res = resolveActorTurn(state, actor, combatant, select, entries, rng);
        if (res.decided !== null) {
          state.decided = res.decided;
        }
      }

      // TASK-149 (R-22 slice 10): the ATB accumulator becomes TURN-ORDER-AUTHORITATIVE
      // at THIS interactive seam ONLY. Slices 7–9 made the bar FILL but MEAN nothing (a
      // display until a rule consumes it — present ≠ observable, L-17). Now, AFTER the
      // normal exchange, a side whose carried `atb` has crossed ATB_THRESHOLD CONSUMES the
      // threshold (`atb -= ATB_THRESHOLD`) and takes ONE EXTRA action this turn — the first
      // slice where a RULE reads `atb`, the payoff of the whole SPD/ATB legibility arc
      // (fill → hit full → DRAIN → bonus strike). Scoped to the interactive `battleTurn`:
      // it EDITS none of the pure whole-fight rules — `simulateBattle`, `resolveTurnOrder`,
      // `resolveActionSequence`, `effectiveSpd`, and `resolveActorTurn` are byte-unchanged
      // (invariant 5 — the auto-resolve `POST :id/battle` path never reads `atb`; the
      // pre-existing battle.spec fight suite staying green with NO edit IS that proof).
      //
      // We iterate the SAME SPD `order` so the faster full side strikes its bonus FIRST,
      // reuse the SAME per-actor chooser closures as the normal loop (player → `() => chosen`;
      // enemy → the matchup-aware closure), and honor the SAME `state.decided !== null`
      // short-circuit — a KO in the normal exchange OR in any bonus action ENDS the turn (no
      // bonus strike lands after a decided fight).
      //
      // TASK-150 (R-22 slice 11): the single-consume becomes a CAPPED DRAIN-LOOP. A side whose
      // banked `atb` is a MULTIPLE of the threshold now cashes out into a mini-combo: WHILE its
      // carried `atb >= ATB_THRESHOLD` AND its per-side bonus count `< MAX_ATB_BONUS_ACTIONS`
      // (and the fight is undecided), CONSUME one threshold (`atb -= ATB_THRESHOLD`) and resolve
      // ONE extra action. Slice 10 capped this at exactly one action per side; now a 2×-full bar
      // lands TWO strikes and a side that stacked a huge SPD lead lands up to the cap. The cap
      // MAX_ATB_BONUS_ACTIONS is a termination-safety bound (A-133): the per-side bonus count is
      // bounded regardless of banked `atb`. Pure integer arithmetic + reuse of the deterministic
      // chooser: no roll, the engine's Math.random count STAYS 0. A-42: the bonus actions are
      // within the SAME round (round is NOT advanced by them), every HP write inside
      // resolveActorTurn still clamps `Math.max(0,…)`, so `round <= MAX_ROUNDS` and HP
      // monotonicity are unaffected. `bonusActions` records the per-side COUNT → threaded as a
      // DISPLAY-ONLY field into serializeFightState below (with `extraActed` derived from it,
      // backward-compat) so the web `/battle` HUD can label the magnitude of the payoff (a
      // log-entry count is UNRELIABLE — a DoT/status tick logs an entry without being an action).
      bonusActions = { player: 0, enemy: 0 };
      if (state.decided === null) {
        for (const actor of order) {
          if (state.decided !== null) break;
          const select: (me: SideState, them: SideState) => Skill =
            actor === 'player'
              ? () => chosen
              : (me, them) => resolveEnemyPick(me, them);
          while (
            state.decided === null &&
            state[actor].atb >= ATB_THRESHOLD &&
            bonusActions[actor] < MAX_ATB_BONUS_ACTIONS
          ) {
            state[actor].atb -= ATB_THRESHOLD;
            bonusActions[actor] += 1;
            const res = resolveActorTurn(state, actor, combatant, select, entries, rng);
            if (res.decided !== null) {
              state.decided = res.decided;
            }
          }
        }
      }
      // `extraActed` stays a valid backward-compatible display flag: "this side took ≥1 bonus
      // action" ≡ `bonusActions > 0`. Existing slice-10 wire consumers keep working.
      extraActed = {
        player: bonusActions.player > 0,
        enemy: bonusActions.enemy > 0,
      };

      // Advance the round counter for the NEXT exchange (mirrors simulateBattle's round loop).
      if (state.decided === null) {
        state.round += 1;
      }
      }

      const outcome = state.decided;

      // 3. Persist the win reward EXACTLY ONCE — on the turn the fight ENDS with a win.
      // TASK-171 (R-22 slice 32): scale the FREE win XP by the encounter danger
      // (`activeEnemyScale`, resolved above at the rebuild seam — biome × distance ×
      // player-level) so a deadlier fight pays proportionally more progression. The
      // `scale === 1` identity guard keeps the auto/PvP/explore paths byte-frozen; still
      // FREE XP (no ResourceBalance/AuditLog — invariant 3 untriggered).
      const rewardXp = scaledBattleReward(BATTLE_XP_REWARD, activeEnemyScale);
      let digimonRow = found;
      let loot: { resource: string; amount: number; rarity?: string } | undefined;
      // TASK-269 (R-31e fourth slice): the loss-penalty amounts to SURFACE to the player.
      // Populated ONLY on the interactive PvE-loss branch (below) so the win/flee/undecided/
      // auto/PvP reward shapes stay byte-frozen; both stay `undefined` elsewhere and the
      // additive-optional reward fields are OMITTED (spread-guarded) on every other path.
      let xpLost: number | undefined;
      let inventoryWiped: boolean | undefined;
      // TASK-182 (R-23a2 slice 43): on an INTERACTIVE PvP win the caller sets `skipEconomicReward`,
      // so we skip the ENTIRE win-reward economic block below — no Digimon XP/level persistence, no
      // loot credit, no `battle_loot` audit row (a ranked duel moves no spendable value; MMR is
      // applied ONCE by the PvP service). `digimonRow` stays `found` (unchanged) and `loot` stays
      // undefined → the returned `reward` is `{ xpGained: rewardXp }` with NO `loot`, invariant 3
      // untriggered. Every PvE caller passes `skipEconomicReward === false` → this guard is a no-op
      // and the wild-win branch runs BYTE-IDENTICALLY.
      if (outcome === 'win' && !skipEconomicReward) {
        const next = applyBattleReward(
          {
            level: found.level,
            xp: found.xp,
            hp: found.hp,
            atk: found.atk,
            def: found.def,
            spd: found.spd,
            dataFire: found.dataFire,
          },
          rewardXp,
        );
        digimonRow = await tx.digimon.update({
          where: { id: digimonId },
          data: {
            level: next.level,
            xp: next.xp,
            hp: next.hp,
            atk: next.atk,
            def: next.def,
            spd: next.spd,
          },
        });

        // TASK-173 (R-22 slice 34): DANGER-SCALED LOOT DROP — the FIRST danger →
        // ECONOMIC-reward link. A wild interactive WIN now credits a small, danger-scaled
        // amount of a SPENDABLE resource (DigiCredits) into the player's persisted
        // `ResourceBalance`, banked into the SAME economy the shop/collect/evolve systems
        // use — so the win pays something the player can SEE on `/farm` and later spend.
        // Because a fight now moves SPENDABLE value, invariant 3 is GENUINELY triggered:
        // the credit + an append-only `AuditLog` row land inside THIS same `$transaction`
        // (the L-13 upsert-increment CREDIT template — collect's twin — reused on the combat
        // path for the first time; atomic, owner-scoped by `userId` — invariant 2). The drop
        // is GUARANTEED on a win (RNG-free); only its SIZE scales with `activeEnemyScale`
        // (the same biome × distance × player-level danger that scaled the XP). This does NOT
        // touch the auto `battle()` / explore / PvP reward paths — those grant no wild loot,
        // so their `reward` shape stays byte-identical (invariant 5). A LOSS credits nothing.
        const lootAmount = battleLootAmount(activeEnemyScale);
        // TASK-174 (R-22 slice 35): the loot RESOURCE depends on the encounter's biome — a
        // win in a volcanic mountain drops `EmberShard`, a swamp win `AquaPearl`, etc.
        // TASK-178 (R-22 slice 39): that resource is now DRAWN from a biome-anchored WEIGHTED
        // TABLE through the SAME injected-RNG seam this method already carries
        // (`rng: Rng = DEFAULT_RNG`, fed `LIVE_RNG` at the HTTP boundary as of slice 38), so
        // which item drops actually VARIES per fight instead of being one fixed value per biome.
        // LOAD-BEARING: `rollLootResource` returns EXACTLY the biome's PRIMARY resource (its
        // table's first entry `= lootResourceForBiome(biome)`) at `rng()===0` (= `DEFAULT_RNG`,
        // the auto / PvP / explore paths), so those wins bank the byte-identical resource slice
        // 35 shipped (invariant-5 identity proof — all pinned fixtures green, NO re-pin). A
        // missing/unknown biome (auto/PvP/explore/safe/back-compat) still falls back to the
        // shipped `BATTLE_LOOT_RESOURCE` verbatim (validated against the known `BIOMES` union —
        // no throw). Single `rng()` draw inside `rollLootResource` (L-58 multi-draw footgun
        // avoided). Only the resource STRING varies; the AMOUNT, the credit/audit SHAPE, and
        // every combat rule are untouched (A-42 held — no HP/combat state touched; invariant 3
        // shape unchanged — every drawn string is a valid free-form `ResourceBalance` row, no
        // migration).
        const lootResource =
          biome !== undefined && (BIOMES as readonly string[]).includes(biome)
            ? rollLootResource(biome as Biome, rng)
            : BATTLE_LOOT_RESOURCE;
        const existingLoot = await tx.resourceBalance.findUnique({
          where: { userId_resource: { userId, resource: lootResource } },
        });
        const amountBefore = existingLoot?.amount ?? 0;
        const amountAfter = amountBefore + lootAmount;
        // CREDIT: upsert-increment — a first win creates the row at `lootAmount`, subsequent
        // wins increment the one `userId_resource` row (never split into two).
        await tx.resourceBalance.upsert({
          where: { userId_resource: { userId, resource: lootResource } },
          create: { userId, resource: lootResource, amount: lootAmount },
          update: { amount: { increment: lootAmount } },
        });
        // Invariant 3: the append-only ledger row for THIS credit, inside the SAME tx as the
        // balance change (both commit or neither). Never updated/deleted (immutability by
        // shape, L-12); `entity`/`entityId` reference the winning Digimon without a hard FK.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'battle_loot',
            entity: 'Digimon',
            entityId: digimonId,
            resource: lootResource,
            amountBefore,
            amountAfter,
          },
        });
        // TASK-175 (R-22 slice 36): the loot now carries a DISPLAY-ONLY rarity TIER derived from
        // the encounter's biome via the pure world-domain `lootRarityForBiome` map (harder zones
        // drop rarer loot — a QUALITY dimension orthogonal to the KIND above and the danger-scaled
        // AMOUNT). Reuse the SAME known-biome guard: a missing/unknown/safe biome → 'Common' (the
        // baseline anchor), so a safe/no-biome win reports the byte-identical baseline tier an
        // un-tiered slice-35 drop implicitly had. Rarity is DISPLAY-ONLY — NOT credited/audited/
        // persisted (the credit + AuditLog row above are byte-identical to slice 35); it mirrors
        // the display-only `baseXp?`/`scaleBonus?` precedent (L-70). A-42 held (no HP/combat state
        // touched); invariant 3 shape unchanged (no new economic write).
        const baseRarity =
          biome !== undefined && (BIOMES as readonly string[]).includes(biome)
            ? lootRarityForBiome(biome as Biome)
            : 'Common';
        // TASK-176 (R-22 slice 37): the tier is now ROLLED, not fixed — drawn around the
        // biome baseline through the SAME injected-RNG seam this method already carries
        // (`rng: Rng = DEFAULT_RNG`), so a win can roll UP to a rarer tier (the FIRST loot
        // outcome that actually *varies*). LOAD-BEARING: `rollLootRarity` returns EXACTLY
        // `baseRarity` at `rng()===0` (= `DEFAULT_RNG`, the production/HTTP path), so this
        // is byte-identical to slice 36 for every existing test/fixture (invariant-5 proof);
        // a test drives the rolled-up case by calling `battleTurn` directly with a high stub
        // rng. Still DISPLAY-ONLY — only the `rarity` string varies; the credit + AuditLog
        // above are byte-unchanged, invariant 3 shape untouched, `battle.ts` absent from the
        // diff. Single `rng()` draw here (L-58 multi-draw footgun avoided).
        const lootRarity = rollLootRarity(baseRarity, rng);
        loot = { resource: lootResource, amount: lootAmount, rarity: lootRarity };
      } else if (outcome === 'loss' && !skipEconomicReward) {
        // TASK-268 (R-31e third slice): the roguelike ON-LOSS penalty in the INTERACTIVE
        // turn seam. The auto `battle()` path already penalizes a defeat (see the loss branch
        // ~:691-738), but the menu-driven `/battle/turn` fight a real player DRIVES had ONLY a
        // win-reward branch — so losing the fight you actually play cost NOTHING. This branch
        // is a byte-for-byte BEHAVIOURAL MIRROR of the auto-path loss branch (A-250): the SAME
        // `applyLossPenalty(..., lossPenaltyFor(found.level))` xp-only persist, the SAME
        // `battle-loss` audit row, and the SAME `wipeInventoryForUser`, all INSIDE THIS same
        // turn `$transaction` (never a second tx) so the xp drop + every stack destruction +
        // every audit row commit together or not at all.
        //
        // PvE-SCOPED by `!skipEconomicReward`: a PvP interactive loss (the PvP caller passes
        // `skipEconomicReward === true`, mirroring how the win block above suppresses its
        // economic reward) stays MMR-only — no xp drop, no wipe. Owner-scoped by the authed
        // `userId` (invariant 2 — only the loser's own Digimon xp + inventory change). One-way
        // door HANDLED exactly as TASK-266: SOFT (wipe soft-zeroes `quantity`, the read hides
        // zero rows), FULLY AUDITED (a `battle-loss` xp-drop row + a `battle-loss-wipe` row per
        // stack), and code-revertible (drop this branch). A-42 UNTRIGGERED (moves only xp +
        // inventory, no combat HP; `applyLossPenalty` floors xp at 0 and never de-levels).
        const penalized = applyLossPenalty(
          {
            level: found.level,
            xp: found.xp,
            hp: found.hp,
            atk: found.atk,
            def: found.def,
            spd: found.spd,
          },
          lossPenaltyFor(found.level),
        );
        digimonRow = await tx.digimon.update({
          where: { id: digimonId },
          data: { level: penalized.level, xp: penalized.xp },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'battle-loss',
            entity: 'Digimon',
            entityId: digimonId,
            resource: null,
            amountBefore: found.xp,
            amountAfter: penalized.xp,
          },
        });
        const wipedCount = await this.wipeInventoryForUser(tx, userId);
        // TASK-269: capture the loss consequences to REPORT them to the player (display-only —
        // no behaviour change). `xpLost` is the real before→after xp drop (>= 0, floored by the
        // unchanged `applyLossPenalty`); `inventoryWiped` is true iff ≥1 stack was soft-zeroed.
        xpLost = found.xp - penalized.xp;
        inventoryWiped = wipedCount > 0;
      } else if (outcome === 'loss' && skipEconomicReward && pvpLossXpPenalty) {
        // TASK-277 (R-31e — PvP-loss XP penalty, challenger only, XP-ONLY, NO wipe): the PvP
        // interactive-duel path (`skipEconomicReward === true`) was gated out of the whole loss
        // branch above (`!skipEconomicReward`), so a challenger who LOST a duel paid NO xp toll
        // (MMR/Elo only). This arm extends the roguelike on-loss penalty to the challenger with the
        // LEAST-destructive framing: the SAME `applyLossPenalty(..., lossPenaltyFor(found.level))`
        // xp-only persist + the SAME `battle-loss` audit row as the PvE branch — but it does NOT
        // call `wipeInventoryForUser` (the pack-wipe stays PvE-only, the deferred one-way child).
        // All INSIDE this same turn `$transaction` (the xp drop + the audit row commit together or
        // not at all). Owner-scoped by the authed `userId`/`found` (invariant 2 — only the loser's
        // own Digimon xp changes). Invariant 3 UNTRIGGERED (xp is FREE progress, no `ResourceBalance`
        // move). A-42 held (xp only, floored at 0, never de-levels, no HP). Reuses the shipped
        // `applyLossPenalty` / `lossPenaltyFor` / `battle-loss` audit / `xpLost` capture VERBATIM.
        const penalized = applyLossPenalty(
          {
            level: found.level,
            xp: found.xp,
            hp: found.hp,
            atk: found.atk,
            def: found.def,
            spd: found.spd,
          },
          lossPenaltyFor(found.level),
        );
        digimonRow = await tx.digimon.update({
          where: { id: digimonId },
          data: { level: penalized.level, xp: penalized.xp },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'battle-loss',
            entity: 'Digimon',
            entityId: digimonId,
            resource: null,
            amountBefore: found.xp,
            amountAfter: penalized.xp,
          },
        });
        // NO `wipeInventoryForUser` — inventory is UNTOUCHED on a PvP loss (the destructive
        // pack-wipe stays PvE-only). `xpLost` still surfaces the drop on the shared defeat notice;
        // `inventoryWiped` stays false (no stack was destroyed).
        xpLost = found.xp - penalized.xp;
        inventoryWiped = false;
      }

      return {
        state:
          outcome === null ? serializeFightState(state, effSpd, extraActed, bonusActions) : null,
        entries,
        outcome,
        reward:
          outcome === 'win' && !skipEconomicReward
            ? {
                xpGained: rewardXp,
                // TASK-172 (R-22 slice 33): make the danger→reward link LEGIBLE. When the
                // encounter danger scaled the win XP (`activeEnemyScale !== 1`), surface the
                // decomposition — `baseXp` = the un-scaled base, `scaleBonus` = the extra —
                // so the client can render "+N XP (base +bonus)". Display-only: `xpGained`
                // (the total) and the persisted `applyBattleReward` are BYTE-UNCHANGED (no new
                // XP). Omitted at scale 1 so the auto/PvP/explore reward shape stays byte-frozen.
                ...(activeEnemyScale !== 1
                  ? { baseXp: BATTLE_XP_REWARD, scaleBonus: rewardXp - BATTLE_XP_REWARD }
                  : {}),
                // TASK-173 (R-22 slice 34): the danger-scaled loot drop credited above.
                // Additive-optional — present ONLY on the interactive WIN branch, OMITTED on
                // loss / non-win / auto / PvP / explore paths → pre-slice-34 readers unchanged.
                ...(loot !== undefined ? { loot } : {}),
              }
            : {
                xpGained: 0,
                // TASK-269 (R-31e fourth slice): on the interactive PvE-LOSS branch ONLY, surface
                // the already-computed penalty so the player can be TOLD. Additive-OPTIONAL —
                // `xpLost`/`inventoryWiped` are `undefined` (and spread-OMITTED) on every non-loss
                // path (win uses the branch above; flee/undecided/auto/PvP leave them unset), so
                // every pre-slice reward reader stays byte-unchanged (invariant 5). Display-only:
                // the destruction itself is the shipped `battle-loss`/`battle-loss-wipe` behaviour
                // (invariant 3 untriggered) — this only REPORTS it.
                ...(xpLost !== undefined ? { xpLost } : {}),
                ...(inventoryWiped !== undefined ? { inventoryWiped } : {}),
              },
        playerSkills: menuFor(),
        enemy: { id: enemy.id, name: enemy.name },
        digimon: this.toOwnedDigimon(digimonRow),
        nextEnemy: telegraphFor(),
        nextPlayer: playerTelegraphFor(),
        playerControlLock: lockFor(),
        nextEnemyControlLock: enemyLockFor(),
        // TASK-271 (R-44): surface the player party (omitted when none is set — additive).
        ...partyField,
        // TASK-273 (R-44a): surface the enemy group (omitted when a single enemy — additive).
        ...enemyField,
      };
    });
  }

  /**
   * Grant the starter roster to `userId` IFF they currently own nothing, then
   * return the (now non-empty) roster. Idempotent and race-safe.
   *
   * Why the count-guard runs INSIDE an interactive `$transaction` and re-checks
   * the count (rather than trusting the caller's earlier empty read): two rapid
   * concurrent first requests from the same fresh account could BOTH observe an
   * empty roster in step 1 above and both try to grant — doubling the starters.
   * The transaction makes "count, then (if 0) createMany" atomic. On SQLite the
   * writer is serialized, so the second transaction sees the first's inserts and
   * its `count > 0` short-circuits — the starters are granted exactly once. A
   * returning player (roster already non-empty) is likewise never re-granted.
   *
   * The read-back happens OUTSIDE the transaction (a plain `findMany`) so the
   * returned roster reflects whatever is committed — the grant we just made, or
   * the concurrent grant that won the race — with the same deterministic order as
   * {@link getRosterForUser}.
   */
  private async grantStarterRosterIfEmpty(userId: string): Promise<Digimon[]> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.digimon.count({
        where: { userId, deletedAt: null },
      });
      // Only seed a genuinely empty roster; a racing grant that already committed
      // makes this > 0 and we skip (no duplicate roster).
      if (existing > 0) return;

      const starters: Prisma.DigimonCreateManyInput[] = STARTER_DIGIMON.map((starter) => ({
        ...starter,
        userId,
      }));
      await tx.digimon.createMany({ data: starters });
    });

    return this.prisma.digimon.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Project a persisted `Digimon` row to its public {@link OwnedDigimon} shape,
   * naming each field explicitly so internal columns (`userId`, `createdAt`,
   * `deletedAt`) can NEVER accidentally leak across the API boundary — the same
   * discipline the auth handlers apply to `passwordHash`. If a new public field is
   * ever added it must be added here deliberately (invariant 5: additive).
   */
  private toOwnedDigimon(digimon: Digimon): OwnedDigimon {
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
      // TASK-29 (R-6) additive fields (invariant 5): the raw XP toward the next level
      // and the current level's threshold (derived from the pure training curve), so
      // the UI can render "xp / xpToNext" progress WITHOUT mirroring the curve
      // client-side (no drift — D-8 #1). `xpToNext` is computed, not a stored column.
      xp: digimon.xp,
      xpToNext: xpForLevel(digimon.level),
      // TASK-30 (R-16) additive field (invariant 5): the accumulated typed Fire Data
      // that unlocks the variant evolution branch once it crosses the threshold. The
      // UI (TASK-31) renders it + mirrors the threshold to show branch availability.
      dataFire: digimon.dataFire,
      // TASK-189 (R-26 slice 48) additive-optional field (invariant 5): the ISO string
      // of the server-stored training-start timestamp, or `null` when not training. The
      // UI reads it to show a live elapsed indicator and gate the Start/Collect buttons.
      // `null`/absent on an old-shape row → no client change breaks.
      trainingStartedAt: digimon.trainingStartedAt
        ? digimon.trainingStartedAt.toISOString()
        : null,
      // TASK-255 (R-31a) additive-optional field (invariant 5): the persisted party
      // slot (1–3) this Digimon occupies, or `null` when not in the party. Explicit
      // whitelist projection (does not auto-flow). A follow-on client control renders
      // it to show/choose the party.
      partySlot: digimon.partySlot,
    };
  }
}
