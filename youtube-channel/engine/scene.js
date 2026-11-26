// Brevane demo engine: everything is drawn in code on a 1920x1080 canvas.
// draw(t) renders the frame at time t (seconds).
const W = 1920, H = 1080;
const C = { bg: '#0A0F1C', bg2: '#1B2333', white: '#F2F5FA', ink: '#05070D', cyan: '#00E5FF', grey: '#8A93A6', red: '#FF3B3B' };
const DURATION = 25;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ---------- character ----------
function nevHead(ctx, x, y, r, o = {}) {
  const glow = o.glow || 0, blink = o.blink || 0, brow = o.brow ?? 1, look = o.look || 0, lit = o.lit || 0;
  ctx.save();
  // head
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - r * .3, y - r * .4, r * .1, x, y, r * 1.05);
  g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#C9D2E0');
  ctx.fillStyle = g; ctx.fill();
  if (lit > 0) { // phone light from below
    const lg = ctx.createRadialGradient(x, y + r * 1.1, r * .2, x, y + r * .6, r * 1.4);
    lg.addColorStop(0, `rgba(170,240,255,${.55 * lit})`); lg.addColorStop(1, 'rgba(170,240,255,0)');
    ctx.fillStyle = lg; ctx.fill();
  }
  if (glow > 0) {
    const cg = ctx.createRadialGradient(x, y, r * .2, x, y, r * 1.1);
    cg.addColorStop(0, `rgba(0,229,255,${.35 * glow})`); cg.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = cg; ctx.fill();
  }
  ctx.lineWidth = Math.max(3, r * .035); ctx.strokeStyle = C.ink; ctx.stroke();
  // eyes
  const ex = r * .32, ey = -r * .06, erx = r * .085, ery = r * .135 * (1 - .92 * blink);
  for (const s of [-1, 1]) {
    const cx = x + s * ex + look * r * .08, cy = y + ey;
    if (glow > 0) {
      ctx.save();
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * .45);
      halo.addColorStop(0, `rgba(0,229,255,${.75 * glow})`); halo.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, r * .45, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = C.cyan; ctx.shadowBlur = r * .35 * glow;
      ctx.beginPath(); ctx.ellipse(cx, cy, erx * (1 + .45 * glow), ery * (1 + .3 * glow), 0, 0, Math.PI * 2);
      ctx.fillStyle = mix('#05070D', '#00E5FF', glow); ctx.fill(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy, erx * .55 * glow, ery * .55 * glow, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.restore();
    } else {
      ctx.beginPath(); ctx.ellipse(cx, cy, erx, ery, 0, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
      if (blink < .5) { ctx.beginPath(); ctx.arc(cx - erx * .3, cy - ery * .35, erx * .28, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
    }
    // brows: brow=1 worried (inner ends up), 0 flat, -1 confident
    ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineWidth = r * .045; ctx.strokeStyle = C.ink;
    const bx = cx, by = cy - ery - r * .12, bw = r * .14;
    // inner end (toward the nose) rises when worried (brow>0), drops when confident (brow<0)
    ctx.moveTo(bx - s * bw, by - brow * r * .07); ctx.lineTo(bx + s * bw * .9, by + brow * r * .03); ctx.stroke();
  }
  ctx.restore();
}
function mix(a, b, k) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(',')})`;
}
function limb(ctx, pts, w) { // white limb with black outline
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = C.ink; ctx.lineWidth = w + 6; ctx.stroke();
  ctx.strokeStyle = C.white; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
}
function hand(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.white; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.stroke(); }

// ---------- environment ----------
function sky(ctx, t) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0B1426'); g.addColorStop(1, C.bg); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function bedroom(ctx, t, phoneGlow) {
  // wall
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#111a2c'); g.addColorStop(1, '#0A0F1C'); ctx.fillStyle = g; ctx.fillRect(-200, -200, W + 400, H + 400);
  // window
  const wx = 180, wy = 170, ww = 560, wh = 420;
  ctx.save(); rrect(ctx, wx, wy, ww, wh, 8); ctx.clip();
  const sg = ctx.createLinearGradient(0, wy, 0, wy + wh); sg.addColorStop(0, '#0d2040'); sg.addColorStop(1, '#1a2b4d'); ctx.fillStyle = sg; ctx.fillRect(wx, wy, ww, wh);
  ctx.beginPath(); ctx.arc(wx + 420, wy + 95, 42, 0, Math.PI * 2); ctx.fillStyle = '#E8EEF7'; ctx.shadowColor = '#bcd6ff'; ctx.shadowBlur = 40; ctx.fill(); ctx.shadowBlur = 0;
  const r = rng(7); for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(255,255,255,${.3 + .5 * r()})`; ctx.fillRect(wx + r() * ww, wy + r() * wh * .5, 2, 2); }
  let x = wx; const r2 = rng(3);
  while (x < wx + ww) { const bw = 40 + r2() * 70, bh = 90 + r2() * 200; ctx.fillStyle = '#070b15'; ctx.fillRect(x, wy + wh - bh, bw - 6, bh);
    for (let yy = wy + wh - bh + 14; yy < wy + wh - 10; yy += 22) for (let xx = x + 8; xx < x + bw - 14; xx += 16) if (r2() < .28) { ctx.fillStyle = r2() < .15 ? 'rgba(0,229,255,.7)' : 'rgba(255,214,140,.55)'; ctx.fillRect(xx, yy, 7, 10); }
    x += bw; }
  ctx.restore();
  ctx.lineWidth = 14; ctx.strokeStyle = '#1F2A40'; ctx.strokeRect(wx, wy, ww, wh); ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
  // moonlight patch on floor
  ctx.fillStyle = 'rgba(140,170,230,.06)'; ctx.beginPath(); ctx.moveTo(wx, wy + wh); ctx.lineTo(wx + ww, wy + wh); ctx.lineTo(wx + ww + 300, H); ctx.lineTo(wx + 200, H); ctx.fill();
  // floor
  ctx.fillStyle = '#0c1220'; ctx.fillRect(-200, 880, W + 400, 400);
  // nightstand + clock
  ctx.fillStyle = '#18223a'; rrect(ctx, 820, 690, 170, 200, 10); ctx.fill();
  ctx.fillStyle = '#0b1020'; rrect(ctx, 840, 640, 130, 56, 10); ctx.fill();
  ctx.save(); ctx.font = '700 40px "JetBrains Mono"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#9FF5FF'; ctx.shadowColor = C.cyan; ctx.shadowBlur = 18; ctx.fillText('3:33', 905, 669); ctx.restore();
  // bed
  ctx.fillStyle = '#1a2540'; rrect(ctx, 1000, 640, 860, 250, 18); ctx.fill(); // frame
  ctx.fillStyle = '#26345a'; rrect(ctx, 1010, 560, 70, 330, 14); ctx.fill(); // headboard
  ctx.fillStyle = '#d9e1ee'; rrect(ctx, 1090, 600, 230, 90, 40); ctx.fill(); // pillow
}
function bedNev(ctx, t, phoneGlow) {
  // blanket
  ctx.fillStyle = '#2f4170'; ctx.beginPath(); ctx.moveTo(1250, 660); ctx.bezierCurveTo(1450, 600, 1700, 610, 1860, 650); ctx.lineTo(1860, 890); ctx.lineTo(1250, 890); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3c5288'; ctx.lineWidth = 4; ctx.stroke();
  // arm holding phone above face
  const bob = Math.sin(t * 1.3) * 4;
  limb(ctx, [[1330, 680], [1330, 560], [1240, 500 + bob]], 14);
  // phone
  ctx.save(); ctx.translate(1225, 470 + bob); ctx.rotate(.25);
  ctx.fillStyle = '#05070D'; rrect(ctx, -34, -60, 68, 120, 12); ctx.fill();
  ctx.fillStyle = '#9FF5FF'; ctx.globalAlpha = .9; rrect(ctx, -28, -52, 56, 104, 8); ctx.fill(); ctx.restore();
  hand(ctx, 1240, 500 + bob, 16);
  // head on pillow, looking up at phone
  nevHead(ctx, 1190, 600, 64, { lit: phoneGlow, brow: .3, look: .5, blink: blinkAt(t, [2.6]) });
  // glow cone from phone
  const gg = ctx.createRadialGradient(1225, 480, 10, 1225, 480, 420);
  gg.addColorStop(0, `rgba(120,235,255,${.30 * phoneGlow})`); gg.addColorStop(1, 'rgba(120,235,255,0)');
  ctx.fillStyle = gg; ctx.fillRect(700, 0, 1100, 1000);
}
function blinkAt(t, times) { let b = 0; for (const s of times) { const d = Math.abs(t - s); if (d < .09) b = Math.max(b, 1 - d / .09); } return b; }

