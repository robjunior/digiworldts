import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DigimonModule } from '../digimon/digimon.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PvpController } from './pvp.controller';
import { PvpGateway } from './pvp.gateway';
import { PvpService } from './pvp.service';

/**
 * Ranked-PvP feature module (TASK-36, R-12) — home of the `/api/pvp` API.
 *
 * House feature-module shape (P-1, the DIRECT analogue of {@link AdminModule} /
 * {@link ShopModule} / {@link FarmModule}): declares {@link PvpController}, provides
 * the {@link PvpService} rules, and is registered ADDITIVELY (LAST) on `AppModule`
 * (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1: the
 *    opponents roster + the player ratings are read/written only through the
 *    datastore provider);
 *  - {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on both routes
 *    (no new guard, no passport). AuthModule exports JwtAuthGuard AND re-exports
 *    `JwtModule`, so the guard's `JwtService` dependency resolves in THIS module's
 *    context (the cross-module wiring the farm/shop/admin modules established).
 *  - {@link DigimonModule} — (TASK-182, R-23a2 slice 43) to inject the exported
 *    {@link DigimonService} and drive an INTERACTIVE PvP duel through the SAME shared
 *    `battleTurn`/`resolveActorTurn` seam PvE uses, the opponent entering as the injected
 *    `foe` (TASK-180). Additive import; the whole-duel `challenge` path is unchanged.
 *
 * TASK-192 (R-25 slice 51) adds {@link PvpGateway} to `providers` — the Socket.IO realtime
 * gateway for the LIVE challenge→accept handshake. Additive (invariant 5): a NEW sibling
 * transport; the offline HTTP `/api/pvp/*` routes are byte-unchanged. It reuses the SAME
 * re-exported `JwtModule`/`JwtService` (socket auth mirrors `JwtAuthGuard`) + `PrismaService`
 * (owner-scoped display-name read) this module already has in scope.
 */
@Module({
  imports: [PrismaModule, AuthModule, DigimonModule],
  controllers: [PvpController],
  providers: [PvpService, PvpGateway],
})
export class PvpModule {}
