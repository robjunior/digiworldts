const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost/'.replace('http://localhost/','file://'+path.resolve(__dirname,'index.html')));
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    window.__renderOnce();
    const c=document.getElementById('stage'); const gl=c.getContext('webgl');
    function rd(cx,cy){const px=new Uint8Array(4);gl.readPixels(cx*32+16,c.height-(cy*32+16),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px);}
    const before = rd(10,10);
    const forced = window.__testDraw(56,10,10);
    const after = rd(10,10);
    return { before, forced, after };
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
