/**
 * Shared HTTP helper for the scraper subsystem.
 *
 *   - Sets a polite User-Agent so upstream hosts can identify + rate us.
 *   - Rate-limits with a global minimum delay between requests (config.SCRAPER_MIN_DELAY_MS).
 *   - Retries transient errors (5xx, ECONNRESET, timeout) with exponential backoff.
 *   - Returns text OR bytes depending on the caller; 403 is treated as success
 *     when the body is HTML (skullbot returns 403 for the digivolution pages
 *     but the payload is still the real page).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config.js';
import { log } from '../util/log.js';

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + config.SCRAPER_MIN_DELAY_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

type FetchOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  acceptBody?: 'text' | 'bytes';
  acceptHtmlOn403?: boolean;
};

export type ScrapeResult<T> = {
  ok: boolean;
  status: number;
  url: string;
  data: T | null;
  error?: string;
};

async function tryFetch(url: string, opts: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 25_000;
  const timer = setTimeout(() => controller.abort(new Error(`fetch timeout after ${timeout}ms`)), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': config.SCRAPER_USER_AGENT,
        Accept: opts.acceptBody === 'bytes' ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch HTML text with polite retries. Returns the body string on success,
 * or `null` on final failure. Emits log lines for each attempt.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<ScrapeResult<string>> {
  const maxRetries = opts.maxRetries ?? 3;
  const acceptHtmlOn403 = opts.acceptHtmlOn403 ?? true;
  let attempt = 0;
  let lastStatus = 0;
  let lastError: string | undefined;

  while (attempt <= maxRetries) {
    await throttle();
    try {
      const res = await tryFetch(url, opts);
      lastStatus = res.status;
      if (res.ok || (res.status === 403 && acceptHtmlOn403)) {
        const text = await res.text();
        return { ok: true, status: res.status, url, data: text };
      }
      if (!RETRY_STATUS.has(res.status)) {
        return { ok: false, status: res.status, url, data: null, error: `http ${res.status}` };
      }
      lastError = `http ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    attempt += 1;
    if (attempt <= maxRetries) {
      const backoff = Math.min(8000, 400 * 2 ** attempt);
      log.warn('scrape.retry', { url, attempt, backoff, error: lastError });
      await sleep(backoff);
    }
  }
  return { ok: false, status: lastStatus, url, data: null, ...(lastError ? { error: lastError } : {}) };
}

/**
 * Fetch raw bytes (for image downloads). Same retry policy as fetchText.
 */
export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<ScrapeResult<Uint8Array>> {
  const maxRetries = opts.maxRetries ?? 3;
  let attempt = 0;
  let lastStatus = 0;
  let lastError: string | undefined;

  while (attempt <= maxRetries) {
    await throttle();
    try {
      const res = await tryFetch(url, { ...opts, acceptBody: 'bytes' });
      lastStatus = res.status;
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return { ok: true, status: res.status, url, data: buf };
      }
      if (!RETRY_STATUS.has(res.status)) {
        return { ok: false, status: res.status, url, data: null, error: `http ${res.status}` };
      }
      lastError = `http ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    attempt += 1;
    if (attempt <= maxRetries) {
      const backoff = Math.min(8000, 400 * 2 ** attempt);
      log.warn('scrape.retry.bytes', { url, attempt, backoff, error: lastError });
      await sleep(backoff);
    }
  }
  return { ok: false, status: lastStatus, url, data: null, ...(lastError ? { error: lastError } : {}) };
}

/**
 * Convenience for callers that don't care about status codes and just want
 * text-or-null. Logs a warning on failure and returns null.
 */
export async function textOrNull(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const r = await fetchText(url, opts);
  if (!r.ok || r.data === null) {
    log.warn('scrape.fail', { url, status: r.status, error: r.error });
    return null;
  }
  return r.data;
}
