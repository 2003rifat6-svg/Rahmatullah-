// Brevane hook demo — "What If You Earned $1 Every Time Someone Said Your Name?"
// Style: soft pastel 3D, money counter top-right, small labels, POV phone shots, slow push-ins.
import { THREE, W, H, clamp, lerp, ease, easeOut, prog, V, rng, renderer, scene, composer, bloom, look, lightRig,
  makeChar, poseChar, standPose, sitPose, setFace, makePhone, placePhone } from './core.js';
import { drawPhoneUI } from './ui.js';
import { bedroom, school, house, showSet } from './sets.js';

const TL = await (await fetch('/timing.json')).json();
const T = Object.fromEntries(TL.map(x => [x.id, x]));
const DURATION = T.n3.end + 1.6;

// pastel restyle of the reused sets (soft, bright, like a toy world)
const RECOLOR = { '46578a': 'b7a6d9', '3a4466': 'd8c6b4', '2a3558': '8e7bb8', '3c5aa0': '5fc7b4', '5a4a6a': 'c98f6a', '9cc7b4': '8fd1c2' };
scene.traverse(o => { if (o.material && o.material.color) { const h = o.material.color.getHexString(); if (RECOLOR[h]) o.material.color.set('#' + RECOLOR[h]); } });

const nev = makeChar({ hoodie: '#D2512E' });
const teacher = makeChar({ hoodie: '#7a8599', glasses: true, string: '#7a8599', sleeveFull: true });
const mom = makeChar({ hoodie: '#8a4fbf', scarf: '#f2a6c8', bun: '#3a2a22', string: '#8a4fbf', sleeveFull: true });
const kids = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3', '#3fae6a', '#ff8c42'].map(h => makeChar({ hoodie: h, string: h }));
const CAST = [nev, teacher, mom, ...kids];
const phone = makePhone();
function drawUI(s) { drawPhoneUI(phone.cv.getContext('2d'), s); phone.tex.needsUpdate = true; phone.g.visible = true; phone.light.intensity = s.light ?? .05; }
const blink = t => { const p = (t % 3.3) / 3.3; return p > .93 ? 1 - Math.abs(p - .965) / .035 : 0; };

const LIGHT = {
  morning: () => { lightRig(V(0, 1, 0), { key: 2.6, keyCol: '#ffe9cf', hemi: 2.6, sky: '#fff1e2', ground: '#8a7a90', bg: '#c9b8e6', exposure: 1.35, fill: 1.4, fillCol: '#d9ccff' }); bedroom.day(true); bedroom.lamp.intensity = 0; },
  kitchen: () => { lightRig(V(120, 1, 0), { key: 2.5, keyCol: '#fff0dc', hemi: 2.5, sky: '#fff0dc', ground: '#7a6050', bg: '#f0d6b0', exposure: 1.3 }); house.day(true); house.lamp.intensity = 0; },
  school: (z = 0) => lightRig(V(30, 1, z), { key: 2.2, keyCol: '#fff4e4', hemi: 2.3, sky: '#fff6ea', ground: '#7a8a80', bg: '#cfe6df', exposure: 1.15, fill: 1.3 }),
};

const BED = { seat: V(0, .5, -.05), fwd: V(0, 0, 1) };
const BANK = (memo, a = 1) => ({ who: 'bank', title: 'Bank', body: `+$1.00 received · Memo: "${memo}"`, tag: 'Sender: UNKNOWN', tagCol: '#ffcf4a', a });

