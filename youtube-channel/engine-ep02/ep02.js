// Brevane #02 — "What If You Earned $1 Every Time Someone Said Your Name?"  (no burned-in subtitles)
import { VERT, THREE, W, H, clamp, lerp, ease, easeOut, prog, V, rng, renderer, scene, camera, composer, bloom, look, lightRig,
  makeChar, poseChar, standPose, sitPose, makePhone, placePhone } from './core.js';
import { drawPhoneUI } from './ui.js';
import { bedroom, school, street, store, house, showSet } from './sets.js';
import { town, gym, studio, lake, makeExtra } from './sets2.js';

const TL = await (await fetch('/timing.json')).json();
const ps = i => TL[i].start, pe = i => TL[i].end;
const END0 = pe(TL.length - 1) + .7, ENDCARD = 13, DURATION = END0 + ENDCARD;

// pastel restyle
const RECOLOR = { '46578a': '9d8cc9', '3a4466': 'c9b6a4', '2a3558': '7f6fae', '3c5aa0': '5fc7b4', '5a4a6a': 'c98f6a', '9cc7b4': '8fd1c2' };
scene.traverse(o => { if (o.material && o.material.color) { const h = o.material.color.getHexString(); if (RECOLOR[h]) o.material.color.set('#' + RECOLOR[h]); } });

// ---------- cast ----------
const nev = makeChar({ hoodie: '#D2512E' });
const jake = makeChar({ hoodie: '#3fae6a', cap: '#f2f2f2', string: '#ffffff' });
const teacher = makeChar({ hoodie: '#7a8599', glasses: true, string: '#7a8599', sleeveFull: true });
const mom = makeChar({ hoodie: '#8a4fbf', scarf: '#f2a6c8', bun: '#3a2a22', string: '#8a4fbf', sleeveFull: true });
const anchor = makeChar({ hoodie: '#22325a', bun: '#5a3a22', string: '#22325a', sleeveFull: true, scarf: '#e23b3b' });
const grandma = makeChar({ hoodie: '#c9a6d9', glasses: true, bun: '#d9d9d9', scarf: '#ffffff', string: '#c9a6d9', sleeveFull: true });
const fisher = makeChar({ hoodie: '#f2b33d', cap: '#2a3a5a', string: '#f2b33d', sleeveFull: true });
const kids = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3', '#3fae6a', '#ff8c42'].map(h => makeChar({ hoodie: h, string: h }));
const CAST = [nev, jake, teacher, mom, anchor, grandma, fisher, ...kids];
const extras = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3', '#3fae6a', '#ff8c42', '#e23b3b', '#7a8599', '#5ac8e6', '#c98f6a', '#8a4fbf'].map(c => makeExtra(c, town.g));
const phone = makePhone(), phone2 = makePhone();
const setWorld = (o, p) => o.position.copy(p).sub(o.parent.position);
// money stacks for the bedroom
const cash = new THREE.Group(); bedroom.g.add(cash); const cashM = new THREE.MeshStandardMaterial({ color: '#6fbf73', roughness: .7 }), bandM = new THREE.MeshStandardMaterial({ color: '#f2e6b0', roughness: .6 });
const stacks = []; { const r = rng(5); for (let i = 0; i < 90; i++) { const s = new THREE.Group(); cash.add(s); const b = new THREE.Mesh(new THREE.BoxGeometry(.16, .06, .08), cashM); s.add(b); const band = new THREE.Mesh(new THREE.BoxGeometry(.03, .062, .082), bandM); s.add(band);
  const ring = Math.floor(i / 18), a = r() * 6.28, rad = r() * (.9 - ring * .15); s.position.set(.55 + Math.cos(a) * rad, .56 + ring * .062, -.7 + Math.sin(a) * rad * .8); s.rotation.y = r() * 3; stacks.push(s); } }

function ui(ph, s) { drawPhoneUI(ph.cv.getContext('2d'), s); ph.tex.needsUpdate = true; ph.g.visible = true; ph.light.intensity = s.light ?? .05; }
// custom phone apps: bank, trend, call, rec
function app(ph, s) { const g = ph.cv.getContext('2d'); ph.g.visible = true; ph.light.intensity = s.light ?? .06; ph.tex.needsUpdate = true;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  g.fillStyle = s.bg || '#0f1626'; g.fillRect(0, 0, 600, 1200); g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = '600 30px Inter'; g.fillStyle = '#e8eef7'; g.fillText(s.time || '7:02', 44, 48);
  if (s.kind === 'bank') {
    g.fillStyle = '#1b3a7a'; g.fillRect(0, 90, 600, 300); g.font = '600 32px Inter'; g.fillStyle = '#bcd0ff'; g.fillText(s.owner || 'Your balance', 44, 150);
    g.font = '900 78px Inter'; g.fillStyle = s.red ? '#ff6b6b' : '#ffffff'; g.fillText(s.balance, 44, 245); g.font = '600 28px Inter'; g.fillStyle = '#9fb0c8'; g.fillText(s.sub || '', 44, 330);
    (s.rows || []).forEach((row, i) => { const y = 430 + i * 104 - (s.scroll || 0); if (y < 400 || y > 1180) return; g.fillStyle = 'rgba(34,44,70,.92)'; rr(26, y, 548, 88, 18); g.fill();
      g.font = '700 30px Inter'; g.fillStyle = '#fff'; g.fillText(row[0], 50, y + 32); g.font = '500 24px Inter'; g.fillStyle = '#9fb0c8'; g.fillText(row[1], 50, y + 64);
      g.font = '800 32px Inter'; g.textAlign = 'right'; g.fillStyle = row[2][0] === '-' ? '#ff6b6b' : '#4ee08a'; g.fillText(row[2], 552, y + 44); g.textAlign = 'left'; });
    if (s.button) { const p = s.button; g.save(); g.shadowColor = '#ff5a5a'; g.shadowBlur = 40 * p; g.fillStyle = s.pressed ? '#ffffff' : '#e23b3b'; rr(60, 1020, 480, 110, 55); g.fill(); g.restore();
      g.font = '900 44px Inter'; g.fillStyle = s.pressed ? '#e23b3b' : '#ffffff'; g.textAlign = 'center'; g.fillText('RETURN ALL', 300, 1076); g.textAlign = 'left'; }
  } else if (s.kind === 'trend') {
    const gr = g.createLinearGradient(0, 90, 0, 760); gr.addColorStop(0, '#ff8c42'); gr.addColorStop(1, '#9b5de5'); g.fillStyle = gr; g.fillRect(0, 90, 600, 670);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(300, 360, 120, 0, 7); g.fill(); g.fillStyle = '#0b0d14'; g.beginPath(); g.ellipse(255, 345, 18, 28, 0, 0, 7); g.ellipse(345, 345, 18, 28, 0, 0, 7); g.fill();
    g.fillStyle = '#D2512E'; g.fillRect(170, 480, 260, 280); g.font = '900 64px Inter'; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('#SayNev', 300, 160); g.textAlign = 'left';
    g.font = '900 64px Inter'; g.fillStyle = '#fff'; g.fillText(s.views || '14.2M views', 44, 840); g.font = '600 30px Inter'; g.fillStyle = '#ffd34d'; g.fillText('#1 TRENDING · USA', 44, 905);
    g.font = '600 30px Inter'; g.fillStyle = '#dfe6f2'; ['"NEV NEV NEV 😂"', '"say it with me: NEV"', '"my grandma said it 40 times"'].forEach((c, i) => g.fillText(c, 44, 990 + i * 60));
  } else if (s.kind === 'call') {
    g.fillStyle = '#163a2a'; g.fillRect(0, 0, 600, 1200); g.fillStyle = '#3fae6a'; g.beginPath(); g.arc(300, 380, 120, 0, 7); g.fill(); g.font = '900 110px Inter'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('J', 300, 385);
    g.font = '800 56px Inter'; g.fillText('Jake', 300, 580); g.font = '500 34px Inter'; g.fillStyle = '#bfe8cf'; g.fillText(s.sub || 'calling...', 300, 640);
    g.fillStyle = '#e23b3b'; g.beginPath(); g.arc(300, 1000, 60, 0, 7); g.fill(); g.textAlign = 'left';
  } else if (s.kind === 'rec') {
    g.fillStyle = '#2a2034'; g.fillRect(0, 90, 600, 1110); g.fillStyle = '#5a3a6a'; g.fillRect(0, 760, 600, 440);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(300, 560, 70, 0, 7); g.fill(); g.fillStyle = '#D2512E'; g.fillRect(240, 630, 120, 140);
    g.fillStyle = '#e23b3b'; g.beginPath(); g.arc(70, 150, 16, 0, 7); g.fill(); g.font = '800 36px Inter'; g.fillStyle = '#fff'; g.fillText('REC ' + (s.rec || '00:14'), 100, 152);
  } else if (s.kind === 'msg') {
    g.font = '700 36px Inter'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('Jake', 300, 140); g.textAlign = 'left';
    g.fillStyle = '#2f6fd6'; rr(300, 900, 250, 90, 40); g.fill(); g.font = '700 44px Inter'; g.fillStyle = '#fff'; g.fillText(s.typed || 'Nev', 340, 946);
    g.fillStyle = 'rgba(255,255,255,.12)'; rr(26, 1080, 548, 80, 40); g.fill(); g.font = '500 30px Inter'; g.fillStyle = '#9fb0c8'; g.fillText('Delivered', 410, 1010);
  }
}
const blink = t => { const p = (t % 3.3) / 3.3; return p > .93 ? 1 - Math.abs(p - .965) / .035 : 0; };
const talk = (t, i) => t > ps(i) && t < pe(i) - .05 ? (Math.sin(t * 15) > 0 ? 'o' : 'flat') : null;
const yell = (t, i) => t > ps(i) && t < pe(i) - .05 ? (Math.sin(t * 15) > 0 ? 'yell' : 'o') : null;
const F = { calm: { brow: .3, mouth: 'flat' }, happy: { brow: -.2, mouth: 'smile' }, smug: { brow: -.6, mouth: 'smirk' }, sad: { brow: 1, mouth: 'frown' }, shock: { brow: 1, mouth: 'o', wide: true }, worried: { brow: .8, mouth: 'wavy' } };
const fb = (f, t) => ({ ...f, blink: f.blink ?? blink(t) });

