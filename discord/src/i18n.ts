export type Locale = 'pt' | 'en';
export type TranslationParams = Readonly<Record<string, string | number>>;
export type TranslationCatalog = Readonly<Record<Locale, Readonly<Record<string, string>>>>;

export const COMMERCE_I18N_KEYS = [
  'discord.link.success',
  'discord.link.failure',
  'discord.link.pending',
  'discord.link.code_instructions',
  'discord.link.already_linked',
  'discord.link.discord_already_linked',
  'discord.link.game_user_already_linked',
  'discord.link.code_busy',
  'discord.link.code_expired',
  'discord.link.rate_limited',
  'discord.link.user_not_found',
  'discord.unlink.confirm',
  'discord.unlink.done',
  'discord.balance.title',
  'discord.balance.credits',
  'discord.balance.no_link',
  'discord.buy.no_packs',
  'discord.buy.pack_row',
  'discord.buy.select_prompt',
  'discord.buy.qr_title',
  'discord.buy.qr_expires_in',
  'discord.buy.confirmed',
  'discord.buy.expired',
  'discord.buy.failed',
  'discord.buy.deferred',
  'discord.buy.refunded',
  'discord.purchases.title',
  'discord.purchases.empty',
  'discord.purchases.row',
  'discord.admin.refund.done',
  'discord.admin.stats.title',
  'discord.help.overview',
  'discord.errors.rate_limited',
  'discord.errors.not_linked',
  'discord.errors.internal',
] as const;

export type CommerceI18nKey = (typeof COMMERCE_I18N_KEYS)[number];

