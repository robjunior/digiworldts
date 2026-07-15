import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { DigimonService } from './digimon.service';
import { LIVE_RNG } from './rng';
import type { BattleOutcomeView, BattleTurnView, OwnedDigimon } from './digimon.types';
import { BattleDto } from './dto/battle.dto';
import { BattleTurnDto } from './dto/battle-turn.dto';
import { EvolveDto } from './dto/evolve.dto';
import { SetPartySlotDto } from './dto/set-party-slot.dto';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * `/digimon` — the server-authoritative roster API (TASK-8, R-3).
 *
 * House feature-controller shape (P-1, like {@link AuthController}): a thin HTTP
 * layer that delegates the rules to {@link DigimonService}. This is the API layer
 * TASK-9's `/collection` screen consumes over `apiUrl` (invariant 1: the SPA reads
 * the roster ONLY through this endpoint, never the datastore directly).
 *
 * `GET /digimon` (TASK-8) and `POST /digimon/:id/evolve` (TASK-18) are both NET-NEW
 * and additive (invariant 5); no existing route changes. `GET` is read-only; the
 * evolve route is the FIRST mutation here (server-authoritative evolution). Neither
 * takes a request body/DTO, so no parameter-scoped `ValidationPipe`/`expectedType`
 * is needed on this controller (unlike the auth controller's register/login bodies)
 * — the evolve target is fully determined by the path `:id` plus the Digimon's own
 * persisted `name`+`level`.
 */
@Controller('digimon')
export class DigimonController {
  // Explicit @Inject(DigimonService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. See the fuller note in
  // digimon.service.ts / auth.service.ts. Resolves identically under tsc (build).
  constructor(@Inject(DigimonService) private readonly digimonService: DigimonService) {}

  /**
   * `GET /digimon` → 200 `OwnedDigimon[]` — the signed-in player's roster.
   *
   * {@link JwtAuthGuard} (reused from AuthModule — see DigimonModule's imports)
   * runs first: it 401s a missing/invalid/expired Bearer token and, on success,
   * pins the verified principal to `request.user`. So by the time this body runs
   * the caller is authenticated; we read their id and delegate. The service
   * grants the starter roster on the first empty read (A-8), so a freshly
   * registered player still gets a non-empty roster back.
   *
   * The guard depends on `JwtService`, which resolves because DigimonModule imports
   * AuthModule (which now exports JwtAuthGuard + re-exports JwtModule — the one
   * wiring change TASK-8 made). No new guard, no passport.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  getRoster(@Req() request: AuthenticatedRequest): Promise<OwnedDigimon[]> {
    return this.digimonService.getRosterForUser(request.user.id);
  }

  /**
   * `POST /digimon/:id/evolve` → 200 evolved `OwnedDigimon` — advance one of the
   * signed-in player's OWN Digimon to its next form (TASK-18, R-8).
   *
   * The FIRST non-GET mutation on a player-owned record. Same guard idiom as
   * {@link getRoster}: {@link JwtAuthGuard} 401s a missing/invalid/expired Bearer
   * token, then pins the verified principal to `request.user`. We read the owner's
   * id (`request.user.id` — the guard maps JWT `sub`→`.id`; NOT `.sub`) and the
   * target's `:id` from the path, and delegate the whole rule to the service.
   *
   * The service enforces ownership + the evolution rules and signals failure with
   * HTTP exceptions the guard/pipe surface directly: 404 for a missing/foreign
   * Digimon (isolation, no existence leak) and 422 for an ineligible one (terminal
   * form, under-level, no variant, or not enough Fire Data), the 422 body carrying
   * the player-readable reason.
   *
   * TASK-30 (R-16): an OPTIONAL `@Body() EvolveDto` selects which branch to take —
   * `'linear'` (the original chain) or the accumulation-gated `'variant'`. An
   * absent/empty body defaults to `'linear'`, so the EXISTING no-body evolve stays
   * byte-compatible (invariant 5). P-7 footgun (skill): the body is bound with a
   * PARAMETER-SCOPED `ValidationPipe({ expectedType: EvolveDto, transform: true })`
   * (mirroring the global pipe's whitelist/transform) — NOT the global pipe alone —
   * or the vitest/esbuild transform omits the expected-type metadata and the
   * `@IsIn` validation is silently skipped under the gate.
   *
   * `@HttpCode(200)` overrides NestJS's POST-default 201 (matching `POST /auth/login`
   * and `/auth/refresh`): evolving does not CREATE a resource — it mutates an
   * existing owned row in place and returns its new form — so 200 is the honest
   * status, and pinning it makes that an explicit contract rather than an incidental
   * framework default.
   */
  @Post(':id/evolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  evolve(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, transform: true, expectedType: EvolveDto }))
    dto: EvolveDto,
  ): Promise<OwnedDigimon> {
    // TASK-188 (R-27) — feed `LIVE_RNG` into evolve's new `rng` seam at the HTTP boundary
    // (mirroring the battleTurn boundary below) so a real player's digivolution DRAWS one
    // of the species' valid champion forms at random. Entropy is drawn HERE, not inside the
    // pure `pickEvolution`/`evolution.ts` — the engine's executable `Math.random` stays 0.
    return this.digimonService.evolve(request.user.id, id, dto.branch ?? 'linear', LIVE_RNG);
  }

  /**
   * `POST /digimon/:id/party` → 200 {@link OwnedDigimon} (TASK-255, R-31a) — set or
   * clear which party SLOT one of the signed-in player's OWN Digimon occupies, so a
   * player can PERSIST their chosen party (up to 3) instead of getting the first three
   * they happened to collect (the read-only `slice(0,3)` view the Party rail shipped
   * with — TASK-243/L-149). The value-persisting MUTATION core of R-31a's add/remove
   * party strand; a follow-on client control renders it.
   *
   * Same guard idiom as {@link evolve}/{@link train}: {@link JwtAuthGuard} 401s a
   * missing/invalid Bearer token, then pins the verified principal to `request.user`;
   * we read the owner's id (`request.user.id` — NOT `.sub`) + the target's `:id` and
   * delegate. The service enforces ownership (404 on a missing/foreign/soft-deleted
   * Digimon — invariant 2, no existence leak), the one-Digimon-per-slot rule, and the
   * slot guard (`null` or an int in `[1,3]` → else 422). Party is DOMAIN state, moving
   * NO spendable value → no ResourceBalance/AuditLog (invariant 3 untriggered, like
   * train). `@HttpCode(200)` overrides the POST-default 201 (mutates an existing owned
   * row in place, creates no resource — matching train/evolve).
   *
   * The body is `{ slot: number | null }`. P-7 footgun (add-nest-feature-endpoint
   * skill): the body is bound with a PARAMETER-SCOPED `ValidationPipe({ expectedType:
   * SetPartySlotDto, whitelist, transform })` — NOT the global pipe alone — or the
   * vitest/esbuild transform omits the expected-type metadata and the `@IsInt/@Min/@Max`
   * validation is silently SKIPPED under the gate. The service ALSO re-guards `slot`, so
   * the rule holds on the direct-service path too.
   */
  @Post(':id/party')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  setPartySlot(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, transform: true, expectedType: SetPartySlotDto }))
    dto: SetPartySlotDto,
  ): Promise<OwnedDigimon> {
    return this.digimonService.setPartySlot(request.user.id, id, dto.slot);
  }

  /**
   * `POST /digimon/:id/train` → 200 trained `OwnedDigimon` (TASK-29, R-6) — grant one
   * of the signed-in player's OWN Digimon a fixed amount of XP, levelling it up (with
   * a flat stat gain) when the XP crosses the per-level threshold. The FIRST feature
   * that MOVES `level`.
   *
   * Same guard/idiom as {@link evolve}: {@link JwtAuthGuard} 401s a missing/invalid
   * Bearer token, then pins the principal to `request.user`; we read the owner's id
   * (`request.user.id`) + the target's `:id` and delegate. NO request body/DTO — the
   * grant is a fixed server constant, so (like evolve) no parameter-scoped
   * `ValidationPipe`/`expectedType` is needed. The service enforces ownership (404 on
   * a missing/foreign Digimon — invariant 2, no existence leak) and applies the pure
   * training rule. Training grants XP for FREE (invariant 3 not triggered — no
   * balance/ledger). `@HttpCode(200)` overrides the POST-default 201: training mutates
   * an existing owned row in place and returns its new state, so 200 is the honest,
   * explicit status (matching evolve).
   */
  @Post(':id/train')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  train(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<OwnedDigimon> {
    return this.digimonService.train(request.user.id, id);
  }

  /**
   * `POST /digimon/:id/train/start` → 200 {@link OwnedDigimon} (TASK-189, R-26 slice
   * 48) — OPEN a duration-based training session on one of the signed-in player's OWN
   * Digimon, stamping the server-authoritative start timestamp. Paired with
   * {@link collectTraining} (below), it replaces the old instant flat {@link train}: a
   * player trains over ELAPSED time and collects an elapsed-scaled reward.
   *
   * Same bodyless guard/idiom as {@link train}: {@link JwtAuthGuard} 401s a
   * missing/invalid token; the service enforces ownership (404 on a missing/foreign id
   * — invariant 2) and 422s a digimon already training. NO request body/DTO (the start
   * carries no client-supplied data — the timestamp is a SERVER value, invariant 1), so
   * no parameter-scoped `ValidationPipe` is needed. `@HttpCode(200)` matches
   * train/evolve (mutates an existing owned row, creates no resource).
   */
  @Post(':id/train/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  startTraining(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<OwnedDigimon> {
    return this.digimonService.startTraining(request.user.id, id);
  }

  /**
   * `POST /digimon/:id/train/collect` → 200 {@link OwnedDigimon} (TASK-189, R-26 slice
   * 48) — CLOSE the training session opened by {@link startTraining} and pay out the
   * ELAPSED-TIME-SCALED gain, so a digimon trained longer banks a measurably greater
   * stat/XP gain. Same bodyless guard idiom as {@link train}: {@link JwtAuthGuard} 401s
   * an invalid token; the service enforces ownership (404 — invariant 2), 422s a digimon
   * not currently training, computes the SERVER-authoritative elapsed (invariant 1,
   * never client-supplied), applies the pure elapsed rule, and clears the timestamp.
   * NO body/DTO. `@HttpCode(200)` matches train/evolve.
   */
  @Post(':id/train/collect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  collectTraining(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<OwnedDigimon> {
    return this.digimonService.collectTraining(request.user.id, id);
  }

  /**
   * `POST /digimon/:id/battle` → 200 {@link BattleOutcomeView} (TASK-32, R-7) — send
   * one of the signed-in player's OWN Digimon into a deterministic PvE fight against a
   * fixed enemy chosen by the body, and (on a win) grant it a FREE XP reward. The
   * turn-based combat core R-12 PvP + R-9 encounters reuse.
   *
   * Same guard idiom as {@link train}/{@link evolve}: {@link JwtAuthGuard} 401s a
   * missing/invalid Bearer token, then pins the principal to `request.user`; we read
   * the owner's id (`request.user.id`) + the target's `:id` and the chosen `enemyId`
   * and delegate. The service enforces ownership (404 on a missing/foreign Digimon —
   * invariant 2, no existence leak) and rejects an unknown enemy (422) BEFORE any
   * write. The win reward is a FREE XP grant (invariant 3 untriggered — no
   * balance/ledger, like train).
   *
   * P-7 footgun (add-nest-feature-endpoint skill): the required body is bound with a
   * PARAMETER-SCOPED `ValidationPipe({ expectedType: BattleDto, whitelist, transform })`
   * — NOT the global pipe alone — or the vitest/esbuild transform omits the
   * expected-type metadata and the `@IsString/@IsNotEmpty enemyId` validation is
   * silently SKIPPED under the gate (a missing enemyId would pass as 2xx instead of
   * 400). `@HttpCode(200)` overrides the POST-default 201: a battle resolves + may
   * mutate an existing owned row and returns the outcome — it CREATES no resource — so
   * 200 is the honest, explicit status (matching train/evolve).
   */
  @Post(':id/battle')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  battle(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, transform: true, expectedType: BattleDto }))
    dto: BattleDto,
  ): Promise<BattleOutcomeView> {
    return this.digimonService.battle(request.user.id, id, dto.enemyId);
  }

  /**
   * Resolve ONE interactive combat turn (TASK-140, R-22) — the player-agency route,
   * ADDITIVE alongside the whole-fight `POST :id/battle` (which stays byte-unchanged,
   * invariant 5). The player posts their CHOSEN `skillId` (+ the mid-fight `state` they
   * are carrying — A-123, no server session store this slice). The server validates the
   * choice server-authoritatively (palette + affordability → 422), resolves the player
   * turn + the enemy's automatic reply, and returns the carried-forward state, this
   * exchange's log entries, and the menu for the next turn. `@HttpCode(200)` for the same
   * reason as the whole-fight route (mutates/returns, creates no resource).
   */
  @Post(':id/battle/turn')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  battleTurn(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, transform: true, expectedType: BattleTurnDto }))
    dto: BattleTurnDto,
  ): Promise<BattleTurnView> {
    return this.digimonService.battleTurn(
      request.user.id,
      id,
      dto.enemyId,
      dto.skillId,
      dto.state,
      dto.action,
      // TASK-177 (R-22 slice 38): feed REAL per-player entropy into the injected-RNG
      // combat seam. Was `undefined` (→ `DEFAULT_RNG = () => 0`), which pinned every
      // roll OFF in production (never crit/evade/resist, flee always succeeded, loot
      // never varied). `LIVE_RNG = () => Math.random()` is drawn here at the HTTP
      // boundary (mirroring `world.service.ts`'s encounter roll), so the pure engine's
      // `Math.random` count STAYS 0. Two-way door: pass `undefined` again to revert.
      LIVE_RNG,
      dto.difficulty,
      dto.enemyScale,
      dto.biome,
      // foe / skipEconomicReward stay defaulted (PvE); memberSlot names the acting party member.
      undefined,
      undefined,
      dto.memberSlot,
      // TASK-273 (R-44a): the rolled ENEMY GROUP's roster ids (handed off from /world's `enemies[]`);
      // absent → the single `enemyId` foe (the length-1 identity path).
      dto.enemyIds,
      // TASK-274 (R-44b first slice): the acting member's picked enemy target (0-based living index);
      // absent → the server targets the front-living enemy (the TASK-273 identity path).
      dto.targetEnemyIndex,
    );
  }
}
