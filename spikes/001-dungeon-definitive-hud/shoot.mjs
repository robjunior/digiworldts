// Headless validation of the definitive-mode dungeon HUD spike — chat tabs edition.
// Covers: 4 tabs (DM/Local/Global/System), per-tab close (X), reopen (+),
// minimize-all -> message icon with unread badge, and the exit-by-portal flow.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(__dirname, 'hud.html');
const out = (n) => join(__dirname, `shot-${n}.png`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// 1) Desktop default (chat open, Local active)
await page.screenshot({ path: out('desktop') });

// 2) Switch to Global tab -> message from Ryo should be visible
await page.click('.ctab[data-ch="global"]');
await page.waitForTimeout(120);
const globalVisible = await page.evaluate(() => {
  const log = document.getElementById('chat-log').textContent;
  return log.includes('planta 3');
});
await page.screenshot({ path: out('tab-global') });

// 3) Close Local and System tabs via their X
await page.click('.ctab[data-ch="local"] .x');
await page.click('.ctab[data-ch="system"] .x');
await page.waitForTimeout(120);
const addShown = await page.evaluate(() => document.getElementById('ctab-add').classList.contains('show'));
await page.screenshot({ path: out('tabs-closed') });

// 4) Reopen a closed tab via the + button
await page.click('#ctab-add');
await page.waitForTimeout(120);
const reopened = await page.evaluate(() => {
  const vis = [...document.querySelectorAll('.ctab')].filter(b => b.style.display !== 'none').map(b => b.dataset.ch);
  return vis;
});

// 5) Minimize all -> message icon appears at bottom-left
await page.click('#chat-min');
await page.waitForTimeout(150);
const minimized = await page.evaluate(() => ({
  chatHidden: document.getElementById('chat').classList.contains('hidden'),
  iconShown: document.getElementById('chat-reopen').classList.contains('show'),
}));
await page.screenshot({ path: out('chat-min') });

// 6) Reopen from the message icon
await page.click('#chat-reopen');
await page.waitForTimeout(120);
const reopenedAll = await page.evaluate(() => !document.getElementById('chat').classList.contains('hidden'));

// 7) Walk to portal -> exit modal -> left screen
for (let i = 0; i < 7; i++) { await page.click('.dpad .right'); await page.waitForTimeout(50); }
await page.waitForTimeout(150);
const modalOpen = await page.evaluate(() => document.getElementById('exit-bg').classList.contains('open'));
await page.click('#exit-go');
await page.waitForTimeout(200);
const leftOpen = await page.evaluate(() => document.getElementById('leftscreen').classList.contains('open'));
await page.screenshot({ path: out('leftscreen') });

console.log(JSON.stringify({
  errors,
  globalVisible,
  addShown,
  reopened,
  minimized,
  reopenedAll,
  modalOpen,
  leftOpen,
}, null, 2));
await browser.close();
