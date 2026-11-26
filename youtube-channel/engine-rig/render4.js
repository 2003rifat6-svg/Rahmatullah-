// Serves the folder, opens scene3d.js in headless Chromium (software WebGL), pipes frames to ffmpeg.
// usage: node render3d.js out.mp4 [fps] [still times "2,9,12"]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const dir = __dirname, out = process.argv[2] || 'video.mp4', fps = +process.argv[3] || 30, stills = process.argv[4];
const types = { '.js': 'text/javascript', '.html': 'text/html' };
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head>
<body style="margin:0;background:#000"><script type="module" src="/scene4.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const f = path.join(dir, path.normalize(u));
  if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', m => { if (m.type() === 'error') console.log('page:', m.text()); });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const grab = async t => Buffer.from((await page.evaluate(([t]) => window.frame(t), [t])).split(',')[1], 'base64');
  if (stills) {
    for (const t of stills.split(',').map(Number)) { const s = Date.now(); fs.writeFileSync(path.join(dir, `still_${t}.jpg`), await grab(t)); console.log('still', t, Date.now() - s, 'ms'); }
  } else {
    const n = Math.round((await page.evaluate(() => window.DUR)) * fps);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const s0 = Date.now();
    for (let i = 0; i < n; i++) { if (!ff.stdin.write(await grab(i / fps))) await new Promise(r => ff.stdin.once('drain', r)); if (i % 60 === 0) console.log(`frame ${i}/${n} ${((Date.now() - s0) / 1000).toFixed(0)}s`); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('done', out);
  }
  await browser.close(); server.close();
});
