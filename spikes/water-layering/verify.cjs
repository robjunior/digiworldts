const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const fileUrl = 'file://' + path.resolve(__dirname, 'index.html') + '?v=' + Date.now();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(fileUrl);
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);

  // stop the rAF loop for deterministic reads, expose water-cell helper
  await page.evaluate(() => {
    window.__stopLoop = true;
    window.__isWaterCell = (cx, cy) => {
      const W = 20, r = Math.sqrt((cx - W/2 + 0.5)**2 + (cy - W/2 + 0.5)**2);
      const border = cx===0||cy===0||cx===W-1||cy===W-1;
      return !border && r < 6.2;
    };
    // override requestAnimationFrame to a no-op so render() fires once
    window.requestAnimationFrame = () => 0;
    window.mode = 'fix';
  });

  async function scan(modeName) {
    return await page.evaluate((modeName) => {
      window.mode = modeName;
      window.__renderOnce();
      const c = document.getElementById('stage');
      const ctx = c.getContext('2d');
      const TILE = 32, W = c.width, H = c.height, cols = W/TILE, rows = H/TILE;
      const out = { cols, rows, waterBlue:0, waterTotal:0, landBlue:0, landTotal:0, avgWaterB:0 };
      let sumB = 0;
      for (let cy=0; cy<rows; cy++) for (let cx=0; cx<cols; cx++) {
        const px = ctx.getImageData(cx*TILE+16, cy*TILE+16, 1, 1).data;
        const isBlue = px[2] > px[0] + 12 && px[2] > px[1] + 6;
        const isWater = window.__isWaterCell(cx, cy);
        if (isWater) { out.waterTotal++; if (isBlue) out.waterBlue++; sumB += px[2]; }
        else { out.landTotal++; if (isBlue) out.landBlue++; }
      }
      out.avgWaterB = out.waterTotal ? Math.round(sumB/out.waterTotal) : 0;
      return out;
    }, modeName);
  }

  const fix = await scan('fix');
  await page.screenshot({ path: path.resolve(__dirname, 'shot-fix.png') });
  const bug = await scan('bug');
  await page.screenshot({ path: path.resolve(__dirname, 'shot-bug.png') });

  console.log('fix:', JSON.stringify(fix));
  console.log('bug:', JSON.stringify(bug));

  const fixFrac = fix.waterBlue / Math.max(1, fix.waterTotal);
  const bugFrac = bug.waterBlue / Math.max(1, bug.waterTotal);
  const checks = [];
  checks.push(['no JS errors', errors.length === 0]);
  if (errors.length) console.log('ERRORS:', errors);
  checks.push(['fix: >=70% of water cells render blue (water on top)', fixFrac >= 0.7]);
  checks.push(['bug: <=25% of water cells render blue (terrain covers water)', bugFrac <= 0.25]);
  checks.push(['fix water-on-top fraction >> bug (delta >= 0.45)', fixFrac - bugFrac >= 0.45]);
  checks.push(['water region avg blue channel higher in fix than bug', fix.avgWaterB > bug.avgWaterB + 10]);

  let pass=0, fail=0;
  for (const [name, ok] of checks) { console.log((ok?'PASS':'FAIL')+' — '+name); ok?pass++:fail++; }
  await browser.close();
  process.exit(fail===0?0:1);
})().catch(e => { console.error(e); process.exit(2); });
