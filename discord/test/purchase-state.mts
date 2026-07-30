import { assert, assertEqual } from './assert.mjs';

async function main(): Promise<void> {
  const { MERCADOPAGO_STATUSES, commerceStateForMercadoPagoStatus, decideMercadoPagoTransition, decideTransition } = await import('../src/purchase/stateMachine.js');
  const expected = new Map<string, string>([
    ['pending', 'awaiting_payment'],
    ['in_process', 'awaiting_payment'],
    ['pending_waiting_transfer', 'awaiting_payment'],
    ['approved', 'paid'],
    ['rejected', 'failed'],
    ['cancelled', 'cancelled'],
    ['refunded', 'refunded'],
    ['in_mediation', 'disputed'],
    ['charged_back', 'chargeback'],
  ]);
  assertEqual(MERCADOPAGO_STATUSES.length, expected.size, 'test exhausts all MP statuses');
  for (const status of MERCADOPAGO_STATUSES) assertEqual(commerceStateForMercadoPagoStatus(status), expected.get(status) ?? '', `${status} maps to expected commerce state`);
  assertEqual(decideMercadoPagoTransition('awaiting_payment', 'approved').kind, 'accepted', 'approved payment is accepted');
  assertEqual(decideTransition('delivered', 'paid').kind, 'rejected', 'invalid transition rejected');
  const chargeback = decideMercadoPagoTransition('delivered', 'charged_back');
  assert(chargeback.kind === 'accepted' && chargeback.to === 'chargeback', 'charged_back after delivery records chargeback');
  process.stdout.write('purchase state machine tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