// ---------- phone close-up ----------
function phoneUI(ctx, t, o) {
  const { scroll = 0, rowIn = 0, knob = 0, flash = 0, hidden = 1 } = o;
  const px = 960, py = 560, pw = 640, ph = 1240;
  ctx.save();
  // body
  ctx.fillStyle = '#05070D'; rrect(ctx, px - pw / 2, py - ph / 2, pw, ph, 70); ctx.fill();
  ctx.strokeStyle = '#2a3550'; ctx.lineWidth = 6; ctx.stroke();
  const sx = px - pw / 2 + 26, sy = py - ph / 2 + 26, sw = pw - 52, sh = ph - 52;
  ctx.save(); rrect(ctx, sx, sy, sw, sh, 50); ctx.clip();
  ctx.fillStyle = '#0d1424'; ctx.fillRect(sx, sy, sw, sh);
  // status bar
  ctx.font = '600 30px Inter'; ctx.fillStyle = '#E8EEF7'; ctx.textBaseline = 'middle'; ctx.fillText('3:33', sx + 50, sy + 60);
  ctx.strokeStyle = '#E8EEF7'; ctx.lineWidth = 3; rrect(ctx, sx + sw - 110, sy + 47, 56, 26, 6); ctx.stroke(); ctx.fillStyle = '#E8EEF7'; ctx.fillRect(sx + sw - 106, sy + 51, 44, 18);
  ctx.font = '700 44px Inter'; ctx.fillStyle = '#fff'; ctx.fillText('Settings', sx + 50, sy + 140 - scroll * .2);
  // rows
  const names = ['Wi-Fi', 'Bluetooth', 'Notifications', 'Sounds', 'Focus', 'Screen Time', 'Display', 'Battery', 'Privacy', 'Storage', 'Accessibility', 'General'];
  const rowH = 96, top = sy + 210 - scroll;
  names.forEach((n, i) => {
    const y = top + i * rowH; if (y < sy + 160 || y > sy + sh) return;
    ctx.fillStyle = '#151e33'; rrect(ctx, sx + 30, y, sw - 60, rowH - 12, 18); ctx.fill();
    ctx.fillStyle = ['#3a7bd5', '#4a5fd0', '#d05a5a', '#d0507f', '#6a5ad0', '#7a5ad0', '#3a8bd5', '#3fbf6f', '#3a7bd5', '#7a8599', '#3a7bd5', '#7a8599'][i];
    rrect(ctx, sx + 54, y + 20, 44, 44, 11); ctx.fill();
    ctx.font = '500 32px Inter'; ctx.fillStyle = '#E8EEF7'; ctx.fillText(n, sx + 122, y + 42);
    ctx.strokeStyle = '#59647a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx + sw - 80, y + 30); ctx.lineTo(sx + sw - 66, y + 42); ctx.lineTo(sx + sw - 80, y + 54); ctx.stroke();
  });
  // hidden row
  if (rowIn > 0) {
    const y = sy + sh - 260;
    ctx.save(); ctx.globalAlpha = rowIn;
    ctx.shadowColor = C.cyan; ctx.shadowBlur = 30 + 20 * Math.sin(t * 4);
    ctx.fillStyle = '#0a2230'; rrect(ctx, sx + 30, y, sw - 60, 120, 22); ctx.fill();
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.font = '700 36px Inter'; ctx.fillStyle = '#E8FDFF'; ctx.fillText('Hidden Mode', sx + 60, y + 60);
    // toggle
    const tx = sx + sw - 190, ty = y + 30, tw = 120, th = 60;
    ctx.fillStyle = mix('#3a4459', '#00E5FF', knob); rrect(ctx, tx, ty, tw, th, 30); ctx.fill();
    if (knob > .5) { ctx.shadowColor = C.cyan; ctx.shadowBlur = 40 * knob; ctx.fill(); ctx.shadowBlur = 0; }
    ctx.beginPath(); ctx.arc(tx + 30 + knob * 60, ty + 30, 25, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }
  if (flash > 0) { ctx.fillStyle = `rgba(160,245,255,${flash})`; ctx.fillRect(sx, sy, sw, sh); }
  ctx.restore();
  ctx.restore();
}

// ---------- overlays ----------
function caption(ctx, text, a) {
  if (!text || a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.font = '700 50px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width; ctx.fillStyle = 'rgba(5,7,13,.72)'; rrect(ctx, W / 2 - tw / 2 - 34, H - 152, tw + 68, 84, 20); ctx.fill();
  ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(text, W / 2, H - 110);
  ctx.fillStyle = '#fff'; ctx.fillText(text, W / 2, H - 110); ctx.restore();
}
function vignette(ctx, k = .75) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .95);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${k})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function grain(ctx, t) {
  const r = rng(Math.floor(t * 30) + 11); ctx.fillStyle = 'rgba(255,255,255,.035)';
  for (let i = 0; i < 900; i++) ctx.fillRect(r() * W, r() * H, 2, 2);
}
function particles(ctx, t, n, alpha) {
  const r = rng(99);
  for (let i = 0; i < n; i++) {
    const x = r() * W, sp = 20 + r() * 60, y = (r() * H - t * sp) % H, s = 1 + r() * 3;
    ctx.fillStyle = `rgba(0,229,255,${alpha * (.3 + .7 * r())})`; ctx.beginPath(); ctx.arc(x, (y + H) % H, s, 0, Math.PI * 2); ctx.fill();
  }
}
function cam(ctx, cx, cy, z, shake = 0, t = 0) {
  ctx.translate(W / 2 + Math.sin(t * 53) * shake, H / 2 + Math.cos(t * 47) * shake); ctx.scale(z, z); ctx.translate(-cx, -cy);
}

