// node shot.js view1,view2  -> out_<view>.jpg
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const dir = __dirname, views = (process.argv[2] || 'sheet').split(',');
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body style="margin:0"><script type="module" src="/scene.js"></script></body></html>`;
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(html); }
  const f = path.join(dir, path.normalize(u)); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/json' }); fs.createReadStream(f).pipe(r); }).listen(0, async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('pageerror:', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`); await p.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
  for (const v of views) { const d = await p.evaluate(v => window.shot(v), v); fs.writeFileSync(path.join(dir, `out_${v}.jpg`), Buffer.from(d.split(',')[1], 'base64')); console.log('wrote', v); }
  await b.close(); srv.close(); });