export const translations = {
  en: {
    'discord.link.success': 'Your Discord account is linked to DigiWorld.',
    'discord.link.failure': 'Unable to link your DigiWorld account. Try again later.',
    'discord.link.pending': 'Open this private link to connect your DigiWorld account: {url}',
    'discord.link.code_instructions': 'Open DigiWorld while logged in, copy your one-time code, then run /link code:<code>. Code page: {url}',
    'discord.link.already_linked': 'This Discord account is already linked to that DigiWorld account.',
    'discord.link.discord_already_linked': 'This Discord account is already linked. Use /unlink first or contact support.',
    'discord.link.game_user_already_linked': 'That DigiWorld account is already linked. Use /unlink first or contact support.',
    'discord.link.code_busy': 'That link code is being processed. Try again in a moment.',
    'discord.link.code_expired': 'That link code is missing, expired, malformed, or already used. Generate a new one in DigiWorld.',
    'discord.link.rate_limited': 'Too many failed link attempts. Try again later.',
    'discord.link.user_not_found': 'That DigiWorld account no longer exists. Contact support.',
    'discord.unlink.confirm': 'Confirm that you want to unlink this Discord account from DigiWorld.',
    'discord.unlink.done': 'Your Discord account is unlinked from DigiWorld.',
    'discord.balance.title': 'DigiWorld Balance',
    'discord.balance.credits': 'Credits: {credits}',
    'discord.balance.no_link': 'Link your DigiWorld account with /link before checking your balance.',
    'discord.buy.no_packs': 'No DigiCredit packs are available right now.',
    'discord.buy.pack_row': '{name} — BRL {price} — SKU {sku}',
    'discord.buy.select_prompt': 'Select a DigiCredit pack to buy with PIX.',
    'discord.buy.qr_title': 'PIX payment for {sku}',
    'discord.buy.qr_expires_in': 'Expires in {minutes} minutes.',
    'discord.buy.confirmed': 'Payment confirmed. Credits are being delivered.',
    'discord.buy.expired': 'This PIX payment expired.',
    'discord.buy.failed': 'Payment failed. No charge was completed.',
    'discord.buy.deferred': 'Payment is still pending. We will update you when it changes.',
    'discord.buy.refunded': 'Payment refunded. Credits have been reversed.',
    'discord.purchases.title': 'Purchase history',
    'discord.purchases.empty': 'No purchases found.',
    'discord.purchases.row': '{sku} — {state} — BRL {price}',
    'discord.admin.refund.done': 'Refund completed for {purchaseId}.',
    'discord.admin.stats.title': 'Commerce stats',
    'discord.help.overview': 'Available commands: /link, /unlink, /balance, /buy, /purchases, /help.',
    'discord.errors.rate_limited': 'You are doing that too quickly. Try again soon.',
    'discord.errors.not_linked': 'Link your DigiWorld account with /link first.',
    'discord.errors.internal': 'Something went wrong. Please try again later.',
  },
  pt: {
    'discord.link.success': 'Sua conta do Discord foi vinculada ao DigiWorld.',
    'discord.link.failure': 'Não foi possível vincular sua conta DigiWorld. Tente novamente mais tarde.',
    'discord.link.pending': 'Abra este link privado para conectar sua conta DigiWorld: {url}',
    'discord.link.code_instructions': 'Abra o DigiWorld logado, copie seu código único e use /link code:<código>. Página do código: {url}',
    'discord.link.already_linked': 'Esta conta do Discord já está vinculada a essa conta DigiWorld.',
    'discord.link.discord_already_linked': 'Esta conta do Discord já está vinculada. Use /unlink primeiro ou fale com o suporte.',
    'discord.link.game_user_already_linked': 'Essa conta DigiWorld já está vinculada. Use /unlink primeiro ou fale com o suporte.',
    'discord.link.code_busy': 'Esse código de vínculo está sendo processado. Tente novamente em instantes.',
    'discord.link.code_expired': 'Esse código está ausente, expirado, malformado ou já foi usado. Gere outro no DigiWorld.',
    'discord.link.rate_limited': 'Muitas tentativas de vínculo falharam. Tente novamente mais tarde.',
    'discord.link.user_not_found': 'Essa conta DigiWorld não existe mais. Fale com o suporte.',
    'discord.unlink.confirm': 'Confirme que deseja desvincular esta conta do Discord do DigiWorld.',
    'discord.unlink.done': 'Sua conta do Discord foi desvinculada do DigiWorld.',
    'discord.balance.title': 'Saldo DigiWorld',
    'discord.balance.credits': 'Créditos: {credits}',
    'discord.balance.no_link': 'Vincule sua conta DigiWorld com /link antes de consultar o saldo.',
    'discord.buy.no_packs': 'Nenhum pacote de DigiCredits disponível no momento.',
    'discord.buy.pack_row': '{name} — BRL {price} — SKU {sku}',
    'discord.buy.select_prompt': 'Selecione um pacote de DigiCredits para comprar com PIX.',
    'discord.buy.qr_title': 'Pagamento PIX para {sku}',
    'discord.buy.qr_expires_in': 'Expira em {minutes} minutos.',
    'discord.buy.confirmed': 'Pagamento confirmado. Créditos serão entregues em instantes.',
    'discord.buy.expired': 'Este pagamento PIX expirou.',
    'discord.buy.failed': 'O pagamento falhou. Nenhuma cobrança foi concluída.',
    'discord.buy.deferred': 'O pagamento ainda está pendente. Avisaremos quando mudar.',
    'discord.buy.refunded': 'Pagamento reembolsado. Créditos foram estornados.',
    'discord.purchases.title': 'Histórico de compras',
    'discord.purchases.empty': 'Nenhuma compra encontrada.',
    'discord.purchases.row': '{sku} — {state} — BRL {price}',
    'discord.admin.refund.done': 'Reembolso concluído para {purchaseId}.',
    'discord.admin.stats.title': 'Estatísticas de comércio',
    'discord.help.overview': 'Comandos disponíveis: /link, /unlink, /balance, /buy, /purchases, /help.',
    'discord.errors.rate_limited': 'Você está fazendo isso rápido demais. Tente novamente em breve.',
    'discord.errors.not_linked': 'Vincule sua conta DigiWorld com /link primeiro.',
    'discord.errors.internal': 'Algo deu errado. Tente novamente mais tarde.',
  },
} as const satisfies TranslationCatalog;

export function normalizeLocale(locale: string | null | undefined): Locale {
  return locale?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function translate(catalog: TranslationCatalog, locale: Locale, key: string, params: TranslationParams = {}): string {
  const template = catalog[locale][key] ?? catalog.en[key] ?? `[missing:${key}]`;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder: string, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function t(key: string, params: TranslationParams = {}, locale: Locale = 'en'): string {
  return translate(translations, locale, key, params);
}
