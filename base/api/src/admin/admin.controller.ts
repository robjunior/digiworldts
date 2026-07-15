import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import { GrantDto } from './dto/grant.dto';
import type { GrantResult } from './admin.types';

/**
 * `/api/admin` — the server-authoritative admin-panel (live-ops) API (TASK-34,
 * R-14). The FIRST authorization tier beyond "authenticated" and the admin
 * write-path R-14's later actions reuse.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link ShopController}
 * — copied deliberately): a thin HTTP layer that delegates the rules to
 * {@link AdminService}. This is the API layer TASK-35's `/admin` screen consumes over
 * `apiUrl` (invariant 1: the SPA reaches the admin write ONLY through this endpoint,
 * never the datastore directly).
 *
 * The single route is guarded by {@link AdminGuard} (reused from AuthModule): it
 * authenticates via JwtAuthGuard (401 without a valid Bearer token) THEN requires
 * `role === 'admin'` (403 for a non-admin) — the two failure modes stay distinct. It
 * is additive (invariant 5); no existing route changes.
 */
@Controller('admin')
export class AdminController {
  // Explicit @Inject(AdminService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. Resolves identically under
  // tsc (build). NO other ctor param.
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  /**
   * `POST /api/admin/grant` → 200 {@link GrantResult} — credit a target player's
   * spendable balance (a CREDIT), audit-logged, admin-gated.
   *
   * {@link AdminGuard} runs first: 401 (no/invalid token), 403 (a valid token for a
   * non-admin), else it pins the verified admin principal to `request.user`. We read
   * the acting admin's id (`request.user.id`) and delegate. The service resolves the
   * target by email (404 if none) and performs the CREDIT + audit row in one
   * `$transaction` (invariant 3).
   *
   * The body `{ targetEmail, resource, amount }` is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist: true, transform: true, expectedType: GrantDto })`
   * — NOT a bare `@Body() dto: GrantDto` leaning on the global pipe (P-7): under the
   * vitest/esbuild transform the global pipe cannot see the DTO class and validation
   * would be SILENTLY SKIPPED (a bad body would pass as 2xx). The `whitelist` /
   * `transform` mirror the global pipe (`app.ts`). The malformed-body → 400 e2e case
   * is the guard against this regressing.
   *
   * `@HttpCode(200)` pins the response to 200 OK: a `@Post` defaults to 201 Created,
   * but a grant is not a resource creation — it credits a running balance and returns
   * the current balance, so 200 is the honest, contracted status (the same reason
   * collect/purchase/login pin 200 over the POST-default).
   */
  @Post('grant')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  grant(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: GrantDto,
      }),
    )
    dto: GrantDto,
  ): Promise<GrantResult> {
    return this.admin.grantResource(request.user.id, dto);
  }
}
