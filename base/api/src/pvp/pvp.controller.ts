import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LIVE_RNG } from '../digimon/rng';
import { ChallengeDto } from './dto/challenge.dto';
import { ChallengeTurnDto } from './dto/challenge-turn.dto';
import { PvpService } from './pvp.service';
import type { OpponentView, PvpOutcomeView, PvpTurnView } from './pvp.types';

/**
 * `/api/pvp` — the ranked player-vs-player API (TASK-36, R-12). The FIRST PvP surface
 * and the write-path R-12's later slices (matchmaking, a live queue, a leaderboard,
 * seasons — carved children, A-24) reuse.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link AdminController}
 * / {@link ShopController} — copied deliberately): a thin HTTP layer that delegates
 * the rules to {@link PvpService}. This is the API layer TASK-37's `/pvp` screen
 * consumes over `apiUrl` (invariant 1: the SPA reaches the opponents roster + the
 * ranked write ONLY through these endpoints, never the datastore directly).
 *
 * Both routes are guarded by the EXISTING {@link JwtAuthGuard} (reused from
 * AuthModule via `imports: [AuthModule]`): 401 without a valid Bearer token. The
 * module is additive (invariant 5); no existing route changes.
 */
@Controller('pvp')
export class PvpController {
  // Explicit @Inject(PvpService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. Resolves identically under
  // tsc (build). NO other ctor param.
  constructor(@Inject(PvpService) private readonly pvp: PvpService) {}

  /**
   * `GET /api/pvp/opponents` → 200 {@link OpponentView}[] — the OTHER players the
   * caller may challenge (each a minimal public view: userId, a non-identifying
   * display name, mmr, champion name). JwtAuthGuard pins `request.user`; we read the
   * caller's id and delegate (the caller is excluded from their own opponents list).
   */
  @Get('opponents')
  @UseGuards(JwtAuthGuard)
  opponents(@Req() request: AuthenticatedRequest): Promise<OpponentView[]> {
    return this.pvp.listOpponents(request.user.id);
  }

  /**
   * `POST /api/pvp/challenge` → 200 {@link PvpOutcomeView} — challenge the player
   * named by `opponentId`; the deterministic `simulateBattle` resolves it and BOTH
   * ratings move by an Elo step (persisted).
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the challenger's id
   * (`request.user.id`, never trusted from the body) and delegate. The service
   * resolves both champions + both ratings and applies the symmetric Elo move in one
   * `$transaction` (422 self-challenge / challenger-has-no-Digimon / opponent-has-no-
   * Digimon; 404 unknown opponent).
   *
   * The body `{ opponentId }` is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist, transform, expectedType: ChallengeDto })` — NOT a
   * bare `@Body() dto: ChallengeDto` leaning on the global pipe (P-7): under the
   * vitest/esbuild transform the global pipe cannot see the DTO class and validation
   * would be SILENTLY SKIPPED (a bad body would pass as 2xx). The malformed-body →
   * 400 e2e case is the guard against this regressing.
   *
   * `@HttpCode(200)` pins the response to 200 OK: a `@Post` defaults to 201 Created,
   * but a challenge is not a resource creation — it returns the resolved match, so
   * 200 is the honest, contracted status (the same reason battle/collect/purchase
   * pin 200 over the POST default).
   */
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  challenge(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: ChallengeDto,
      }),
    )
    dto: ChallengeDto,
  ): Promise<PvpOutcomeView> {
    return this.pvp.challenge(request.user.id, dto);
  }

  /**
   * `POST /api/pvp/challenge/turn` → 200 {@link PvpTurnView} — resolve ONE turn of an
   * INTERACTIVE ranked duel (TASK-182, R-23a2 slice 43). The challenger drives their
   * champion turn-by-turn against the opponent's champion through the SAME shared
   * `battleTurn` engine PvE uses (the opponent injected as `foe`); on the ending turn
   * the Elo move applies exactly once and both `RatingMove`s surface.
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the challenger's id
   * (`request.user.id`, never trusted from the body) and delegate. `LIVE_RNG` is drawn
   * HERE at the HTTP boundary (mirroring the PvE turn route + `world.service.ts`) so a
   * real duel crits/evades/resists like a PvE fight while the pure engine's
   * `Math.random` count STAYS 0.
   *
   * The body is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist, transform, expectedType: ChallengeTurnDto })` (P-7 —
   * the malformed-body → 400 e2e guards against the global-pipe-skip regression).
   * `@HttpCode(200)` for the same reason as `challenge` (resolves + returns, creates
   * no resource). The whole-duel `challenge` route above is UNCHANGED (the reversible
   * cut — the door stays two-way).
   */
  @Post('challenge/turn')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  challengeTurn(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: ChallengeTurnDto,
      }),
    )
    dto: ChallengeTurnDto,
  ): Promise<PvpTurnView> {
    return this.pvp.challengeTurn(request.user.id, dto, LIVE_RNG);
  }
}