const CAPTIONS = [
  [0.4, 4.2, "There's a setting on your phone you've never seen."],
  [4.8, 8.7, 'It only shows up at 3:33 AM.'],
  [9.1, 12.3, 'And no matter what happens... never turn it on.'],
  [13.5, 15.9, 'You turned it on.'],
];

function draw(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (t < 4.5) { // S1: bedroom wide, slow push-in
    const k = prog(t, 0, 4.5); cam(ctx, lerp(1000, 1150, ease(k)), lerp(540, 560, k), lerp(1.0, 1.35, ease(k)));
    bedroom(ctx, t); bedNev(ctx, t, .9);
  } else if (t < 9) { // S2: phone close-up, scroll, hidden row appears
    const k = prog(t, 4.5, 9); cam(ctx, 960, 560, lerp(.82, .9, k));
    sky(ctx, t);
    phoneUI(ctx, t, { scroll: ease(prog(t, 4.6, 7.2)) * 420, rowIn: easeOut(prog(t, 7.4, 8.2)), knob: 0 });
  } else if (t < 12.5) { // S3: Nev face lit by phone
    const k = prog(t, 9, 12.5); cam(ctx, 960, 560, lerp(1.0, 1.12, ease(k)));
    sky(ctx, t); nevHead(ctx, 960, 560, 330, { lit: 1, brow: 1, blink: blinkAt(t, [10.9]), look: 0 });
  } else if (t < 16) { // S4: thumb flips toggle
    const k = prog(t, 12.5, 16); const flip = ease(prog(t, 13.0, 13.35));
    cam(ctx, 960, 760, lerp(1.2, 1.3, k), flip > 0 && t < 14 ? 10 * (1 - prog(t, 13.35, 14)) : 0, t);
    sky(ctx, t);
    phoneUI(ctx, t, { scroll: 420, rowIn: 1, knob: flip, flash: t > 13.3 ? .5 * (1 - prog(t, 13.3, 14)) : 0 });
    // thumb
    const tx = lerp(1500, 1145, ease(prog(t, 12.5, 13.0))) + flip * 60, ty = lerp(1300, 950, ease(prog(t, 12.5, 13.0)));
    const out = prog(t, 14.2, 15); hand(ctx, tx + out * 300, ty + out * 400, 46);
  } else if (t < 21) { // S5: eyes ignite
    const k = prog(t, 16, 21); const g = easeOut(prog(t, 16.3, 17.5));
    cam(ctx, 960, 560, lerp(1.0, 1.25, ease(k)), t < 17 ? 6 * (1 - prog(t, 16.3, 17)) : 0, t);
    sky(ctx, t);
    const flood = ctx.createRadialGradient(960, 560, 50, 960, 560, 900); flood.addColorStop(0, `rgba(0,229,255,${.18 * g})`); flood.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = flood; ctx.fillRect(0, 0, W, H);
    particles(ctx, t, 70, g * .8);
    nevHead(ctx, 960, 560, 330, { glow: g, brow: lerp(1, -.4, g), lit: .6 });
  } else { // S6: title card
    const k = prog(t, 21, 25);
    ctx.fillStyle = '#05070D'; ctx.fillRect(0, 0, W, H); particles(ctx, t, 40, .5);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = easeOut(prog(t, 21.2, 22)); ctx.font = '800 40px Inter'; ctx.fillStyle = C.cyan; ctx.fillText('B R E V A N E', W / 2, 400);
    ctx.globalAlpha = easeOut(prog(t, 21.8, 22.8)); ctx.font = '900 96px Inter'; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,229,255,.6)'; ctx.shadowBlur = 30; ctx.fillText('YOUR PHONE HAS', W / 2, 520); ctx.fillText('A HIDDEN MODE.', W / 2, 630); ctx.shadowBlur = 0;
    ctx.globalAlpha = easeOut(prog(t, 23, 23.8)); ctx.font = '600 38px Inter'; ctx.fillStyle = '#9FB0C8'; ctx.fillText('Impossible ideas. Real consequences.', W / 2, 760);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  vignette(ctx); grain(ctx, t);
  // cut fades
  for (const c of [4.5, 9, 12.5, 16, 21]) { const d = Math.abs(t - c); if (d < .12) { ctx.fillStyle = `rgba(0,0,0,${1 - d / .12})`; ctx.fillRect(0, 0, W, H); } }
  if (t > 24.4) { ctx.fillStyle = `rgba(0,0,0,${prog(t, 24.4, 25)})`; ctx.fillRect(0, 0, W, H); }
  for (const [a, b, s] of CAPTIONS) if (t >= a && t <= b) caption(ctx, s, Math.min(prog(t, a, a + .25), 1 - prog(t, b - .25, b)));
}