function holdSit(t, o = {}) {
  const tmp = { handL: BED.seat.clone().add(V(0, .4, .2)), handR: BED.seat.clone().add(V(0, .4, .2)) };
  const i1 = sitPose(nev, BED.seat, BED.fwd, { t, lean: .32, face: { ...o.face, blink: o.face?.blink ?? blink(t) }, ...tmp });
  placePhone(phone, i1, {});
  const gL = phone.g.localToWorld(V(-.066, -.05, -.012)), gR = phone.g.localToWorld(V(.066, -.05, -.012));
  const i2 = sitPose(nev, BED.seat, BED.fwd, { t, lean: .32, face: { ...o.face, blink: o.face?.blink ?? blink(t) }, handL: gL, handR: gR, handModeL: 'grip', handModeR: 'grip',
    handTargetL: phone.g.position, handTargetR: phone.g.position, look: o.look || phone.g.position, hide: o.hide });
  placePhone(phone, i2, {}); nev.root.visible = true; return i2;
}
function phoneCU(t, k, ui, o = {}) {
  holdSit(t, { hide: { head: true, body: true, arms: true, legs: true } }); drawUI({ t, ...ui });
  const n = phone.g.localToWorld(V(0, 0, 1)).sub(phone.g.position).normalize();
  const tgt = phone.g.localToWorld((o.focus || V(0, -.005, 0)).clone());
  const d = lerp(o.d0 ?? .17, o.d1 ?? .14, ease(k)); const sh = o.shake ? V(Math.sin(t * 70), Math.cos(t * 55), 0).multiplyScalar(o.shake) : V(0, 0, 0);
  look(tgt.clone().add(n.multiplyScalar(d)).add(V(.03, .01, 0)).add(sh), tgt, 34);
}

// money: one dollar per spoken "Nev"
const DING = [T.n1.start + .25, T.mom.start + .15, T.teacher.start + .1, ...[0, .55, 1.15, 1.75, 2.35].map(x => T.kids.start + x)];
function money(t) { let m = DING.filter(d => t >= d).length; if (t > T.kids.start + 2.6) m += Math.floor(Math.pow(prog(t, T.kids.start + 2.6, DURATION), 1.6) * 46); return m; }
window.DING = DING;

