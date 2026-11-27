// Brevane #01 — "Your Phone Has a Hidden Mode. Never Turn It On."  (no subtitles burned in)
import { VERT, THREE, W, H, clamp, lerp, ease, easeOut, prog, V, Y, rng, renderer, scene, camera, composer, bloom, look, lightRig,
  makeChar, poseChar, standPose, sitPose, setFace, makePhone, placePhone, TOGGLE_LOCAL } from './core.js';
import { drawPhoneUI } from './ui.js';
import { bedroom, school, street, store, house, highway, showSet } from './sets.js';

const TIMING = await (await fetch('/timing.json')).json();
const DURATION = TIMING[TIMING.length - 1].end + 3.2;
const ps = i => TIMING[i].start, pe = i => TIMING[i].end;

// ---------- cast ----------
const nev = makeChar({ hoodie: '#D2512E' });
const jake = makeChar({ hoodie: '#3fae6a', cap: '#f2f2f2', string: '#ffffff' });
const teacher = makeChar({ hoodie: '#7a8599', glasses: true, string: '#7a8599', sleeveFull: true });
const mom = makeChar({ hoodie: '#8a4fbf', scarf: '#f2a6c8', bun: '#3a2a22', string: '#8a4fbf', sleeveFull: true });
const kids = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3'].map(h => makeChar({ hoodie: h, string: h }));
const CAST = [nev, jake, teacher, mom, ...kids];
const phone = makePhone(), phone2 = makePhone();
const setWorld = (o, p) => o.position.copy(p).sub(o.parent.position);
function drawUI(ph, s) { drawPhoneUI(ph.cv.getContext('2d'), s); ph.tex.needsUpdate = true; ph.g.visible = true; ph.light.intensity = s.light ?? .05; }

// ---------- lighting presets ----------
const LIGHT = {
  night: () => { lightRig(V(0, 1, 0), { key: 1.6, keyCol: '#c9d6ff', hemi: 1.7, bg: '#24305a', exposure: 1.4 }); bedroom.day(false); bedroom.lamp.intensity = .9; },
  dark: () => { lightRig(V(0, 1, 0), { key: .6, keyCol: '#7d8fcf', hemi: .9, bg: '#121a36', exposure: 1.3 }); bedroom.day(false); bedroom.lamp.intensity = 0; },
  morning: () => { lightRig(V(0, 1, 0), { key: 2.4, keyCol: '#ffe6c4', hemi: 2.2, sky: '#ffe9d2', ground: '#5a4a50', bg: '#9fb6d8', exposure: 1.3 }); bedroom.day(true); bedroom.lamp.intensity = 0; },
  school: (z = 0) => lightRig(V(30, 1, z), { key: 1.6, hemi: 1.4, sky: '#fff2e0', ground: '#5a5a55', bg: '#bcd6d0', exposure: 1.0 }),
  rain: () => lightRig(V(60, 1, 0), { key: 1.0, keyCol: '#c9d3e6', hemi: 2.0, sky: '#b8c4d8', ground: '#4a5060', bg: '#7f8ca3', exposure: 1.3 }),
  store: () => lightRig(V(90, 1, 0), { key: 1.7, hemi: 1.6, sky: '#fff8ee', ground: '#8a7a6a', bg: '#f1e4d0', exposure: 1.05 }),
  houseDay: () => { lightRig(V(120, 1, 0), { key: 2.3, keyCol: '#fff0dc', hemi: 2.2, sky: '#fff0dc', ground: '#6a5040', bg: '#e8c9a0', exposure: 1.25 }); house.day(true); house.lamp.intensity = 0; },
  houseNight: () => { lightRig(V(120, 1, 0), { key: .8, keyCol: '#ffcf9a', hemi: 1.4, sky: '#ffd9a8', ground: '#3a2a22', bg: '#3a2a30', exposure: 1.35 }); house.day(false); house.lamp.intensity = 2.5; },
  highway: () => lightRig(V(220, 1, 0), { key: 2.6, hemi: 2.4, sky: '#d8ecff', ground: '#6a8a5a', bg: '#a9cfff', exposure: 1.2, keyOff: V(30, 60, 40) }),
};

// ---------- reusable beats ----------
const BED = { seat: V(0, .5, -.05), fwd: V(0, 0, 1) };
const FACE = { calm: { brow: .3, mouth: 'flat' }, worried: { brow: 1, mouth: 'frown' }, scared: { brow: 1, mouth: 'o', wide: true },
  happy: { brow: -.2, mouth: 'smile' }, smug: { brow: -.6, mouth: 'smirk' }, confused: { brow: .6, mouth: 'wavy' }, determined: { brow: -.8, mouth: 'frown' } };
const blinkAt = (t, list) => list.reduce((b, s) => Math.max(b, 1 - Math.abs(t - s) / .09), 0);
function withBlink(f, t) { return { ...f, blink: f.blink ?? blinkAt(t, [Math.floor(t / 3.7) * 3.7 + 2.1]) }; }

