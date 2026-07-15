import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorldController } from './world.controller';
import { WorldService } from './world.service';

/**
 * World feature module (TASK-46, R-17a) — home of the `/api/world` API.
 *
 * House feature-module shape (P-1, the analogue of {@link ExploreModule} /
 * {@link PvpModule}), registered ADDITIVELY (LAST) on `AppModule` (invariant 5). It
 * imports {@link AuthModule} — to REUSE its exported {@link JwtAuthGuard} on the world
 * routes (AuthModule exports JwtAuthGuard AND re-exports `JwtModule`, so the guard's
 * `JwtService` dependency resolves in THIS module's context) — and (TASK-48, R-17b)
 * {@link PrismaModule}, because {@link WorldService} now PERSISTS the per-player spawn
 * (`GET /state`, the grant-on-first-read idiom) and reaches the datastore through the
 * injected `PrismaService`.
 *
 * The `GET chunk` route stays a PURE `world.map` / `world.types` call; only the new
 * spawn/encounter routes touch Prisma/RNG, via {@link WorldService}.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WorldController],
  providers: [WorldService],
})
export class WorldModule {}
