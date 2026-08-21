const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://'+path.resolve(__dirname,'index.html')+'?v='+Date.now());
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    // recompute what buildProceduralMap should have set, by re-deriving:
    const W=20,H=20; const info=[];
    for (const [x,y] of [[10,10],[10,5],[3,3],[15,15],[10,3]]) {
      const dx=x-W/2+0.5, dy=y-H/2+0.5; const r=Math.sqrt(dx*dx+dy*dy);
      const border = x===0||y===0||x===W-1||y===H-1;
      const isWater = !border && r<6.2;
      info.push([x,y, +r.toFixed(2), isWater]);
    }
    return { info, waterTotal: window.__waterDrawn };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
