const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({
    t56: window.__testDraw(56, 2, 2),
    t130: window.__testDraw(130, 4, 4),
    t2: window.__testDraw(2, 6, 6),
    t4: window.__testDraw(4, 8, 8),
  }));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
