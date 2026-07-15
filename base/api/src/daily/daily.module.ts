import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DailyController } from './daily.controller';
import { DailyService } from './daily.service';

/**
 * Daily-reward feature module (TASK-235, R-40) — home of the `/daily` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link FarmModule}): declares
 * {@link DailyController}, provides the {@link DailyService} rules, and is registered
 * ADDITIVELY (LAST) on `AppModule` (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    streak/balance are read/written only through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on `/daily` +
 *    `/daily/claim` (no new guard, no passport). AuthModule additively exports the guard
 *    AND re-exports `JwtModule`, so the guard's `JwtService` dependency resolves in THIS
 *    module's context (the cross-module wiring TASK-8 established).
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DailyController],
  providers: [DailyService],
})
export class DailyModule {}
