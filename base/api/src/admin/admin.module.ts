import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Admin-panel feature module (TASK-34, R-14) — home of the `/api/admin` live-ops API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link ShopModule} /
 * {@link FarmModule}): declares {@link AdminController}, provides the
 * {@link AdminService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    target's balance + the audit ledger are read/written only through the datastore
 *    provider);
 *  - {@link AuthModule} — to REUSE its exported {@link AdminGuard} (which internally
 *    delegates to {@link JwtAuthGuard}) on the grant route (no new guard, no
 *    passport). AuthModule additively exports AdminGuard + JwtAuthGuard AND
 *    re-exports `JwtModule`, so the guards' `JwtService` dependency resolves in THIS
 *    module's context (the cross-module wiring the farm/shop modules established).
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
