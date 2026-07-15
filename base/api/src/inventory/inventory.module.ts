import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Inventory feature module (TASK-262, R-31b) — home of the `/api/inventory` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link FarmModule} /
 * {@link ShopModule}): declares {@link InventoryController}, provides the
 * {@link InventoryService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    inventory is read only through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on
 *    `GET /api/inventory` (no new guard, no passport). AuthModule additively exports
 *    the guard AND re-exports `JwtModule`, so the guard's `JwtService` dependency
 *    resolves in THIS module's context (the cross-module wiring the farm/shop modules
 *    established). If the guard failed to construct at boot, that missing export would
 *    be why — but AuthModule already exports both, so no AuthModule edit is needed here.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