// Nev sitting and holding the phone. Returns phone info.
function nevHoldSit(t, seat, fwd, o = {}) {
  const tmp = { handL: seat.clone().add(V(0, .4, .2)), handR: seat.clone().add(V(0, .4, .2)) };
  const info = sitPose(nev, seat, fwd, { t, lean: o.lean ?? .32, face: withBlink(o.face || FACE.calm, t), ...tmp, floorY: o.floorY });
  placePhone(phone, info, { drop: o.drop, dist: o.dist });
  const gL = phone.g.localToWorld(V(-.066, -.05, -.012));
  let gR = phone.g.localToWorld(V(.066, -.05, -.012)), pdir = null, modeR = 'grip';
  if (o.pointLocal) { gR = phone.g.localToWorld(o.pointLocal.clone()); pdir = phone.g.localToWorld(o.pointLocal.clone()).sub(phone.g.localToWorld(V(.09, -.12, .05))); modeR = 'point'; }
  const info2 = sitPose(nev, seat, fwd, { t, lean: o.lean ?? .32, face: withBlink(o.face || FACE.calm, t), handL: gL, handR: gR, handModeL: 'grip', handModeR: modeR,
    handTargetL: phone.g.position, handTargetR: phone.g.position, pointDirR: pdir, look: o.look || phone.g.position, hide: o.hide, floorY: o.floorY });
  nev.root.visible = true;
  placePhone(phone, info2, { drop: o.drop, dist: o.dist });
  return info2;
}
function nevHoldStand(t, base, fwd, o = {}) {
  const tmp = { handL: base.clone().add(V(0, 1, .2)), handR: base.clone().add(V(0, 1, .2)) };
  const info = standPose(nev, base, fwd, { ...tmp, face: withBlink(o.face || FACE.calm, t), lean: o.lean ?? .1 });
  placePhone(phone, info, { drop: o.drop ?? .3, dist: o.dist ?? .3 });
  const gL = phone.g.localToWorld(V(-.066, -.05, -.012)), gR = phone.g.localToWorld(V(.066, -.05, -.012));
  const info2 = standPose(nev, base, fwd, { handL: gL, handR: gR, handTargetL: phone.g.position, handTargetR: phone.g.position, face: withBlink(o.face || FACE.calm, t), lean: o.lean ?? .1, look: o.look || phone.g.position, phase: o.phase, stride: o.stride });
  placePhone(phone, info2, { drop: o.drop ?? .3, dist: o.dist ?? .3 });
  nev.root.visible = true; return info2;
}
// phone close-up exactly like the hook (POV, body hidden)
function phoneCU(t, k, ui, o = {}) {
  nevHoldSit(t, o.seat || BED.seat, o.fwd || BED.fwd, { pointLocal: o.pointLocal, hide: { head: true, body: true, arms: true, legs: true, keepHandR: !!o.pointLocal } });
  drawUI(phone, { t, ...ui });
  const cards = (ui.notifs || []).length > 0 || ui.under;
  let focus = o.focusLocal || null, d0 = o.d0, d1 = o.d1;
  if (!focus && cards && !o.wide) { focus = ui.under ? V(0, -.028, 0) : ui.mode === 'notif' ? V(0, .02, 0) : V(0, .008, 0); d0 = .19; d1 = .16; }
  const n = phone.g.localToWorld(V(0, 0, 1)).sub(phone.g.position).normalize();
  const tgt = focus ? phone.g.localToWorld(focus.clone()) : phone.g.position.clone().add(o.aimOff || V(0, 0, 0));
  let d = lerp(d0 ?? .3, d1 ?? .27, ease(k)); if (VERT) d = Math.max(d, .27);
  const sh = o.shake ? V(Math.sin(t * 60), Math.cos(t * 50), 0).multiplyScalar(o.shake) : V(0, 0, 0);
  look(tgt.clone().add(n.multiplyScalar(d)).add(sh), tgt, o.fov || 34);
}
function faceCU(t, k, info, o = {}) {
  const hc = info.hc, f = info.fwd;
  const cam = hc.clone().add(f.clone().multiplyScalar(lerp(o.d0 ?? .85, o.d1 ?? .7, ease(k)))).add(info.right.clone().multiplyScalar(o.side ?? .08)).add(V(0, o.dy ?? -.04, 0));
  look(cam, hc.clone().add(V(0, o.ty ?? -.02, 0)), o.fov || 30);
}

// UI shorthands
const N = {
  jake: { who: 'jake', title: 'Jake', body: "Bro... I can't believe you fell in the cafeteria 😂", tag: 'now' },
  teacher: { who: 'teacher', title: 'Mr. Hall', body: 'Pop quiz tomorrow. Chapter 7.', tag: 'now' },
  weather: { who: 'weather', title: 'Weather Alert', body: 'Heavy rain at 4:15 PM.', tag: 'now' },
  bank: { who: 'bank', title: 'Bank', body: 'Card declined: $189.99 at Sneaker Hub', tag: 'now', red: true },
  you1: { who: 'you', title: 'You', body: 'Stop changing things.', tag: 'Sent tomorrow', glow: true },
  you2: { who: 'you', title: 'You', body: "You don't know what you're using up.", tag: 'Sent tomorrow', glow: true },
  you3: { who: 'you', title: 'You', body: "Save the rest. You're going to need it.", tag: 'Sent tomorrow', glow: true },
  mom: { who: 'mom', title: 'Mom 💜', body: 'Running late. Taking the highway. Love you ❤️', tag: 'Sent tomorrow · 8:14 AM', tagCol: '#ff8a8a', big: true, glow: true, glowCol: '#ff6b6b' },
  youLast: { who: 'you', title: 'You', body: "Whatever you do... don't install it.", tag: 'Sent tomorrow', glow: true },
};

