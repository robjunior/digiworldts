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
    const prog=window.__prog, tex=window.__getSheet();
    function rd(cx,cy){const px=new Uint8Array(4);gl.readPixels(cx*32+16,c.height-(cy*32+16),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px);}
    gl.viewport(0,0,c.width,c.height); gl.clearColor(0.11,0.122,0.165,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.uniform2f(gl.getUniformLocation(prog,'u_resolution'), c.width, c.height);
    gl.uniform1f(gl.getUniformLocation(prog,'u_time'), 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(prog,'u_tex'),0);
    window.__drawTerrain(); // terrain only
    const grid=[];
    for(let y=0;y<20;y++){let row=[];for(let x=0;x<20;x++){const p=rd(x,y);row.push(p[0]>p[1]&&p[0]>p[2]?'W':(p[1]>=p[2]&&p[1]>=p[0]?'G':'?'));}grid.push(row.join(''));}
    return { grid, sample1010: rd(10,10), sample1009: rd(10,9), sample109: rd(10,9) };
  });
  console.log(r.grid.join('\n'));
  console.log('1010',r.sample1010,'1009',r.sample1009);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
