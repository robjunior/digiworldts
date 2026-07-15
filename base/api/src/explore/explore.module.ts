import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';

/**
 * Exploration feature module (TASK-40, R-9) — home of the `/api/explore` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link PvpModule} /
 * {@link ShopModule} / {@link FarmModule}): declares {@link ExploreController}, provides
 * the {@link ExploreService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    explored Digimon + the XP write are reached only through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on both routes (no
 *    new guard, no passport). AuthModule exports JwtAuthGuard AND re-exports `JwtModule`,
 *    so the guard's `JwtService` dependency resolves in THIS module's context (the
 *    cross-module wiring the farm/shop/pvp modules established).
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ExploreController],
  providers: [ExploreService],
})
export class ExploreModule {}