const SHOTS = [
  // 1. morning, Nev asleep, phone buzzing on nightstand
  [0, T.n0.end + .2, (t, k) => { LIGHT.morning(); showSet('bedroom'); bedroom.setClock('7:02');
    poseChar(nev, { hip: V(.55, .62, -.9), fwd: V(0, 0, -1), lean: -Math.PI / 2 + .1, footL: V(.48, .6, 0), footR: V(.65, .6, 0), handL: V(.75, .62, -1.1), handR: V(.35, .62, -1.1), face: { brow: .2, mouth: 'flat', blink: 1 }, look: V(.55, 2, -1.6), hide: { legs: true } });
    nev.root.visible = true; const buzz = t > 1.6 ? Math.sin(t * 90) * .006 : 0;
    phone.g.position.set(-0.78 + buzz, .535, -0.55); phone.g.rotation.set(-Math.PI / 2, 0, .4 + buzz * 3); drawUI({ mode: 'lock', bigTime: '7:02', notifs: t > 1.6 ? [BANK('Nev')] : [], light: t > 1.6 ? .5 : .02 });
    look(V(lerp(1.5, 1.05, ease(k)), lerp(1.45, 1.25, k), lerp(1.9, 1.35, ease(k))), V(-.25, .6, -.6), 38); }],
  // 2. POV: the bank notification
  [T.n0.end + .2, T.n1.start + 2.4, (t, k) => { LIGHT.morning(); showSet('bedroom');
    phoneCU(t, k, { mode: 'lock', bigTime: '7:02', time: '7:02', notifs: [BANK('Nev', easeOut(prog(t, T.n1.start, T.n1.start + .35)))] }, { d0: .2, d1: .15, shake: t < T.n1.start + .4 ? .002 : 0 }); }],
  // 3. Nev's confused face
  [T.n1.start + 2.4, T.mom.start - .1, (t, k) => { LIGHT.morning(); showSet('bedroom');
    const i = holdSit(t, { face: { brow: .7, mouth: 'wavy' }, look: k < .5 ? phone.g.position : V(.6, 1.1, 1.4) }); drawUI({ mode: 'lock', notifs: [BANK('Nev')] });
    const c = i.hc.clone().add(i.fwd.clone().multiplyScalar(lerp(.95, .72, ease(k)))).add(i.right.clone().multiplyScalar(.12)).add(V(0, -.05, 0)); look(c, i.hc.clone().add(V(0, -.05, 0)), 32); }],
  // 4. Mom in the kitchen yelling up the stairs
  [T.mom.start - .1, T.n2.start - .1, (t, k) => { LIGHT.kitchen(); showSet('house'); const base = V(120.9, 0, -1.4);
    const talk = t > T.mom.start && t < T.mom.end - .2;
    standPose(mom, base, V(-.5, 0, 1), { handL: base.clone().add(V(-.25, 1.45, .25)), handR: base.clone().add(V(.05, .95, -.2)), handModeL: 'open', face: { brow: -.3, mouth: talk ? (Math.sin(t * 14) > 0 ? 'yell' : 'o') : 'smile', blink: blink(t) }, look: V(119.6, 2.2, .6), lean: -.05 });
    mom.root.visible = true; look(V(lerp(122.6, 122.2, k), 1.3, lerp(.4, .1, k)), V(120.8, 1.25, -1.3), 34); }],
  // 5. phone again: second dollar
  [T.n2.start - .1, T.teacher.start - .15, (t, k) => { LIGHT.morning(); showSet('bedroom');
    phoneCU(t, k, { mode: 'lock', bigTime: '7:04', time: '7:04', notifs: [BANK('Nev', easeOut(prog(k, 0, .25))), BANK('Nev')] }, { d0: .17, d1: .145, focus: V(0, -.02, 0) }); }],
  // 6. classroom roll call
  [T.teacher.start - .15, T.kids.start - .1, (t, k) => { LIGHT.school(-14); showSet('school'); const cl = V(30, 0, -14);
    standPose(teacher, cl.clone().add(V(-.35, 0, -1.4)), V(0, 0, 1), { face: { brow: -.4, mouth: t > T.teacher.start && t < T.teacher.end ? 'o' : 'flat', blink: blink(t) }, look: cl.clone().add(V(-1.2, 1.1, .5)), handL: cl.clone().add(V(-.6, .8, -1.3)), handR: cl.clone().add(V(-.1, .8, -1.3)), handModeL: 'open', handModeR: 'open' });
    teacher.root.visible = true;
    look(teacher.head.position.clone().add(V(-.55, -.08, 1.2)), teacher.head.position.clone().add(V(0, -.1, 0)), 32); }],
  // 7. cafeteria: everybody chants the name, counter runs
  [T.kids.start - .1, T.n3.start + .2, (t, k) => { LIGHT.school(); showSet('school'); const c = V(30.2, 0, 3.7);
    standPose(nev, c, V(0, 0, 1), { face: { brow: -.3, mouth: 'smile', blink: blink(t) }, look: c.clone().add(V(Math.sin(t * 2) * 1.5, 1.4, 3)), handL: c.clone().add(V(-.35, .9, .1)), handR: c.clone().add(V(.35, .9, .1)), handModeL: 'open', handModeR: 'open' }); nev.root.visible = true;
    kids.forEach((ch, i) => { const a = Math.PI * .45 + i * (Math.PI * 1.1 / (kids.length - 1)), r = 1.3 + (i % 2) * .45; const b = c.clone().add(V(Math.sin(a) * r, 0, Math.cos(a) * r));
      const hop = Math.max(0, Math.sin(t * 7.5 + i * 1.3)) * .06; const f = c.clone().sub(b).setY(0).normalize();
      standPose(ch, b.clone().add(V(0, hop, 0)), f, { handL: b.clone().add(f.clone().cross(V(0,1,0)).multiplyScalar(.5)).add(V(0, 1.42 + hop + Math.sin(t * 7.5 + i) * .1, 0)), handR: b.clone().add(f.clone().cross(V(0,1,0)).multiplyScalar(-.5)).add(V(0, 1.42 + hop + Math.cos(t * 7.5 + i) * .1, 0)), handModeL: 'fist', handModeR: 'fist', face: { brow: -.5, mouth: Math.sin(t * 7.5 + i) > 0 ? 'yell' : 'smile', blink: blink(t + i) }, look: nev.head.position.clone() }); ch.root.visible = true; });
    const ang = lerp(-.45, .35, k); look(c.clone().add(V(Math.sin(ang) * 2.9, lerp(1.45, 1.7, k), Math.cos(ang) * 2.9)), c.clone().add(V(0, 1.05, -.6)), 42); }],
  // 8. title over a high wide shot, counter keeps climbing
  [T.n3.start + .2, DURATION, (t, k) => { LIGHT.school(); showSet('school'); const c = V(30.2, 0, 3.7);
    standPose(nev, c, V(0, 0, 1), { face: { brow: -.6, mouth: 'smirk', blink: blink(t) }, look: c.clone().add(V(.5, 2.6, 2.6)), handL: c.clone().add(V(-.3, .9, .1)), handR: c.clone().add(V(.3, .9, .1)) }); nev.root.visible = true;
    kids.forEach((ch, i) => { const a = Math.PI * .45 + i * (Math.PI * 1.1 / (kids.length - 1)), r = 1.3 + (i % 2) * .45; const b = c.clone().add(V(Math.sin(a) * r, 0, Math.cos(a) * r));
      standPose(ch, b, c.clone().sub(b).setY(0).normalize(), { handL: b.clone().add(c.clone().sub(b).setY(0).normalize().cross(V(0,1,0)).multiplyScalar(.5)).add(V(0, 1.42, 0)), handR: b.clone().add(c.clone().sub(b).setY(0).normalize().cross(V(0,1,0)).multiplyScalar(-.5)).add(V(0, 1.42, 0)), handModeL: 'fist', handModeR: 'fist', face: { brow: -.5, mouth: 'smile', blink: blink(t + i) }, look: nev.head.position.clone() }); ch.root.visible = true; });
    look(c.clone().add(V(lerp(.7, .4, k), lerp(2.3, 2.6, k), lerp(2.3, 2.7, k))), c.clone().add(V(0, .9, -.4)), 42); }],
];
const setWorld = (o, p) => o.position.copy(p).sub(o.parent.position);
const WINDOWS = SHOTS.map(([s, e, fn]) => ({ start: s, end: e, fn }));

