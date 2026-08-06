/**
 * Shared HTTP helper for the scraper subsystem.
 *
 *   - Sets a polite User-Agent so upstream hosts can identify + rate us.
 *   - Rate-limits with a global minimum delay between requests (config.SCRAPER_MIN_DELAY_MS).
 *   - Retries transient errors (5xx, ECONNRESET, timeout) with exponential backoff.
 *   - Returns text OR bytes depending on the caller; 403 is treated as success
 *     when the body is HTML (skullbot returns 403 for the digivolution pages
 *     but the payload is still the real page).
 *   - SSRF guard: refuses non-http(s) schemes and refuses any hostname that
 *     resolves to a private/loopback/link-local IP; validates each redirect
 *     hop the same way (redirect: 'manual' + manual follow up to 3 hops).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { lookup } from 'node:dns/promises';
import { config } from '../config.js';
import { log } from '../util/log.js';

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

// Hard byte caps on the response body. Larger than any real portrait
// (`.webp`, ~10-40 KB), dot sprite (`.gif`, ~5-15 KB), or wikimon HTML page
// (~200-800 KB), so a benign upstream never trips them. A hostile mirror
// serving an unbounded chunked stream is bounded to `maxBytes` of heap
// pressure per concurrent request rather than the socket read buffer.
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + config.SCRAPER_MIN_DELAY_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * IPv4 dotted-quad → 32-bit integer. Returns -1 on malformed input so the
 * subsequent range check rejects rather than accidentally passing.
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return -1;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return -1;
    out = out * 256 + n;
  }
  return out;
}

/**
 * Block all RFC-1918 private ranges, loopback, link-local (incl. AWS/GCP
 * metadata at 169.254.169.254), CGNAT, multicast, and 0.0.0.0/8. Also blocks
 * IPv6 loopback, ULA (fc00::/7), and link-local (fe80::/10).
 */
function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) {
    const n = ipv4ToInt(address);
    if (n < 0) return true;
    if (n < ipv4ToInt('1.0.0.0')) return true;
    if (n >= ipv4ToInt('10.0.0.0') && n <= ipv4ToInt('10.255.255.255')) return true;
    if (n >= ipv4ToInt('100.64.0.0') && n <= ipv4ToInt('100.127.255.255')) return true;
    if (n >= ipv4ToInt('127.0.0.0') && n <= ipv4ToInt('127.255.255.255')) return true;
    if (n >= ipv4ToInt('169.254.0.0') && n <= ipv4ToInt('169.254.255.255')) return true;
    if (n >= ipv4ToInt('172.16.0.0') && n <= ipv4ToInt('172.31.255.255')) return true;
    if (n >= ipv4ToInt('192.168.0.0') && n <= ipv4ToInt('192.168.255.255')) return true;
    if (n >= ipv4ToInt('224.0.0.0')) return true;
    return false;
  }
  if (family === 6) {
    const norm = address.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(norm)) return true;
    if (norm.startsWith('::ffff:')) {
      const v4 = norm.slice('::ffff:'.length);
      const n = ipv4ToInt(v4);
      if (n >= 0) return isPrivateAddress(v4, 4);
    }
    return false;
  }
  return true;
}

async function assertPublicHost(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF-guard: not a valid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SSRF-guard: refuse non-http(s) scheme: ${parsed.protocol} for ${rawUrl}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const { address, family } = await lookup(host, { verbatim: true });
  if (isPrivateAddress(address, family)) {
    throw new Error(`SSRF-guard: refuse private/loopback/link-local host: ${host} → ${address}`);
  }
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
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(current);
      const res = await fetch(current, {
        headers: {
          'User-Agent': config.SCRAPER_USER_AGENT,
          Accept: opts.acceptBody === 'bytes' ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
        redirect: 'manual',
      });
      if (!REDIRECT_STATUS.has(res.status)) return res;
      const location = res.headers.get('location');
      if (!location) return res;
      current = new URL(location, current).toString();
    }
    throw new Error(`SSRF-guard: too many redirects (>${MAX_REDIRECTS}) starting from ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body with a hard byte cap enforced in TWO places:
 *   (1) Content-Length header (if present) — reject before streaming.
 *   (2) Running total across streamed chunks — reject on any header lie
 *       or chunked-encoded server that omits Content-Length.
 *
 * Excess data cancels the reader immediately so peak memory is bounded by
 * `maxBytes`, not by the underlying socket read buffer. Preserves the
 * partial-chunks-then-concat pattern so we return a contiguous Uint8Array.
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const cl = res.headers.get('content-length');
  if (cl !== null) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`response too large: content-length ${declared} > ${maxBytes}`);
    }
  }
  const body = res.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error(`response too large: streamed ${total} > ${maxBytes}`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
        const buf = await readBodyCapped(res, MAX_TEXT_BYTES);
        const text = new TextDecoder('utf-8').decode(buf);
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
        const buf = await readBodyCapped(res, MAX_ASSET_BYTES);
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
