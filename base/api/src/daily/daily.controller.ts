import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DailyService } from './daily.service';
import type { DailyClaimResult, DailyState } from './daily.types';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * `/daily` — the server-authoritative daily-reward claim loop (TASK-235, R-40).
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link FarmController} —
 * copied deliberately): a thin HTTP layer that delegates the rules to
 * {@link DailyService}. This is the API layer the follow-on Dashboard slide widget
 * consumes over `apiUrl` (invariant 1: the SPA reads/claims ONLY through this endpoint,
 * never the datastore directly).
 *
 * `GET /daily` is read-only. `POST /daily/claim` is the economic mutation: it credits the
 * current streak-day's reward into the player's spendable balance and — because it MOVES
 * value — writes an append-only audit row (invariant 3), all inside one `$transaction`
 * (the rules live in the service). Both routes are additive (invariant 5); no existing
 * route changes.
 */
@Controller('daily')
export class DailyController {
  // Explicit @Inject(DailyService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject `undefined`
  // and the route would 500 under the gate. Resolves identically under tsc (build).
  constructor(@Inject(DailyService) private readonly dailyService: DailyService) {}

  /**
   * `GET /daily` → 200 `DailyState` — the signed-in player's current streak state
   * (streakDay, claimedToday, nextDay, the 7-entry rewards table). Read-only.
   *
   * {@link JwtAuthGuard} (reused from AuthModule — see DailyModule's imports) runs first:
   * it 401s a missing/invalid/expired Bearer token and, on success, pins the verified
   * principal to `request.user` (the guard maps the JWT `sub` → `.id`).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  getDaily(@Req() request: AuthenticatedRequest): Promise<DailyState> {
    return this.dailyService.getStateForUser(request.user.id);
  }

  /**
   * `POST /daily/claim` → 200 `DailyClaimResult` — grant the current streak-day's reward,
   * advance the streak, and refuse a second claim the same UTC calendar day (409). The
   * first invariant-3 audit write of R-40.
   *
   * Guarded by the SAME reused {@link JwtAuthGuard} (401 without a valid Bearer token —
   * the mutation is unreachable signed out), and owner-scoped in the service
   * (`request.user.id` → the caller only ever claims for their OWN account, invariant 2).
   *
   * NO request body — "claim my daily reward" needs none — so NO DTO and NO
   * parameter-scoped `ValidationPipe`/`expectedType` (the P-7 validation footgun is
   * thereby sidestepped, exactly like `farm/collect`). `@HttpCode(200)` pins the honest
   * status: the POST advances a streak + returns current state, it creates no resource,
   * so 201 would lie.
   */
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  claim(@Req() request: AuthenticatedRequest): Promise<DailyClaimResult> {
    return this.dailyService.claimForUser(request.user.id);
  }
}