// ---------- overlay: counter, labels, +$1 pops, title ----------
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
const fmt = n => '$' + n.toLocaleString('en-US');
function txt(s, x, y, size, col, align = 'left', w = 900, stroke = 0) {
  og.save(); og.font = `${w} ${size}px Inter`; og.textAlign = align; og.textBaseline = 'middle';
  og.shadowColor = 'rgba(0,0,0,.55)'; og.shadowBlur = 10; og.shadowOffsetY = 3;
  if (stroke) { og.lineJoin = 'round'; og.lineWidth = stroke; og.strokeStyle = 'rgba(20,12,4,.9)'; og.strokeText(s, x, y); }
  og.fillStyle = col; og.fillText(s, x, y); og.restore();
}
function overlay(t) {
  og.drawImage(renderer.domElement, 0, 0);
  const v = og.createRadialGradient(W / 2, H / 2, H * .5, W / 2, H / 2, H * 1.05); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.28)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
  // counter (top-right), pops on every dollar
  const m = money(t), last = DING.filter(d => t >= d).pop() ?? -9, pop = 1 + .25 * Math.max(0, 1 - (t - last) / .25);
  if (t > T.n1.start) { og.save(); og.translate(W - 60, 62); og.scale(pop, pop);
    og.beginPath(); og.arc(-txtW(fmt(m)) - 34, 0, 15, 0, 7); og.lineWidth = 4; og.strokeStyle = '#ffd34d'; og.stroke(); og.beginPath(); og.moveTo(-txtW(fmt(m)) - 34, 0); og.lineTo(-txtW(fmt(m)) - 34, -9); og.moveTo(-txtW(fmt(m)) - 34, 0); og.lineTo(-txtW(fmt(m)) - 27, 4); og.stroke();
    og.restore(); og.save(); og.translate(W - 60, 62); og.scale(pop, pop); txt(fmt(m), 0, 0, 46, '#ffd34d', 'right', 800); og.restore(); }
  // top-left label
  const lab = t < T.mom.start - .1 ? '7:02 AM' : t < T.teacher.start - .15 ? '7:04 AM' : t < T.kids.start - .1 ? '8:15 AM · Roll call' : t < T.n3.start + .2 ? '12:30 PM · Lunch' : '';
  if (lab) txt(lab, 60, 64, 38, '#ffffff', 'left', 800);
  // "+$1" pops near the bottom
  for (const d of DING) { const a = t - d; if (a >= 0 && a < .9) { og.save(); og.globalAlpha = a < .1 ? a / .1 : 1 - prog(a, .55, .9); txt('+$1', W / 2, H - 170 - easeOut(a / .9) * 70, 76, '#ffd34d', 'center', 900, 12); og.restore(); } }
  if (t > T.kids.start + .1 && t < T.n3.start + .2) txt('$1 / name', W / 2, H - 80, 40, '#ffffff', 'center', 800, 8);
  // title card
  if (t > T.n3.start + .5) { const a = easeOut(prog(t, T.n3.start + .5, T.n3.start + 1.1)); og.save(); og.globalAlpha = a; og.translate(W / 2, H / 2 - 30); og.scale(lerp(1.08, 1, a), lerp(1.08, 1, a));
    for (const [s, y] of [['WHAT IF YOU EARNED $1 EVERY TIME', -55], ['SOMEONE SAID YOUR NAME?', 55]]) {
      og.font = '900 92px Inter'; og.letterSpacing = '3px'; og.textAlign = 'center'; og.textBaseline = 'middle'; og.lineJoin = 'round'; og.lineWidth = 16; og.strokeStyle = '#2a1606'; og.strokeText(s, 0, y);
      const gr = og.createLinearGradient(0, y - 40, 0, y + 40); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(.55, '#ffcc33'); gr.addColorStop(1, '#e08a00'); og.fillStyle = gr; og.shadowColor = 'rgba(255,190,40,.6)'; og.shadowBlur = 30; og.fillText(s, 0, y); og.shadowBlur = 0; }
    og.restore(); }
  for (const w of WINDOWS) { const d = Math.abs(t - w.start); if (w.start > 0 && d < .05) { og.fillStyle = `rgba(0,0,0,${.6 * (1 - d / .05)})`; og.fillRect(0, 0, W, H); } }
  if (t < .3) { og.fillStyle = `rgba(0,0,0,${1 - t / .3})`; og.fillRect(0, 0, W, H); }
  if (t > DURATION - .5) { og.fillStyle = `rgba(0,0,0,${prog(t, DURATION - .5, DURATION)})`; og.fillRect(0, 0, W, H); }
  return out;
}
function txtW(s) { og.save(); og.font = '800 46px Inter'; const w = og.measureText(s).width; og.restore(); return w; }

window.frame = (t, q = .92) => {
  for (const c of CAST) c.root.visible = false; phone.g.visible = false; school.paper.visible = false; school.tray.position.set(0, -5, 0);
  bloom.strength = .28;
  const w = WINDOWS.find(w => t >= w.start && t < w.end) || WINDOWS[WINDOWS.length - 1];
  w.fn(t, clamp((t - w.start) / (w.end - w.start)));
  composer.render(); return overlay(t).toDataURL('image/jpeg', q);
};
window.DUR = DURATION; window.ready = true; window.TIMING = TL;
