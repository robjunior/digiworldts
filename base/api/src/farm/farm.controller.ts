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
import { FarmService } from './farm.service';
import type { FarmState } from './farm.types';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * `/farm` — the server-authoritative Farm/City API (TASK-15, R-4; collect TASK-22,
 * R-4b).
 *
 * House feature-controller shape (P-1, the DIRECT analogue of
 * {@link DigimonController} — copied deliberately): a thin HTTP layer that
 * delegates the rules to {@link FarmService}. This is the API layer TASK-16's
 * `/farm` screen consumes over `apiUrl` (invariant 1: the SPA reads the farm ONLY
 * through this endpoint, never the datastore directly), and it lights up the
 * Dashboard's reserved Resources/Production widgets.
 *
 * `GET /farm` is read-only. `POST /farm/collect` (R-4b) is the FIRST economic
 * mutation: it banks each ready building's accrued buffer into the player's
 * spendable balance and — because it MOVES value — writes an append-only audit row
 * (invariant 3), all inside one `$transaction` (the rules live in the service).
 * Both routes are additive (invariant 5); no existing route changes.
 */
@Controller('farm')
export class FarmController {
  // Explicit @Inject(FarmService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. See the fuller note in
  // farm.service.ts / digimon.service.ts. Resolves identically under tsc (build).
  constructor(@Inject(FarmService) private readonly farmService: FarmService) {}

  /**
   * `GET /farm` → 200 `FarmState` — the signed-in player's buildings, each with
   * its computed-on-read `produced` amount, plus their spendable `balance` (R-4b).
   *
   * {@link JwtAuthGuard} (reused from AuthModule — see FarmModule's imports) runs
   * first: it 401s a missing/invalid/expired Bearer token and, on success, pins
   * the verified principal to `request.user`. So by the time this body runs the
   * caller is authenticated; we read their id (`request.user.id` — the guard maps
   * the JWT `sub` → `.id`) and delegate. The service materializes the starting
   * buildings on the first empty read (A-8), so a freshly registered player still
   * gets their three starters back.
   *
   * The guard depends on `JwtService`, which resolves because FarmModule imports
   * AuthModule (which exports JwtAuthGuard + re-exports JwtModule — the wiring
   * TASK-8 established for cross-module guard reuse). No new guard, no passport.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  getFarm(@Req() request: AuthenticatedRequest): Promise<FarmState> {
    return this.farmService.getFarmForUser(request.user.id);
  }

  /**
   * `POST /farm/collect` → 200 `FarmState` — bank every ready building's accrued
   * production into the player's spendable balance (TASK-22, R-4b). The game's
   * FIRST economic mutation and FIRST invariant-3 audit write.
   *
   * Guarded by the SAME reused {@link JwtAuthGuard} as `GET /farm` (401 without a
   * valid Bearer token — the mutation is unreachable signed out; acceptance check
   * 6), and owner-scoped in the service (`request.user.id` → the caller only ever
   * collects their OWN buildings and banks into their OWN balance — invariant 2).
   *
   * NO request body — "collect all ready buildings" needs none — so NO DTO and NO
   * parameter-scoped `ValidationPipe`/`expectedType` is required (friction #1 of
   * the guarded-endpoint traps is thereby sidestepped, exactly like `getFarm`).
   * The whole mutation (re-read → upsert-credit the balance → reset the accrual
   * clock → append the audit row, per non-zero building) runs inside a single
   * `$transaction` in {@link FarmService.collectForUser}, which returns the fresh
   * `FarmState` (reset `produced` + updated `balance`).
   *
   * `@HttpCode(200)` pins the response to 200 OK: a `@Post` defaults to 201
   * Created, but collect is not a resource-creation — it banks into (and may
   * create-or-update) a running balance and returns the CURRENT farm state, so 200
   * is the honest, contracted status (the same reason login pins 200 over the
   * POST-default; the collect e2e asserts it).
   */
  @Post('collect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  collect(@Req() request: AuthenticatedRequest): Promise<FarmState> {
    return this.farmService.collectForUser(request.user.id);
  }
}