const LIGHT = {
  morning: () => { lightRig(V(0, 1, 0), { key: 2.6, keyCol: '#ffe9cf', hemi: 2.6, sky: '#fff1e2', ground: '#8a7a90', bg: '#c9b8e6', exposure: 1.35, fill: 1.4, fillCol: '#d9ccff' }); bedroom.day(true); bedroom.lamp.intensity = 0; },
  night: () => { lightRig(V(0, 1, 0), { key: 2.0, keyCol: '#d9d6ff', hemi: 2.2, sky: '#c9c0f0', ground: '#4a4060', bg: '#3b3566', exposure: 1.45, fill: 1.4, fillCol: '#c8b8ff' }); bedroom.day(false); bedroom.lamp.intensity = .9; },
  dark: () => { lightRig(V(0, 1, 0), { key: 1.1, keyCol: '#a9a3e6', hemi: 1.5, sky: '#9d93d6', ground: '#2a2440', bg: '#241f42', exposure: 1.45 }); bedroom.day(false); bedroom.lamp.intensity = 0; },
  kitchen: () => { lightRig(V(120, 1, 0), { key: 2.5, keyCol: '#fff0dc', hemi: 2.5, sky: '#fff0dc', ground: '#7a6050', bg: '#f0d6b0', exposure: 1.3 }); house.day(true); house.lamp.intensity = 0; },
  kitchenNight: () => { lightRig(V(120, 1, 0), { key: 1.0, keyCol: '#ffcf9a', hemi: 1.6, sky: '#ffd9a8', ground: '#3a2a22', bg: '#3a2a30', exposure: 1.4 }); house.day(false); house.lamp.intensity = 2.5; },
  school: (z = 0) => lightRig(V(30, 1, z), { key: 2.2, keyCol: '#fff4e4', hemi: 2.3, sky: '#fff6ea', ground: '#7a8a80', bg: '#cfe6df', exposure: 1.15, fill: 1.3 }),
  town: (x = 300, sunset = false) => lightRig(V(x, 1, 0), sunset ? { key: 2.4, keyCol: '#ffb37a', hemi: 2.2, sky: '#ffcf9a', ground: '#6a7a50', bg: '#f2a37a', exposure: 1.25, keyOff: V(-20, 14, 20) } : { key: 2.8, keyCol: '#fff4e0', hemi: 2.6, sky: '#cfe6ff', ground: '#7a9a60', bg: '#9fd0f5', exposure: 1.2, keyOff: V(12, 20, 16) }),
  gym: () => { lightRig(V(360, 1, 0), { key: 1.6, keyCol: '#fff4e0', hemi: 2.0, sky: '#fff6ea', ground: '#8a7050', bg: '#cfd8ea', exposure: 1.2 }); gym.spot.intensity = 60; },
  studio: () => lightRig(V(420, 1, 0), { key: 2.4, keyCol: '#e6eeff', hemi: 2.0, sky: '#cfe0ff', ground: '#203050', bg: '#16264a', exposure: 1.25 }),
  lake: () => lightRig(V(480, 1, 0), { key: 2.6, keyCol: '#fff8ee', hemi: 2.6, sky: '#dff0ff', ground: '#5a8aa6', bg: '#bfe3ff', exposure: 1.2, keyOff: V(10, 20, 14) }),
  store: () => lightRig(V(90, 1, 0), { key: 2.0, hemi: 2.0, sky: '#fff8ee', ground: '#8a7a6a', bg: '#f1e4d0', exposure: 1.1 }),
};

const BED = { seat: V(0, .5, -.05), fwd: V(0, 0, 1) };
function holdSit(t, seat, fwd, o = {}) {
  const tmp = { handL: seat.clone().add(V(0, .4, .2)), handR: seat.clone().add(V(0, .4, .2)) };
  const i1 = sitPose(nev, seat, fwd, { t, lean: .32, face: fb(o.face || F.calm, t), ...tmp }); placePhone(phone, i1, {});
  const gL = phone.g.localToWorld(V(-.066, -.05, -.012)); let gR = phone.g.localToWorld(V(.066, -.05, -.012)), pdir = null, modeR = 'grip';
  if (o.pointLocal) { gR = phone.g.localToWorld(o.pointLocal.clone()); pdir = phone.g.localToWorld(o.pointLocal.clone()).sub(phone.g.localToWorld(V(.09, -.12, .05))); modeR = 'point'; }
  const i2 = sitPose(nev, seat, fwd, { t, lean: .32, face: fb(o.face || F.calm, t), handL: gL, handR: gR, handModeL: 'grip', handModeR: modeR, handTargetL: phone.g.position, handTargetR: phone.g.position, pointDirR: pdir, look: o.look || phone.g.position, hide: o.hide });
  placePhone(phone, i2, {}); nev.root.visible = true; return i2;
}
function phoneCU(t, k, draw, o = {}) {
  holdSit(t, o.seat || BED.seat, o.fwd || BED.fwd, { pointLocal: o.pointLocal, hide: { head: true, body: true, arms: true, legs: true, keepHandR: !!o.pointLocal } }); draw(phone);
  const n = phone.g.localToWorld(V(0, 0, 1)).sub(phone.g.position).normalize(); const tgt = phone.g.localToWorld((o.focus || V(0, 0, 0)).clone());
  const d = lerp(o.d0 ?? .22, o.d1 ?? .18, ease(k)); const sh = o.shake ? V(Math.sin(t * 70), Math.cos(t * 55), 0).multiplyScalar(o.shake) : V(0, 0, 0);
  look(tgt.clone().add(n.multiplyScalar(d)).add(V(.025 * Math.sin(k * 2), .01, 0)).add(sh), tgt, 34);
}
function faceCU(info, k, o = {}) { const hc = info.hc, f = info.fwd;
  look(hc.clone().add(f.clone().multiplyScalar(lerp(o.d0 ?? .9, o.d1 ?? .72, ease(k)))).add(info.right.clone().multiplyScalar(o.side ?? .1)).add(V(0, o.dy ?? -.04, 0)), hc.clone().add(V(0, -.03, 0)), o.fov || 30); }
function headCU(c, k, off, o = {}) { const h = c.head.position; look(h.clone().add(off.clone().multiplyScalar(lerp(1, o.push ?? .85, ease(k)))), h.clone().add(V(0, o.ty ?? -.06, 0)), o.fov || 32); }
function lieNev(face, glow) { poseChar(nev, { hip: V(.55, .62, -.9), fwd: V(0, 0, -1), lean: -Math.PI / 2 + .1, footL: V(.48, .6, 0), footR: V(.65, .6, 0), handL: V(.75, .62, -1.1), handR: V(.35, .62, -1.1), face, look: V(.55, 2, -1.6), hide: { legs: true } }); nev.root.visible = true; }
function cafCrowd(t, c, o = {}) { kids.forEach((ch, i) => { const a = Math.PI * .45 + i * (Math.PI * 1.1 / (kids.length - 1)), r = 1.3 + (i % 2) * .45; const b = c.clone().add(V(Math.sin(a) * r, 0, Math.cos(a) * r));
  const hop = o.hop ? Math.max(0, Math.sin(t * 7.5 + i * 1.3)) * .06 : 0; const f = c.clone().sub(b).setY(0).normalize(); const sd = f.clone().cross(V(0, 1, 0));
  standPose(ch, b.clone().add(V(0, hop, 0)), f, { handL: b.clone().add(sd.clone().multiplyScalar(.5)).add(V(0, (o.up ? 1.42 : .9) + hop + Math.sin(t * 7.5 + i) * .1 * (o.up ? 1 : 0), 0)), handR: b.clone().add(sd.clone().multiplyScalar(-.5)).add(V(0, (o.up ? 1.42 : .9) + hop, 0)), handModeL: 'fist', handModeR: 'fist',
    face: fb({ brow: -.5, mouth: o.chant ? (Math.sin(t * 7.5 + i) > 0 ? 'yell' : 'smile') : 'smile' }, t + i), look: o.look || nev.head.position.clone() }); ch.root.visible = true; }); }
function townExtras(t, o = {}) { extras.forEach((e, i) => { e.g.visible = true; const x = -9 + i * 1.6 + (i % 2) * .3, z = (i % 3) * .5 - .2; e.g.position.set(x, 0, z); e.g.rotation.y = (o.face ?? 0) + Math.sin(i) * .4; e.set(t, { up: o.up ?? 0, bob: o.bob ?? 0, talk: o.talk ?? 0, ph: i * 1.3, turn: o.turn ? Math.sin(t + i) * .3 : 0 }); }); }

