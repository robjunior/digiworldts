export type PaymentProviderName = 'mercadopago';

export type PayerInfo = {
  readonly email: string;
  readonly name: string;
  readonly lastName: string;
  readonly identificationType: string;
  readonly identificationNumber: string;
};

export type CreatePixPaymentInput = {
  readonly amountBrlCents: number;
  readonly payer: PayerInfo;
  readonly description: string;
  readonly externalReference: string;
  readonly notificationUrl: string;
  readonly expiresAt: Date;
};

export type PixPayment = {
  readonly provider: PaymentProviderName;
  readonly providerPaymentId: string;
  /** MP Orders API: the inner `transactions.payments[0].id` — the addressable payment id for refunds via `POST /v1/payments/{id}/refunds`. Distinct from `providerPaymentId`, which stores the ORDER id (order id 404s at that refund endpoint). See REVISION-1.4 in `.omo/plans/discord-commerce.md`. */
  readonly innerPaymentId: string;
  readonly status: string;
  readonly qrCode: string;
  readonly qrCodeBase64: string;
  readonly ticketUrl: string;
  readonly expiresAt: string | null;
  readonly idempotencyKey: string;
};

export type PaymentStatus = {
  readonly provider: PaymentProviderName;
  readonly providerPaymentId: string;
  readonly status: string;
  readonly raw: unknown;
};

export type RefundResult = {
  readonly provider: PaymentProviderName;
  readonly refundId: string;
  readonly paymentId: string;
  readonly amount: number | null;
  readonly status: string;
};

export type WebhookVerificationInput = {
  readonly signatureHeader: string | undefined;
  readonly requestId: string | undefined;
  readonly dataId: string | undefined;
};

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPixPayment(input: CreatePixPaymentInput): Promise<PixPayment>;
  getStatus(paymentId: string): Promise<PaymentStatus>;
  refund(paymentId: string, amountBrlCents?: number): Promise<RefundResult>;
  verifyWebhook(input: WebhookVerificationInput): boolean;
}
