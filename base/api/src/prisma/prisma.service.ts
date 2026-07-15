import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The project's first datastore provider (TASK-4, R-2).
 *
 * `PrismaService` IS the Prisma client (it extends {@link PrismaClient}), wrapped
 * as an `@Injectable()` so Nest owns its lifecycle and any feature that needs the
 * database injects this one instance rather than newing up its own connection.
 * Keeping persistence behind a Nest provider is how invariant 1 (all data access
 * goes through the API layer) is realised on the server: nothing outside a Nest
 * module can reach the datastore.
 *
 * Connection management is tied to the module lifecycle, not left implicit:
 *  - `onModuleInit` opens the connection eagerly at boot so a bad DATABASE_URL
 *    fails fast on startup (a red gate / crashed process) instead of on the first
 *    request in production.
 *  - `onModuleDestroy` closes it so tests (and graceful shutdowns) don't leak the
 *    SQLite handle — the e2e suite spins many app instances, so a leaked handle
 *    would exhaust file descriptors and flake the gate.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to the datastore');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