// ---------- money / labels / captions ----------
const RAMPS = []; const ramp = (a, b, v0, v1, pw = 1) => RAMPS.push([a, b, v0, v1, pw]);
const DINGS = [ps(1) + .25, ps(2) + .15, ps(4) + .1, ...[0, .55, 1.15, 1.75, 2.35].map(x => ps(5) + x), ...[0, 1, 2, 3, 4, 5].map(j => ps(12) + 3.2 + j * .8), ...[0, 1, 2, 3].map(j => ps(14) + 2.7 + j * .55)];
function money(t) { let m = DINGS.filter(d => t >= d).length; for (const [a, b, v0, v1, pw] of RAMPS) if (t >= a) m = t >= b ? v1 : Math.round(v0 + (v1 - v0) * Math.pow((t - a) / (b - a), pw)); return m; }
{ const base = 8 + 6 + 4; ramp(ps(15), pe(15), base, 248, 1); ramp(ps(16), pe(19), 248, 1027, 1); ramp(ps(20), pe(21), 1027, 12027, 1.2); ramp(ps(22), pe(26), 12027, 341500, 2.2);
  ramp(pe(26), ps(27) + .6, 341500, 1284000, 1); ramp(ps(28), pe(39), 1284000, 14100000, 1.4); ramp(pe(39), ps(45) + .2, 14100000, 14203117, .6);
  ramp(ps(52) + .2, ps(52) + 3.2, 14203117, 0, .5); }
const LABELS = [[0, 'Day 1 · 7:02 AM'], [4, 'Day 1 · 8:15 AM'], [5, 'Day 1 · Lunch'], [6, ''], [7, 'Day 1 · After school'], [15, 'Day 2 · Lunch'], [16, 'Day 3'], [18, 'Day 5 · Talent show'], [22, 'Day 6'], [24, ''], [26, 'Day 8'], [27, 'Day 9'],
  [30, 'Day 12 · Monday'], [36, 'Day 12 · 6:40 PM'], [38, 'Day 13'], [40, 'Day 14 · Wednesday'], [45, 'Day 16'], [47, 'Day 16 · 11:58 PM'], [53, 'Day 17'], [57, 'Day 17 · 7:00 PM'], [59, '3:33 AM'], [62, '']];
const CAPS = { 9: 'Your voice = $0', 10: 'Texting = $0  ·  Out loud only', 13: '6 × "Nev" = $6', 15: 'Jake: 240 × "Nev"', 21: '400 kids × 90 seconds', 23: '#SayNev  ·  14.2M views', 35: 'Every $1 = someone else\'s $1', 37: 'Mom this week: 11 × "Nev"', 38: '14,000,000 people  ×  -$1', 52: '+$1  ·  Memo: "sorry"' };
const CAP_LINES = Object.keys(CAPS).map(Number);

// ---------- shots ----------
const S = {};
// HOOK (same beats as the approved demo)
S[0] = (t, k) => { LIGHT.morning(); showSet('bedroom'); bedroom.setClock('7:02'); lieNev({ brow: .2, mouth: 'flat', blink: 1 });
  const buzz = t > 1.6 ? Math.sin(t * 90) * .006 : 0; phone.g.position.set(-0.78 + buzz, .535, -0.55); phone.g.rotation.set(-Math.PI / 2, 0, .4 + buzz * 3);
  ui(phone, { mode: 'lock', bigTime: '7:02', notifs: t > 1.6 ? [BANK('Nev')] : [], light: t > 1.6 ? .5 : .02 });
  look(V(lerp(1.5, 1.05, ease(k)), lerp(1.45, 1.25, k), lerp(1.9, 1.35, ease(k))), V(-.25, .6, -.6), 38); };
const BANK = (memo, a = 1) => ({ who: 'bank', title: 'Bank', body: `+$1.00 received · Memo: "${memo}"`, tag: 'Sender: UNKNOWN', tagCol: '#ffcf4a', a });
S[1] = (t, k) => { LIGHT.morning(); showSet('bedroom');
  if (k < .55) phoneCU(t, k / .55, ph => ui(ph, { mode: 'lock', bigTime: '7:02', time: '7:02', notifs: [BANK('Nev', easeOut(prog(t, ps(1), ps(1) + .35)))] }), { d0: .2, d1: .15, focus: V(0, -.005, 0), shake: t < ps(1) + .4 ? .002 : 0 });
  else { const i = holdSit(t, BED.seat, BED.fwd, { face: { brow: .7, mouth: 'wavy' }, look: V(.6, 1.1, 1.4) }); ui(phone, { mode: 'lock', notifs: [BANK('Nev')] }); faceCU(i, (k - .55) / .45, { d0: .95, d1: .75 }); } };
S[2] = (t, k) => { LIGHT.kitchen(); showSet('house'); const base = V(120.9, 0, -1.4);
  standPose(mom, base, V(-.5, 0, 1), { handL: base.clone().add(V(-.25, 1.45, .25)), handR: base.clone().add(V(.05, .95, -.2)), handModeL: 'open', face: fb({ brow: -.3, mouth: yell(t, 2) || 'smile' }, t), look: V(119.6, 2.2, .6), lean: -.05 });
  mom.root.visible = true; look(V(lerp(122.6, 122.2, k), 1.3, lerp(.4, .1, k)), V(120.8, 1.25, -1.3), 34); };
S[3] = (t, k) => { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k, ph => ui(ph, { mode: 'lock', bigTime: '7:04', time: '7:04', notifs: [BANK('Nev', easeOut(prog(k, 0, .25))), BANK('Nev')] }), { d0: .17, d1: .145, focus: V(0, -.02, 0) }); };
S[4] = (t, k) => { LIGHT.school(-14); showSet('school'); const cl = V(30, 0, -14);
  standPose(teacher, cl.clone().add(V(-.35, 0, -1.4)), V(0, 0, 1), { face: fb({ brow: -.4, mouth: talk(t, 4) || 'flat' }, t), look: cl.clone().add(V(-1.2, 1.1, .5)), handL: cl.clone().add(V(-.6, .8, -1.3)), handR: cl.clone().add(V(-.1, .8, -1.3)), handModeL: 'open', handModeR: 'open' });
  teacher.root.visible = true; headCU(teacher, k, V(-.55, -.08, 1.2)); };
const CAF = V(30.2, 0, 3.7);
function cafNev(t, face) { standPose(nev, CAF, V(0, 0, 1), { face: fb(face, t), look: CAF.clone().add(V(Math.sin(t * 2) * 1.5, 1.4, 3)), handL: CAF.clone().add(V(-.35, .9, .1)), handR: CAF.clone().add(V(.35, .9, .1)), handModeL: 'open', handModeR: 'open' }); nev.root.visible = true; }
S[5] = (t, k) => { LIGHT.school(); showSet('school'); cafNev(t, { brow: -.3, mouth: 'smile' }); cafCrowd(t, CAF, { up: 1, hop: 1, chant: 1 });
  const a = lerp(-.45, .35, k); look(CAF.clone().add(V(Math.sin(a) * 2.9, lerp(1.45, 1.7, k), Math.cos(a) * 2.9)), CAF.clone().add(V(0, 1.05, -.6)), 42); };
S[6] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { face: Math.PI * .1 }); // title over a wide establishing shot (no faces under the title)
  look(V(lerp(318, 322, k), lerp(3.2, 3.6, k), lerp(16, 14, k)), V(328, 3.6, -6), 40); };
// RULES
S[7] = (t, k) => { LIGHT.morning(); showSet('bedroom'); const i = holdSit(t, BED.seat, BED.fwd, { face: F.smug, look: V(.3, 1.1, 1.4) }); app(phone, { kind: 'bank', balance: '$8.00', sub: '8 transfers today' });
  look(V(lerp(1.3, 1.0, ease(k)), 1.15, lerp(1.7, 1.35, ease(k))), V(0, .9, -.1), 36); };
S[8] = (t, k) => { LIGHT.morning(); showSet('bedroom'); const i = holdSit(t, BED.seat, BED.fwd, { face: fb({ brow: lerp(-.2, .9, k), mouth: talk(t, 8) || 'frown' }, t), look: phone.g.position.clone().add(V(0, .05, 0)) }); app(phone, { kind: 'bank', balance: '$8.00', sub: 'No new transfers' });
  if (k < .55) faceCU(i, k / .55, { d0: 1.15, d1: 1.0, side: .2 }); else look(V(.9, 1.05, 1.1), V(0, .85, -.1), 34); };
S[9] = (t, k) => { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$8.00', sub: 'No new transfers', rows: [['Unknown', 'Memo: "Nev"', '+$1.00'], ['Unknown', 'Memo: "Nev"', '+$1.00']] }), { d0: .26, d1: .22, shake: k > .2 && k < .4 ? .0015 : 0 }); };
S[10] = (t, k) => { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'msg', typed: 'Nev Nev Nev' }), { d0: .24, d1: .2, pointLocal: V(.02 + Math.sin(t * 9) * .006, -.05, .008) }); };
S[11] = (t, k) => { if (k < .5) { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k / .5, ph => app(ph, { kind: 'call' }), { d0: .26, d1: .22 }); }
  else { LIGHT.kitchen(); showSet('house'); const b = V(121.4, 0, -1.6); standPose(jake, b, V(-.4, 0, 1), { handR: jake.head.position.clone().add(V(.12, -.02, .02)), handL: b.clone().add(V(-.2, .95, .2)), face: fb({ brow: .2, mouth: 'flat' }, t), look: V(120.6, 1.3, 1) }); jake.root.visible = true;
    look(V(lerp(122.6, 122.4, k), 1.4, lerp(.6, .4, k)), V(121.3, 1.25, -1.5), 34); } };
