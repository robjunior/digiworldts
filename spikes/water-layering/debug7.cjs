const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html'));
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const c=document.getElementById('stage'); const gl=c.getContext('webgl');
    function rd(cx,cy){const px=new Uint8Array(4);gl.readPixels(cx*32+16,c.height-(cy*32+16),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px);}
    // clear, call real drawWater
    gl.viewport(0,0,c.width,c.height); gl.clearColor(0.11,0.122,0.165,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(window.__uvForTile ? null : null); gl.useProgram(document.getElementById('stage').getContext('webgl').__prog || null);
    window.__drawWater();
    const a = rd(10,10);
    const drawn = window.__waterDrawn, tile10 = window.__debugTile10;
    // now testDraw same
    const b = window.__testDraw(56, 10, 10, 0.72, [0.7,0.85,1.0], 0);
    return { afterDrawWater: a, drawn, tile10, testDrawSame: b, alpha: window.__alphaVal };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
