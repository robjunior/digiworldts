import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DigimonController } from './digimon.controller';
import { DigimonService } from './digimon.service';

/**
 * Digimon feature module (TASK-8, R-3) — home of the `/digimon` roster API.
 *
 * House feature-module shape (P-1): declares {@link DigimonController}, provides
 * the {@link DigimonService} rules, and is registered ADDITIVELY on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1:
 *    the roster is read/written only through the datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on
 *    `GET /digimon` (no new guard, no passport). AuthModule additively exports the
 *    guard AND re-exports `JwtModule`, so the guard's `JwtService` dependency
 *    resolves in THIS module's context (the one wiring change TASK-8 made). If the
 *    guard failed to construct at boot, that missing export would be why.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DigimonController],
  providers: [DigimonService],
  // TASK-182 (R-23a2 slice 43): EXPORT the service so the PvP module can inject it and drive
  // an INTERACTIVE PvP duel through the SAME shared `battleTurn`/`resolveActorTurn` seam PvE
  // uses (the opponent entering via the TASK-180 `foe` slot). Additive (invariant 5) — no
  // existing wiring changes; DigimonModule already exports nothing, so this only grows the API.
  exports: [DigimonService],
})
export class DigimonModule {}
