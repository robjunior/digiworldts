import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

/**
 * Player-market feature module (TASK-42, R-10) — home of the `/api/market` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link ShopModule} /
 * {@link PvpModule} / {@link FarmModule}): declares {@link MarketController}, provides
 * the {@link MarketService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    listings, balances, ledger, and Digimon rows are read/written only through the
 *    datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on all three
 *    routes (no new guard, no passport). AuthModule exports JwtAuthGuard AND re-exports
 *    `JwtModule`, so the guard's `JwtService` dependency resolves in THIS module's
 *    context (the cross-module wiring the farm/shop/pvp modules established).
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
