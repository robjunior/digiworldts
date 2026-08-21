const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html'));
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    // Stop the rAF loop by overriding requestAnimationFrame to no-op AFTER first render,
    // then call drawWater once in isolation.
    const c=document.getElementById('stage'); const gl=c.getContext('webgl');
    gl.viewport(0,0,c.width,c.height); gl.clearColor(0.11,0.122,0.165,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(gl.getParameter(gl.CURRENT_PROGRAM));
    window.__drawWater();
    return { drawn: window.__waterDrawn, tile10: window.__debugTile10, foam10: window.__debugFoam10, px10: window.__debugPx10, alpha: window.alpha };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
