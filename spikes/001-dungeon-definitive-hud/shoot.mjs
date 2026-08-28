// Headless validation of the definitive-mode dungeon HUD spike.
// Captures: desktop, drawer open, function panel (placeholder), portal cell,
// and the exit-by-portal flow (modal -> "saiu para a cidade" screen).
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

// 1) Desktop default
await page.screenshot({ path: out('desktop') });

// 2) Drawer (funções) open
await page.click('#btn-menu');
await page.waitForTimeout(250);
await page.screenshot({ path: out('drawer') });

// 3) Function panel placeholder (Roster)
await page.click('.drawer .fn:not(.soon)');
await page.waitForTimeout(200);
await page.screenshot({ path: out('fnpanel') });
await page.click('#fn-x');
await page.waitForTimeout(150);
await page.click('#drawer-x');
await page.waitForTimeout(200);

// 4) Walk the player to the portal (2,4) -> (9,4) via d-pad.
//    Path: right x7 to (9,4) avoiding walls (none on row 4 except edges).
for (let i = 0; i < 7; i++) {
  await page.click('.dpad .right');
  await page.waitForTimeout(60);
}
await page.waitForTimeout(200);
await page.screenshot({ path: out('portal') });

// 5) Exit modal should be open after stepping onto the portal
await page.screenshot({ path: out('exit-modal') });
const modalOpen = await page.evaluate(() => document.getElementById('exit-bg').classList.contains('open'));

// 6) Confirm "Atravessar" -> saiu para a cidade screen
await page.click('#exit-go');
await page.waitForTimeout(250);
await page.screenshot({ path: out('leftscreen') });
const leftOpen = await page.evaluate(() => document.getElementById('leftscreen').classList.contains('open'));

console.log(JSON.stringify({ errors, modalOpen, leftOpen }, null, 2));
await browser.close();
