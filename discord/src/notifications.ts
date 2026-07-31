import type { Client } from 'discord.js';

import { createBackendClient, type BackendGateway } from './backendClient.js';
import { normalizeLocale, t, type Locale } from './i18n.js';
import { log } from './logger.js';

export type PurchaseNotificationKind = 'approved' | 'failed' | 'expired' | 'refunded';

export type PurchaseNotificationInput = {
  readonly discordId: string;
  readonly kind: PurchaseNotificationKind;
  readonly sku?: string;
};

export type NotificationService = {
  sendPurchaseNotification(input: PurchaseNotificationInput): Promise<void>;
};

export type NotificationServiceDeps = {
  readonly discordSender?: (discordId: string, content: string) => Promise<void>;
  readonly localeResolver?: (discordId: string) => Promise<Locale>;
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
};

const KIND_TO_KEY: Record<PurchaseNotificationKind, string> = {
  approved: 'discord.buy.confirmed',
  failed: 'discord.buy.failed',
  expired: 'discord.buy.expired',
  refunded: 'discord.buy.refunded',
};

async function defaultLocaleResolver(backendClient: Pick<BackendGateway, 'userByDiscord'>, discordId: string): Promise<Locale> {
  try {
    const user = await backendClient.userByDiscord(discordId);
    return normalizeLocale(user.locale);
  } catch {
    return 'en';
  }
}

function messageForKind(kind: PurchaseNotificationKind, locale: Locale, sku?: string): string {
  return t(KIND_TO_KEY[kind], sku === undefined ? {} : { sku }, locale);
}

export function createNotificationService(client: Client, deps: NotificationServiceDeps = {}): NotificationService {
  const backendClient = deps.backendClient ?? createBackendClient();
  const discordSender = deps.discordSender ?? (async (discordId, content) => {
    const user = await client.users.fetch(discordId);
    await user.send({ content });
  });
  const localeResolver = deps.localeResolver ?? ((discordId) => defaultLocaleResolver(backendClient, discordId));
  return {
    async sendPurchaseNotification(input) {
      let locale: Locale = 'en';
      try {
        locale = await localeResolver(input.discordId);
      } catch (error) {
        log.warn('discord.notification.locale.failed', { discordId: input.discordId, err: error instanceof Error ? error.message : 'unknown' });
      }
      try {
        const content = messageForKind(input.kind, locale, input.sku);
        await discordSender(input.discordId, content);
      } catch (error) {
        log.warn('discord.notification.send.failed', { discordId: input.discordId, kind: input.kind, err: error instanceof Error ? error.message : 'unknown' });
      }
    },
  };
}
