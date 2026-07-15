import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Digimon } from '@prisma/client';
import { Combatant, Enemy, simulatePvpDuel } from '../digimon/battle';
import { DigimonService } from '../digimon/digimon.service';
import { DEFAULT_RNG, type Rng } from '../digimon/rng';
import { applyLossPenalty, lossPenaltyFor } from '../digimon/training';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeDto } from './dto/challenge.dto';
import { ChallengeTurnDto } from './dto/challenge-turn.dto';
import { elo } from './rating';
import type { OpponentView, PvpOutcomeView, PvpTurnView } from './pvp.types';

/**
 * Ranked-PvP domain logic (TASK-36, R-12) — the FIRST player-vs-player write path.
 * This slice ships ONE observable ranked fight: a player picks a specific OPPONENT
 * (another real player) and fights them; the EXISTING deterministic
 * {@link simulateBattle} resolves the whole fight, and BOTH players' `mmr` rating
 * moves by a standard Elo step ({@link elo}). It establishes the `mmr` rating column
 * + the PvP write-path R-12's later slices (matchmaking, a live queue, a leaderboard,
 * seasons — carved children, A-24) reuse.
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link AdminService} /
 * {@link ShopService}, copied deliberately): the controller owns HTTP concerns (the
 * routes, the JwtAuthGuard), this owns the rules. It reaches the datastore ONLY
 * through the injected {@link PrismaService} (invariant 1) — nothing bypasses the
 * provider; the opponents roster + the ratings are read/written only here.
 *
 * A ranked match is NOT an economic mutation: MMR/rating is DOMAIN progression, not
 * spendable value (exactly like R-6 XP + R-7 battle rewards), so it moves NO
 * `ResourceBalance` and writes NO `AuditLog` row (invariant 3 is NOT triggered; the
 * ledger is for value-moving mutations, L-12/L-13). The whole match — resolve both
 * combatants, run the sim, apply BOTH rating moves — is ONE `$transaction` so the two
 * symmetric rating updates commit together or not at all (a win for one is the loss
 * for the other; they must never half-apply).
 */
