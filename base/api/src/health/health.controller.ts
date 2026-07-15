import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthStatus } from './health.types';
import { resolveVersion } from './version';

/**
 * `GET /health` — application-liveness endpoint (TASK-2, R-1).
 *
 * The server-side half of R-1's "a live health/status call renders on screen":
 * any HTTP client (TASK-3's SPA, a load balancer, a human with `curl`) can hit
 * this and get REAL, changing data. It is deliberately dependency-free (A-2):
 * a liveness probe, not a readiness probe — it never touches a database, cache,
 * or queue (none exist in R-1). Reaching this handler at all is the proof the
 * process is alive, so the verdict is a constant `'ok'`; the live signal is
 * `uptime`, which increases on every call.
 */
@Controller('health')
export class HealthController {
  /**
   * The process version is resolved ONCE at construction: it cannot change while
   * the process runs, so re-reading env/disk on every request would be pointless
   * work on a hot path. `uptime`, by contrast, MUST be read per request — it is
   * the field that makes the response live.
   */
  private readonly version = resolveVersion();

  @Get()
  @HttpCode(HttpStatus.OK)
  // Nest already serialises objects as JSON, but we assert the header explicitly
  // so the `Content-Type: application/json` half of the contract is guaranteed
  // and self-documented rather than incidental.
  @Header('Content-Type', 'application/json')
  getHealth(): HealthStatus {
    return {
      status: 'ok',
      // Floor to whole seconds: stable integer contract, and sub-second jitter
      // adds no signal for a liveness check. Read here (not cached) so two calls
      // a second apart return different values — the liveness guarantee.
      uptime: Math.floor(process.uptime()),
      version: this.version,
    };
  }
}
