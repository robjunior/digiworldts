import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Datastore module (TASK-4, R-2) — the Prisma provider's home.
 *
 * It follows the house feature-module shape (like {@link HealthModule}): a
 * self-contained module registered ADDITIVELY on {@link AppModule} (invariant 5,
 * the composition root only grows). Unlike a plain feature module it declares no
 * controller — it is infrastructure — and it `exports` {@link PrismaService} so
 * any feature module that imports `PrismaModule` (TASK-5's auth module first) can
 * inject the single shared client. Later this may become `@Global()` if the
 * datastore is needed pervasively, but explicit imports are kept for now so the
 * dependency graph stays visible.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