function jakeHome(t, face, o = {}) { const b = V(121.4, 0, -1.6); const up = o.up ?? 0;
  standPose(jake, b.clone().add(V(0, o.hop ? Math.max(0, Math.sin(t * 8)) * .05 : 0, 0)), V(-.4, 0, 1), { handL: b.clone().add(V(-.35, lerp(.95, 1.55, up), .2)), handR: b.clone().add(V(.35, lerp(.95, 1.55, up), .1)), handModeL: up ? 'fist' : 'open', handModeR: up ? 'fist' : 'open', face: fb(face, t), look: o.look || V(120.6, 1.35, 1.2) }); jake.root.visible = true; }
S[12] = (t, k) => { LIGHT.kitchen(); showSet('house');
  if (k < .4) { jakeHome(t, { brow: .6, mouth: talk(t, 12) || 'flat' }); headCU(jake, k / .4, V(-.55, -.05, .95)); }
  else { jakeHome(t, { brow: -.6, mouth: yell(t, 12) || 'smile' }, { up: 1, hop: 1 }); look(V(lerp(122.9, 122.7, k), 1.45, lerp(1.1, .9, k)), V(121.3, 1.3, -1.5), 38); } };
S[13] = (t, k) => { LIGHT.morning(); showSet('bedroom'); const n = 6; phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$14.00', sub: '+$6 in 4 seconds', rows: Array.from({ length: n }, () => ['Unknown', 'Memo: "Nev"', '+$1.00']) }), { d0: .24, d1: .19 }); };
S[14] = (t, k) => { LIGHT.kitchen(); showSet('house');
  if (k < .45) { jakeHome(t, { brow: -.7, mouth: talk(t, 14) ? 'yell' : 'smile' }); headCU(jake, k / .45, V(-.5, -.05, .9)); }
  else { jakeHome(t, { brow: -.8, mouth: Math.sin(t * 12) > 0 ? 'yell' : 'smile' }, { up: 1, hop: 1 }); look(V(123.1, 1.6, 1.3), V(121.3, 1.3, -1.5), 40); } };
S[15] = (t, k) => { LIGHT.school(); showSet('school'); const tb = school.tables[3];
  sitPose(jake, V(tb.x + .2, .45, tb.z - .65), V(0, 0, 1), { t, lean: .2, handL: V(tb.x + .1, .82, tb.z - .3), handR: V(tb.x + .45, 1.05 + Math.sin(t * 6) * .05, tb.z - .2), handModeR: 'fist', face: fb({ brow: -.6, mouth: Math.sin(t * 12) > 0 ? 'yell' : 'smile' }, t), look: V(tb.x - .2, 1.3, tb.z + .9) }); jake.root.visible = true;
  sitPose(nev, V(tb.x - .2, .45, tb.z + .65), V(0, 0, -1), { t, lean: .15, handL: V(tb.x - .05, .8, tb.z + .3), handR: V(tb.x - .35, .8, tb.z + .3), face: fb(F.smug, t), look: jake.head.position.clone() }); nev.root.visible = true;
  school.tray.position.set(tb.x - school.g.position.x + .1, .79, tb.z - .15); school.tray.rotation.set(0, .3, 0);
  if (k < .5) look(V(tb.x + 1.7, 1.3, tb.z + .4), V(tb.x, .95, tb.z), 36); else headCU(jake, (k - .5) / .5, V(-.4, -.02, .85)); };
// GETTING RICH
S[16] = (t, k) => { LIGHT.town(); showSet('town'); const x = lerp(296, 300, k), b = V(x, 0, .4); standPose(nev, b, V(1, 0, 0), { phase: t * 4.5, stride: .2, face: fb({ brow: -.3, mouth: 'smirk' }, t), look: V(x + 3, 1.3, 1) }); nev.root.visible = true;
  look(V(x + .6, 1.25, 3.4), b.clone().add(V(.2, 1.0, 0)), 36); };
S[17] = (t, k) => { LIGHT.school(14); showSet('school'); [[kids[0], -1, 12.5, 1], [kids[1], -.6, 12.3, -1], [kids[2], 1.1, 13.4, 1], [kids[3], .7, 13.2, -1]].forEach(([c, x, z, s], i) => {
    standPose(c, V(30 + x, 0, z), V(s * .6, 0, -.3), { face: fb({ brow: -.2, mouth: Math.sin(t * 14 + i) > 0 ? 'o' : 'smile' }, t + i), look: V(30 + x + s * .6, 1.3, z - .2), handL: V(30 + x - .2, .9, z), handR: V(30 + x + s * .1, 1.35, z - .1) }); c.root.visible = true; });
  look(V(30.3, 1.4, lerp(16, 15.2, k)), V(30, 1.2, 12.8), 36); };
S[18] = (t, k) => { LIGHT.gym(); showSet('gym'); gym.set(t, { up: 0, bob: 0 }); const sx = 360 + lerp(-2.6, 0, ease(prog(k, 0, .55)));
  standPose(nev, V(sx, .9, -4.2), V(0, 0, 1), { phase: k < .55 ? t * 4.5 : 0, stride: k < .55 ? .18 : 0, face: fb({ brow: 0, mouth: 'flat' }, t), look: V(360, 2.2, 4), handL: V(sx - .3, 1.75, -4.2), handR: V(sx + .3, 1.75, -4.2) }); nev.root.visible = true;
  if (k < .55) look(V(363, 2.2, 3.5), V(360, 1.6, -4), 40); else headCU(nev, (k - .55) / .45, V(.15, -.05, 1.1), { push: .8 }); };
S[19] = (t, k) => { LIGHT.gym(); showSet('gym'); gym.set(t, { up: prog(k, .4, 1) * .6, bob: 0 }); standPose(nev, V(360, .9, -4.2), V(0, 0, 1), { face: fb({ brow: 0, mouth: 'flat' }, t), look: V(360, 2.2, 4) }); nev.root.visible = true;
  look(V(lerp(358.4, 358.8, k), 1.9, -3.4), V(360, 1.4, 3), 40); };
S[20] = (t, k) => { LIGHT.gym(); showSet('gym'); gym.set(t, { up: 1, bob: .12, talk: 1 }); standPose(nev, V(360, .9, -4.2), V(0, 0, 1), { face: fb({ brow: -.4, mouth: 'smirk' }, t), look: V(360, 2.2, 4) }); nev.root.visible = true;
  const a = lerp(-.6, .6, k); look(V(360 + Math.sin(a) * 6, 3.0, 7 + Math.cos(a)), V(360, 1.4, 0), 44); };
S[21] = (t, k) => { LIGHT.gym(); showSet('gym'); gym.set(t, { up: 1, bob: .1, talk: 1 }); standPose(nev, V(360, .9, -4.2), V(0, 0, 1), { face: fb({ brow: -.7, mouth: 'smirk' }, t), look: V(360, 2.2, 4) }); nev.root.visible = true;
  if (k < .5) headCU(nev, k / .5, V(-.2, -.05, 1.0)); else look(V(360, lerp(2.4, 2.9, k), lerp(6, 8, k)), V(360, 1.6, -4), 34); };
S[22] = (t, k) => { LIGHT.gym(); showSet('gym'); gym.set(t, { up: 1, bob: .1, talk: 1 }); standPose(nev, V(360, .9, -4.2), V(0, 0, 1), { face: fb(F.smug, t), look: V(360, 2.2, 4) }); nev.root.visible = true;
  const e = gym.crowd[22]; phone2.g.position.copy(e.g.position).add(gym.g.position).add(V(.05, 1.35, -.3)); phone2.g.lookAt(V(360, 1.6, -4.2)); phone2.g.rotateY(Math.PI); phone2.g.updateMatrixWorld(true); app(phone2, { kind: 'rec', rec: `00:${String(Math.floor(10 + k * 20)).padStart(2, '0')}`, light: .2 });
  look(phone2.g.position.clone().add(V(.06, .05, .22)), phone2.g.position.clone(), 34); };
S[23] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'trend', views: (2 + k * 12.2).toFixed(1) + 'M views', time: '9:41' }), { d0: .25, d1: .19 }); };
S[24] = (t, k) => { const part = Math.min(2, Math.floor(k * 3)), kk = (k * 3) % 1;
  if (part === 0) { LIGHT.town(); showSet('town'); [kids[4], kids[5], kids[6]].forEach((c, i) => { const b = V(318 + i * .9, 0, .5); standPose(c, b, V(0, 0, 1), { face: fb({ brow: -.5, mouth: Math.sin(t * 12 + i) > 0 ? 'yell' : 'smile' }, t + i), handL: b.clone().add(V(-.4, 1.45, .1)), handR: b.clone().add(V(.4, 1.45, .1)), handModeL: 'fist', handModeR: 'fist', look: V(319, 1.4, 4) }); c.root.visible = true; });
    look(V(319, 1.3, lerp(4.2, 3.6, kk)), V(318.9, 1.1, .5), 40); }
  else if (part === 1) { LIGHT.town(300, true); showSet('town'); const b = V(294, 0, -1.8); standPose(grandma, b, V(0, 0, 1), { face: fb({ brow: -.3, mouth: Math.sin(t * 10) > 0 ? 'o' : 'smile' }, t), handL: b.clone().add(V(-.25, 1.0, .25)), handR: b.clone().add(V(.15, 1.55, .15)), handModeR: 'open', look: V(294, 1.4, 3) }); grandma.root.visible = true;
    headCU(grandma, kk, V(-.55, -.05, 1.7)); }
  else { LIGHT.lake(); showSet('lake'); lake.boat.position.set(480, Math.sin(t * 2) * .05, 0); lake.boat.rotation.z = Math.sin(t * 1.6) * .03; const b = V(480, .6, -.4);
    standPose(fisher, b, V(.3, 0, 1), { face: fb({ brow: -.4, mouth: Math.sin(t * 12) > 0 ? 'yell' : 'smile' }, t), handL: b.clone().add(V(-.4, 1.4, .2)), handR: b.clone().add(V(.4, 1.4, .1)), handModeL: 'fist', handModeR: 'fist', look: V(481, 2, 4) }); fisher.root.visible = true;
    look(V(lerp(483, 482.4, kk), 2.0, lerp(5, 4.4, kk)), V(480, 1.2, 0), 40); } };
