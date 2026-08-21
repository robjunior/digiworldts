const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html')+'?v='+Date.now());
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    c1010: window.__dumpCell(10,10),
    c55: window.__dumpCell(10,5),
    c33: window.__dumpCell(3,3),
  }));
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