// ---------- shots ----------
// each: [fromParagraph, toParagraph, fn(t, k)]
const SHOTS = [
  // HOOK
  [0, 0, (t, k) => { LIGHT.night(); showSet('bedroom'); bedroom.setClock('3:32');
    nevHoldSit(t, BED.seat, BED.fwd, { face: { ...FACE.calm, brow: .4 } }); drawUI(phone, { mode: 'settings', scroll: k * 120, battery: 100, light: .05 });
    look(V(lerp(1.9, 1.3, ease(k)), lerp(1.4, 1.25, k), lerp(2.6, 1.8, ease(k))), V(-.1, .85, -.35), 38); }],
  [1, 1, (t, k) => { LIGHT.night(); showSet('bedroom'); bedroom.setClock(k < .45 ? '3:32' : '3:33'); nevHoldSit(t, BED.seat, BED.fwd, {}); drawUI(phone, { mode: 'settings', scroll: 140 });
    look(V(-0.45, .72, -0.05 + .05 * ease(k)), V(-0.8, .58, -0.55), 24); }],
  [2, 2, (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, { mode: 'settings', scroll: 330 + ease(prog(k, 0, .5)) * 100, rowIn: easeOut(prog(k, .25, .55)), battery: 100 }); }],
  [3, 3, (t, k) => { LIGHT.night(); showSet('bedroom'); const g = Math.max(0, 1 - Math.abs(t - (ps(3) + pe(3)) / 2 - .6) / .25);
    const info = nevHoldSit(t, BED.seat, BED.fwd, { face: { ...FACE.worried, mouth: g > .2 ? 'wavy' : 'frown' }, look: V(.1, 1.0, 1.4) }); drawUI(phone, { mode: 'settings', scroll: 430, rowIn: 1 }); faceCU(t, k, info); }],
  [4, 4, (t, k) => { LIGHT.night(); showSet('bedroom'); const appr = ease(prog(k, 0, .45)), flip = ease(prog(k, .45, .6));
    const tl = V(.09, -.12, .05).lerp(TOGGLE_LOCAL.clone().add(V(-.012 + flip * .024, -.004, .006)), appr);
    phoneCU(t, k, { mode: 'settings', scroll: 430, rowIn: 1, knob: flip, flash: k > .58 ? .6 * (1 - prog(k, .58, 1)) : 0, light: .05 + (k > .58 ? .15 * (1 - prog(k, .58, 1)) : 0) },
      { pointLocal: tl, shake: k > .58 && k < .85 ? .004 * (1 - prog(k, .58, .85)) : 0 }); }],
  [5, 5, (t, k) => { LIGHT.night(); showSet('bedroom'); const g = 1 - easeOut(prog(k, .1, .7));
    const info = nevHoldSit(t, BED.seat, BED.fwd, { face: { brow: lerp(-.6, .5, 1 - g), mouth: 'flat', glow: g }, look: V(Math.sin(t * 1.5) * .6, 1.05, 1.3) });
    drawUI(phone, { mode: 'settings', scroll: 430, rowIn: 1, knob: 1, dot: 1 }); faceCU(t, k, info, { d0: 1.1, d1: .95, side: .15 }); }],
  [6, 6, (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, { mode: 'lock', bigTime: '3:34', notifs: [], dot: 1 + .3 * Math.sin(t * 5), dotScale: 1 + .2 * Math.sin(t * 5), battery: 100 }, { focusLocal: V(.012, .06, 0), d0: .12, d1: .09, fov: 30 }); }],
  [7, 7, (t, k) => { LIGHT.dark(); showSet('bedroom'); bedroom.setClock('3:35'); // phone face-down glowing on the nightstand, Nev asleep
    const lie = bedroom.seat.clone().add(V(.2, .05, -.9));
    poseChar(nev, { hip: V(.55, .62, -.9), fwd: V(0, 0, -1), lean: -Math.PI / 2 + .1, footL: V(.48, .6, .0), footR: V(.65, .6, .0), handL: V(.75, .62, -1.1), handR: V(.35, .62, -1.1), face: { brow: .2, mouth: 'flat', blink: 1 }, look: V(.55, 2, -1.6), hide: { legs: true } });
    nev.root.visible = true; phone.g.position.set(-0.75, .535, -0.55); phone.g.rotation.set(Math.PI / 2, 0, .4); drawUI(phone, { mode: 'off', light: .25 });
    look(V(lerp(1.0, .55, ease(k)), lerp(1.25, 1.05, k), lerp(1.6, 1.0, ease(k))), V(-.1, .6, -.7), 36); }],
  // MORNING
  [8, 8, (t, k) => { LIGHT.morning(); showSet('bedroom'); bedroom.setClock('7:02');
    nevHoldSit(t, BED.seat, BED.fwd, { face: { ...FACE.calm, brow: .2, blink: t - ps(8) < .4 ? 1 : 0 } }); drawUI(phone, { mode: 'lock', bigTime: '7:02', notifs: [{ ...N.jake, a: easeOut(prog(k, .3, .6)) }], dot: 1, light: .02 });
    look(V(lerp(1.6, 1.3, k), 1.25, lerp(2.2, 1.9, k)), V(0, .8, -.2), 38); }],
  [9, 10, (t, k) => { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k, { mode: 'lock', bigTime: '7:02', notifs: [N.jake], dot: 1, time: '7:02' }, { d0: .32, d1: .28 }); }],
  [11, 11, (t, k) => { LIGHT.morning(); showSet('bedroom'); bedroom.setClock('7:02');
    const info = nevHoldSit(t, BED.seat, BED.fwd, { face: { ...FACE.confused, blink: blinkAt(t, [ps(11) + 1.2]) }, look: V(-.6, 1.0, 1.2) }); drawUI(phone, { mode: 'lock', bigTime: '7:02', notifs: [N.jake], dot: 1 });
    look(V(.6, 1.0, 1.4), V(-.25, .8, -.3), 34); }],
  [12, 13, (t, k) => { LIGHT.morning(); showSet('bedroom'); const pulse = .5 + .5 * Math.sin(t * 6);
    phoneCU(t, k, { mode: 'lock', bigTime: '7:03', time: '7:03', dot: 1, notifs: [{ ...N.jake, tag: 'Sent 12:41 PM · Today', tagCol: `rgb(${Math.round(120 + 135 * pulse)},${Math.round(229 * pulse + 150 * (1 - pulse))},255)`, glow: k > .45 }] }, { d0: .26, d1: .19, aimOff: V(0, .03, 0) }); }],
  [14, 14, (t, k) => { LIGHT.morning(); showSet('bedroom'); const info = nevHoldSit(t, BED.seat, BED.fwd, { face: FACE.scared, look: V(0, 1.1, 1.5) }); drawUI(phone, { mode: 'lock', notifs: [N.jake] }); faceCU(t, k, info, { d0: .8, d1: .62 }); }],
  // CAFETERIA
  [15, 15, (t, k) => { LIGHT.school(); showSet('school'); seatKids(t); const x = lerp(32.5, 31.0, k), base = V(x, 0, 4.2 - k * 1.2);
    standPose(nev, base, V(-.5, 0, -1), { phase: t * 3.2, stride: .09, face: { ...FACE.worried, mouth: 'flat' }, look: base.clone().add(V(-.3, .2, -2)), lean: .12 }); nev.root.visible = true;
    look(V(28.2, 1.5, 5.6), V(31.2, .9, 3), 40); }],
  [16, 16, (t, k) => { LIGHT.school(); showSet('school'); seatKids(t); const base = V(30.35, 0, 3.05);
    const foot = V(30.25, lerp(.35, .28, Math.sin(t * 2) * .5 + .5), 2.75);
    poseChar(nev, { hip: base.clone().add(V(0, .82, 0)), fwd: V(0, 0, -1), lean: .2, footL: foot, footR: base.clone().add(V(.1, .1, .1)), handL: base.clone().add(V(-.3, .55, 0)), handR: base.clone().add(V(.3, .55, 0)), handModeL: 'open', handModeR: 'open', face: FACE.scared, look: V(30.2, 0, 2.6) });
    nev.root.visible = true; look(V(lerp(29.0, 29.2, k), .55, 1.6), V(30.25, .35, 2.7), 42); }],
  [17, 17, (t, k) => { LIGHT.school(); showSet('school'); seatKids(t); const s = ease(k); const base = V(30.3, 0, lerp(3.1, 2.2, s));
    const lift = Math.sin(Math.PI * clamp(s * 1.2)) * .3;
    poseChar(nev, { hip: base.clone().add(V(0, .84 + lift * .3, 0)), fwd: V(0, 0, -1), lean: .05, footL: base.clone().add(V(-.1, .1 + lift, -.35 * s)), footR: base.clone().add(V(.1, .1, .2 - .2 * s)),
      handL: base.clone().add(V(-.55, 1.15, 0)), handR: base.clone().add(V(.55, 1.15, 0)), handModeL: 'open', handModeR: 'open', face: FACE.happy, look: V(30.3, 1.3, -2) });
    nev.root.visible = true; look(V(31.7, 1.2, 1.1), V(30.3, 1.0, 2.5), 40); }],
  [18, 18, (t, k) => { LIGHT.school(); showSet('school'); seatKids(t);
    const tb = school.tables[3]; // jake eats, phone face-down on the table
    sitPose(jake, V(tb.x + .2, .45, tb.z - .65), V(0, 0, 1), { t, lean: .2, handL: V(tb.x + .1, .82, tb.z - .3), handR: V(tb.x + .35, .9, tb.z - .25), face: withBlink({ brow: -.1, mouth: 'smile' }, t), look: V(tb.x - .2, .9, tb.z + .6) }); jake.root.visible = true;
    sitPose(nev, V(tb.x - .2, .45, tb.z + .65), V(0, 0, -1), { t, lean: .15, handL: V(tb.x - .05, .8, tb.z + .3), handR: V(tb.x - .35, .8, tb.z + .3), face: FACE.smug, look: jake.head.position.clone() }); nev.root.visible = true;
    phone2.g.position.set(tb.x + .5, .785, tb.z - .1); phone2.g.rotation.set(Math.PI / 2, 0, .3); drawUI(phone2, { mode: 'off' });
    look(V(tb.x + 1.6, 1.25, tb.z + .2), V(tb.x, .95, tb.z), 34); }],
  [19, 19, (t, k) => { LIGHT.school(); showSet('school'); const tb = school.tables[3];
    phoneCU(t, k, { mode: 'lock', bigTime: '12:41', time: '12:41', notifs: [{ ...N.jake, a: 1 - prog(k, .1, .5) }], empty: prog(k, .5, .8), dot: 1, battery: 100 }, { seat: V(tb.x - .2, .45, tb.z + .65), fwd: V(0, 0, -1) }); }],
  [20, 20, (t, k) => { LIGHT.school(); showSet('school'); const tb = school.tables[3]; phoneCU(t, k, { mode: 'battery', pct: 99, dot: 1, time: '12:41', battery: 99 }, { seat: V(tb.x - .2, .45, tb.z + .65), fwd: V(0, 0, -1) }); }],
  [21, 21, (t, k) => { LIGHT.night(); showSet('bedroom'); // concept: notifications drifting out of the phone
    phoneCU(t, k, { mode: 'lock', bigTime: '9:15', notifs: [N.teacher, N.weather, N.bank].map((n, i) => ({ ...n, a: clamp(1 - prog(k, .2 + i * .15, .5 + i * .15)) })), dot: 1 }, { d0: .42, d1: .36, wide: true }); }],
  [22, 22, (t, k) => { LIGHT.school(); showSet('school'); seatKids(t); const tb = school.tables[3];
    const info = nevHoldSit(t, V(tb.x - .2, .45, tb.z + .65), V(0, 0, -1), { face: FACE.smug, look: V(tb.x - .6, 1.05, tb.z - 1) });
    drawUI(phone, { mode: 'lock', notifs: [], empty: 1, dot: 1 }); faceCU(t, k, info, { d0: .9, d1: .75, side: -.12 }); }],
  // THE FUN
  [23, 23, (t, k) => { LIGHT.night(); showSet('bedroom'); bedroom.setClock('9:40'); nevHoldSit(t, BED.seat, BED.fwd, { face: FACE.happy, look: V(.4, 1.0, 1.4) }); drawUI(phone, { mode: 'lock', bigTime: '9:40', dot: 1, notifs: [] });
    look(V(lerp(.9, .7, k), 1.05, lerp(1.6, 1.3, k)), V(0, .9, 0), 34); }],
  [24, 24, (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, { mode: 'lock', bigTime: '9:41', dot: 1, notifs: [{ ...N.teacher, a: easeOut(prog(k, .05, .3)), tag: 'Sent tomorrow', tagCol: '#7ff3ff' }] }); }],
  [25, 25, (t, k) => { LIGHT.school(-14); showSet('school'); const cl = V(30, 0, -14); school.setGrade('A');
    sitPose(nev, cl.clone().add(V(-1.2, .45, .5)), V(0, 0, -1), { t, lean: .05, handL: cl.clone().add(V(-1.25, 1.3, .05)), handR: cl.clone().add(V(-1.05, 1.3, .05)), handModeL: 'grip', handModeR: 'grip', face: FACE.happy, look: V(30, 1.3, -11) });
    nev.root.visible = true; setWorld(school.paper, cl.clone().add(V(-1.15, 1.42, -.02))); school.paper.rotation.set(0, Math.PI, 0); school.paper.visible = true;
    standPose(teacher, cl.clone().add(V(-.35, 0, -.15)), V(-1, 0, .25), { face: { brow: -.9, mouth: 'flat' }, look: nev.head.position.clone(), handL: cl.clone().add(V(-.3, .95, .05)), handR: cl.clone().add(V(-.3, .95, -.3)) }); teacher.root.visible = true;
    if (k < .55) look(V(lerp(29.5, 29.4, k), 1.35, lerp(-15.2, -15.0, k)), V(29.0, 1.15, -13.7), 38); else look(teacher.head.position.clone().add(V(-.7, -.05, .4)), teacher.head.position.clone(), 30); }],
  [26, 26, (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, { mode: 'lock', bigTime: '8:02', dot: 1, notifs: [{ ...N.weather, a: easeOut(prog(k, .05, .3)), tag: 'Sent tomorrow', tagCol: '#7ff3ff' }] }); }],
  [27, 27, (t, k) => { LIGHT.rain(); showSet('street'); street.setRain(t); const base = V(lerp(57.5, 61.5, k), 0, -.8);
    const uh = base.clone().add(V(.12, 1.3, -.12)); const info = standPose(nev, base, V(1, 0, 0), { phase: t * 5, stride: .16, face: FACE.smug, handR: uh, look: V(66, 1.2, 2) }); nev.root.visible = true;
    setWorld(street.umb, uh.clone().add(V(0, .9, 0))); street.umb.visible = true;
    [[jake, -1.2, .4], [kids[0], -2.2, -.3], [kids[1], .9, .9]].forEach(([c, dx, dz], i) => { const b = V(lerp(64, 55, k) + dx, 0, -2.2 + dz * .5);
      standPose(c, b, V(-1, 0, 0), { phase: t * 8 + i, stride: .28, lean: .35, handL: b.clone().add(V(-.1, 1.55, .12)), handR: b.clone().add(V(-.1, 1.55, -.12)), handModeL: 'open', handModeR: 'open', face: { brow: 1, mouth: 'o' } }); c.root.visible = true; });
    if (k < .5) look(V(lerp(57, 59, k), 1.2, 4.2), V(lerp(58, 60, k), 1.1, -.8), 38); else look(nev.head.position.clone().add(V(1.1, -.05, .55)), nev.head.position.clone().add(V(0, .1, 0)), 32); }],
  [28, 28, (t, k) => { LIGHT.store(); showSet('store'); phoneCU(t, k, { mode: 'lock', bigTime: '5:20', dot: 1, notifs: [{ ...N.bank, a: easeOut(prog(k, .05, .3)), tag: 'Sent tomorrow', tagCol: '#7ff3ff' }] }, { seat: V(90, .45, 0), fwd: V(0, 0, 1) }); }],
  [29, 29, (t, k) => { LIGHT.store(); showSet('store'); const base = V(90.1, 0, -1.4), shelf = V(89.9, 1.03, -2.15);
    const reach = ease(k); const hr = V(lerp(90.15, shelf.x, reach), lerp(1.1, shelf.y, reach), lerp(-1.1, shelf.z + .1, reach));
    standPose(nev, base, V(0, 0, -1), { handR: hr, handL: hr.clone().add(V(-.18, 0, 0)), handModeR: 'grip', handModeL: 'grip', face: k > .6 ? FACE.happy : FACE.calm, look: shelf, lean: .1 }); nev.root.visible = true;
    setWorld(store.held, hr.clone().add(V(-.09, .02, -.03))); store.held.visible = true;
    if (k < .55) look(V(91.0, 1.35, -2.0), V(90.1, 1.15, -1.45), 40); else look(V(90.35, 1.2, -1.75), V(89.95, 1.05, -2.15), 34); }],
  [30, 30, (t, k) => { LIGHT.school(14); showSet('school'); const z = lerp(16.5, 11.5, k), base = V(30, 0, z);
    standPose(nev, base, V(0, 0, -1), { phase: t * 4.5, stride: .2, face: FACE.smug, look: V(30, 1.2, z - 3) }); nev.root.visible = true;
    [[kids[2], -1.1, 12.5], [kids[3], 1.1, 13.2], [jake, -1.1, 14.5]].forEach(([c, x, zz]) => { standPose(c, V(30 + x, 0, zz), V(-x, 0, .4), { face: { brow: -.2, mouth: 'smile' }, look: nev.head.position.clone() }); c.root.visible = true; });
    look(V(30.4, 1.35, z - 3.4), V(30, 1.1, z), 40); }],
  [31, 31, (t, k) => { LIGHT.night(); showSet('bedroom'); const n = 4 - Math.floor(k * 4.5);
    phoneCU(t, k, { mode: 'notif', time: '10:12', dot: 1, battery: 61, notifs: [N.teacher, N.weather, N.bank, N.jake].map((x, i) => ({ ...x, a: clamp((n - i) / 1) })) }, { d0: .34, d1: .3 }); }],
  // THE PRICE
  [32, 32, (t, k) => { LIGHT.school(14); showSet('school'); const base = V(30, 0, 12.2);
    nevHoldStand(t, base, V(0, 0, -1), { face: { brow: lerp(-.3, .7, k), mouth: 'flat' } }); drawUI(phone, { mode: 'lock', bigTime: '3:15', dot: 1, battery: 60 });
    look(V(30.75, 1.2, lerp(11.0, 11.2, k)), V(30, 1.2, 12.2), 36); }],
  [33, 33, (t, k) => { LIGHT.night(); showSet('bedroom'); // phone on the desk with the cable
    phone.g.position.set(1.6, .776, -1.45); phone.g.rotation.set(-Math.PI / 2, 0, .2); drawUI(phone, { mode: 'battery', pct: 60, plugged: true, battery: 60, dot: 1, light: .08, alert: k > .45 ? 1 : 0, t });
    look(V(1.6 + .02, lerp(1.15, 1.05, k), -1.45 + .12), V(1.6, .776, -1.45), 32); }],
  [34, 35, (t, k) => { LIGHT.night(); showSet('bedroom'); const drops = Math.floor(k * 6); const pct = 60 - drops;
    phoneCU(t, k, { mode: 'battery', pct, battery: pct, dot: 1, delta: '-1%', deltaA: 1 - ((k * 6) % 1), label: k > .5 ? 'every change = -1%' : '', alert: 1 - ((k * 6) % 1) > .7 ? 1 : 0 }, { shake: 1 - ((k * 6) % 1) > .8 ? .002 : 0 }); }],
  [36, 36, (t, k) => { LIGHT.night(); showSet('bedroom'); const info = nevHoldSit(t, BED.seat, BED.fwd, { face: FACE.determined, look: V(-.3, 1.1, 1.5) }); drawUI(phone, { mode: 'settings', scroll: 330 });
    faceCU(t, k, info, { d0: .95, d1: .8, side: -.15 }); }],
  [37, 37, (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, { mode: 'settings', scroll: 430, gone: true, battery: 54, dot: 1 }); }],
  [38, 38, (t, k) => { LIGHT.night(); showSet('bedroom'); const part = Math.floor(k * 3);
    if (part < 2) phoneCU(t, (k * 3) % 1, { mode: 'restart', label: part ? 'Erasing all content...' : 'Restarting...' }, { d0: .34, d1: .3 });
    else { const info = nevHoldSit(t, BED.seat, BED.fwd, { face: FACE.determined }); drawUI(phone, { mode: 'off' }); phone2.g.position.set(.9, .56, -.3); phone2.g.rotation.set(-Math.PI / 2, 0, .5); drawUI(phone2, { mode: 'off' });
      look(V(1.3, 1.3, 1.5), V(.3, .7, -.2), 36); } }],
  [39, 39, (t, k) => { LIGHT.night(); showSet('bedroom'); const pr = ease(prog(k, 0, .4));
    phoneCU(t, k, { mode: 'lock', bigTime: '11:02', notifs: [], dot: prog(k, .4, .6), dotScale: 1 + 1.5 * Math.max(0, 1 - Math.abs(k - .5) * 6), battery: 52 },
      { pointLocal: V(.09, -.12, .05).lerp(V(.012, .055, .01), pr * (1 - prog(k, .6, .9))), d0: .3, d1: .22, aimOff: V(0, .02, 0) }); }],
  [40, 40, (t, k) => { LIGHT.night(); showSet('bedroom'); const n = Math.floor(k * 9);
    phoneCU(t, k, { mode: 'notif', time: '11:30', dot: 1, battery: 40 - n * 2, notifs: [N.bank, N.weather, N.teacher, N.jake].map((x, i) => ({ ...x, tag: 'Sent tomorrow', a: clamp((n - i) % 4 + 1 - (k * 9) % 1) })) },
      { pointLocal: V(-.005 + Math.sin(t * 9) * .01, -.01 + Math.cos(t * 7) * .02, .008) }); }],
  [41, 42, (t, k) => { LIGHT.dark(); showSet('bedroom'); const steps = [20, 10, 5, 3], i = Math.min(3, Math.floor(k * 4.3)); const kk = (k * 4.3) % 1; phoneCU(t, k, { mode: 'battery', pct: steps[i], battery: steps[i], dot: 1, light: .03, alert: kk < .35 ? 1 : 0, t }, { d0: .3, d1: .25, shake: kk < .2 ? .003 : 0 }); }],
  [43, 43, (t, k) => { LIGHT.dark(); showSet('bedroom'); const info = nevHoldSit(t, BED.seat, BED.fwd, { face: FACE.worried, look: V(.2, .95, .9) }); drawUI(phone, { mode: 'lock', notifs: [], battery: 3, dot: 1, light: .12 });
    look(V(lerp(1.1, .9, k), .95, lerp(1.5, 1.25, k)), V(0, .95, 0), 32); }],
  [44, 47, (t, k) => { LIGHT.dark(); showSet('bedroom'); const at = i => easeOut(prog(t, ps(i) + .1, ps(i) + .5));
    phoneCU(t, k, { mode: 'notif', time: '3:12', battery: 3, dot: 1, notifs: [{ ...N.you1, a: at(45) }, { ...N.you2, a: at(46) }, { ...N.you3, a: at(47) }], empty: 1 - at(45), light: .03 }, { d0: .34, d1: .27 }); }],
  [48, 48, (t, k) => { LIGHT.night(); showSet('bedroom'); const put = ease(k);
    const info = sitPose(nev, BED.seat, BED.fwd, { t, lean: lerp(.32, .05, put), handL: V(.2, .6, .2), handR: V(lerp(.0, -.55, put), lerp(.78, .58, put), lerp(.3, -.45, put)), face: { brow: .3, mouth: 'flat', blink: put > .7 ? .8 : 0 }, look: V(0, 1.3, 1.5) });
    nev.root.visible = true; phone.g.position.copy(nev.arms[1].hand.position).add(V(0, -.02, 0)); phone.g.rotation.set(Math.PI / 2, 0, .3); drawUI(phone, { mode: 'off' });
    look(V(1.2, 1.1, 1.6), V(-.1, .75, -.1), 36); }],
  [49, 49, (t, k) => { const part = Math.min(2, Math.floor(k * 3)), kk = (k * 3) % 1;
    if (part === 0) { LIGHT.school(); showSet('school'); seatKids(t); const base = V(30.3, 0, 2.4);
      poseChar(nev, { hip: base.clone().add(V(0, lerp(.8, .5, kk), lerp(0, .2, kk))), fwd: V(0, 0, -1), lean: lerp(0, -.9, ease(kk)), footL: base.clone().add(V(-.1, .1 + kk * .5, -.4 * kk)), footR: base.clone().add(V(.1, .1, .1)), handL: base.clone().add(V(-.5, 1.4, .2)), handR: base.clone().add(V(.5, 1.4, .2)), handModeL: 'open', handModeR: 'open', face: FACE.scared, look: V(30.3, 3, 2) });
      nev.root.visible = true; setWorld(school.tray, V(30.4, 1.2 + kk * .8, 2.0 - kk * .3)); school.tray.rotation.set(kk * 6, 0, kk * 3); look(V(32.3, 1.1, 3.6), V(30.3, .9, 2.3), 36); }
    else if (part === 1) { LIGHT.school(-14); showSet('school'); const cl = V(30, 0, -14); school.setGrade('F'); school.paper.visible = true;
      sitPose(nev, cl.clone().add(V(-1.2, .45, .5)), V(0, 0, -1), { t, lean: .1, handL: cl.clone().add(V(-1.25, 1.25, .05)), handR: cl.clone().add(V(-1.05, 1.25, .05)), face: { brow: .8, mouth: 'frown' }, look: cl.clone().add(V(-1.15, 1.3, -.2)) }); nev.root.visible = true;
      setWorld(school.paper, cl.clone().add(V(-1.15, 1.36, -.02))); school.paper.rotation.set(0, Math.PI, 0); look(V(29.3, 1.35, -14.9), V(28.85, 1.2, -13.6), 36); }
    else { LIGHT.rain(); showSet('street'); street.setRain(t); const base = V(60 + kk * .6, 0, -.8);
      standPose(nev, base, V(1, 0, 0), { phase: t * 3, stride: .08, lean: .2, face: { brow: .9, mouth: 'frown', blink: .4 }, look: V(62, .6, -.8) }); nev.root.visible = true;
      look(V(61.4, 1.3, 1.2), V(60.2, 1.1, -.8), 34); } }],
  [50, 50, (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, { mode: 'battery', pct: 3, battery: 3, dot: 1, label: 'Holding...' }, { d0: .3, d1: .27 }); }],
  // THE TWIST
  [51, 51, (t, k) => { LIGHT.dark(); showSet('bedroom'); bedroom.setClock('3:33');
    poseChar(nev, { hip: V(.55, .62, -.9), fwd: V(0, 0, -1), lean: -Math.PI / 2 + .1, footL: V(.48, .6, 0), footR: V(.65, .6, 0), handL: V(.75, .62, -1.1), handR: V(.35, .62, -1.1), face: { brow: .2, mouth: 'flat', blink: k < .6 ? 1 : 0 }, look: V(.55, 2, -1.6), hide: { legs: true } });
    nev.root.visible = true; phone.g.position.set(-0.75, .535, -0.55); phone.g.rotation.set(-Math.PI / 2, 0, .4); drawUI(phone, { mode: 'lock', bigTime: '3:33', notifs: [{ ...N.mom, a: easeOut(prog(k, .3, .6)) }], battery: 3, dot: 1, light: .4 * easeOut(prog(k, .3, .5)) });
    look(V(lerp(.4, .2, k), lerp(1.3, 1.1, k), .6), V(-.5, .55, -.6), 36); }],
  [52, 53, (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, { mode: 'lock', bigTime: '3:33', battery: 3, dot: 1, notifs: [{ ...N.mom, a: easeOut(prog(k, 0, .2)) }], light: .05 }, { d0: .3, d1: .24 }); }],
  [54, 54, (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, { mode: 'lock', bigTime: '3:33', battery: 3, dot: 1, notifs: [N.mom], shake: true }, { d0: .26, d1: .24, shake: .003 }); }],
  [55, 55, (t, k) => { LIGHT.dark(); showSet('bedroom'); const info = nevHoldSit(t, BED.seat, BED.fwd, { face: { ...FACE.scared, glow: .35 * easeOut(prog(k, .3, .8)) }, look: V(0, 1.15, 1.5) }); drawUI(phone, { mode: 'lock', notifs: [N.mom], battery: 3, dot: 1, light: .1 });
    faceCU(t, k, info, { d0: .95, d1: .7 }); }],
  [56, 56, (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, { mode: 'battery', pct: 3, battery: 3, dot: 1, label: 'Mom · 8:14 AM' }, { d0: .3, d1: .26 }); }],
  [57, 57, (t, k) => { LIGHT.houseDay(); showSet('house'); const take = ease(prog(k, .3, .8));
    const base = V(119.75, 0, -1.65), bowl = V(119.6, .92, -2.2);
    const hr = V(lerp(119.9, bowl.x, take < .5 ? take * 2 : 1 - (take - .5) * 2 + .0), lerp(1.0, bowl.y, take < .5 ? take * 2 : 2 - take * 2), lerp(-1.5, bowl.z, take < .5 ? take * 2 : 2 - take * 2));
    standPose(nev, base, V(-.3, 0, -1), { handR: hr, handModeR: 'grip', face: { brow: .5, mouth: 'flat' }, look: bowl, lean: .15 }); nev.root.visible = true;
    setWorld(house.keys, take > .5 ? nev.arms[1].hand.position.clone().add(V(0, -.03, 0)) : V(119.6, .93, -2.2));
    standPose(mom, V(121.6, 0, -1.6), V(-.2, 0, -1), { handL: V(121.5, 1.0, -2.0), handR: V(121.75, 1.0, -2.0), face: withBlink({ brow: .4, mouth: 'flat' }, t), look: V(121.6, .9, -2.4) }); mom.root.visible = true;
    look(V(120.8, 1.5, 1.4), V(120.5, 1.0, -1.8), 40); }],
  [58, 58, (t, k) => { LIGHT.houseDay(); showSet('house'); const base = V(120.9, 0, -1.2);
    standPose(mom, base, V(-1, 0, .3), { handL: base.clone().add(V(-.05, .95, .2)), handR: base.clone().add(V(.05, .95, -.2)), handModeL: 'fist', handModeR: 'fist', face: { brow: -.9, mouth: Math.sin(t * 9) > 0 ? 'yell' : 'frown' }, look: V(119.8, 1.3, -.9), elbowPole: (s, sh) => sh.clone().add(V(0, -.2, s * .5)) }); mom.root.visible = true;
    standPose(nev, V(119.8, 0, -.9), V(1, 0, -.3), { face: { brow: .8, mouth: 'wavy' }, look: mom.head.position.clone(), handL: V(119.85, .85, -.65), handR: V(119.85, .85, -1.15) }); nev.root.visible = true;
    look(V(120.3, 1.35, 1.6), V(120.35, 1.05, -1.05), 36); }],
  [59, 59, (t, k) => { LIGHT.highway(); showSet('highway'); highway.bus.position.z = 6 + k * 3; highway.car.position.z = 14 + k * 3;
    look(V(lerp(236, 228, k), lerp(55, 48, k), lerp(70, 60, k)), V(lerp(218, 214, k), 0, -10), 40); }],
  [60, 60, (t, k) => { LIGHT.houseDay(); showSet('house'); phoneCU(t, k, { mode: 'battery', pct: 1, battery: 1, dot: 1, label: 'It cost you two.', alert: Math.sin(t * 5) > 0 ? 1 : 0, t }, { seat: V(120.5, .45, 0), fwd: V(0, 0, 1) }); }],
  [61, 61, (t, k) => { LIGHT.houseNight(); showSet('house'); const c = V(121.2, 0, -1.0);
    standPose(nev, c.clone().add(V(.18, 0, 0)), V(-1, 0, 0), { handL: c.clone().add(V(-.05, 1.05, .2)), handR: c.clone().add(V(-.05, 1.05, -.2)), face: { brow: .2, mouth: 'smile', blink: .9 }, look: c.clone().add(V(-1, 1.3, 0)), lean: .1 }); nev.root.visible = true;
    standPose(mom, c.clone().add(V(-.18, 0, 0)), V(1, 0, 0), { handL: c.clone().add(V(.2, 1.15, -.18)), handR: c.clone().add(V(.2, 1.15, .18)), face: { brow: .3, mouth: 'smile', blink: 1 }, look: c.clone().add(V(1, 1.2, 0)), lean: .12 }); mom.root.visible = true;
    look(V(lerp(122.6, 122.3, k), 1.45, lerp(.6, .3, k)), V(121.2, 1.2, -1), 34); }],
  // THE END
  [62, 62, (t, k) => { LIGHT.dark(); showSet('bedroom'); const on = easeOut(prog(k, .2, .45));
    poseChar(nev, { hip: V(.55, .62, -.9), fwd: V(0, 0, -1), lean: -Math.PI / 2 + .1, footL: V(.48, .6, 0), footR: V(.65, .6, 0), handL: V(.75, .62, -1.1), handR: V(.35, .62, -1.1), face: { brow: .2, mouth: 'flat', blink: k < .5 ? 1 : 0 }, look: V(.55, 2, -1.6), hide: { legs: true } });
    nev.root.visible = true; phone.g.position.set(-0.75, .535, -0.55); phone.g.rotation.set(-Math.PI / 2, 0, .4); drawUI(phone, { mode: 'popup', battery: 1, dot: 1, light: 1.2 * on }); bloom.strength = .35 + .5 * on;
    look(V(lerp(.9, .5, k), 1.3, lerp(1.2, .8, k)), V(-.5, .55, -.6), 36); }],
  [63, 63, (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, { mode: 'popup', battery: 1, dot: 1, light: .1 }, { d0: .3, d1: .25 }); }],
  [64, 64, (t, k) => { LIGHT.dark(); showSet('bedroom'); phoneCU(t, k, { mode: 'popup', battery: 1, dot: 1, under: N.youLast, underA: easeOut(prog(k, .3, .6)) }, { d0: .3, d1: .27, aimOff: V(0, -.02, 0) }); }],
  [65, 65, (t, k) => { LIGHT.dark(); showSet('bedroom'); const g = easeOut(prog(k, .2, .6));
    const info = nevHoldSit(t, BED.seat, BED.fwd, { face: { brow: 1, mouth: 'o', glow: g, wide: true }, look: V(0, 1.15, 1.5) }); drawUI(phone, { mode: 'popup', light: .1 }); bloom.strength = .35 + .25 * g;
    faceCU(t, k, info, { d0: .75, d1: .5 }); }],
];
function seatKids(t) {
  const tb = school.tables; const spots = [[tb[0], -.5, 1], [tb[0], .4, -1], [tb[1], -.3, -1], [tb[2], .5, 1], [tb[2], -.6, -1]];
  kids.forEach((c, i) => { const [p, dx, side] = spots[i]; const seat = V(p.x + dx, .45, p.z + side * .65), f = V(0, 0, -side);
    sitPose(c, seat, f, { t: t + i, lean: .15, handL: seat.clone().add(V(-.12, .37, -side * .3)), handR: seat.clone().add(V(.12, .37 + Math.max(0, Math.sin(t * 2 + i)) * .1, -side * .3)), face: withBlink({ brow: 0, mouth: i % 2 ? 'smile' : 'flat' }, t + i), look: V(p.x + dx + Math.sin(t * .7 + i) * .5, 1.0, p.z) }); c.root.visible = true; });
}

