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
import { DiscardItemDto } from './dto/discard-item.dto';
import { UseItemDto } from './dto/use-item.dto';
import { InventoryService } from './inventory.service';
import type {
  DiscardInventoryItemResult,
  InventoryState,
  UseInventoryItemResult,
} from './inventory.types';

/**
 * `/api/inventory` — the server-authoritative player-inventory API (TASK-262, R-31b).
 * The read half of the space-limited inventory pillar; the WRITE (a grant) rides the
 * EXISTING shop-purchase mutation (invariant 3), so this controller is read-only.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link FarmController}
 * — copied deliberately): a thin HTTP layer that delegates the rules to
 * {@link InventoryService}. This is the API layer the Inventory rail consumes over
 * `apiUrl` (invariant 1: the SPA reads the inventory ONLY through this endpoint, never
 * the datastore directly). The single route is additive (invariant 5); no existing
 * route changes.
 */
@Controller('inventory')
export class InventoryController {
  // Explicit @Inject(InventoryService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. See the fuller note in
  // inventory.service.ts / farm.service.ts. Resolves identically under tsc (build).
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  /**
   * `GET /api/inventory` → 200 {@link InventoryState} — the signed-in player's owned
   * item stacks (each with its resolved display name + quantity).
   *
   * {@link JwtAuthGuard} (reused from AuthModule — see InventoryModule's imports) runs
   * first: it 401s a missing/invalid/expired Bearer token and, on success, pins the
   * verified principal to `request.user`. So by the time this body runs the caller is
   * authenticated; we read their id (`request.user.id` — the guard maps the JWT `sub`
   * → `.id`, the SAME extraction `FarmController`/`ShopController` use, NEVER a
   * client-supplied userId — invariant 2) and delegate. A player who has bought
   * nothing gets `{ items: [] }`.
   *
   * The guard depends on `JwtService`, which resolves because InventoryModule imports
   * AuthModule (which exports JwtAuthGuard + re-exports JwtModule — the cross-module
   * wiring the farm/shop modules rely on). No new guard, no passport.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  getInventory(@Req() request: AuthenticatedRequest): Promise<InventoryState> {
    return this.inventory.getInventoryForUser(request.user.id);
  }

  /**
   * `POST /api/inventory/use` → 200 {@link UseInventoryItemResult} — USE one unit of an
   * owned consumable on a chosen owned Digimon (TASK-263, R-31b child i): spend a stack
   * unit AND grant its server-authoritative XP boost to the target Digimon, atomically.
   * The whole value move (decrement + XP grant + audit row) rides ONE `$transaction` in
   * the service (invariant 3).
   *
   * Guarded by the SAME reused {@link JwtAuthGuard} as `GET /api/inventory` (401 without
   * a valid Bearer token — the use is unreachable signed out), and owner-scoped in the
   * service (`request.user.id` → the caller spends only their OWN stack and boosts only
   * their OWN Digimon — invariant 2, NEVER a client-supplied userId).
   *
   * The body `{ itemId, digimonId }` is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist: true, transform: true, expectedType: UseItemDto })` —
   * NOT a bare `@Body() dto: UseItemDto` leaning on the global pipe (P-7): under the
   * vitest/esbuild transform the global pipe cannot see the DTO class and validation
   * would be SILENTLY SKIPPED. Mirrors `ShopController.purchase` verbatim. The service
   * maps an unusable/unowned item → 422 and a foreign/unknown Digimon → 404.
   *
   * `@HttpCode(200)` pins the response to 200 OK (a `@Post` defaults to 201 Created, but
   * this is not a resource creation — it spends a stack and returns the current result;
   * the same reason purchase/collect pin 200 over the POST-default).
   */
  @Post('use')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  useItem(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: UseItemDto,
      }),
    )
    dto: UseItemDto,
  ): Promise<UseInventoryItemResult> {
    return this.inventory.useItemForUser(request.user.id, dto.itemId, dto.digimonId);
  }

  /**
   * `POST /api/inventory/discard` → 200 {@link DiscardInventoryItemResult} — DISCARD a
   * whole owned stack (TASK-265, R-31b child ii): destroy the stack to FREE a slot in the
   * space-limited inventory. The stack IS the destroyed resource, so the whole value move
   * (the `quantity` zero-out + the audit row) rides ONE `$transaction` in the service
   * (invariant 3). No refund (A-247 — pure destruction, moves no `ResourceBalance`).
   *
   * Guarded by the SAME reused {@link JwtAuthGuard} as the other routes (401 without a
   * valid Bearer token), and owner-scoped in the service (`request.user.id` → the caller
   * discards only their OWN stack; invariant 2, NEVER a client-supplied userId). The
   * service maps an unowned/already-drained stack → 422 (rolling back with NO write).
   *
   * The body `{ itemId }` is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist: true, transform: true, expectedType: DiscardItemDto })` —
   * NOT a bare `@Body() dto: DiscardItemDto` leaning on the global pipe (P-7): under the
   * vitest/esbuild transform the global pipe cannot see the DTO class and validation would
   * be SILENTLY SKIPPED. Mirrors `useItem` verbatim.
   *
   * `@HttpCode(200)` pins the response to 200 OK (a `@Post` defaults to 201 Created, but
   * this destroys a stack and returns the current result — the same reason use/purchase
   * pin 200 over the POST-default).
   */
  @Post('discard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  discardItem(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: DiscardItemDto,
      }),
    )
    dto: DiscardItemDto,
  ): Promise<DiscardInventoryItemResult> {
    return this.inventory.discardItemForUser(request.user.id, dto.itemId);
  }
}
