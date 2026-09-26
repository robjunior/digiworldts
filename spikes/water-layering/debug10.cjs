const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html')+'?v='+Date.now());
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__stopLoop = true; });
  const r = await page.evaluate(() => {
    window.mode = 'fix';
    window.__renderOnce();
    return window.__renderState;
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
