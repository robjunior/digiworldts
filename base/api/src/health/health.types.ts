/**
 * Public shape of the `GET /health` response (TASK-2).
 *
 * This is the FIRST public API contract in the project, so it is written as an
 * explicit type other code depends on. Per invariant 5 (additive/versioned,
 * never a silent break), fields may be ADDED here in later slices but existing
 * ones must not change meaning or disappear. TASK-3's SPA consumes exactly this
 * shape; keep them in lock-step.
 */
export interface HealthStatus {
  /**
   * Liveness verdict. Always the literal `'ok'` in R-1 because `/health` is an
   * application-liveness probe only (A-2): if this handler runs at all, the
   * process is up. It is intentionally NOT a readiness probe — no DB/cache/queue
   * is consulted (none exist yet). A future readiness slice may widen this union
   * (e.g. `'degraded'`) additively without breaking existing consumers.
   */
  status: 'ok';

  /**
   * Whole seconds the process has been alive (`process.uptime()`, floored).
   *
   * This is the field that PROVES the endpoint is live rather than a static
   * fixture: two calls a second apart return different values. Floored to an
   * integer so the contract is stable and JSON stays tidy (sub-second precision
   * carries no useful signal for a liveness check).
   */
  uptime: number;

  /**
   * The running application version, sourced from configuration — never
   * hard-coded here (see {@link resolveVersion}). Lets a client/monitor tell
   * which build answered.
   */
  version: string;
}
