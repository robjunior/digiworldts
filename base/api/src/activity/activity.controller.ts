import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ActivityService } from './activity.service';
import type { ActivityFeed } from './activity.types';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * `/activity` — the signed-in player's recent audited-action feed (TASK-248, R-31 — the
 * SIXTH & LAST dual-sidebar rail; the default-route RIGHT "Activity" rail consumes it).
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link DailyController} —
 * copied deliberately): a thin HTTP layer delegating the read to {@link ActivityService}.
 * This is the API layer the Activity sidebar rail consumes over `apiUrl` (invariant 1:
 * the SPA reads ONLY through this endpoint, never the datastore directly).
 *
 * `GET /activity` is READ-ONLY (projects the append-only `AuditLog` ledger — no mutation,
 * invariant 3 untriggered) and ADDITIVE (invariant 5; no existing route changes).
 */
@Controller('activity')
export class ActivityController {
  // Explicit @Inject(ActivityService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject `undefined`
  // and the route would 500 under the gate. Resolves identically under tsc (build).
  constructor(@Inject(ActivityService) private readonly activityService: ActivityService) {}

  /**
   * `GET /activity` → 200 {@link ActivityFeed} — the caller's most recent audited actions.
   *
   * {@link JwtAuthGuard} (reused from AuthModule — see ActivityModule's imports) runs first:
   * it 401s a missing/invalid/expired Bearer token and, on success, pins the verified
   * principal to `request.user`. The feed is owner-scoped to `request.user.id` — the
   * verified JWT `sub`, NEVER a client-supplied value (invariant 2).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  getActivity(@Req() request: AuthenticatedRequest): Promise<ActivityFeed> {
    return this.activityService.getFeedForUser(request.user.id);
  }
}