S[25] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { talk: 1, bob: .03, face: Math.PI * 0 }); look(V(lerp(296, 298, k), 1.6, 6.5), V(lerp(296, 298, k), 1.0, 0), 44); };
S[26] = (t, k) => { LIGHT.dark(); showSet('bedroom'); bedroom.setClock('2:14'); lieNev({ brow: .5, mouth: 'flat', blink: 0 });
  const buzz = Math.sin(t * 90) * .006; phone.g.position.set(-0.78 + buzz, .535, -0.55); phone.g.rotation.set(-Math.PI / 2, 0, .4 + buzz * 3); ui(phone, { mode: 'lock', bigTime: '2:14', notifs: [BANK('Nev'), BANK('Nev'), BANK('Nev')], light: .6 });
  look(V(lerp(.5, .3, k), lerp(1.35, 1.2, k), lerp(.8, .6, k)), V(-.4, .6, -.6), 36); };
S[27] = (t, k) => { LIGHT.morning(); showSet('bedroom'); cash.visible = true; const n = Math.floor(lerp(10, 90, ease(k))); stacks.forEach((s, i) => s.visible = i < n);
  sitPose(nev, V(.55, .95, -.7), V(0, 0, 1), { t, lean: -.1, face: fb(F.happy, t), handL: V(.2, 1.4, -.6), handR: V(.9, 1.4, -.6), handModeL: 'open', handModeR: 'open', look: V(.6, 1.5, 1.5) }); nev.root.visible = true;
  look(V(lerp(1.9, 1.5, k), 1.6, lerp(2.0, 1.6, k)), V(.5, .9, -.6), 38); };
S[28] = (t, k) => { LIGHT.town(); showSet('town'); if (k < .5) { const b = V(292.4, 0, -.4); standPose(mom, b, V(.4, 0, 1), { face: fb({ brow: -.4, mouth: 'o', wide: true }, t), handL: b.clone().add(V(-.25, 1.5, .3)), handR: b.clone().add(V(.25, 1.5, .3)), handModeL: 'open', handModeR: 'open', look: town.car.position.clone().add(town.g.position).add(V(0, 1, 0)) }); mom.root.visible = true;
    look(V(292, 1.6, 4.5), V(293.5, 1.0, -1.0), 40); } else { look(V(305, 2.2, 8.5), V(306, 1.8, 2.6), 40); } };
S[29] = (t, k) => { LIGHT.town(); showSet('town'); const b = V(304.5, 0, 4.6); standPose(jake, b, V(.3, 0, 1), { face: fb({ brow: .9, mouth: Math.sin(t * 9) > 0 ? 'smile' : 'wavy' }, t), handL: b.clone().add(V(-.15, 1.2, .3)), handR: b.clone().add(V(.25, 1.2, .3)), look: V(305, 1.4, 8) }); jake.root.visible = true;
  headCU(jake, k, V(.1, -.05, 1.0)); };
// THE PRICE
S[30] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(28.9, 0, 12.6); standPose(jake, b, V(1, 0, .2), { face: fb({ brow: .9, mouth: 'frown' }, t), handL: b.clone().add(V(.3, 1.0, .1)), handR: b.clone().add(V(.3, 1.0, -.1)), look: b.clone().add(V(1, .7, 0)) }); jake.root.visible = true;
  phone2.g.position.copy(b).add(V(.32, 1.05, 0)); phone2.g.lookAt(b.clone().add(V(0, 1.6, 0))); phone2.g.updateMatrixWorld(true); app(phone2, { kind: 'bank', owner: 'Jake · balance', balance: '$0.00', red: true });
  look(V(lerp(30.7, 30.4, ease(k)), 1.5, lerp(13.9, 13.4, ease(k))), b.clone().add(V(0, 1.15, 0)), 38); };
S[31] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(28.9, 0, 12.6); const part = k < .38 ? 0 : k < .7 ? 1 : 2;
  standPose(jake, b, V(1, 0, .2), { face: fb({ brow: 1, mouth: talk(t, 31) || 'frown' }, t), handL: b.clone().add(V(.3, 1.05, .1)), handR: b.clone().add(V(.3, 1.05, -.1)), look: V(30.2, 1.4, 12.8) }); jake.root.visible = true;
  phone2.g.position.copy(b).add(V(.32, 1.1, 0)); phone2.g.lookAt(V(30.6, 1.5, 12.6)); phone2.g.updateMatrixWorld(true); app(phone2, { kind: 'bank', owner: 'Jake · balance', balance: '$0.00', red: true, sub: 'Yesterday: $240.00' });
  standPose(nev, V(30.2, 0, 12.8), V(-1, 0, -.1), { face: fb(F.worried, t), look: jake.head.position.clone() }); nev.root.visible = true;
  if (part === 0) headCU(jake, k / .38, V(.6, -.04, .5)); else if (part === 1) look(phone2.g.position.clone().add(phone2.g.localToWorld(V(0, 0, 1)).sub(phone2.g.position).multiplyScalar(.24)), phone2.g.position, 34); else headCU(nev, (k - .7) / .3, V(-.55, -.05, .5)); };
S[32] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(28.9, 0, 12.6); standPose(jake, b, V(1, 0, .2), { face: fb(F.sad, t), handL: b.clone().add(V(.3, 1.05, .1)), handR: b.clone().add(V(.3, 1.05, -.1)), look: b.clone().add(V(1, .8, 0)) }); jake.root.visible = true;
  phone2.g.position.copy(b).add(V(.32, 1.1, 0)); phone2.g.lookAt(V(30.6, 1.5, 12.6)); phone2.g.updateMatrixWorld(true);
  app(phone2, { kind: 'bank', owner: 'Jake · history', balance: '-$240.00', red: true, sub: '240 transfers · To: Nev', rows: Array.from({ length: 8 }, () => ['To: Nev', 'Auto transfer', '-$1.00']), scroll: k * 300 });
  look(phone2.g.position.clone().add(phone2.g.localToWorld(V(0, 0, 1)).sub(phone2.g.position).multiplyScalar(lerp(.26, .2, k))), phone2.g.position, 34); };
S[33] = (t, k) => { LIGHT.school(14); showSet('school'); standPose(nev, V(30.2, 0, 12.8), V(-1, 0, -.1), { face: fb({ brow: 1, mouth: 'frown' }, t), look: V(28.9, 1.0, 12.6) }); nev.root.visible = true; headCU(nev, k, V(-.6, -.04, .55), { push: .8 }); };
const SENDERS = [['Jake', 'Memo: "Nev"', '+$1.00'], ['Mom', 'Memo: "Nev"', '+$1.00'], ['Mr. Hall', 'Memo: "Nev"', '+$1.00'], ['Kayla R. · Ohio', 'Memo: "Nev"', '+$1.00'], ['Doris P. · Texas', 'Memo: "Nev"', '+$1.00'], ['Hank W. · Alaska', 'Memo: "Nev"', '+$1.00'], ['Jake', 'Memo: "Nev"', '+$1.00'], ['Liam O.', 'Memo: "Nev"', '+$1.00'], ['Mom', 'Memo: "Nev"', '+$1.00'], ['Ava T.', 'Memo: "Nev"', '+$1.00']];
S[34] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$9,812,440', sub: 'Senders: 9,812,440', rows: SENDERS, scroll: k * 420, time: '10:12' }), { d0: .25, d1: .17, focus: V(0, -.02 + k * .01, 0) }); };
S[35] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { talk: 1, face: 0 }); look(V(lerp(293, 296, k), 1.5, 5.6), V(lerp(294, 297, k), 1.1, 0), 40); };
S[36] = (t, k) => { LIGHT.store(); showSet('store'); const b = V(90.3, 0, -1.2);
  standPose(mom, b, V(0, 0, 1), { face: fb({ brow: .8, mouth: talk(t, 36) || 'wavy' }, t), handL: b.clone().add(V(-.12, 1.1, .3)), handR: b.clone().add(V(.12, 1.1, .3)), look: V(90.3, 1.2, 1) }); mom.root.visible = true;
  phone2.g.position.copy(b).add(V(0, 1.15, .32)); phone2.g.lookAt(b.clone().add(V(0, 1.6, 0))); phone2.g.updateMatrixWorld(true); app(phone2, { kind: 'bank', owner: 'Mom · card', balance: 'DECLINED', red: true, sub: 'Grocery Mart · $86.40' });
  if (k < .6) headCU(mom, k / .6, V(.35, -.05, 1.0)); else look(phone2.g.position.clone().add(V(0, .12, .2)), phone2.g.position, 34); };
