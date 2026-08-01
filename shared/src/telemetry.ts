/**
 * Cross-boundary telemetry event shape. Everything that instruments a game
 * loop (server-side today, browser-side later via `/api/telemetry/ingest`)
 * emits this shape, and every sink (jsonl file, PostHog HTTP, etc.)
 * consumes it. Keeping it in `@digiworld/shared` means the ingest
 * route + the frontend batch client + the backend emit path all speak
 * the same schema without a translation layer.
 *
 * `event` is a dot-separated namespace (`battle.end`, `quest.accept`,
 * `daily.claim`). Namespaces let downstream tools (PostHog cohorts,
 * jq filters) slice by subsystem without a lookup table.
 *
 * `distinctId` is the stable identity for retention / funnel math.
 * When the user is authenticated we use their `userId`; anonymous
 * events (pre-signup page views) get a cookie-issued opaque id.
 *
 * `props` is a free-form JSON object. Keep values under 1 KB total per
 * event — every sink truncates hard above that.
 *
 * Runtime validation (Zod) lives on the backend side of the boundary
 * (backend/src/telemetry/routes.ts + emit.ts) so the shared package
 * stays dependency-free — pure types travel to both frontend and
 * backend, but only the backend needs the parse cost.
 */

export type TelemetryEventName =
  | 'auth.signup' | 'auth.login'
  | 'session.start' | 'session.end'
  | 'world.move' | 'world.encounter'
  | 'battle.start' | 'battle.end'
  | 'battle.action'
  | 'capture.attempt' | 'capture.success'
  | 'quest.accept' | 'quest.objective_bump' | 'quest.claim'
  | 'dialogue.start' | 'dialogue.choice' | 'dialogue.finish'
  | 'evolution.evolve'
  | 'farm.collect' | 'farm.upgrade'
  | 'shop.buy'
  | 'market.list' | 'market.sold'
  | 'coinmarket.offer_post' | 'coinmarket.fill'
  | 'daily.claim' | 'daily.break';

export type TelemetryEvent = {
  readonly event: TelemetryEventName | (string & { readonly __brand?: 'custom' });
  readonly userId?: string;
  readonly distinctId: string;
  readonly ts: number;
  readonly props: Readonly<Record<string, unknown>>;
};

export type TelemetryBatch = {
  readonly events: readonly TelemetryEvent[];
};

export const TELEMETRY_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.]{0,79}$/;
export const TELEMETRY_MAX_BATCH_SIZE = 100;
export const TELEMETRY_MAX_PROPS_BYTES = 1024;
