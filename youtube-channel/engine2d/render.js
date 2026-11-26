// Renders scene.js frame by frame in headless Chromium and pipes JPEGs into ffmpeg.
// usage: node render.js <out.mp4> [fps] [onlyFrameTimes comma list -> PNG stills]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const dir = __dirname, out = process.argv[2] || path.join(dir, 'video.mp4');
const fps = +process.argv[3] || 30, stills = process.argv[4];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const code = fs.readFileSync(path.join(dir, 'scene.js'), 'utf8');
  await page.setContent(`<html><body style="margin:0;background:#000"><canvas id="c" width="1920" height="1080"></canvas><script>${code};
    const ctx=document.getElementById('c').getContext('2d');
    window.frame=(t,q)=>{draw(ctx,t);return document.getElementById('c').toDataURL('image/jpeg',q);};
    window.DUR=DURATION;</script></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  if (stills) {
    for (const t of stills.split(',').map(Number)) {
      const d = await page.evaluate(([t]) => window.frame(t, .9), [t]);
      fs.writeFileSync(path.join(dir, `still_${t}.jpg`), Buffer.from(d.split(',')[1], 'base64'));
    }
    await browser.close(); return;
  }
  const dur = await page.evaluate(() => window.DUR), n = Math.round(dur * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < n; i++) {
    const d = await page.evaluate(([t]) => window.frame(t, .93), [i / fps]);
    if (!ff.stdin.write(Buffer.from(d.split(',')[1], 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i}/${n}`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  await browser.close(); console.log('done', out);
})();