S[37] = (t, k) => { LIGHT.kitchen(); showSet('house'); const base = V(120.9, 0, -1.4);
  standPose(mom, base, V(-.5, 0, 1), { handL: base.clone().add(V(-.25, 1.45, .25)), handR: base.clone().add(V(.05, .95, -.2)), handModeL: 'open', face: fb({ brow: -.3, mouth: Math.sin(t * 8) > 0 ? 'yell' : 'o' }, t), look: V(119.6, 2.2, .6) }); mom.root.visible = true;
  look(V(lerp(122.6, 122.3, k), 1.3, .3), V(120.8, 1.25, -1.3), 34); };
S[38] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { face: Math.PI * .05, turn: 1 }); if (k < .5) look(V(lerp(290, 293, k * 2), 1.5, 6), V(lerp(291, 294, k * 2), 1.0, 0), 40); else look(V(299, lerp(5, 6, k), 9), V(298, .8, 0), 44); };
S[39] = (t, k) => { LIGHT.studio(); showSet('studio'); studio.draw(t); const b = V(420, 0, -1.25);
  sitPose(anchor, b.clone().add(V(0, .55, 0)), V(0, 0, 1), { t, lean: .05, handL: V(419.8, 1.06, -.4), handR: V(420.2, 1.06, -.4), face: fb({ brow: .2, mouth: talk(t, 39) || 'flat' }, t), look: V(420, 1.3, 4) }); anchor.root.visible = true;
  if (k < .5) headCU(anchor, k / .5, V(0, -.04, 1.4)); else look(V(lerp(418.6, 418.9, k), 1.7, 3.6), V(420.6, 1.6, -1.8), 40); };
S[40] = (t, k) => { LIGHT.school(14); showSet('school'); const z = lerp(16.5, 11.5, k), b = V(30, 0, z);
  standPose(nev, b, V(0, 0, -1), { phase: t * 3.6, stride: .14, face: fb(F.sad, t), look: V(30, 1.1, z - 3), lean: .1 }); nev.root.visible = true;
  [[kids[2], -1.1, 12.5], [kids[3], 1.1, 13.2], [kids[5], -1.1, 14.5], [kids[0], 1.1, 15.4]].forEach(([c, x, zz]) => { const away = z < zz + 1.2; standPose(c, V(30 + x, 0, zz), away ? V(x, 0, 0) : V(-x, 0, .4), { face: fb({ brow: .3, mouth: 'flat' }, t), look: away ? V(30 + x * 3, 1.3, zz) : nev.head.position.clone() }); c.root.visible = true; });
  look(V(30.4, 1.45, z - 3.0), V(30, 1.1, z), 40); };
S[41] = (t, k) => { LIGHT.school(-14); showSet('school'); const cl = V(30, 0, -14);
  standPose(teacher, cl.clone().add(V(-.35, 0, -1.4)), V(0, 0, 1), { face: fb({ brow: -.8, mouth: talk(t, 41) || 'flat' }, t), look: cl.clone().add(V(-1.2, 1.1, .5)), handL: cl.clone().add(V(-.6, .8, -1.3)), handR: cl.clone().add(V(-.1, .8, -1.3)), handModeL: 'open', handModeR: 'open' }); teacher.root.visible = true;
  headCU(teacher, k, V(.5, -.08, 1.2)); };
S[42] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(30.9, 0, 12.4);
  standPose(jake, b, V(-.6, 0, .8), { face: fb({ brow: .7, mouth: talk(t, 42) || 'wavy' }, t), look: k < .5 ? V(29.6, 1.3, 13.4) : V(31.5, 2.0, 13.5), handL: b.clone().add(V(-.1, 1.5, .1)), handR: b.clone().add(V(.3, .9, .1)), handModeL: 'open' }); jake.root.visible = true;
  headCU(jake, k, V(-.55, -.05, .75)); };
S[43] = (t, k) => { LIGHT.school(14); showSet('school'); standPose(nev, V(29.6, 0, 13.4), V(.6, 0, -.6), { face: fb({ brow: 1, mouth: 'frown' }, t), look: V(30.9, 1.4, 12.4) }); nev.root.visible = true; headCU(nev, k, V(.6, -.05, -.5)); };
S[44] = (t, k) => { LIGHT.kitchen(); showSet('house'); const c = V(121, 0, -1.1);
  standPose(mom, c.clone().add(V(-.5, 0, 0)), V(1, 0, .2), { face: fb({ brow: .2, mouth: Math.sin(t * 12) > 0 && k < .8 ? 'o' : 'smile' }, t), look: c.clone().add(V(.5, 1.25, 0)) }); mom.root.visible = true;
  standPose(nev, c.clone().add(V(.5, 0, 0)), V(-1, 0, .2), { face: fb(F.sad, t), look: mom.head.position.clone() }); nev.root.visible = true;
  look(V(121, 1.4, lerp(1.6, 1.2, k)), V(121, 1.15, -1.1), 36); };
S[45] = (t, k) => { LIGHT.night(); showSet('bedroom'); phone.g.position.set(.3, .56, -.3); phone.g.rotation.set(-Math.PI / 2, 0, .5); ui(phone, { mode: 'lock', bigTime: '9:58', notifs: [], light: .02 });
  look(V(.45, 1.0, .05), V(.3, .56, -.3), 34); };
S[46] = (t, k) => { LIGHT.night(); showSet('bedroom'); bedroom.setClock('10:04'); lieNev(fb({ brow: 1, mouth: 'frown' }, t)); const part = k < .4 ? 0 : k < .75 ? 1 : 2;
  if (part === 0) look(V(lerp(1.6, 1.3, k), 1.5, 1.4), V(.4, .7, -.8), 38); else if (part === 1) look(nev.head.position.clone().add(V(.75, .15, .45)), nev.head.position.clone(), 32); else look(V(.2, 1.4, .4), V(-.55, 1.55, -1.88), 40); };
