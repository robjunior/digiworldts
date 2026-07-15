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
import { PurchaseDto } from './dto/purchase.dto';
import { ShopService } from './shop.service';
import type { ShopState } from './shop.types';

/**
 * `/api/shop` — the server-authoritative premium-shop API (TASK-26, R-13). Where
 * DigiCredits get a purpose and the ethical-monetization pillar goes live.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link FarmController}
 * — copied deliberately): a thin HTTP layer that delegates the rules to
 * {@link ShopService}. This is the API layer TASK-27's `/shop` screen consumes over
 * `apiUrl` (invariant 1: the SPA reads/writes the shop ONLY through these
 * endpoints, never the datastore directly).
 *
 * `GET /api/shop` returns the catalog + the player's DigiCredits balance (granting
 * the A-17 starter on first visit). `POST /api/shop/purchase` is an economic
 * mutation (a DEBIT): it spends DigiCredits, applies a QoL effect, and — because it
 * MOVES value — writes an append-only audit row (invariant 3), all inside one
 * `$transaction` (the rules live in the service). Both routes are additive
 * (invariant 5); no existing route changes.
 */
@Controller('shop')
export class ShopController {
  // Explicit @Inject(ShopService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. See the fuller note in
  // shop.service.ts / farm.service.ts. Resolves identically under tsc (build). NO
  // other ctor param (friction #3).
  constructor(@Inject(ShopService) private readonly shop: ShopService) {}

  /**
   * `GET /api/shop` → 200 {@link ShopState} — the signed-in player's catalog + their
   * DigiCredits balance (the A-17 starter granted on the first visit).
   *
   * {@link JwtAuthGuard} (reused from AuthModule — see ShopModule's imports) runs
   * first: it 401s a missing/invalid/expired Bearer token and, on success, pins the
   * verified principal to `request.user`. So by the time this body runs the caller
   * is authenticated; we read their id (`request.user.id` — the guard maps the JWT
   * `sub` → `.id`, the SAME extraction `FarmController`/`DigimonController` use) and
   * delegate. The service grants the starter DigiCredits on the first empty read
   * (A-17), so a freshly registered player still sees a stocked, funded shop.
   *
   * The guard depends on `JwtService`, which resolves because ShopModule imports
   * AuthModule (which exports JwtAuthGuard + re-exports JwtModule — the cross-module
   * wiring the farm/roster modules rely on). No new guard, no passport.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  getShop(@Req() request: AuthenticatedRequest): Promise<ShopState> {
    return this.shop.getShopForUser(request.user.id);
  }

  /**
   * `POST /api/shop/purchase` → 200 {@link ShopState} — buy the named catalog item:
   * DEBIT DigiCredits, apply the QoL effect (raise the Meat Farm's capacity), and
   * append the invariant-3 audit row, all atomically in the service's
   * `$transaction`. Returns the fresh shop state (the balance dropped).
   *
   * Guarded by the SAME reused {@link JwtAuthGuard} as `GET /api/shop` (401 without a
   * valid Bearer token — the spend is unreachable signed out), and owner-scoped in
   * the service (`request.user.id` → the caller spends only their OWN DigiCredits and
   * upgrades only their OWN building — invariant 2).
   *
   * The body `{ itemId }` is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist: true, transform: true, expectedType: PurchaseDto })`
   * — NOT a bare `@Body() dto: PurchaseDto` leaning on the global pipe (friction #4,
   * P-7): under the vitest/esbuild transform the global pipe cannot see the DTO class
   * and validation would be SILENTLY SKIPPED (a bad body would pass as 2xx). The
   * `whitelist`/`transform` mirror the global pipe (`app.ts`). The malformed-body →
   * 400 e2e case is the guard against this regressing. The service maps an unknown
   * `itemId` → 404 and an unaffordable purchase → 422.
   *
   * `@HttpCode(200)` pins the response to 200 OK: a `@Post` defaults to 201 Created,
   * but a purchase is not a resource creation — it debits a running balance and
   * returns the CURRENT shop state, so 200 is the honest, contracted status (the same
   * reason collect/login pin 200 over the POST-default; TASK-27 + the e2e assert 200).
   */
  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  purchase(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: PurchaseDto,
      }),
    )
    dto: PurchaseDto,
  ): Promise<ShopState> {
    return this.shop.purchaseForUser(request.user.id, dto.itemId);
  }
}
