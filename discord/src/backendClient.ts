import { z } from 'zod';

import { config } from './config.js';

const LinkInitResponseSchema = z.object({ linked: z.boolean(), userId: z.string().nullable().optional() }).passthrough();
const LinkCompleteResponseSchema = z.object({ linked: z.boolean(), userId: z.string(), alreadyLinked: z.boolean().optional() }).passthrough();
const UnlinkResponseSchema = z.object({ ok: z.boolean(), unlinked: z.boolean() }).passthrough();
const UserByDiscordResponseSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  discordId: z.string(),
  credits: z.number(),
  premiumUntil: z.number().nullable(),
  locale: z.string().nullable(),
});
const WalletCreditResponseSchema = z.object({ ok: z.boolean(), userId: z.string(), amount: z.number(), credits: z.number(), reason: z.string() }).passthrough();
const ErrorResponseSchema = z.object({ error: z.string().optional() }).passthrough();

export type LinkInitResponse = z.infer<typeof LinkInitResponseSchema>;
export type LinkCompleteResponse = z.infer<typeof LinkCompleteResponseSchema>;
export type UnlinkResponse = z.infer<typeof UnlinkResponseSchema>;
export type UserByDiscordResponse = z.infer<typeof UserByDiscordResponseSchema>;
export type WalletCreditResponse = z.infer<typeof WalletCreditResponseSchema>;

export class BackendClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(code);
    this.name = 'BackendClientError';
  }
}

export class BackendClientTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super('backend-timeout');
    this.name = 'BackendClientTimeoutError';
  }
}

export type BackendClientOptions = {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs: number;
};

export type BackendGateway = {
  readonly linkInit: (discordId: string) => Promise<LinkInitResponse>;
  readonly linkComplete: (input: LinkCompleteInput) => Promise<LinkCompleteResponse>;
  readonly unlink: (discordId: string) => Promise<UnlinkResponse>;
  readonly userByDiscord: (discordId: string) => Promise<UserByDiscordResponse>;
  readonly walletCredit: (input: WalletCreditInput) => Promise<WalletCreditResponse>;
};

export type WalletCreditInput = { readonly userId: string; readonly amount: number; readonly idempotencyKey: string; readonly reason: string };
export type LinkCompleteInput = { readonly discordId: string; readonly code: string };

type JsonSchema<T> = { readonly parse: (value: unknown) => T };

export class BackendClient implements BackendGateway {
  constructor(private readonly options: BackendClientOptions) {}

  async linkInit(discordId: string): Promise<LinkInitResponse> {
    return this.request('/api/service/link-init', LinkInitResponseSchema, { method: 'POST', body: { discordId } });
  }

  async linkComplete(input: LinkCompleteInput): Promise<LinkCompleteResponse> {
    return this.request('/api/service/link-complete', LinkCompleteResponseSchema, { method: 'POST', body: input });
  }

  async unlink(discordId: string): Promise<UnlinkResponse> {
    return this.request('/api/service/unlink', UnlinkResponseSchema, { method: 'POST', body: { discordId } });
  }

  async userByDiscord(discordId: string): Promise<UserByDiscordResponse> {
    return this.request(`/api/service/user-by-discord/${encodeURIComponent(discordId)}`, UserByDiscordResponseSchema, { method: 'GET' });
  }

  async walletCredit(input: WalletCreditInput): Promise<WalletCreditResponse> {
    return this.request('/api/service/wallet-credit', WalletCreditResponseSchema, { method: 'POST', body: input });
  }

  private async request<T>(path: string, schema: JsonSchema<T>, init: { readonly method: 'GET' | 'POST'; readonly body?: unknown }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const url = new URL(path, this.options.baseUrl);
    try {
      const requestInit: RequestInit = {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.options.serviceToken}`,
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        signal: controller.signal,
      };
      if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);
      const response = await fetch(url, requestInit);
      const body = await response.json().catch((error: unknown) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      if (!response.ok) {
        const parsedError = ErrorResponseSchema.safeParse(body);
        throw new BackendClientError(response.status, parsedError.success ? parsedError.data.error ?? 'backend-error' : 'backend-error', body);
      }
      return schema.parse(body);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new BackendClientTimeoutError(this.options.timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createBackendClient(): BackendClient {
  return new BackendClient({ baseUrl: config.BACKEND_URL, serviceToken: config.SERVICE_TOKEN_DISCORD, timeoutMs: 5_000 });
}