// THE CHOICE
S[47] = (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$14,203,117', sub: '14,203,117 transfers', rows: SENDERS, time: '11:58' }), { d0: .26, d1: .2 }); };
S[48] = (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$14,203,117', sub: '14,203,117 transfers', rows: SENDERS, scroll: 200 + k * 200, button: easeOut(prog(k, .3, .8)), time: '11:58' }), { d0: .24, d1: .19, focus: V(0, -.03 * ease(k), 0) }); };
S[49] = (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$14,203,117', sub: '14,203,117 transfers', rows: SENDERS, scroll: 400, button: 1, time: '11:59' }), { d0: .2, d1: .17, focus: V(0, -.035, 0), pointLocal: V(.002 + Math.sin(t * 23) * .004, -.042 + Math.cos(t * 19) * .003, .012) }); };
S[50] = (t, k) => { LIGHT.dark(); showSet('bedroom'); const i = holdSit(t, BED.seat, BED.fwd, { face: fb({ brow: lerp(1, -.5, k), mouth: 'frown' }, t), look: V(0, 1.15, 1.5) }); app(phone, { kind: 'bank', balance: '$14,203,117', button: 1, light: .25 }); faceCU(i, k, { d0: .85, d1: .62 }); };
S[51] = (t, k) => { LIGHT.dark(); showSet('bedroom'); const pr = ease(prog(k, 0, .5)), hit = k > .5;
  phoneCU(t, k, ph => app(ph, { kind: 'bank', balance: '$14,203,117', rows: SENDERS, scroll: 400, button: 1, pressed: hit, time: '11:59', light: hit ? .5 : .1 }), { d0: .2, d1: .18, focus: V(0, -.035, 0), pointLocal: V(.002, lerp(-.042, -.04, pr), lerp(.03, .004, pr)), shake: hit && k < .7 ? .003 : 0 }); };
S[52] = (t, k) => { LIGHT.town(300, true); showSet('town'); townExtras(t, { face: 0, up: easeOut(prog(k, .3, .6)) * .5 }); look(V(lerp(297, 299, k), lerp(2, 3.4, k), lerp(7, 9, k)), V(298, 1.0, 0), 42); };
S[53] = (t, k) => { LIGHT.kitchenNight(); showSet('house'); const c = V(121, 0, -1.1);
  standPose(mom, c.clone().add(V(-.5, 0, 0)), V(1, 0, .3), { face: fb({ brow: .7, mouth: talk(t, 53) || 'o' }, t), look: c.clone().add(V(.5, 1.25, 0)) }); mom.root.visible = true;
  standPose(nev, c.clone().add(V(.5, 0, 0)), V(-1, 0, .2), { face: fb(F.sad, t), look: mom.head.position.clone() }); nev.root.visible = true; headCU(mom, k, V(.8, -.05, .45)); };
S[54] = (t, k) => { LIGHT.kitchenNight(); showSet('house'); const c = V(121, 0, -1.1);
  standPose(nev, c.clone().add(V(.5, 0, 0)), V(-1, 0, .2), { face: fb({ brow: .6, mouth: k > .4 ? 'smile' : 'wavy' }, t), look: c.clone().add(V(-.5, 1.25, 0)) }); nev.root.visible = true;
  standPose(mom, c.clone().add(V(-.5, 0, 0)), V(1, 0, .3), { face: fb(F.happy, t), look: nev.head.position.clone() }); mom.root.visible = true; headCU(nev, k, V(-.7, -.05, 1.15)); };
S[55] = (t, k) => { LIGHT.night(); showSet('bedroom'); phone.g.position.set(.3, .56, -.3); phone.g.rotation.set(-Math.PI / 2, 0, .5); app(phone, { kind: 'bank', balance: '$0.00', sub: 'No new transfers', time: '8:12' });
  look(V(lerp(.42, .36, k), lerp(.95, .85, k), .0), V(.3, .56, -.3), 34); };
S[56] = (t, k) => { LIGHT.kitchenNight(); showSet('house'); const c = V(121.2, 0, -1.0);
  standPose(nev, c.clone().add(V(.18, 0, 0)), V(-1, 0, 0), { handL: c.clone().add(V(-.05, 1.05, .2)), handR: c.clone().add(V(-.05, 1.05, -.2)), face: { brow: .2, mouth: 'smile', blink: .9 }, look: c.clone().add(V(-.6, 1.3, 1.6)), lean: .1 }); nev.root.visible = true;
  standPose(mom, c.clone().add(V(-.18, 0, 0)), V(1, 0, 0), { handL: c.clone().add(V(.2, 1.15, -.18)), handR: c.clone().add(V(.2, 1.15, .18)), face: { brow: .3, mouth: 'smile', blink: .7 }, look: c.clone().add(V(.6, 1.25, 1.6)), lean: .12 }); mom.root.visible = true;
  look(V(lerp(122.1, 121.95, k), 1.42, lerp(.15, -.05, k)), V(121.2, 1.25, -1), 30); };
S[57] = (t, k) => { LIGHT.kitchenNight(); showSet('house'); const base = V(120.9, 0, -1.4);
  standPose(mom, base, V(-.5, 0, 1), { handL: base.clone().add(V(-.25, 1.45, .25)), handR: base.clone().add(V(.05, .95, -.2)), handModeL: 'open', face: fb({ brow: -.4, mouth: yell(t, 57) || 'smile' }, t), look: V(119.6, 2.2, .6) }); mom.root.visible = true;
  look(V(lerp(122.6, 122.2, k), 1.3, lerp(.4, .1, k)), V(120.8, 1.25, -1.3), 34); };
S[58] = (t, k) => { LIGHT.town(300, true); showSet('town'); const b = V(301, 0, .6);
  standPose(jake, b.clone().add(V(0, Math.max(0, Math.sin(t * 8)) * .06, 0)), V(0, 0, 1), { face: fb({ brow: -.8, mouth: Math.sin(t * 12) > 0 ? 'yell' : 'smile' }, t), handL: b.clone().add(V(-.42, 1.5, .1)), handR: b.clone().add(V(.42, 1.5, .1)), handModeL: 'fist', handModeR: 'fist', look: V(301, 1.5, 5) }); jake.root.visible = true;
  standPose(nev, V(302.2, 0, .9), V(-.5, 0, 1), { face: fb(F.happy, t), look: jake.head.position.clone() }); nev.root.visible = true;
  if (k < .45) headCU(jake, k / .45, V(.1, -.05, 1.0)); else look(V(lerp(301.6, 301.8, k), 1.4, lerp(5, 4.4, k)), V(301.6, 1.0, .7), 38); };
S[59] = (t, k) => { LIGHT.dark(); showSet('house'); LIGHT.kitchenNight(); house.lamp.intensity = 0; const b = V(121.2, .45, -1.4);
  sitPose(jake, b, V(0, 0, 1), { t, lean: .2, face: { brow: .2, mouth: 'flat', blink: k < .5 ? 1 : 0 }, handL: b.clone().add(V(-.2, .25, .3)), handR: b.clone().add(V(.2, .25, .3)), look: V(121.4, .6, -.6) }); jake.root.visible = true;
  phone2.g.position.set(121.45, .55, -.75); phone2.g.rotation.set(-Math.PI / 2, 0, .3); ui(phone2, { mode: 'lock', bigTime: '3:33', notifs: k > .4 ? [BANK('Jake', easeOut(prog(k, .4, .6)))] : [], light: k > .4 ? .6 : .02 });
  look(V(lerp(122.2, 122.0, k), 1.25, .6), V(121.3, .8, -1.1), 36); };
S[60] = (t, k) => { LIGHT.dark(); showSet('house'); LIGHT.kitchenNight(); house.lamp.intensity = 0; phone2.g.position.set(121.45, .55, -.75); phone2.g.rotation.set(-Math.PI / 2, 0, .3); ui(phone2, { mode: 'lock', bigTime: '3:33', notifs: [BANK('Jake')], light: .5 });
  look(V(121.45 + .03, lerp(.8, .72, k), -.75 + .06), V(121.45, .55, -.75), 34); };
S[61] = (t, k) => { LIGHT.dark(); showSet('house'); LIGHT.kitchenNight(); house.lamp.intensity = 0; const b = V(121.2, .45, -1.4);
  sitPose(jake, b, V(0, 0, 1), { t, lean: .2, face: { brow: 1, mouth: talk(t, 61) || 'o', wide: true, glow: .3 }, handL: V(121.33, .88, -1.05), handR: V(121.47, .88, -1.05), look: V(121.4, .9, -1.0) }); jake.root.visible = true;
  phone2.g.position.set(121.4, .9, -1.05); phone2.g.lookAt(jake.head.position); phone2.g.updateMatrixWorld(true); ui(phone2, { mode: 'lock', bigTime: '3:33', notifs: [BANK('Jake')], light: .6 });
  headCU(jake, k, V(.55, -.02, .65)); };
S[62] = (t, k) => { LIGHT.town(300, true); showSet('town'); const wave = Math.sin(t * 6) * .12;
  standPose(nev, V(300.4, 0, .6), V(0, 0, 1), { face: fb(F.happy, t), handR: V(300.75, 1.55 + wave, .75), handModeR: 'open', look: V(300.6, 1.4, 5) }); nev.root.visible = true;
  standPose(jake, V(301.3, 0, .6), V(0, 0, 1), { face: fb({ brow: -.4, mouth: 'smile' }, t), handL: V(300.95, 1.55 - wave, .75), handModeL: 'open', look: V(300.6, 1.4, 5) }); jake.root.visible = true;
  look(V(300.85, lerp(1.6, 1.8, k), lerp(4.2, 5.4, k)), V(300.85, 1.6, .6), 40); };

const WINDOWS = TL.map((l, i) => ({ start: i === 0 ? 0 : l.start - .15, fn: S[i], i }));
WINDOWS.forEach((w, i) => { w.end = i + 1 < WINDOWS.length ? WINDOWS[i + 1].start : END0; });

// ---------- overlay ----------
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
const fmt = n => '$' + n.toLocaleString('en-US');
function txt(s, x, y, size, col, align = 'left', w = 800, stroke = 0) { og.save(); og.font = `${w} ${size}px Inter`; og.textAlign = align; og.textBaseline = 'middle'; og.shadowColor = 'rgba(0,0,0,.55)'; og.shadowBlur = 10; og.shadowOffsetY = 3;
  if (stroke) { og.lineJoin = 'round'; og.lineWidth = stroke; og.strokeStyle = 'rgba(20,12,4,.9)'; og.strokeText(s, x, y); } og.fillStyle = col; og.fillText(s, x, y); og.restore(); }
function goldTitle(lines, y0, size, a) { og.save(); og.globalAlpha = a; og.translate(W / 2, y0); og.scale(lerp(1.08, 1, a), lerp(1.08, 1, a));
  lines.forEach((s, i) => { const y = i * size * 1.18; og.font = `900 ${size}px Inter`; og.letterSpacing = '3px'; og.textAlign = 'center'; og.textBaseline = 'middle'; og.lineJoin = 'round'; og.lineWidth = size * .18; og.strokeStyle = '#2a1606'; og.strokeText(s, 0, y);
    const gr = og.createLinearGradient(0, y - size / 2, 0, y + size / 2); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(.55, '#ffcc33'); gr.addColorStop(1, '#e08a00'); og.fillStyle = gr; og.shadowColor = 'rgba(255,190,40,.6)'; og.shadowBlur = 30; og.fillText(s, 0, y); og.shadowBlur = 0; }); og.restore(); }
const sp = V(0, 0, 0);
function bubbles(t, list, text, col) { for (const [i, e] of list.entries()) { sp.setFromMatrixPosition(e.head.matrixWorld).add(V(0, .38, 0)).project(camera); if (sp.z > 1) continue;
  const x = (sp.x + 1) / 2 * W, y = (1 - sp.y) / 2 * H, a = Math.max(0, Math.sin(t * 3 + i * 1.7)); if (a < .2) continue; og.save(); og.globalAlpha = Math.min(1, a * 1.5);
  og.fillStyle = col === 'red' ? 'rgba(226,59,59,.92)' : 'rgba(255,255,255,.95)'; og.beginPath(); og.roundRect(x - 62, y - 30, 124, 56, 28); og.fill(); og.beginPath(); og.moveTo(x - 8, y + 24); og.lineTo(x, y + 40); og.lineTo(x + 8, y + 24); og.fill();
  og.font = '900 30px Inter'; og.textAlign = 'center'; og.textBaseline = 'middle'; og.fillStyle = col === 'red' ? '#fff' : '#1a1f2b'; og.fillText(text, x, y - 2); og.restore(); } }
function overlay(t) {
  og.drawImage(renderer.domElement, 0, 0);
  const v = og.createRadialGradient(W / 2, H / 2, H * .5, W / 2, H / 2, H * 1.05); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.25)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
  const w = WINDOWS.find(w => t >= w.start && t < w.end); const li = w ? w.i : -1;
  if (t < END0) {
    if ([25, 35, 38].includes(li)) bubbles(t, extras, li === 25 ? 'NEV!' : '-$1', li === 25 ? 'white' : 'red');
    if (li === 52) bubbles(t, extras, '+$1', 'white');
    // money counter
    const m = money(t), last = DINGS.filter(d => t >= d).pop() ?? -9, pop = 1 + .22 * Math.max(0, 1 - (t - last) / .25), dropping = t > ps(52) + .2 && t < ps(52) + 3.4, frozen = li >= 45 && li <= 51;
    if (t > ps(1) && li !== 6) { const col = dropping ? '#ff6b6b' : frozen ? '#c9c9c9' : '#ffd34d', s = fmt(m); og.save(); og.translate(W - 60, 62); og.scale(pop, pop); og.font = '800 46px Inter'; const tw = og.measureText(s).width;
      og.beginPath(); og.arc(-tw - 34, 0, 15, 0, 7); og.lineWidth = 4; og.strokeStyle = col; og.stroke(); og.beginPath(); og.moveTo(-tw - 34, 0); og.lineTo(-tw - 34, -9); og.moveTo(-tw - 34, 0); og.lineTo(-tw - 27, 4); og.stroke(); og.restore();
      og.save(); og.translate(W - 60, 62); og.scale(pop, pop); txt(s, 0, 0, 46, col, 'right'); og.restore(); }
    // +$1 pops
    for (const d of DINGS) { const a = t - d; if (a >= 0 && a < .9) { og.save(); og.globalAlpha = a < .1 ? a / .1 : 1 - prog(a, .55, .9); txt('+$1', W / 2, H - 190 - easeOut(a / .9) * 70, 76, '#ffd34d', 'center', 900, 12); og.restore(); } }
    // labels (Ohio/Texas/Alaska inside line 24)
    let lab = ''; for (const [i, l] of LABELS) if (t >= ps(i) - .15) lab = l;
    if (li === 24) { const k = (t - w.start) / (w.end - w.start); lab = ['Ohio', 'Texas', 'Alaska'][Math.min(2, Math.floor(k * 3))]; }
    if (lab) txt(lab, 60, 64, 38, '#ffffff');
    // captions
    if (CAP_LINES.includes(li)) { const a = Math.min(easeOut(prog(t, w.start + .2, w.start + .5)), 1 - prog(t, w.end - .25, w.end)); og.save(); og.globalAlpha = a; txt(CAPS[li], W / 2, H - 90, 44, '#ffffff', 'center', 800, 9); og.restore(); }
    // title (upper third, over the wide establishing shot)
    if (li === 6) { const a = Math.min(easeOut(prog(t, ps(6) + .3, ps(6) + .9)), 1); goldTitle(['WHAT IF YOU EARNED $1 EVERY TIME', 'SOMEONE SAID YOUR NAME?'], H * .2, 84, a); }
    if (li === 48 && t > ps(48) + 1.2) { const a = easeOut(prog(t, ps(48) + 1.2, ps(48) + 1.6)); og.save(); og.globalAlpha = a; txt('RETURN ALL?', W / 2, H * .16, 70, '#ff6b6b', 'center', 900, 12); og.restore(); }
    if (li === 62) { const a = easeOut(prog(t, ps(62) + .2, ps(62) + .7)); goldTitle(['WHOSE NAME WOULD', 'YOU GET PAID FOR?'], H * .16, 74, a); }
  }
  // cuts
  for (const x of WINDOWS) { const d = Math.abs(t - x.start); if (x.start > 0 && d < .05) { og.fillStyle = `rgba(0,0,0,${.5 * (1 - d / .05)})`; og.fillRect(0, 0, W, H); } }
  if (t < .3) { og.fillStyle = `rgba(0,0,0,${1 - t / .3})`; og.fillRect(0, 0, W, H); }
  // end card (YouTube end-screen space)
  if (t >= END0) { const a = easeOut(prog(t, END0, END0 + .6)); const gr = og.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2b2350'); gr.addColorStop(1, '#4a3a7a'); og.save(); og.globalAlpha = a; og.fillStyle = gr; og.fillRect(0, 0, W, H);
    og.textAlign = 'center'; og.textBaseline = 'middle'; og.font = '800 46px Inter'; og.fillStyle = '#00e5ff'; og.shadowColor = '#00e5ff'; og.shadowBlur = 25; og.fillText('B R E V A N E', W / 2, 150); og.shadowBlur = 0;
    og.font = '500 30px Inter'; og.fillStyle = '#cfc6f0'; og.fillText('Impossible ideas. Real consequences.', W / 2, 205);
    og.strokeStyle = 'rgba(255,255,255,.35)'; og.lineWidth = 4; og.setLineDash([14, 10]); og.strokeRect(220, 330, 880, 495); og.beginPath(); og.arc(1460, 578, 170, 0, 7); og.stroke(); og.setLineDash([]);
    og.font = '800 40px Inter'; og.fillStyle = 'rgba(255,255,255,.75)'; og.fillText('WATCH NEXT', 660, 578); og.fillText('SUBSCRIBE', 1460, 578); og.restore();
    if (t > DURATION - .6) { og.fillStyle = `rgba(0,0,0,${prog(t, DURATION - .6, DURATION)})`; og.fillRect(0, 0, W, H); } }
  return out;
}

window.frame = (t, q = .92) => {
  for (const c of CAST) c.root.visible = false; for (const e of extras) e.g.visible = false;
  phone.g.visible = phone2.g.visible = false; school.paper.visible = false; street.umb.visible = false; school.tray.position.set(0, -5, 0); cash.visible = false; gym.spot.intensity = 0; bloom.strength = .28;
  if (t < END0) { const w = WINDOWS.find(w => t >= w.start && t < w.end) || WINDOWS[WINDOWS.length - 1]; w.fn(t, clamp((t - w.start) / (w.end - w.start))); }
  else { showSet('none'); }
  composer.render(); return overlay(t).toDataURL('image/jpeg', q);
};
window.DUR = DURATION; window.ready = true; window.TIMING = TL; window.END0 = END0;

// ---------- thumbnails (1280x720) ----------
window.thumb = (variant = 'A') => {
  for (const c of CAST) c.root.visible = false; for (const e of extras) e.g.visible = false; phone.g.visible = phone2.g.visible = false; cash.visible = false; gym.spot.intensity = 0;
  let lines;
  if (variant === 'B') { LIGHT.gym(); showSet('gym'); gym.set(1, { up: 1, bob: 0, talk: 1 }); standPose(nev, V(360, .9, -4.2), V(0, 0, 1), { face: { brow: -.7, mouth: 'smirk' }, look: V(360, 2.0, 4), handL: V(359.55, 1.85, -4.1), handR: V(360.45, 1.85, -4.1), handModeL: 'open', handModeR: 'open' }); nev.root.visible = true;
    look(V(359.2, 2.3, 1.2), V(360, 1.75, -4.2), 34); lines = ['SAY MY', 'NAME'];
  } else { LIGHT.morning(); showSet('bedroom'); cash.visible = true; stacks.forEach(s => s.visible = true);
    sitPose(nev, V(.55, .95, -.7), V(0, 0, 1), { t: 2, lean: -.1, face: variant === 'C' ? { brow: 1, mouth: 'o', wide: true } : { brow: -.5, mouth: 'smile' }, handL: V(.15, 1.5, -.55), handR: V(.95, 1.5, -.55), handModeL: 'open', handModeR: 'open', look: V(.2, 1.4, 2) }); nev.root.visible = true;
    look(V(-.15, 1.35, 1.25), V(.4, 1.35, -.7), 36); lines = variant === 'C' ? ['$14,203,117', 'FROM ONE WORD'] : ['$1 EVERY', 'TIME'];
  }
  bloom.strength = .35; composer.render();
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, 1280, 720);
  const v = g.createRadialGradient(640, 360, 250, 640, 360, 760); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.4)'); g.fillStyle = v; g.fillRect(0, 0, 1280, 720);
  const glowBg = g.createRadialGradient(330, 200, 20, 330, 200, 520); glowBg.addColorStop(0, 'rgba(255,190,60,.35)'); glowBg.addColorStop(1, 'rgba(255,190,60,0)'); g.fillStyle = glowBg; g.fillRect(0, 0, 1280, 720);
  g.textBaseline = 'top'; g.lineJoin = 'round';
  lines.forEach((txt, i) => { const size = txt.length > 9 ? 96 : 140; const y = 30 + i * (size + 12); g.font = `900 ${size}px Inter`; g.lineWidth = 22; g.strokeStyle = '#1a0d02'; g.strokeText(txt, 44, y);
    const gr = g.createLinearGradient(0, y, 0, y + size); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(.55, '#ffcc33'); gr.addColorStop(1, '#e08a00'); g.fillStyle = gr; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 18; g.fillText(txt, 44, y); g.shadowBlur = 0; });
  // speech bubbles "NEV!"
  [[930, 120, -.12], [1110, 260, .1], [880, 330, .05]].forEach(([x, y, r]) => { g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = '#fff'; g.strokeStyle = '#1a0d02'; g.lineWidth = 8; g.beginPath(); g.roundRect(-110, -50, 220, 100, 50); g.fill(); g.stroke();
    g.font = '900 64px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e23b3b'; g.fillText('NEV!', 0, 4); g.restore(); });
  return c.toDataURL('image/jpeg', .92);
};