@Injectable()
export class PvpService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike
  // the production `nest build` via tsc), so a bare `private readonly prisma` injects
  // `undefined` under the gate and the first request 500s. Naming the provider needs
  // no reflected metadata, so it resolves identically under esbuild (tests) and tsc
  // (build). The SECOND ctor param (TASK-182, R-23a2 slice 43) is the injected
  // {@link DigimonService} — the interactive PvP turn DELEGATES to its shared
  // `battleTurn` seam (the opponent entering as the `foe`), so a PvP and a PvE fight
  // run the SAME engine. Both are @Inject-tokened for the same P-7 reason.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DigimonService) private readonly digimon: DigimonService,
  ) {}

  /**
   * List the OTHER players the caller may challenge (`GET /api/pvp/opponents`).
   *
   * Reads every active user except the caller (`id: { not: callerId }, deletedAt:
   * null`), then for each resolves their CHAMPION — their strongest owned, non-soft-
   * deleted Digimon (`orderBy:[{level:'desc'},{id:'asc'}]`, `take:1`; the `id` tiebreak
   * makes the pick deterministic when several share a level, e.g. all-level-1
   * starters). A user with NO Digimon is SKIPPED (there is nothing to challenge).
   *
   * The projection is deliberately minimal (invariant 2): only `userId`, a
   * non-identifying `displayName` (the email's LOCAL PART, before `@` — so no full
   * email leaks cross-user), the opponent's `mmr`, and the champion's `name`. No
   * email, passwordHash, balance, resource, or any other private account state is
   * ever read into the view.
   */
  async listOpponents(callerId: string): Promise<OpponentView[]> {
    const others = await this.prisma.user.findMany({
      where: { id: { not: callerId }, deletedAt: null },
    });

    const opponents: OpponentView[] = [];
    for (const other of others) {
      const champion = await this.prisma.digimon.findFirst({
        where: { userId: other.id, deletedAt: null },
        orderBy: [{ level: 'desc' }, { id: 'asc' }],
      });
      // Skip a player with no roster — there is no champion to field, so they are
      // not a challengeable opponent in this slice.
      if (champion === null) continue;
      opponents.push({
        userId: other.id,
        // Only the email's LOCAL PART (before the first '@'), never the full email
        // (invariant 2 — no cross-user private data leak).
        displayName: localPart(other.email),
        mmr: other.mmr,
        championName: champion.name,
      });
    }
    return opponents;
  }

  /**
   * Resolve a ranked challenge (`POST /api/pvp/challenge`): the caller fights the
   * player named by `dto.opponentId`; the deterministic {@link simulateBattle}
   * decides it, and BOTH ratings move by an Elo step — PERSISTED.
   *
   * All in ONE `$transaction` (so both symmetric rating updates commit together):
   *  1. `opponentId === challengerId` → 422 ("Cannot challenge yourself"), before any
   *     read — a self-match is meaningless and would double-update one row.
   *  2. The challenger's CHAMPION — their strongest owned, active Digimon
   *     (owner-scoped to `challengerId`, `orderBy:[{level:'desc'},{id:'asc'}]`) → 422
   *     if they own none ("You have no Digimon to battle").
   *  3. The opponent USER (`{ id: opponentId, deletedAt: null }`) → 404 if unknown or
   *     soft-deleted (a generic not-found — invariant 2, no enumeration hint), then
   *     THEIR champion the same way → 422 if the opponent has none.
   *  4. Map each Digimon to a {@link Combatant} EXACTLY as `DigimonService.battle`
   *     does (name/type/element/hp/atk/def/spd — Combatant has no `level`). Run the
   *     pure, RNG-free {@link simulateBattle}(challenger, opponent); the result is
   *     from the FIRST arg's (the challenger's) perspective.
   *  5. Apply the Elo step to BOTH ratings ({@link elo}) — two absolute `tx.user.update`
   *     writes (a win for the challenger is the symmetric loss for the opponent). NO
   *     audit row (invariant 3 untriggered — rating is domain progression).
   *
   * Returns the outcome + turn log + both rating moves (the opponent side carries a
   * non-identifying `displayName`, never the email — invariant 2).
   */
  async challenge(challengerId: string, dto: ChallengeDto): Promise<PvpOutcomeView> {
    const opponentId = dto.opponentId;

    // A self-challenge is rejected BEFORE any read (it would also collide the two
    // rating updates onto one row). 422: well-formed + authorized but not a valid
    // target — the same status family the PvE battle uses for an ineligible target.
    if (opponentId === challengerId) {
      throw new UnprocessableEntityException('Cannot challenge yourself.');
    }

    return this.prisma.$transaction(async (tx) => {
      // The challenger's champion (owner-scoped — invariant 2). None → 422 (they have
      // nothing to field), before touching the opponent.
      const challengerDigimon = await tx.digimon.findFirst({
        where: { userId: challengerId, deletedAt: null },
        orderBy: [{ level: 'desc' }, { id: 'asc' }],
      });
      if (challengerDigimon === null) {
        throw new UnprocessableEntityException('You have no Digimon to battle.');
      }

      // The opponent user. Unknown or soft-deleted → a GENERIC 404 (invariant 2 — no
      // enumeration signal). Read inside the tx so both ratings move atomically.
      const opponent = await tx.user.findFirst({
        where: { id: opponentId, deletedAt: null },
      });
      if (opponent === null) {
        throw new NotFoundException('Opponent not found.');
      }

      // The opponent's champion. None → 422 (they cannot field a fighter).
      const opponentDigimon = await tx.digimon.findFirst({
        where: { userId: opponent.id, deletedAt: null },
        orderBy: [{ level: 'desc' }, { id: 'asc' }],
      });
      if (opponentDigimon === null) {
        throw new UnprocessableEntityException('Opponent has no Digimon to battle.');
      }

      // Map each Digimon to the combat projection EXACTLY as DigimonService.battle
      // does — the pure sim needs only these fields (no `level`).
      const challengerCombatant = toCombatant(challengerDigimon);
      const opponentCombatant = toCombatant(opponentDigimon);

      // The pure, RNG-free rule owns the WHOLE fight (turn order, matchup damage,
      // termination). Result is from the FIRST arg's (challenger's) perspective, so
      // the same two rosters ALWAYS produce the same outcome (deterministic → the
      // e2e asserts it exactly). TASK-181 (R-23a1 slice 42): re-pointed off the
      // second whole-fight code path (`simulateBattleAtb`) onto `simulatePvpDuel`,
      // which resolves the duel by looping the SHARED per-turn `resolveActorTurn`
      // seam the interactive PvE fight drives — unifying PvE and PvP onto the ONE
      // shared per-turn engine (R-23). This slice injects flat `chooseSkill` for BOTH
      // sides, so `simulatePvpDuel` is byte-equivalent to `simulateBattleAtb` (the
      // deep-equal oracle proves it) → PvP outcomes + fixtures are UNCHANGED; the
      // difficulty-aware banking opponent AI is the next slice (a one-line chooser
      // swap inside `simulatePvpDuel`). The MMR Elo step + `$transaction` below are
      // UNCHANGED (invariant 3 untriggered: MMR is a rating, not spendable).
      const result = simulatePvpDuel(challengerCombatant, opponentCombatant);
      const challengerWon = result.outcome === 'win';

      // Elo step, BOTH players (a = challenger, b = opponent). Symmetric + zero-sum:
      // the winner's gain is the loser's loss (up to rounding). Read the challenger's
      // OWN current rating inside the same tx (the opponent's rides on `opponent`).
      const challenger = await tx.user.findFirst({
        where: { id: challengerId, deletedAt: null },
      });
      // The authenticated caller always resolves (the guard proved the token); the
      // guard is defensive so `mmr` is always a number.
      const mmrBeforeChallenger = challenger?.mmr ?? 1000;
      const mmrBeforeOpponent = opponent.mmr;
      const moved = elo(mmrBeforeChallenger, mmrBeforeOpponent, challengerWon);

      // Two ABSOLUTE updates inside the tx — commit together or not at all. `where:
      // { id }` safely drops any owner filter: the same-tx reads already proved both
      // rows exist and SQLite's serialized writer means no interleaving write changed
      // them within the tx.
      await tx.user.update({
        where: { id: challengerId },
        data: { mmr: moved.a },
      });
      await tx.user.update({
        where: { id: opponent.id },
        data: { mmr: moved.b },
      });

      return {
        outcome: result.outcome,
        turns: result.turns,
        challenger: {
          mmrBefore: mmrBeforeChallenger,
          mmrAfter: moved.a,
        },
        opponent: {
          displayName: localPart(opponent.email),
          mmrBefore: mmrBeforeOpponent,
          mmrAfter: moved.b,
        },
      };
    });
  }

  /**
   * Resolve ONE turn of an INTERACTIVE ranked duel (`POST /api/pvp/challenge/turn`,
   * TASK-182, R-23a2 slice 43) — the second outcome half of R-23: a PvP fight is now
   * driven turn-by-turn through the SAME shared `battleTurn`/`resolveActorTurn` engine
   * a PvE `/world` encounter uses, so both are visibly the SAME interactive combat UI.
   *
   * The challenger drives their own champion; the OPPONENT's champion is resolved
   * SERVER-SIDE from the DB (invariant 2 — never client-supplied) and injected as the
   * shared seam's `foe` (the TASK-180 injection point). The duel resolves through the
   * byte-frozen engine (`battle.ts` is only CALLED with a `foe`, never modified —
   * invariant 5, A-36 #3 / L-16).
   *
   * Steps:
   *  1. Resolve the challenger's champion (their strongest owned, active Digimon —
   *     the SAME read `challenge` uses) → 422 if they own none. This is the `:id`
   *     `battleTurn` reads owner-scoped, so the challenger's stats are DB-authoritative.
   *  2. Resolve the opponent USER (`{ id, deletedAt: null }`) → 404 if unknown/soft-
   *     deleted (invariant 2, no enumeration hint), then THEIR champion → 422 if none.
   *     Map it to the `Enemy` shape (`toCombatant(opp)` + a synthetic stable id).
   *  3. DELEGATE to `DigimonService.battleTurn(...)` passing the opponent as `foe` and
   *     `skipEconomicReward = true` — a PvP win pays NO loot and levels NO Digimon (MMR
   *     is the ranked progression; invariant 3 stays untriggered inside the shared seam).
   *     The opponent's champion replies via the shared `chooserForDifficulty` dispatch —
   *     the challenger's `dto.difficulty` (TASK-183) selects the tier (`'easy'`→flat
   *     `chooseSkill`, `'normal'`→finisher, `'hard'` (the default when omitted)→the full
   *     banking chain), the SAME tiers PvE resolves.
   *  4. On the ENDING turn ONLY (`battle.outcome !== null`), apply the Elo `$transaction`
   *     ONCE — the SAME symmetric two-`tx.user.update` move `challenge` produces — and
   *     surface both `RatingMove`s. A `'fled'` end is a LOSS for the challenger (they
   *     disengaged the ranked duel) — the honest ranked consequence. Mid-fight turns
   *     move NO rating (both `challenger`/`opponent` are `null`).
   *
   * `rng` defaults to the deterministic `DEFAULT_RNG` (the direct-service e2e path,
   * L-55/L-56); the controller injects `LIVE_RNG` at the HTTP boundary so real duels
   * crit/evade/resist like a PvE fight — the pure engine's `Math.random` stays 0.
   */
  async challengeTurn(
    challengerId: string,
    dto: ChallengeTurnDto,
    rng: Rng = DEFAULT_RNG,
  ): Promise<PvpTurnView> {
    const opponentId = dto.opponentId;

    // A self-duel is rejected before any read (same family as `challenge` — 422).
    if (opponentId === challengerId) {
      throw new UnprocessableEntityException('Cannot challenge yourself.');
    }

    // The challenger's champion — owner-scoped (invariant 2), the strongest active
    // Digimon exactly as `challenge`/`listOpponents` pick it. This is the `:id`
    // `battleTurn` reads owner-scoped, so the shared seam rebuilds its stats from the DB.
    const challengerDigimon = await this.prisma.digimon.findFirst({
      where: { userId: challengerId, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    if (challengerDigimon === null) {
      throw new UnprocessableEntityException('You have no Digimon to battle.');
    }

    // The opponent user (unknown/soft-deleted → generic 404, invariant 2) + their champion.
    const opponent = await this.prisma.user.findFirst({
      where: { id: opponentId, deletedAt: null },
    });
    if (opponent === null) {
      throw new NotFoundException('Opponent not found.');
    }
    const opponentDigimon = await this.prisma.digimon.findFirst({
      where: { userId: opponent.id, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    if (opponentDigimon === null) {
      throw new UnprocessableEntityException('Opponent has no Digimon to battle.');
    }

    // Map the opponent's champion to the injected `foe`. `Enemy = Combatant & { id }` —
    // the champion's row id is a stable, DB-authoritative id (used only as a label; the
    // seam's roster lookup is superseded by the `foe`). The engine consumes a plain
    // Combatant, so the opponent fights EXACTLY as a wild foe would.
    const foe: Enemy = { ...toCombatant(opponentDigimon), id: opponentDigimon.id };

    // TASK-275 (R-44b — team PvP party-vs-party): ALSO read the opponent's persisted PARTY
    // (owner-scoped to the OPPONENT by id — invariant 2, never trusted from the wire). If the
    // opponent has SET a party (>1 partySlot-non-null rows) the challenger drives their own party
    // against the OPPONENT'S WHOLE party (each member rebuilt server-side from the DB row → `Enemy`);
    // ≤1 row → `foeGroup = undefined` → the single-champion `foe` path is byte-identical (the
    // identity anchor). The FRONT of the group is the champion `foe` (the seam mirrors
    // `enemyGroup[0]` into the scalar `enemy`, so keeping the champion first matches the wild-roster
    // path where `enemyIds[0]` === the scalar `enemyId`); the remaining party members follow in
    // partySlot order (the champion is excluded from the tail to avoid a duplicate).
    const opponentPartyRows = await this.prisma.digimon.findMany({
      where: { userId: opponent.id, deletedAt: null, partySlot: { not: null } },
      orderBy: [{ partySlot: 'asc' }],
    });
    const foeGroup: Enemy[] | undefined =
      opponentPartyRows.length > 1
        ? [
            foe,
            ...opponentPartyRows
              .filter((row) => row.id !== opponentDigimon.id)
              .map((row) => ({ ...toCombatant(row), id: row.id })),
          ]
        : undefined;

    // DELEGATE to the shared interactive seam. The challenger's own champion is the
    // owner-scoped `:id`; the opponent enters through `foe`. `skipEconomicReward = true`
    // so a PvP win moves NO spendable value (no loot credit / audit row / Digimon level).
    const battle = await this.digimon.battleTurn(
      challengerId,
      challengerDigimon.id,
      // enemyId is unused when a `foe` is supplied (the override supersedes the roster
      // lookup) — pass the opponent id as a harmless stable label.
      opponentDigimon.id,
      dto.skillId,
      dto.state,
      dto.action,
      rng,
      // TASK-183 (R-23a2 slice 44a): forward the challenger's chosen DIFFICULTY into the
      // shared seam's `difficulty` slot. Omitted → `undefined` → `battleTurn`'s `?? 'hard'`
      // → byte-identical to TASK-182 (every existing duel/fixture unchanged). This selects
      // WHICH enemy selector the opponent's champion runs (`chooserForDifficulty`:
      // `'easy'`→flat `chooseSkill`, `'normal'`→finisher, `'hard'`→the full banking chain) —
      // the SAME tiers PvE resolves. No enemyScale / biome (a duel is not a wild map
      // encounter — biome-derived scaling/loot stays PvE-only).
      dto.difficulty,
      undefined,
      undefined,
      foe,
      true,
      // memberSlot / enemyIds / targetEnemyIndex — unused by the PvP path (the challenger's own
      // party is read+driven by `battleTurn` from the authed user's partySlot rows, front-member/
      // front-target this slice; the PvP DTO carries no per-member pick yet). Pass through to reach
      // the trailing `foeGroup`.
      undefined,
      undefined,
      undefined,
      // TASK-275 (R-44b): the opponent's whole persisted party (>1) as the injected enemy group;
      // undefined → the single-champion `foe` 1v1 path is byte-identical (identity anchor).
      foeGroup,
      // TASK-277 (R-31e): apply the XP-ONLY on-loss penalty to the CHALLENGER when they lose this
      // duel (the SAME level-scaled+capped `lossPenaltyFor` a PvE loss applies), surfaced through
      // the already-shipped `reward.xpLost` defeat-notice field. `skipEconomicReward` STAYS true
      // (MMR-only reward, NO win-loot), and inventory is NOT wiped (PvP wipe stays a deferred
      // child). xp is FREE progress → invariant 3 UNTRIGGERED. The win/MMR/Elo path below is
      // byte-unchanged. If the realtime `PvpGateway` delegates here it inherits this for free.
      true,
      // TASK-312 (R-44b — live-opponent action seam): forward the opponent's chosen skill so the
      // shared seam drives the OPPONENT'S champion turn with THAT skill instead of the AI pick (a
      // two-sided duel). Absent (`dto.opponentSkillId === undefined`) → `undefined` → the AI-driven
      // opponent turn, byte-identical to TASK-182. The seam VALIDATES it against the palette/energy
      // rules (invariant 2 — never trusted; the opponent's champion STATS stay DB-authoritative via
      // `foe`/`foeGroup`, only the *choice* of skill is supplied), refusing the turn (422) with the
      // fight UNCHANGED on an illegal/unaffordable pick. `skipEconomicReward` STAYS true (a duel
      // moves no spendable value — invariant 3 UNTRIGGERED).
      dto.opponentSkillId !== undefined ? { skillId: dto.opponentSkillId } : undefined,
    );

    // Mid-fight: no rating move (invariant 3 untriggered — MMR unmoved until the duel ends).
    if (battle.outcome === null) {
      return { battle, challenger: null, opponent: null };
    }

    // The duel ENDED — apply the Elo move EXACTLY ONCE, the SAME symmetric step
    // `challenge` produces. A `'fled'` end counts as a LOSS for the challenger (they
    // disengaged the ranked duel); a `'win'` is a win; a `'loss'` a loss.
    const challengerWon = battle.outcome === 'win';
    return this.prisma.$transaction(async (tx) => {
      // Re-read both current ratings inside the tx so the two absolute updates commit
      // together (a win for one is the symmetric loss for the other — never half-apply).
      const challenger = await tx.user.findFirst({
        where: { id: challengerId, deletedAt: null },
      });
      const opp = await tx.user.findFirst({
        where: { id: opponent.id, deletedAt: null },
      });
      const mmrBeforeChallenger = challenger?.mmr ?? 1000;
      const mmrBeforeOpponent = opp?.mmr ?? 1000;
      const moved = elo(mmrBeforeChallenger, mmrBeforeOpponent, challengerWon);

      await tx.user.update({ where: { id: challengerId }, data: { mmr: moved.a } });
      await tx.user.update({ where: { id: opponent.id }, data: { mmr: moved.b } });

      // TASK-279 (R-31e — OPPONENT-loss xp penalty): when the challenger WINS this ranked duel
      // the OPPONENT lost; where today that cost the opponent ONLY MMR/Elo, they now ALSO take the
      // SAME level-scaled, capped xp toll a PvE / challenger-PvP / forfeit loss applies (xp-only,
      // NO wipe — inventory intact, the destructive pack-wipe stays a deferred one-way child).
      // Owner-scoped by the DB-authoritative `opponentDigimon.id` (invariant 2 — only the
      // opponent's OWN champion changes, never a wire id). Reuses `applyLossPenalty` /
      // `lossPenaltyFor` / the `battle-loss` audit VERBATIM (the TASK-277/278 mirror). Invariant 3
      // UNTRIGGERED (xp is FREE progress, `resource:null`, NO `ResourceBalance` move; MMR/Elo
      // byte-unchanged). A-42 held (xp only, floored at 0, never de-levels, no HP). Guarded on the
      // challenger having won AND the opponent's champion being re-readable in the tx — a duel the
      // challenger did NOT win writes NO opponent penalty (the invariant-5 identity anchor: every
      // existing loss/fled/mid-fight duel is byte-identical). Re-read the opponent's champion by id
      // INSIDE the tx so the xp write commits against the current row atomically with the MMR moves
      // (mirroring how TASK-278 re-reads the leaver in-tx).
      if (challengerWon) {
        const oppDigimon = await tx.digimon.findFirst({
          where: { id: opponentDigimon.id, deletedAt: null },
        });
        if (oppDigimon !== null) {
          const penalized = applyLossPenalty(
            {
              level: oppDigimon.level,
              xp: oppDigimon.xp,
              hp: oppDigimon.hp,
              atk: oppDigimon.atk,
              def: oppDigimon.def,
              spd: oppDigimon.spd,
            },
            lossPenaltyFor(oppDigimon.level),
          );
          await tx.digimon.update({
            where: { id: oppDigimon.id },
            data: { level: penalized.level, xp: penalized.xp },
          });
          await tx.auditLog.create({
            data: {
              userId: opponent.id,
              action: 'battle-loss',
              entity: 'Digimon',
              entityId: oppDigimon.id,
              resource: null,
              amountBefore: oppDigimon.xp,
              amountAfter: penalized.xp,
            },
          });
        }
      }

      return {
        battle,
        challenger: { mmrBefore: mmrBeforeChallenger, mmrAfter: moved.a },
        opponent: {
          displayName: localPart(opponent.email),
          mmrBefore: mmrBeforeOpponent,
          mmrAfter: moved.b,
        },
      };
    });
  }

  /**
   * TASK-197 (R-25a-follow2 slice 56) — score an ABANDONED live match as a forfeit: the
   * player who dropped (`leaverId`) LOSES, the still-connected player (`remainerId`) WINS.
   *
   * Before this slice a mid-duel disconnect (`PvpGateway.handleDisconnect`) only NOTIFIED
   * the stranded opponent (TASK-194's `opponent_left`) and wrote ZERO rating — leaving a
   * losing live fight was consequence-free. This closes the unmet half of I-13's outcome
   * clause: an abandoned live fight now resolves as a SCORED forfeit so BOTH players' MMR
   * moves and the remaining player sees a real win.
   *
   * REUSE, don't re-implement (A-36 #3 / L-16, one shared rating system per R-23): this
   * mirrors the EXACT `elo(...)` + owner-scoped `tx.user.update({mmr})` shape
   * {@link challengeTurn} applies on a terminal outcome (`:339-364`) — the SAME `deletedAt`
   * guard, the SAME `?? 1000` default, the SAME single symmetric `$transaction` so the win
   * for one and the loss for the other commit together or not at all. `battle.ts` / the
   * engine is NOT touched (the gateway never runs the engine on a forfeit — the outcome is
   * a rating move, not a combat resolution). MMR is domain progression, NOT spendable value,
   * so — exactly like `challengeTurn` — this writes NO `AuditLog` row and moves NO
   * `ResourceBalance` (invariant 3 UNTRIGGERED, A-176/A-179).
   *
   * The two participant ids are resolved by the gateway from the server-side `matches`
   * room membership keyed off the VERIFIED `socket.data.userId` (invariant 2), never a
   * client field. The returned `ratings` before→after lets the gateway push a scored
   * `match_forfeited` result the web `pvp-result` block renders.
   */
  async forfeitMatch(
    remainerId: string,
    leaverId: string,
  ): Promise<{
    outcome: 'win';
    ratings: {
      remainer: { before: number; after: number };
      leaver: { before: number; after: number };
    };
  }> {
    return this.prisma.$transaction(async (tx) => {
      const remainer = await tx.user.findFirst({
        where: { id: remainerId, deletedAt: null },
      });
      const leaver = await tx.user.findFirst({
        where: { id: leaverId, deletedAt: null },
      });
      const remBefore = remainer?.mmr ?? 1000;
      const leavBefore = leaver?.mmr ?? 1000;

      // TASK-278 (R-31e — forfeit/leaver xp penalty): a player who ABANDONS a live duel is
      // forfeit-scored a loss; where today that cost ONLY MMR, they now ALSO take the SAME
      // level-scaled, capped xp toll a PvE / challenger-PvP loss applies (xp-only, NO wipe —
      // inventory intact, the destructive pack-wipe stays a deferred one-way child). Owner-scoped
      // by the gateway-verified `leaverId` (invariant 2 — only the leaver's OWN champion changes,
      // never a wire id). Reuses the shipped `applyLossPenalty` / `lossPenaltyFor` / `battle-loss`
      // audit VERBATIM (digimon.service.ts:1814-1839). Invariant 3 UNTRIGGERED (xp is FREE progress,
      // `resource:null`, NO `ResourceBalance` move, MMR/Elo byte-unchanged). A-42 held (xp only,
      // floored at 0, never de-levels, no HP). The block is UNCONDITIONAL in the tx (a forfeit
      // ALWAYS scores the leaver a loss) but guarded on the leaver actually OWNING a champion — a
      // leaver with NO Digimon is byte-identical to today (the invariant-5 identity anchor).
      const leaverDigimon = await tx.digimon.findFirst({
        where: { userId: leaverId, deletedAt: null },
        orderBy: [{ level: 'desc' }, { id: 'asc' }],
      });
      if (leaverDigimon !== null) {
        const penalized = applyLossPenalty(
          {
            level: leaverDigimon.level,
            xp: leaverDigimon.xp,
            hp: leaverDigimon.hp,
            atk: leaverDigimon.atk,
            def: leaverDigimon.def,
            spd: leaverDigimon.spd,
          },
          lossPenaltyFor(leaverDigimon.level),
        );
        await tx.digimon.update({
          where: { id: leaverDigimon.id },
          data: { level: penalized.level, xp: penalized.xp },
        });
        await tx.auditLog.create({
          data: {
            userId: leaverId,
            action: 'battle-loss',
            entity: 'Digimon',
            entityId: leaverDigimon.id,
            resource: null,
            amountBefore: leaverDigimon.xp,
            amountAfter: penalized.xp,
          },
        });
      }

      // `elo(a, b, aWon)` returns `{a, b}` — here a = remainer (the WINNER), b = leaver.
      const moved = elo(remBefore, leavBefore, true);

      if (remainer) {
        await tx.user.update({ where: { id: remainerId }, data: { mmr: moved.a } });
      }
      if (leaver) {
        await tx.user.update({ where: { id: leaverId }, data: { mmr: moved.b } });
      }

      return {
        outcome: 'win' as const,
        ratings: {
          remainer: { before: remBefore, after: moved.a },
          leaver: { before: leavBefore, after: moved.b },
        },
      };
    });
  }
}

/**
 * The email's LOCAL PART (everything before the first `@`) — the non-identifying
 * display name. Never exposes the domain or the full address (invariant 2). Falls
 * back to the whole string only if there is no `@` (a malformed stored email, which
 * registration prevents).
 */
function localPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

/**
 * Map a persisted {@link Digimon} row to the pure combat {@link Combatant} — exactly
 * the fields the sim needs, dropping `level` and everything else (identical to the
 * mapping in {@link DigimonService.battle}).
 */
function toCombatant(d: Digimon): Combatant {
  return {
    name: d.name,
    type: d.type,
    element: d.element,
    hp: d.hp,
    // TASK-126 (R-17c): maxHp = the fighter's FULL HP (the persisted `Digimon.hp` IS the full HP;
    // this projection never persists mid-fight HP) — inits from the SAME `d.hp`, NO new
    // column/migration. The substrate the pure engine's execute finisher reads.
    maxHp: d.hp,
    atk: d.atk,
    def: d.def,
    spd: d.spd,
  };
}
