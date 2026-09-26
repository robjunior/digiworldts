const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html'));
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({
    a1: window.__testDraw(56, 2, 2, 1.0, [1,1,1], 0),
    a72: window.__testDraw(56, 2, 2, 0.72, [0.7,0.85,1.0], 0),
    a72foam: window.__testDraw(56, 2, 2, 0.72, [0.7,0.85,1.0], 1.0),
  }));
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
