const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html')+'?v='+Date.now());
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    t2_noflip: window.__testDraw(2, 1, 1, 1, [1,1,1], 0, false),
    t2_flip: window.__testDraw(2, 3, 3, 1, [1,1,1], 0, true),
    t3_noflip: window.__testDraw(3, 5, 5, 1, [1,1,1], 0, false),
    t3_flip: window.__testDraw(3, 7, 7, 1, [1,1,1], 0, true),
  }));
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
