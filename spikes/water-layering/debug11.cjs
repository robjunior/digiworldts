const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html')+'?v='+Date.now());
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const c=document.getElementById('stage'); const gl=c.getContext('webgl');
    gl.viewport(0,0,c.width,c.height);
    function rd(cx,cy){const px=new Uint8Array(4);gl.readPixels(cx*32+16,c.height-(cy*32+16),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px);}
    // clear to neutral
    gl.clearColor(0.2,0.2,0.2,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // exact drawWater call for (10,10): tile 56, foam 1.0
    const a = window.__testDraw(56, 10, 10, 0.72, [0.7,0.85,1.0], 1.0);
    const b = window.__testDraw(56, 10, 10, 0.72, [0.7,0.85,1.0], 0.0);
    return { foam1: a, foam0: b };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
