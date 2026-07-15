import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/**
 * Activity-feed feature module (TASK-248, R-31) — home of the `/activity` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link DailyModule}): declares
 * {@link ActivityController}, provides the {@link ActivityService} read, and is registered
 * ADDITIVELY (LAST) on `AppModule` (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the audit
 *    ledger is read only through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on `/activity` (no new
 *    guard, no passport). AuthModule additively exports the guard AND re-exports
 *    `JwtModule`, so the guard's `JwtService` dependency resolves in THIS module's context.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
