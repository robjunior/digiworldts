export type Queryable = {
  query<Row extends Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
};

export type DiscordLinkState = 'pending' | 'linked' | 'unlinked' | 'expired';

export type DiscordLink = {
  readonly discordId: string;
  readonly userId: string | null;
  readonly state: DiscordLinkState;
  readonly oauthState: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type PurchaseSession = {
  readonly id: string;
  readonly userId: string;
  readonly discordId: string;
  readonly guildId: string;
  readonly sku: string;
  readonly provider: string;
  readonly providerPaymentId: string | null;
  readonly state: string;
  readonly amountBrlCents: number;
  readonly currency: string;
  readonly idempotencyKey: string | null;
  readonly qrCode: string | null;
  readonly qrCodeBase64: string | null;
  readonly ticketUrl: string | null;
  readonly expiresAt: number | null;
  readonly deliveredAt: number | null;
  readonly metadataJson: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type PurchaseEvent = {
  readonly id: string;
  readonly sessionId: string | null;
  readonly fromState: string | null;
  readonly toState: string;
  readonly providerStatus: string | null;
  readonly reason: string | null;
  readonly payloadJson: string;
  readonly createdAt: number;
};

export type PromoCode = {
  readonly id: string;
  readonly code: string;
  readonly kind: 'fixed_brl';
  readonly discountBrlCents: number;
  readonly maxUses: number | null;
  readonly usesCount: number;
  readonly startsAt: number | null;
  readonly expiresAt: number | null;
  readonly disabledAt: number | null;
  readonly createdBy: string | null;
  readonly createdAt: number;
};

export type PromoRedemption = {
  readonly userId: string;
  readonly codeId: string;
  readonly purchaseSessionId: string | null;
  readonly redeemedAt: number;
};

export type Ticket = {
  readonly id: string;
  readonly userId: string | null;
  readonly discordId: string | null;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly lastPurchaseSessionId: string | null;
  readonly status: string;
  readonly transcript: string | null;
  readonly openedAt: number;
  readonly closedAt: number | null;
  readonly lastActivityAt: number;
};

export type WebhookEvent = {
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string | null;
  readonly payloadJson: string;
  readonly processedAt: number;
};

export type AuditLogEntry = {
  readonly id: string;
  readonly actorDiscordId: string | null;
  readonly action: string;
  readonly targetId: string | null;
  readonly payloadJson: string;
  readonly createdAt: number;
};
