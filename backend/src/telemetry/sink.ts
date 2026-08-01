/**
 * Telemetry sinks. Both implementations share the same {@link TelemetrySink}
 * shape so the {@link emit} caller never learns which one it's talking to —
 * flipping `TELEMETRY_SINK=posthog` is env-only.
 *
 * FileSink: one JSON-per-line file (`data/telemetry.jsonl`). Cheap, works
 * on a single node with no external dep, plays well with `jq` and any log
 * shipper. Good for local dev + bootstrap production.
 *
 * PosthogSink: POST to `${POSTHOG_HOST}/batch/` with the standard PostHog
 * batch envelope. Graceful on network error — dropped events are warn-
 * logged, not thrown, so a temporary PostHog outage never breaks a game
 * loop. Retries are the batching layer's job upstream (emit.ts holds
 * events in memory for at most 5 s + one final flush at shutdown).
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { TelemetryEvent } from '@digiworld/shared/telemetry';

import { config } from '../config.js';
import { log } from '../util/log.js';

export interface TelemetrySink {
  write(events: readonly TelemetryEvent[]): Promise<void>;
}

class FileSink implements TelemetrySink {
  private readonly path: string;
  private mkdirDone = false;

  constructor(relativePath: string) {
    this.path = resolve(config.paths.root, relativePath);
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (!this.mkdirDone) {
      await mkdir(dirname(this.path), { recursive: true });
      this.mkdirDone = true;
    }
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await appendFile(this.path, lines, 'utf8');
  }
}

class PosthogSink implements TelemetrySink {
  private readonly url: string;
  private readonly key: string;

  constructor(host: string, key: string) {
    this.url = `${host.replace(/\/$/, '')}/batch/`;
    this.key = key;
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    const body = {
      api_key: this.key,
      batch: events.map((e) => ({
        event: e.event,
        distinct_id: e.distinctId,
        timestamp: new Date(e.ts).toISOString(),
        properties: {
          ...e.props,
          ...(e.userId !== undefined ? { $user_id: e.userId } : {}),
        },
      })),
    };
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PostHog batch returned ${response.status}: ${text.slice(0, 200)}`);
    }
  }
}

let cached: TelemetrySink | null = null;

export function getSink(): TelemetrySink {
  if (cached !== null) return cached;
  if (config.TELEMETRY_SINK === 'posthog') {
    if (!config.POSTHOG_HOST || !config.POSTHOG_KEY) {
      log.warn('telemetry.sink.posthog.misconfigured', {});
      cached = new FileSink(config.TELEMETRY_FILE_PATH);
    } else {
      cached = new PosthogSink(config.POSTHOG_HOST, config.POSTHOG_KEY);
    }
  } else {
    cached = new FileSink(config.TELEMETRY_FILE_PATH);
  }
  return cached;
}

export function resetSinkForTests(): void {
  cached = null;
}
