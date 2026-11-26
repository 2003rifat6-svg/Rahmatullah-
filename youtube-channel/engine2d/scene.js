// Brevane hook v3 — professional 2D (Ifverse-like grammar): bright palettes, rim light,
// depth-of-field, rigged character with IK arms/legs, fingered hands, expressive face.
const W = 1920, H = 1080, DURATION = 20;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const easeIn = k => Math.pow(clamp(k), 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const P = (x, y) => ({ x, y });
const add = (a, b) => P(a.x + b.x, a.y + b.y);
const lp = (a, b, k) => P(lerp(a.x, b.x, k), lerp(a.y, b.y, k));
const rot = (v, a) => P(v.x * Math.cos(a) - v.y * Math.sin(a), v.x * Math.sin(a) + v.y * Math.cos(a));

const PAL = {
  ink: '#121726', skin: '#F4F6FB', skinShade: '#C9D3E3', hood: '#2E4A8C', hoodDark: '#22386C', pants: '#2A2F45',
  cyan: '#00E5FF', warm: '#FFB46A', red: '#FF5A5A',
};

// ---------- timeline ----------
const S = { B: 4.2, C: 6.3, D: 8.4, E: 10.6, F: 14.3, G: 16.3, FLIP: 15.0 };
const CAPTIONS = [
  [0.3, 3.9, "There's a setting on your phone you've never seen."],
  [4.6, 7.96, 'It only shows up at 3:33 AM.'],
  [8.6, 10.47, "It's called... Hidden Mode."],
  [11.0, 14.23, 'And no matter what happens... never turn it on.'],
  [15.25, 17.4, 'You turned it on.'],
];

// ---------- 2-bone IK ----------
function ik(a, target, l1, l2, bendSign) {
  let dx = target.x - a.x, dy = target.y - a.y, d = Math.hypot(dx, dy);
  d = Math.min(d, l1 + l2 - .01); const base = Math.atan2(dy, dx);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = base + bendSign * Math.acos(cosA);
  const mid = P(a.x + Math.cos(ang) * l1, a.y + Math.sin(ang) * l1);
  const end = P(a.x + Math.cos(base) * d, a.y + Math.sin(base) * d);
  return { mid, end };
}

// ---------- drawing primitives ----------
function stroke(ctx, pts, w, col, outline = PAL.ink) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = outline; ctx.lineWidth = w + 7; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
}
function rimGlow(ctx, col, blur) { ctx.shadowColor = col; ctx.shadowBlur = blur; }

// hand with palm, thumb and four fingers. dir = forearm direction (radians). kind: 'grip' | 'point' | 'open'
function drawHand(ctx, p, dir, s, kind, flip = 1) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(dir); ctx.scale(s, s * flip);
  const f = (x1, y1, x2, y2, w) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineCap = 'round';
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = w + 5; ctx.stroke(); ctx.strokeStyle = PAL.skin; ctx.lineWidth = w; ctx.stroke(); };
  // fingers
  const curl = kind === 'grip' ? .55 : kind === 'point' ? 1 : 1;
  [[-8, 0], [-2.5, 1], [3, 1], [8, 0]].forEach(([oy], i) => {
    const len = (i === 0 && kind === 'point') ? 30 : (kind === 'point' ? 14 : 24 * curl);
    const by = -9 + i * 6;
    f(14, by, 14 + len, by + (kind === 'grip' ? 4 : 0), 7);
  });
  // palm
  ctx.beginPath(); ctx.ellipse(6, 0, 16, 15, 0, 0, Math.PI * 2); ctx.fillStyle = PAL.skin; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = PAL.ink; ctx.stroke();
  // thumb
  f(10, 10, 22, kind === 'point' ? 16 : 18, 8);
  ctx.restore();
}

