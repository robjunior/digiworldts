import { assert, assertEqual } from './assert.mjs';

async function main(): Promise<void> {
  const { COMMERCE_I18N_KEYS, t, translations, translate } = await import('../src/i18n.js');

  assertEqual(COMMERCE_I18N_KEYS.length, 48, 'commerce i18n key list has 48 keys');
  for (const key of COMMERCE_I18N_KEYS) {
    assert(typeof translations.pt[key] === 'string', `pt has ${key}`);
    assert(typeof translations.en[key] === 'string', `en has ${key}`);
  }
  assertEqual(Object.keys(translations.pt).length, 48, 'pt dictionary has exactly 48 keys');
  assertEqual(Object.keys(translations.en).length, 48, 'en dictionary has exactly 48 keys');

  const fallback = translate({ en: { sample: 'Fallback {value}' }, pt: { other: 'Outro' } }, 'pt', 'sample', { value: 'ok' });
  assertEqual(fallback, 'Fallback ok', 'missing PT key falls back to EN and interpolates');
  assertEqual(t('discord.balance.credits', { credits: 17 }, 'en'), 'Credits: 17', 'default interpolation substitutes placeholders');

  process.stdout.write('i18n tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