// shot windows
const WINDOWS = SHOTS.map(([a, b, fn], i) => ({ start: i === 0 ? 0 : TIMING[a].start - .15, fn, a, b }));
WINDOWS.forEach((w, i) => { w.end = i + 1 < WINDOWS.length ? WINDOWS[i + 1].start : DURATION; });

// ---------- overlay: vignette, grain, cuts ----------
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
function overlay(t) {
  og.drawImage(renderer.domElement, 0, 0);
  const v = og.createRadialGradient(W / 2, H / 2, H * .42, W / 2, H / 2, H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
  const r = rng(Math.floor(t * 30) + 3); og.fillStyle = 'rgba(255,255,255,.025)'; for (let i = 0; i < 700; i++) og.fillRect(r() * W, r() * H, 2, 2);
  for (const w of WINDOWS) { const d = Math.abs(t - w.start); if (d < .07 && w.start > 0) { og.fillStyle = `rgba(0,0,0,${.85 * (1 - d / .07)})`; og.fillRect(0, 0, W, H); } }
  if (t < .3) { og.fillStyle = `rgba(0,0,0,${1 - t / .3})`; og.fillRect(0, 0, W, H); }
  // black beat after "don't install it."
  const b0 = TIMING[65].end + .15;
  if (t > b0) { og.fillStyle = '#000'; og.fillRect(0, 0, W, H);
    const a = Math.min(easeOut(prog(t, b0 + .5, b0 + 1.1)), 1 - prog(t, DURATION - .9, DURATION - .2));
    og.save(); og.globalAlpha = a; og.textAlign = 'center'; og.textBaseline = 'middle'; og.font = '800 46px Inter'; og.fillStyle = '#00e5ff'; og.shadowColor = '#00e5ff'; og.shadowBlur = 25;
    og.fillText('B R E V A N E', W / 2, H / 2 - 20); og.shadowBlur = 0; og.font = '500 30px Inter'; og.fillStyle = '#9fb0c8'; og.fillText('Impossible ideas. Real consequences.', W / 2, H / 2 + 40); og.restore(); }
  if (t > DURATION - .8) { og.fillStyle = `rgba(0,0,0,${prog(t, DURATION - .8, DURATION)})`; og.fillRect(0, 0, W, H); }
  if (window.SHORT_TITLE) { og.save(); og.textAlign = 'center'; og.textBaseline = 'middle'; let fs = 92; og.font = `900 ${fs}px Inter`; while (og.measureText(window.SHORT_TITLE).width > W - 90 && fs > 40) { fs -= 4; og.font = `900 ${fs}px Inter`; } og.lineJoin = 'round';
    og.lineWidth = 16; og.strokeStyle = '#05070d'; og.strokeText(window.SHORT_TITLE, W / 2, 230); og.fillStyle = '#ffffff'; og.shadowColor = 'rgba(0,229,255,.7)'; og.shadowBlur = 25; og.fillText(window.SHORT_TITLE, W / 2, 230); og.restore(); }
  return out;
}

window.frame = (t, q = .92) => {
  for (const c of CAST) c.root.visible = false;
  phone.g.visible = phone2.g.visible = false; school.paper.visible = false; street.umb.visible = false; store.held.visible = false;
  school.tray.position.set(0, -5, 0); bloom.strength = .35;
  setWorld(house.keys, V(119.6, .93, -2.2));
  const w = WINDOWS.find(w => t >= w.start && t < w.end) || WINDOWS[WINDOWS.length - 1];
  w.fn(t, clamp((t - w.start) / (w.end - w.start)));
  composer.render();
  return overlay(t).toDataURL('image/jpeg', q);
};
window.DUR = DURATION; window.ready = true;
window.TIMING = TIMING;
window.endCard = (text, a) => { og.fillStyle = '#05070d'; og.fillRect(0, 0, W, H); og.save(); og.globalAlpha = a; og.textAlign = 'center'; og.textBaseline = 'middle';
  og.font = '900 80px Inter'; og.fillStyle = '#fff'; og.fillText('FULL STORY', W / 2, H / 2 - 80); og.fillStyle = '#00e5ff'; og.shadowColor = '#00e5ff'; og.shadowBlur = 30; og.fillText('ON THE CHANNEL', W / 2, H / 2 + 20);
  og.shadowBlur = 0; og.font = '700 44px Inter'; og.fillStyle = '#9fb0c8'; og.fillText('B R E V A N E', W / 2, H / 2 + 150); og.restore(); return out.toDataURL('image/jpeg', .92); };

// ---------- thumbnails ----------
window.thumb = (variant = 'A') => {
  for (const c of CAST) c.root.visible = false; phone.g.visible = phone2.g.visible = false; school.paper.visible = false; street.umb.visible = false; store.held.visible = false;
  LIGHT.night(); showSet('bedroom'); bedroom.lamp.intensity = 1.2;
  const glow = variant === 'B' ? 0 : 1;
  const info = nevHoldSit(2, BED.seat, BED.fwd, { face: variant === 'B' ? { brow: 1, mouth: 'o', wide: true } : { brow: -.7, mouth: 'smirk', glow }, look: V(.25, 1.05, 2) });
  // present the phone to the camera, bigger than life (thumbnail exaggeration)
  phone.g.scale.setScalar(2.2); phone.g.position.copy(info.neck).add(V(-.3, -.2, .45)); phone.g.lookAt(V(-.42, 1.0, 1.45)); phone.g.rotateZ(.08); phone.g.updateMatrixWorld(true);
  drawUI(phone, variant === 'C' ? { mode: 'battery', pct: 1, battery: 1, dot: 1, light: .4 } : { mode: 'bigtoggle', light: .5 });
  const hL = phone.g.localToWorld(V(-.042, -.06, -.01)), hR = phone.g.localToWorld(V(.042, -.06, -.01));
  sitPose(nev, BED.seat, BED.fwd, { t: 2, lean: .2, handL: hL, handR: hR, handTargetL: phone.g.position, handTargetR: phone.g.position, face: variant === 'B' ? { brow: 1, mouth: 'o', wide: true } : { brow: -.7, mouth: 'smirk', glow }, look: V(.25, 1.05, 2) });
  nev.root.visible = true; bloom.strength = .5;
  look(V(-.42, 1.02, 1.45), V(-.42, .98, 0), 36);
  composer.render();
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d');
  g.drawImage(renderer.domElement, 0, 0, 1280, 720);
  const v = g.createRadialGradient(640, 360, 250, 640, 360, 760); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = v; g.fillRect(0, 0, 1280, 720);
  const lines = variant === 'A' ? [["IT'S", '#ffffff'], ['ON.', '#00e5ff']] : variant === 'B' ? [['3:33', '#ffffff'], ['AM', '#00e5ff']] : [['1%', '#ff4d4d'], ['LEFT', '#ffffff']];
  g.font = '900 150px Inter'; g.textBaseline = 'top'; g.lineJoin = 'round';
  lines.forEach(([txt, col], i) => { const y = 40 + i * 150; g.lineWidth = 18; g.strokeStyle = '#05070d'; g.strokeText(txt, 48, y); g.shadowColor = col === '#ffffff' ? 'rgba(0,0,0,.6)' : col; g.shadowBlur = 25; g.fillStyle = col; g.fillText(txt, 48, y); g.shadowBlur = 0; });
  phone.g.scale.setScalar(1);
  return c.toDataURL('image/jpeg', .92);
};