// ---------- character ----------
// rig: { hip, lean, headTilt, look:{x,y}, handN, handF, footN, footF, handKindN, handKindF,
//        face:{ brow, mouth, blink, glow, eyesO }, rim, rimCol, phone:{p,ang,glow}, scale }
function drawNev(ctx, r) {
  const s = r.scale || 1;
  ctx.save(); ctx.translate(r.hip.x, r.hip.y); ctx.scale(s, s);
  const hip = P(0, 0), torsoLen = 150;
  const neck = rot(P(0, -torsoLen), r.lean || 0);
  const sh = add(neck, rot(P(0, 22), r.lean || 0));
  const shN = add(sh, P(14, 0)), shF = add(sh, P(-14, -4));
  const hipN = P(10, 0), hipF = P(-10, -3);
  const rel = q => P((q.x - r.hip.x) / s, (q.y - r.hip.y) / s);
  const hn = rel(r.handN), hf = rel(r.handF), fn = rel(r.footN), ff = rel(r.footF);
  const armF = ik(shF, hf, 82, 78, r.elbowF ?? 1), armN = ik(shN, hn, 82, 78, r.elbowN ?? 1);
  const legF = ik(hipF, ff, 98, 96, -1), legN = ik(hipN, fn, 98, 96, -1);
  const rim = r.rim ?? .8, rimCol = r.rimCol || PAL.warm;

  // far leg + far arm (behind body)
  ctx.save(); rimGlow(ctx, rimCol, 18 * rim);
  stroke(ctx, [hipF, legF.mid, legF.end], 30, '#232739');
  shoe(ctx, legF.end, .92);
  stroke(ctx, [shF, armF.mid, armF.end], 26, PAL.hoodDark);
  ctx.restore();
  drawHand(ctx, armF.end, Math.atan2(armF.end.y - armF.mid.y, armF.end.x - armF.mid.x), .95, r.handKindF || 'grip', -1);

  // phone (between hands, behind near hand)
  if (r.phone) drawPhoneSmall(ctx, rel(r.phone.p), r.phone.ang, r.phone.glow, 1 / s);

  // torso (hoodie)
  ctx.save(); rimGlow(ctx, rimCol, 22 * rim);
  const lean = r.lean || 0;
  const tp = [P(-30, 8), P(-44, -60), P(-38, -118), P(0, -140), P(38, -118), P(46, -60), P(32, 8)].map(p => rot(p, lean));
  ctx.beginPath(); ctx.moveTo(tp[0].x, tp[0].y);
  ctx.bezierCurveTo(tp[1].x, tp[1].y, tp[2].x, tp[2].y, tp[3].x, tp[3].y);
  ctx.bezierCurveTo(tp[4].x, tp[4].y, tp[5].x, tp[5].y, tp[6].x, tp[6].y); ctx.closePath();
  const tg = ctx.createLinearGradient(-40, -140, 40, 10); tg.addColorStop(0, PAL.hood); tg.addColorStop(1, PAL.hoodDark);
  ctx.fillStyle = tg; ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 5; ctx.strokeStyle = PAL.ink; ctx.stroke(); ctx.restore();
  // pocket + strings
  ctx.save(); ctx.rotate(lean); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-24, -40); ctx.quadraticCurveTo(0, -30, 26, -40); ctx.stroke();
  ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 3.5; ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(-8, -120); ctx.lineTo(-10, -88); ctx.moveTo(10, -120); ctx.lineTo(12, -86); ctx.stroke(); ctx.restore();

  // near leg
  ctx.save(); rimGlow(ctx, rimCol, 18 * rim);
  stroke(ctx, [hipN, legN.mid, legN.end], 32, PAL.pants); ctx.restore();
  shoe(ctx, legN.end, 1);

  // head
  const headC = add(neck, rot(P(0, -58), lean + (r.headTilt || 0)));
  drawHead(ctx, headC, 74, r.face || {}, r.look || P(0, 0), r.headTilt || 0, rim, rimCol);

  // near arm (over body)
  ctx.save(); rimGlow(ctx, rimCol, 18 * rim);
  stroke(ctx, [shN, armN.mid, armN.end], 28, PAL.hood); ctx.restore();
  drawHand(ctx, armN.end, Math.atan2(armN.end.y - armN.mid.y, armN.end.x - armN.mid.x), 1, r.handKindN || 'grip', 1);
  ctx.restore();
}
function shoe(ctx, p, k) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(k, k);
  ctx.beginPath(); ctx.moveTo(-14, -6); ctx.quadraticCurveTo(-12, -18, 6, -14); ctx.quadraticCurveTo(34, -8, 36, 6); ctx.lineTo(-16, 8); ctx.closePath();
  ctx.fillStyle = '#EEF1F7'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = PAL.ink; ctx.stroke();
  ctx.fillStyle = PAL.cyan; ctx.fillRect(-14, 2, 50, 4); ctx.restore();
}
function drawHead(ctx, c, R, face, look, tilt, rim, rimCol) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(tilt * .5);
  // hood behind head
  ctx.beginPath(); ctx.ellipse(0, 18, R * 1.08, R * .95, 0, 0, Math.PI * 2); ctx.fillStyle = PAL.hoodDark; ctx.fill();
  // head
  ctx.save(); rimGlow(ctx, rimCol, 26 * rim);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(-R * .35, -R * .45, R * .1, 0, 0, R * 1.05); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, PAL.skinShade);
  ctx.fillStyle = g; ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.lineWidth = 5; ctx.strokeStyle = PAL.ink; ctx.stroke();
  if (face.lit) { const lg = ctx.createRadialGradient(0, R, 4, 0, R * .4, R * 1.3); lg.addColorStop(0, `rgba(150,240,255,${.5 * face.lit})`); lg.addColorStop(1, 'rgba(150,240,255,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fill(); }
  const fx = look.x * R * .28, fy = look.y * R * .22;
  const glow = face.glow || 0, blink = face.blink || 0;
  for (const sd of [-1, 1]) {
    const ex = fx + sd * R * .34, ey = fy - R * .08, rx = R * .12 * (face.eyesO ? 1.15 : 1), ry = R * .17 * (1 - .9 * blink) * (face.eyesO ? 1.1 : 1);
    if (glow > 0) {
      const hg = ctx.createRadialGradient(ex, ey, 0, ex, ey, R * .55); hg.addColorStop(0, `rgba(0,229,255,${.8 * glow})`); hg.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ex, ey, R * .55, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 30 * glow;
      ctx.beginPath(); ctx.ellipse(ex, ey, rx * 1.1, ry * 1.05, 0, 0, Math.PI * 2); ctx.fillStyle = `rgb(${Math.round(lerp(18, 0, glow))},${Math.round(lerp(23, 229, glow))},${Math.round(lerp(38, 255, glow))})`; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.ellipse(ex, ey, rx * .5 * glow, ry * .5 * glow, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = PAL.ink; ctx.fill();
      if (blink < .5) { ctx.beginPath(); ctx.arc(ex - rx * .3, ey - ry * .4, rx * .32, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.beginPath(); ctx.arc(ex + rx * .3, ey + ry * .3, rx * .14, 0, Math.PI * 2); ctx.fill(); }
    }
    // brow: +1 worried (inner up), -1 confident/angry (inner down)
    const b = face.brow ?? 0, by = ey - ry - R * .13;
    ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineWidth = R * .07; ctx.strokeStyle = PAL.ink;
    ctx.moveTo(ex - sd * R * .15, by - b * R * .08); ctx.lineTo(ex + sd * R * .15, by + b * R * .03); ctx.stroke();
  }
  // mouth
  const mx = fx, my = fy + R * .42, m = face.mouth || 'flat';
  ctx.lineWidth = R * .065; ctx.strokeStyle = PAL.ink; ctx.lineCap = 'round'; ctx.beginPath();
  if (m === 'frown') { ctx.moveTo(mx - R * .16, my + R * .05); ctx.quadraticCurveTo(mx, my - R * .1, mx + R * .16, my + R * .05); ctx.stroke(); }
  else if (m === 'smile') { ctx.moveTo(mx - R * .18, my - R * .03); ctx.quadraticCurveTo(mx, my + R * .14, mx + R * .18, my - R * .03); ctx.stroke(); }
  else if (m === 'smirk') { ctx.moveTo(mx - R * .14, my + R * .02); ctx.quadraticCurveTo(mx + R * .02, my + R * .08, mx + R * .2, my - R * .06); ctx.stroke(); }
  else if (m === 'o') { ctx.ellipse(mx, my, R * .07, R * .09, 0, 0, Math.PI * 2); ctx.fillStyle = PAL.ink; ctx.fill(); }
  else if (m === 'wavy') { ctx.moveTo(mx - R * .17, my); for (let i = 1; i <= 4; i++) ctx.quadraticCurveTo(mx - R * .17 + (i - .5) * R * .085, my + (i % 2 ? -1 : 1) * R * .05, mx - R * .17 + i * R * .085, my); ctx.stroke(); }
  else { ctx.moveTo(mx - R * .12, my); ctx.lineTo(mx + R * .12, my); ctx.stroke(); }
  ctx.restore();
}
function drawPhoneSmall(ctx, p, ang, glow, k) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
  ctx.fillStyle = '#0B0F1A'; ctx.beginPath(); ctx.roundRect(-20, -36, 40, 72, 8); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
  ctx.restore();
  // glow toward the face
  const g = ctx.createRadialGradient(p.x, p.y - 20, 4, p.x, p.y - 40, 220); g.addColorStop(0, `rgba(140,240,255,${.35 * glow})`); g.addColorStop(1, 'rgba(140,240,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 40, 220, 0, Math.PI * 2); ctx.fill();
}

// ---------- environment: bedroom ----------
function bedroom(ctx, t, o = {}) {
  const cy = o.cyan || 0;
  // wall
  const wg = ctx.createLinearGradient(0, 0, 0, 1080); wg.addColorStop(0, '#3A3970'); wg.addColorStop(1, '#2A2852'); ctx.fillStyle = wg; ctx.fillRect(-400, -400, 2720, 1880);
  // wall panel lines
  ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 2; for (let x = -400; x < 2400; x += 120) { ctx.beginPath(); ctx.moveTo(x, -400); ctx.lineTo(x, 820); ctx.stroke(); }
  // window
  const wx = 170, wy = 150, ww = 620, wh = 470;
  ctx.save(); ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 10); ctx.clip();
  const sg = ctx.createLinearGradient(0, wy, 0, wy + wh); sg.addColorStop(0, '#2B2D6E'); sg.addColorStop(.7, '#6B54A8'); sg.addColorStop(1, '#C27AA8'); ctx.fillStyle = sg; ctx.fillRect(wx, wy, ww, wh);
  ctx.save(); ctx.shadowColor = '#fff3d6'; ctx.shadowBlur = 50; ctx.beginPath(); ctx.arc(wx + 470, wy + 110, 46, 0, Math.PI * 2); ctx.fillStyle = '#FFF6E2'; ctx.fill(); ctx.restore();
  const r = rng(7); for (let i = 0; i < 50; i++) { ctx.fillStyle = `rgba(255,255,255,${.3 + .5 * r()})`; ctx.fillRect(wx + r() * ww, wy + r() * wh * .45, 2, 2); }
  let x = wx - 10; const r2 = rng(3);
  while (x < wx + ww) { const bw = 50 + r2() * 80, bh = 120 + r2() * 220; ctx.fillStyle = '#1E1B40'; ctx.fillRect(x, wy + wh - bh, bw - 6, bh);
    for (let yy = wy + wh - bh + 14; yy < wy + wh - 10; yy += 22) for (let xx = x + 8; xx < x + bw - 14; xx += 16) if (r2() < .3) { ctx.fillStyle = r2() < .15 ? 'rgba(0,229,255,.8)' : 'rgba(255,205,130,.8)'; ctx.fillRect(xx, yy, 7, 10); }
    x += bw; }
  ctx.restore();
  ctx.lineWidth = 16; ctx.strokeStyle = '#4A4A86'; ctx.strokeRect(wx, wy, ww, wh); ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
  // curtains
  ctx.fillStyle = '#5A3F78'; ctx.beginPath(); ctx.moveTo(wx - 70, wy - 30); ctx.quadraticCurveTo(wx - 20, wy + 250, wx - 60, wy + wh + 80); ctx.lineTo(wx - 110, wy + wh + 80); ctx.lineTo(wx - 110, wy - 30); ctx.fill();
  ctx.beginPath(); ctx.moveTo(wx + ww + 70, wy - 30); ctx.quadraticCurveTo(wx + ww + 20, wy + 250, wx + ww + 60, wy + wh + 80); ctx.lineTo(wx + ww + 110, wy + wh + 80); ctx.lineTo(wx + ww + 110, wy - 30); ctx.fill();
  // poster
  ctx.fillStyle = '#4C4A8C'; ctx.fillRect(1500, 220, 190, 250); ctx.fillStyle = '#FF8A5B'; ctx.beginPath(); ctx.arc(1595, 330, 50, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#2A2852'; ctx.fillRect(1530, 395, 130, 12);
  // floor
  const fg = ctx.createLinearGradient(0, 820, 0, 1080); fg.addColorStop(0, '#3B2E4E'); fg.addColorStop(1, '#2A2138'); ctx.fillStyle = fg; ctx.fillRect(-400, 820, 2720, 700);
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; for (let yy = 860; yy < 1300; yy += 50) { ctx.beginPath(); ctx.moveTo(-400, yy); ctx.lineTo(2400, yy); ctx.stroke(); }
  // nightstand + lamp
  ctx.fillStyle = '#5B4466'; ctx.beginPath(); ctx.roundRect(1520, 640, 230, 200, 12); ctx.fill(); ctx.fillStyle = '#4A3656'; ctx.fillRect(1540, 700, 190, 6);
  ctx.fillStyle = '#2A2138'; ctx.fillRect(1625, 560, 14, 82); ctx.fillStyle = '#E9A65F'; ctx.beginPath(); ctx.moveTo(1585, 560); ctx.lineTo(1680, 560); ctx.lineTo(1660, 500); ctx.lineTo(1605, 500); ctx.closePath(); ctx.fill();
  const lampOn = o.lamp ?? 1;
  const lg = ctx.createRadialGradient(1632, 560, 10, 1632, 620, 520); lg.addColorStop(0, `rgba(255,190,110,${.45 * lampOn})`); lg.addColorStop(1, 'rgba(255,190,110,0)'); ctx.fillStyle = lg; ctx.fillRect(1000, 100, 1200, 1000);
  // clock on nightstand
  flipClockSmall(ctx, 1545, 590, t);
  // bed
  ctx.fillStyle = '#4E3B6E'; ctx.beginPath(); ctx.roundRect(820, 470, 70, 380, 16); ctx.fill(); // headboard
  ctx.fillStyle = '#3F3060'; ctx.beginPath(); ctx.roundRect(840, 690, 660, 160, 18); ctx.fill(); // frame
  ctx.fillStyle = '#E7E3F2'; ctx.beginPath(); ctx.roundRect(860, 640, 630, 70, 26); ctx.fill(); // mattress
  ctx.fillStyle = '#6E8FD8'; ctx.beginPath(); ctx.moveTo(1080, 650); ctx.bezierCurveTo(1250, 620, 1400, 625, 1495, 650); ctx.lineTo(1495, 730); ctx.lineTo(1080, 730); ctx.fill(); // blanket
  ctx.fillStyle = '#F3F1FA'; ctx.beginPath(); ctx.roundRect(880, 585, 170, 70, 30); ctx.fill(); // pillow
  if (cy > 0) { ctx.save(); ctx.globalCompositeOperation = 'screen'; const cg = ctx.createRadialGradient(1000, 520, 20, 1000, 520, 1100); cg.addColorStop(0, `rgba(0,229,255,${.45 * cy})`); cg.addColorStop(1, `rgba(0,80,140,${.25 * cy})`); ctx.fillStyle = cg; ctx.fillRect(-400, -400, 2720, 1880); ctx.restore(); }
}
function flipClockSmall(ctx, x, y, t) {
  ctx.fillStyle = '#1C1830'; ctx.beginPath(); ctx.roundRect(x, y, 120, 52, 8); ctx.fill();
  ctx.font = '800 34px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#9FF5FF'; ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 12;
  ctx.fillText(t < 5.2 ? '3:32' : '3:33', x + 60, y + 28); ctx.shadowBlur = 0; ctx.textAlign = 'left';
}

// Nev's pose sitting on the bed edge, looking at phone
function sittingRig(t, o = {}) {
  const br = Math.sin(t * 1.7) * 2.5;
  const hip = P(1180, 655 + br * .3);
  const scroll = o.scroll ? Math.sin(t * 7) * 4 : 0;
  const phoneP = P(1262 + (o.phoneDX || 0), 598 + br + (o.phoneDY || 0));
  return {
    hip, lean: .12 + (o.lean || 0), headTilt: .34 + (o.headTilt || 0) + Math.sin(t * .8) * .02,
    look: o.look || P(.55, .55),
    handN: add(phoneP, P(16, 22 + scroll)), handF: add(phoneP, P(-18, 18)), handKindN: o.handKindN || 'grip', handKindF: 'grip', elbowN: 1, elbowF: 1,
    footN: P(1262, 842), footF: P(1236, 844),
    phone: { p: phoneP, ang: -.35, glow: o.phoneGlow ?? 1 },
    face: o.face || { brow: .4, mouth: 'flat', lit: .9 },
    rim: o.rim ?? .9, rimCol: o.rimCol || PAL.warm, scale: 1,
  };
}

function headCenterOf(r) { const neck = add(r.hip, rot(P(0, -150), r.lean)); return add(neck, rot(P(0, -58), r.lean + r.headTilt)); }
// ---------- phone screen (insert) ----------
function phoneInsert(ctx, t, o) {
  const { scroll = 0, rowIn = 0, knob = 0, flash = 0 } = o;
  const px = 960, py = 540, pw = 520, ph = 980;
  ctx.save();
  ctx.fillStyle = '#0A0D16'; ctx.beginPath(); ctx.roundRect(px - pw / 2, py - ph / 2, pw, ph, 64); ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#3A4466'; ctx.stroke();
  const sx = px - pw / 2 + 22, sy = py - ph / 2 + 22, sw = pw - 44, sh = ph - 44;
  ctx.save(); ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 46); ctx.clip();
  ctx.fillStyle = '#10182B'; ctx.fillRect(sx, sy, sw, sh);
  ctx.font = '600 26px Inter'; ctx.fillStyle = '#E8EEF7'; ctx.textBaseline = 'middle'; ctx.fillText('3:33', sx + 44, sy + 46);
  ctx.strokeStyle = '#E8EEF7'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(sx + sw - 96, sy + 34, 48, 24, 6); ctx.stroke(); ctx.fillStyle = '#E8EEF7'; ctx.fillRect(sx + sw - 92, sy + 38, 36, 16);
  ctx.save(); ctx.beginPath(); ctx.rect(sx, sy + 80, sw, sh - 80); ctx.clip();
  ctx.font = '800 46px Inter'; ctx.fillStyle = '#fff'; ctx.fillText('Settings', sx + 36, sy + 130 - scroll * .25);
  const names = ['Wi-Fi', 'Bluetooth', 'Notifications', 'Sounds', 'Focus', 'Screen Time', 'Display', 'Battery', 'Privacy', 'Storage', 'General'];
  const cols = ['#3a7bd5', '#4a5fd0', '#d05a5a', '#d0507f', '#6a5ad0', '#7a5ad0', '#3a8bd5', '#3fbf6f', '#3a7bd5', '#7a8599', '#7a8599'];
  names.forEach((n, i) => {
    const y = sy + 190 + i * 84 - scroll; if (y < sy + 70 || y > sy + sh) return;
    ctx.fillStyle = '#18223A'; ctx.beginPath(); ctx.roundRect(sx + 24, y, sw - 48, 72, 16); ctx.fill();
    ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.roundRect(sx + 44, y + 17, 38, 38, 10); ctx.fill();
    ctx.font = '500 28px Inter'; ctx.fillStyle = '#E8EEF7'; ctx.fillText(n, sx + 100, y + 37);
    ctx.strokeStyle = '#59647a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx + sw - 70, y + 26); ctx.lineTo(sx + sw - 58, y + 36); ctx.lineTo(sx + sw - 70, y + 46); ctx.stroke();
  });
  ctx.restore();
  if (rowIn > 0) {
    const y = sy + sh - 220; ctx.save(); ctx.globalAlpha = rowIn; ctx.translate(0, (1 - rowIn) * 30);
    ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 30 + 14 * Math.sin(t * 5);
    ctx.fillStyle = '#0A2533'; ctx.beginPath(); ctx.roundRect(sx + 24, y, sw - 48, 108, 20); ctx.fill(); ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 4; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.font = '800 36px Inter'; ctx.fillStyle = '#E8FDFF'; ctx.fillText('Hidden Mode', sx + 50, y + 55);
    const tx = sx + sw - 170, ty = y + 26; ctx.fillStyle = knob > .5 ? PAL.cyan : '#3A4459'; ctx.beginPath(); ctx.roundRect(tx, ty, 110, 56, 28); ctx.fill();
    if (knob > .5) { ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 30; ctx.fill(); ctx.shadowBlur = 0; }
    ctx.beginPath(); ctx.arc(tx + 28 + knob * 54, ty + 28, 23, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }
  if (flash > 0) { ctx.fillStyle = `rgba(170,250,255,${flash})`; ctx.fillRect(sx, sy, sw, sh); }
  ctx.restore(); ctx.restore();
  return { toggle: P(sx + sw - 170 + 28 + knob * 54, sy + sh - 220 + 54) };
}
// big hand for inserts (thumb pressing)
function bigHand(ctx, p, ang, s, kind) { drawHand(ctx, p, ang, s, kind, 1); }

// ---------- flip clock insert ----------
function flipClockInsert(ctx, t) {
  const k = ease(prog(t, 5.0, 5.4));
  ctx.save(); ctx.translate(960, 520);
  ctx.fillStyle = '#4A3656'; ctx.beginPath(); ctx.roundRect(-560, -220, 1120, 440, 40); ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#2A2138'; ctx.stroke();
  const card = (x, draw) => { ctx.save(); ctx.translate(x, 0); ctx.fillStyle = '#F3EEE4'; ctx.beginPath(); ctx.roundRect(-115, -165, 230, 330, 24); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(-115, -165, 230, 330, 24); ctx.clip(); ctx.fillStyle = '#1C1830'; ctx.font = '900 220px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; draw(); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-115, -2, 230, 5); ctx.restore(); };
  card(-385, () => ctx.fillText('3', 0, 12));
  ctx.fillStyle = '#F3EEE4'; ctx.beginPath(); ctx.arc(-200, -55, 18, 0, Math.PI * 2); ctx.arc(-200, 55, 18, 0, Math.PI * 2); ctx.fill();
  card(-15, () => ctx.fillText('3', 0, 12));
  card(255, () => { ctx.globalAlpha = 1 - k; ctx.fillText('2', 0, 12 - k * 300); ctx.globalAlpha = k; ctx.fillText('3', 0, 12 + (1 - k) * 300); ctx.globalAlpha = 1; });
  ctx.restore();
}
// ---------- overlays ----------
function caption(ctx, s, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.font = '800 52px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(s).width; ctx.fillStyle = 'rgba(10,12,22,.62)'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2 - 34, H - 170, tw + 68, 88, 22); ctx.fill();
  ctx.fillStyle = s === 'You turned it on.' ? '#7FF3FF' : '#fff'; ctx.fillText(s, W / 2, H - 125); ctx.restore();
}
function label(ctx, text, a) { // Ifverse-like top-left chapter label
  ctx.save(); ctx.globalAlpha = a; ctx.font = '800 26px Inter'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(62, 62, 7, 0, Math.PI * 2); ctx.fillStyle = PAL.cyan; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(text, 82, 63); ctx.restore();
}
function pill(ctx, text, a, y = 110) {
  ctx.save(); ctx.globalAlpha = a; ctx.font = '900 44px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width; ctx.fillStyle = 'rgba(8,16,28,.85)'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2 - 40, y - 40, tw + 80, 80, 40); ctx.fill();
  ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 4; ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 20; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff'; ctx.fillText(text, W / 2, y + 2); ctx.restore();
}
function particles(ctx, t, n, alpha) {
  const r = rng(99); for (let i = 0; i < n; i++) {
    const x = r() * W, sp = 20 + r() * 70, y = ((r() * H - t * sp) % H + H) % H, sz = 1.5 + r() * 3.5;
    ctx.fillStyle = `rgba(0,229,255,${alpha * (.3 + .7 * r())})`; ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
  }
}
function vignette(ctx, k = .45) { const g = ctx.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${k})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
function grain(ctx, t) { const r = rng(Math.floor(t * 30) + 11); ctx.fillStyle = 'rgba(255,255,255,.03)'; for (let i = 0; i < 700; i++) ctx.fillRect(r() * W, r() * H, 2, 2); }

// camera: centre (cx,cy) and zoom z in world space; optional blur of the background layer
let bgCanvas = null;
function withCam(ctx, cx, cy, z, fn, shake = 0, t = 0) {
  ctx.save(); ctx.translate(W / 2 + Math.sin(t * 53) * shake, H / 2 + Math.cos(t * 47) * shake); ctx.scale(z, z); ctx.translate(-cx, -cy); fn(ctx); ctx.restore();
}
function blurredLayer(ctx, blur, fn) {
  if (!bgCanvas) { bgCanvas = document.createElement('canvas'); bgCanvas.width = W; bgCanvas.height = H; }
  const b = bgCanvas.getContext('2d'); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, W, H); fn(b);
  ctx.save(); ctx.filter = `blur(${blur}px)`; ctx.drawImage(bgCanvas, 0, 0); ctx.restore();
}

// ---------- main ----------
function draw(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (t < S.B) { // A: wide establishing, slow push-in
    const k = ease(prog(t, 0, S.B));
    const rig = sittingRig(t, { scroll: true, face: { brow: .3, mouth: 'flat', lit: .9, blink: blink(t, [2.1]) } });
    withCam(ctx, lerp(1000, 1120, k), lerp(560, 560, k), lerp(1.0, 1.18, k), c => { bedroom(c, t); drawNev(c, rig); });
    label(ctx, 'TUESDAY · 3:32 AM', easeOut(prog(t, .4, 1.2)) * (1 - prog(t, 3.6, 4.1)));
  } else if (t < S.C) { // B: flip-clock insert, bedroom blurred behind
    const k = ease(prog(t, S.B, S.C));
    blurredLayer(ctx, 14, b => withCam(b, 1450, 560, 1.6, c => bedroom(c, t)));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(lerp(.92, 1.0, k), lerp(.92, 1.0, k)); ctx.translate(-W / 2, -H / 2); flipClockInsert(ctx, t); ctx.restore();
  } else if (t < S.D) { // C: medium shot from the side, phone light on face
    const k = ease(prog(t, S.C, S.D));
    blurredLayer(ctx, 8, b => withCam(b, lerp(1180, 1200, k), 470, 1.9, c => bedroom(c, t)));
    const rig = sittingRig(t, { scroll: true, headTilt: -.04 * k, face: { brow: .2 + .4 * k, mouth: 'flat', lit: 1, blink: blink(t, [7.3]) } });
    withCam(ctx, lerp(1180, 1200, k), 470, 1.9, c => drawNev(c, rig));
  } else if (t < S.E) { // D: POV phone, scrolling, hidden row slides in
    const k = ease(prog(t, S.D, S.E));
    blurredLayer(ctx, 18, b => withCam(b, 1250, 800, 2.4, c => bedroom(c, t)));
    ctx.save(); ctx.translate(W / 2, H / 2 - 40); ctx.scale(lerp(.84, .88, k), lerp(.84, .88, k)); ctx.translate(-W / 2, -H / 2);
    phoneInsert(ctx, t, { scroll: ease(prog(t, S.D, 9.1)) * 360 + 60, rowIn: easeOut(prog(t, 8.7, 9.3)) });
    bigHand(ctx, P(1225, 1000), -2.0, 2.6, 'grip'); bigHand(ctx, P(700, 1000), -1.15, 2.6, 'grip');
    ctx.restore();
  } else if (t < S.F) { // E: extreme close-up on the face
    const k = ease(prog(t, S.E, S.F));
    blurredLayer(ctx, 16, b => withCam(b, 1000, 380, 2.6, c => bedroom(c, t)));
    const z = lerp(4.4, 5.2, k), gulp = Math.max(0, 1 - Math.abs(t - 13.4) / .25);
    const rig = sittingRig(t, { headTilt: -.3, look: P(.1, .25), face: { brow: .95, mouth: gulp > .2 ? 'wavy' : 'frown', lit: 1, blink: blink(t, [12.3]) } });
    const headC = headCenterOf(rig);
    withCam(ctx, headC.x + 10, headC.y + 18, z * .62, c => drawNev(c, rig));
  } else if (t < S.G) { // F: insert — thumb flips the toggle
    const appr = ease(prog(t, S.F, S.FLIP)), flip = ease(prog(t, S.FLIP, S.FLIP + .25));
    const shake = t > S.FLIP + .2 && t < 15.8 ? 10 * (1 - prog(t, S.FLIP + .2, 15.8)) : 0;
    blurredLayer(ctx, 18, b => withCam(b, 1250, 800, 2.4, c => bedroom(c, t, { cyan: flip * .6 })));
    ctx.save(); ctx.translate(W / 2 + Math.sin(t * 60) * shake, H / 2 - 40 + Math.cos(t * 50) * shake); ctx.scale(.88, .88); ctx.translate(-W / 2, -H / 2);
    const ui = phoneInsert(ctx, t, { scroll: 420, rowIn: 1, knob: flip, flash: t > S.FLIP + .2 ? .6 * (1 - prog(t, S.FLIP + .2, 15.9)) : 0 });
    const from = P(1500, 1250), to = P(ui.toggle.x + 30, ui.toggle.y + 40);
    const away = ease(prog(t, 15.6, 16.2));
    const hp = lp(lp(from, to, appr), from, away);
    bigHand(ctx, hp, -2.3, 2.6, 'point');
    ctx.restore();
  } else { // G: medium-close, cyan floods, eyes ignite, he straightens up
    const g = easeOut(prog(t, S.G + .3, S.G + 1.5)), k = ease(prog(t, S.G, 20));
    blurredLayer(ctx, 10, b => withCam(b, 1180, 430, lerp(2.3, 2.6, k), c => bedroom(c, t, { cyan: .6 + .4 * g, lamp: 1 - .6 * g })));
    const rig = sittingRig(t, { lean: -.12 * g, headTilt: -.42 * g, look: P(lerp(.5, 0, g), lerp(.5, -.1, g)), phoneDY: 10 * g, rimCol: g > .3 ? PAL.cyan : PAL.warm, rim: 1.2,
      face: { brow: lerp(.9, -.6, g), mouth: g > .7 ? 'smirk' : 'frown', glow: g, lit: .5 } });
    const sh = t < S.G + .5 ? 8 * (1 - prog(t, S.G + .2, S.G + .5)) : 0;
    { const hc = headCenterOf(rig); withCam(ctx, hc.x + 10, hc.y + 70, lerp(3.0, 3.4, k), c => drawNev(c, rig), sh, t); }
    particles(ctx, t, 90, g * .9);
    pill(ctx, 'HIDDEN MODE: ON', easeOut(prog(t, 17.6, 18.2)), H - 125);
  }
  vignette(ctx); grain(ctx, t);
  for (const c of [S.B, S.C, S.D, S.E, S.F, S.G]) { const d = Math.abs(t - c); if (d < .08) { ctx.fillStyle = `rgba(0,0,0,${.9 * (1 - d / .08)})`; ctx.fillRect(0, 0, W, H); } }
  if (t < .3) { ctx.fillStyle = `rgba(0,0,0,${1 - t / .3})`; ctx.fillRect(0, 0, W, H); }
  if (t > 19.4) { ctx.fillStyle = `rgba(0,0,0,${prog(t, 19.4, 20)})`; ctx.fillRect(0, 0, W, H); }
  for (const [a, b, s] of CAPTIONS) if (t >= a && t <= b) caption(ctx, s, Math.min(prog(t, a, a + .2), 1 - prog(t, b - .2, b)));
}
function blink(t, times) { let b = 0; for (const s of times) { const d = Math.abs(t - s); if (d < .09) b = Math.max(b, 1 - d / .09); } return b; }
