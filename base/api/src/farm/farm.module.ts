import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FarmController } from './farm.controller';
import { FarmService } from './farm.service';

/**
 * Farm/City feature module (TASK-15, R-4) — home of the `/farm` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link DigimonModule}):
 * declares {@link FarmController}, provides the {@link FarmService} rules, and is
 * registered ADDITIVELY (LAST) on `AppModule` (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    farm is read/written only through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on
 *    `GET /farm` (no new guard, no passport). AuthModule additively exports the
 *    guard AND re-exports `JwtModule`, so the guard's `JwtService` dependency
 *    resolves in THIS module's context (the cross-module wiring TASK-8
 *    established). If the guard failed to construct at boot, that missing export
 *    would be why — but AuthModule already exports both, so no AuthModule edit is
 *    needed for this slice.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FarmController],
  providers: [FarmService],
})
export class FarmModule {}
