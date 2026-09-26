const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const fileUrl = 'file://' + path.resolve(__dirname, 'index.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(fileUrl);
  await page.waitForFunction(() => document.getElementById('wtLabel').textContent !== '—', null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const dump = await page.evaluate(() => {
    window.__renderOnce();
    const c = document.getElementById('stage');
    const ctx = c.getContext('webgl');
    const TILE=32,H=c.height;
    function rd(cx,cy){const px=new Uint8Array(4);ctx.readPixels(cx*TILE+16,H-(cy*TILE+16),1,1,ctx.RGBA,ctx.UNSIGNED_BYTE,px);return Array.from(px);}
    // expose uvForTile for tile 56,57,58,130 and a ground 2
    const uvs = [56,57,58,130,2].map(t=>[t, Array.from(window.__uvForTile ? window.__uvForTile(t) : [])]);
    return {
      centerWaterCell: rd(10,10),
      centerLandCell: rd(3,3),
      uvs,
      sheetReady: !!window.__sheetReady
    };
  });
  console.log(JSON.stringify(dump,null,2));
  console.log('ERRS', errs);
  await browser.close();
})().catch(e=>{console.error(e) || console.log(e);process.exit(2);});
