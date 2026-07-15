import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Feature module for the liveness endpoint (TASK-2).
 *
 * Bundling the controller in its own module (rather than registering it directly
 * on {@link AppModule}) keeps the root module a thin composition root and lets
 * `/health` evolve — or be swapped for a richer readiness check later — without
 * churning unrelated wiring. Registering this module in AppModule is purely
 * additive, preserving invariant 5 (the public API only grows).
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
