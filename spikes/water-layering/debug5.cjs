const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html'));
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    window.__renderOnce({skipTerrain:true});
    const c=document.getElementById('stage'); const gl=c.getContext('webgl');
    function rd(cx,cy){const px=new Uint8Array(4);gl.readPixels(cx*32+16,c.height-(cy*32+16),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px);}
    return { waterOnly: rd(10,10), waterOnlyEdge: rd(10,7) };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
