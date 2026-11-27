// usage: node render.js out.mp4 fps [stillTimes] | node render.js out.mp4 fps - startSec endSec
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const dir = __dirname, out = process.argv[2], fps = +process.argv[3] || 30, stills = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : null;
const t0 = +process.argv[5] || 0, t1 = process.argv[6] ? +process.argv[6] : null;
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body style="margin:0"><script type="module" src="/hook2.js"></script></body></html>`;
const types = { '.js': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(html); }
  const f = path.join(dir, path.normalize(u)); if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('pageerror:', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`); await p.waitForFunction(() => window.ready === true, null, { timeout: 90000 }); await p.evaluate(() => document.fonts.ready);
  const grab = async t => Buffer.from((await p.evaluate(([t]) => window.frame(t), [t])).split(',')[1], 'base64');
  if (stills) { for (const t of stills.split(',').map(Number)) fs.writeFileSync(path.join(dir, 'stills', `s_${t}.jpg`), await grab(t)); }
  else { const dur = await p.evaluate(() => window.DUR); const end = t1 ?? dur; const f0 = Math.round(t0 * fps), f1 = Math.round(end * fps);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const s0 = Date.now(); for (let i = f0; i < f1; i++) { if (!ff.stdin.write(await grab(i / fps))) await new Promise(r => ff.stdin.once('drain', r)); if ((i - f0) % 300 === 0) console.log(`frame ${i - f0}/${f1 - f0} ${((Date.now() - s0) / 1000).toFixed(0)}s`); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('done', out, 'duration', dur); }
  await b.close(); srv.close(); });
