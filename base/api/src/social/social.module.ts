import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

/**
 * Social feature module (TASK-44, R-11) — home of the `/api/social` friends API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link MarketModule} /
 * {@link PvpModule}): declares {@link SocialController}, provides the
 * {@link SocialService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    friendship edges + the counterpart users are read/written only through the
 *    datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on all three routes
 *    (no new guard, no passport). AuthModule exports JwtAuthGuard AND re-exports
 *    `JwtModule`, so the guard's `JwtService` dependency resolves in THIS module's
 *    context (the cross-module wiring the farm/shop/pvp/market modules established).
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}
