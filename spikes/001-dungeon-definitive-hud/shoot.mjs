import { chromium } from 'playwright';

const fileUrl = `file://${process.cwd()}/hud.html`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(100);

  const out = { errors };

  // 1) Tooltip visible on hover over a bottom-right fn button
  await page.hover('.fn-btn[data-fn="roster"]');
  await page.waitForTimeout(50);
  out.rosterTooltipVisible = await page.$eval('.fn-btn[data-fn="roster"] .tip', el => getComputedStyle(el).opacity === '1');

  // 2) Chat visible by default in bottom-left (not hidden)
  out.chatVisibleInitially = await page.$eval('#chat', el => !el.classList.contains('hidden'));

  // 3) No roster panel on the left (roster was removed from spike)
  out.noRosterPanel = await page.$('.roster').then(el => !el);

  // 4) No d-pad arrows in DOM
  out.noDpad = await page.$('.dpad').then(el => !el);

  // 5) No encounter card in DOM
  out.noEncounterCard = await page.$('.encounter-card').then(el => !el);

  // 6) Minimize chat -> chat-bar visible
  await page.click('#chat-min');
  out.chatBarVisible = await page.$eval('#chat-bar', el => el.classList.contains('show'));

  // 7) Press Enter on chat-bar -> expands chat and focuses input
  await page.focus('#chat-bar');
  await page.keyboard.press('Enter');
  out.chatExpandedAfterEnter = await page.$eval('#chat', el => !el.classList.contains('hidden'));
  out.inputFocusedAfterEnter = await page.$eval('#chat-input', el => document.activeElement === el);

  // Screenshots
  await page.screenshot({ path: 'shot-final-desktop.png', fullPage: true });

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
