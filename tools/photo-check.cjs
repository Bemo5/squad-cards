// Runs the real cut-out pipeline (CDN library + model) on a drawn test image.
// Needs `node serve.cjs` running and internet. Usage: node tools/photo-check.cjs
const { openPage } = require('./cdp.cjs');
const fs = require('fs'), path = require('path');
(async () => {
  const page = await openPage('http://127.0.0.1:8125/', { width: 900, height: 900, dpr: 1, mobile: false });
  try {
    await new Promise(r => setTimeout(r, 2500));
    const t = Date.now();
    await page.evaluate(`window.__job=(async()=>{
      const c=document.createElement('canvas');c.width=600;c.height=800;const g=c.getContext('2d');
      g.fillStyle='#7fb2d9';g.fillRect(0,0,600,800);g.fillStyle='#3a6b35';g.fillRect(0,560,600,240);
      g.fillStyle='#c68c5f';g.beginPath();g.ellipse(300,300,110,140,0,0,7);g.fill();
      g.fillStyle='#2b1d14';g.beginPath();g.ellipse(300,215,118,70,0,3.14,6.3);g.fill();
      g.fillStyle='#b22222';g.beginPath();g.moveTo(80,800);g.quadraticCurveTo(100,470,300,450);g.quadraticCurveTo(500,470,520,800);g.fill();
      const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));
      const {processPhoto}=await import('./js/photo.js');const log=[];
      const url=await processPhoto(blob,{removeBg:true,onStatus:s=>log.push(s)});
      return {url,log:[...new Set(log.map(s=>s.replace(/\d+%/,'n%')))]};})().then(r=>window.__res=r,e=>window.__res={err:String(e&&e.stack||e)});0`);
    let res;
    while (!(res = await page.evaluate('window.__res'))) { if (Date.now() - t > 280000) throw new Error('cut-out took over 280s'); await new Promise(r => setTimeout(r, 2000)); }
    if (res.err) throw new Error(res.err);
    console.log('took', Math.round((Date.now() - t) / 1000) + 's');
    console.log(res.log.join('\n'));
    console.log('data URL KB', Math.round(res.url.length / 1024), res.url.slice(0, 22));
    fs.writeFileSync(path.join(__dirname, 'shots', 'cutout.webp'), Buffer.from(res.url.split(',')[1], 'base64'));
  } finally { page.close(); }
})().catch(e => { console.error(e); process.exit(1); });
