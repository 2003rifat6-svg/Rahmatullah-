// Vertical Short: plays chosen ranges of the episode timeline (original times), adds title + end card.
// usage: node render_short.js out.mp4 '<json ranges [[a,b],...]>' "TITLE" [stillAt]
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const dir = __dirname, out = process.argv[2], ranges = JSON.parse(process.argv[3]), title = process.argv[4] || '', still = process.argv[5];
const fps = 30, END = 2.5;
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body style="margin:0"><script type="module" src="/ep01.js"></script></body></html>`;
const types = { '.js': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(html); }
  const f = path.join(dir, path.normalize(u)); if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/?v=1`); await p.waitForFunction(() => window.ready === true, null, { timeout: 90000 }); await p.evaluate(() => document.fonts.ready);
  await p.evaluate(t => { window.SHORT_TITLE = t; }, title);
  const total = ranges.reduce((s, [a, c]) => s + (c - a), 0);
  const map = ts => { let x = ts; for (const [a, c] of ranges) { if (x < c - a) return a + x; x -= c - a; } return null; };
  const grab = async ts => { const to = map(ts); const d = to === null ? await p.evaluate(a => window.endCard(window.SHORT_TITLE, a), Math.min(1, (ts - total) / .4)) : await p.evaluate(([t]) => window.frame(t), [to]); return Buffer.from(d.split(',')[1], 'base64'); };
  if (still) { for (const s of still.split(',').map(Number)) fs.writeFileSync(path.join(dir, 'stills', `short_${path.basename(out, '.mp4')}_${s}.jpg`), await grab(s)); await b.close(); srv.close(); return; }
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'medium', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((total + END) * fps);
  for (let i = 0; i < n; i++) { if (!ff.stdin.write(await grab(i / fps))) await new Promise(r => ff.stdin.once('drain', r)); if (i % 300 === 0) console.log(`frame ${i}/${n}`); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('done', out, 'video seconds', total + END);
  await b.close(); srv.close(); });
