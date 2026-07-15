import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

/**
 * Premium-shop feature module (TASK-26, R-13) — home of the `/api/shop` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link FarmModule} /
 * {@link DigimonModule}): declares {@link ShopController}, provides the
 * {@link ShopService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    balance, the audit ledger, and the target building are read/written only
 *    through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on both shop
 *    routes (no new guard, no passport). AuthModule additively exports the guard AND
 *    re-exports `JwtModule`, so the guard's `JwtService` dependency resolves in THIS
 *    module's context (the cross-module wiring the farm/roster modules established).
 *    If the guard failed to construct at boot, that missing export would be why —
 *    but AuthModule already exports both, so no AuthModule edit is needed here.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule {}
