// Brevane #03 — "What If Your Snooze Button Could Freeze Time?"  (no burned-in subtitles)
import { THREE, W, H, clamp, lerp, ease, easeOut, prog, V, rng, renderer, scene, camera, composer, bloom, look, lightRig,
  makeChar, poseChar, standPose, sitPose, makePhone, placePhone } from './core.js';
import { bedroom, school, street, house, highway, showSet as showSet0 } from './sets.js';
import { town, gym, makeExtra } from './sets2.js';

window.__scene = scene; window.__THREE = THREE;
const TL = await (await fetch('/timing.json')).json();
const P = {}; TL.forEach((l, i) => P[l.id] = i);
const ps = i => TL[P[i]].start, pe = i => TL[P[i]].end;
const END0 = TL[TL.length - 1].end + .7, ENDCARD = 13, DURATION = END0 + ENDCARD;

const RECOLOR = { '46578a': '9d8cc9', '3a4466': 'c9b6a4', '2a3558': '7f6fae', '3c5aa0': '5fc7b4', '5a4a6a': 'c98f6a', '9cc7b4': '8fd1c2' };
scene.traverse(o => { if (o.material && o.material.color) { const h = o.material.color.getHexString(); if (RECOLOR[h]) o.material.color.set('#' + RECOLOR[h]); } });
const std = (c, r = .7, x = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...x });
const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
const bx = (parent, w, h, d, mat, x, y, z) => add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const grp = (x = 0, y = 0, z = 0, parent = scene) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const ctex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const g = c.getContext('2d'); const f = (...a) => { draw(g, w, h, ...a); t.needsUpdate = true; }; f(); return { t, f }; };

// ---------- extra sets ----------
// library (x=540)
const library = (() => { const g = grp(540); const fl = add(g, new THREE.PlaneGeometry(14, 14), std('#c9a27a', .8)); fl.rotation.x = -Math.PI / 2;
  add(g, new THREE.PlaneGeometry(14, 6), std('#e9dcc4', .9), 0, 3, -3); const r = rng(31); const cols = ['#e4572e', '#2f6fd6', '#f2b33d', '#3fae6a', '#9b5de5', '#e46b9a', '#4aa3a3', '#c98f6a'];
  for (const sx of [-3.2, 0, 3.2]) { bx(g, 2.8, 2.6, .45, std('#7a5236', .7), sx, 1.3, -2.7); for (let row = 0; row < 5; row++) { let x = sx - 1.25; while (x < sx + 1.2) { const w = .06 + r() * .06, h = .3 + r() * .12; bx(g, w, h, .3, std(cols[Math.floor(r() * 8)], .7), x + w / 2, .2 + row * .5 + h / 2, -2.42); x += w + .01; } } }
  bx(g, 2.4, .06, 1.1, std('#8a5a3a', .6), 0, .76, -.3); for (const dx of [-1.1, 1.1]) bx(g, .06, .74, 1, std('#6a4a3a'), dx, .37, -.3);
  const pile = []; for (let i = 0; i < 22; i++) pile.push(bx(g, .32, .06, .24, std(cols[i % 8], .7), .6 + (i % 2) * .02, .82 + i * .062, -.3)); return { g, pile };
})();
// house: stairs along the side wall + height marks on the door
const stairs = grp(117.6, 0, 0, house.g.parent); { for (let i = 0; i < 9; i++) bx(stairs, 1.1, .2 * (i + 1), .3, std('#b88a64', .7), 0, .1 * (i + 1), 1.3 - i * .3); }
bedroom.g.traverse(o => { if (o.geometry && o.geometry.type === 'BoxGeometry' && Math.abs(o.geometry.parameters.width - .26) < .001 && Math.abs(o.geometry.parameters.height - .1) < .001) o.visible = false; });
house.g.add(stairs); stairs.position.set(-2.4, 0, 0);
const marks = ctex(256, 540, (g, w, h, today) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#3a2a22'; g.fillStyle = '#3a2a22'; g.lineWidth = 5; g.font = '700 26px Inter';
  [[430, 'AGE 8'], [350, 'AGE 10'], [270, 'AGE 12'], [205, 'SEPT']].forEach(([y, s]) => { g.beginPath(); g.moveTo(30, y); g.lineTo(150, y); g.stroke(); g.fillText(s, 158, y + 9); });
  if (today) { g.strokeStyle = '#e23b3b'; g.fillStyle = '#e23b3b'; g.lineWidth = 7; g.beginPath(); g.moveTo(30, 160); g.lineTo(150, 160); g.stroke(); g.font = '900 28px Inter'; g.fillText('NOW', 158, 169);
    g.lineWidth = 3; g.beginPath(); g.moveTo(90, 200); g.lineTo(90, 166); g.stroke(); g.font = '700 22px Inter'; g.fillText('+2"', 98, 190); } });
const markPlane = add(house.g, new THREE.PlaneGeometry(.5, 1.05), new THREE.MeshBasicMaterial({ map: marks.t, transparent: true }), -1.6, 1.25, -2.40);
// gym: basketball hoop, hide talent-show banner
gym.g.traverse(o => { if (o.geometry && o.geometry.type === 'PlaneGeometry' && Math.abs(o.geometry.parameters.width - 6) < .01) o.visible = false; });
const hoop = grp(0, 0, -3.2, gym.g); { bx(hoop, 1.8, 1.1, .06, std('#ffffff', .4), 0, 3.5, 0); bx(hoop, .6, .45, .07, std('#e23b3b', .5), 0, 3.3, .01); const rim = add(hoop, new THREE.TorusGeometry(.23, .02, 8, 24), std('#ff6a1a', .4), 0, 3.05, .3); rim.rotation.x = Math.PI / 2; bx(hoop, .1, 3.2, .1, std('#7a8599'), 0, 1.6, -.4); }
const ball = add(scene, new THREE.SphereGeometry(.12, 24, 16), std('#ff7a2a', .6));
// alarm clock on the nightstand
const clock = (() => { const g = grp(-0.72, .53, -0.66); g.rotation.y = .45; bx(g, .36, .17, .14, std('#f4f1ea', .4), 0, .085, 0); const btn = bx(g, .2, .035, .07, std('#ff7a2a', .5), 0, .185, 0);
  const face = ctex(512, 160, (c, w, h, s = '6:59', col = '#ff4d4d', on = 1) => { c.fillStyle = '#05070d'; c.fillRect(0, 0, w, h); if (!on) return; c.font = s.length > 5 ? '800 84px Inter' : '700 130px "JetBrains Mono"'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 20; c.fillText(s, w / 2, h / 2 + 6); });
  add(g, new THREE.PlaneGeometry(.31, .1), new THREE.MeshBasicMaterial({ map: face.t, toneMapped: false }), 0, .085, .0705);
  const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, .05, -.07), V(-.1, -.1, -.15), V(-.3, -.4, -.1), V(-.6, -.5, .05), V(-1.1, -.3, .1)]), 40, .008, 6), std('#222', .6)); g.add(cord);
  const plug = bx(scene, .06, .04, .08, std('#e8e8e8', .5), 0, 0, 0); const outlet = add(scene, new THREE.PlaneGeometry(.12, .16), std('#f4f1ea', .5), -2.19, .3, -.42); outlet.rotation.y = Math.PI / 2;
  return { g, btn, face, cord, plug, top: () => btn.getWorldPosition(V(0, 0, 0)), front: () => g.localToWorld(V(0, .085, .07)), set(s, col, on, press = 0, shake = 0, plugged = 1) { face.f(s, col, on); btn.position.y = .185 - .02 * press; g.position.set(-0.72 + shake * .006, .53, -0.66); g.rotation.z = shake * .05;
      plug.visible = true; plug.position.set(lerp(-1.6, -2.16, plugged), lerp(.02, .3, plugged), lerp(-.35, -.42, plugged)); plug.rotation.set(0, 0, lerp(.6, 0, plugged)); cord.visible = true; } };
})();
// juice: pitcher, glass, frozen stream
const juice = (() => { const g = grp(0, 0, 0); const glassM = std('#dff2ff', .05, { transparent: true, opacity: .45 }), oj = std('#ffa424', .3, { emissive: '#ff8a00', emissiveIntensity: .25 });
  const pitcher = grp(0, 0, 0, g); add(pitcher, new THREE.CylinderGeometry(.07, .08, .2, 20), glassM); add(pitcher, new THREE.CylinderGeometry(.066, .076, .14, 20), oj, 0, -.025, 0);
  const glass = grp(0, 0, 0, g); add(glass, new THREE.CylinderGeometry(.045, .038, .12, 18), glassM); const fill = add(glass, new THREE.CylinderGeometry(.04, .035, .06, 18), oj, 0, -.025, 0);
  const stream = add(g, new THREE.CylinderGeometry(.012, .018, 1, 10), oj); const drops = []; const r = rng(7); for (let i = 0; i < 18; i++) { const d = add(g, new THREE.SphereGeometry(.008 + r() * .012, 10, 8), oj); d.userData.o = V((r() - .5) * .22, (r() - .5) * .3, (r() - .5) * .22); drops.push(d); }
  const puddle = add(g, new THREE.CircleGeometry(.35, 32), oj); puddle.rotation.x = -Math.PI / 2; return { g, pitcher, glass, stream, drops, puddle,
    set(pp, gp, fall = 0) { g.visible = true; pitcher.position.copy(pp); pitcher.rotation.set(0, 0, -1.1); glass.position.copy(gp); const a = pp.clone().add(V(.09, .06, 0)), b = gp.clone().add(V(0, .05, 0));
      const top = a.clone().lerp(b, 0), bot = a.clone().lerp(b, 1); const drop = fall * fall * 2.2; top.y -= drop; bot.y -= drop * 1.05;
      const mid = top.clone().add(bot).multiplyScalar(.5); stream.position.copy(mid); stream.scale.set(1, top.distanceTo(bot), 1); stream.lookAt(bot); stream.rotateX(Math.PI / 2); stream.visible = bot.y > .02;
      drops.forEach(d => { d.position.copy(mid).add(d.userData.o); d.position.y = Math.max(.01, d.position.y - drop * 1.2); d.visible = fall < .9; });
      puddle.visible = fall > .3; puddle.position.set(gp.x + .1, .006, gp.z + .05); puddle.scale.setScalar(clamp((fall - .3) * 1.6, .05, 1)); } };
})();
// birds
function makeBird(col) { const g = grp(); const m = std(col, .6); add(g, new THREE.SphereGeometry(.09, 16, 12), m).scale.set(1, .8, 1.4); add(g, new THREE.SphereGeometry(.06, 14, 10), m, 0, .07, .11);
  const bk = add(g, new THREE.ConeGeometry(.018, .05, 8), std('#f2a33d'), 0, .065, .18); bk.rotation.x = Math.PI / 2; for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(.012, 8, 6), std('#111'), s * .035, .085, .155);
  const wings = [-1, 1].map(s => { const w = grp(s * .07, .03, 0, g); add(w, new THREE.SphereGeometry(.1, 12, 8), m, s * .1, 0, 0).scale.set(1, .15, .55); return w; });
  return { g, set(p, flap, ry = 0) { g.visible = true; g.position.copy(p); g.rotation.y = ry; wings.forEach((w, i) => w.rotation.z = (i ? -1 : 1) * flap); } }; }
const birds = [makeBird('#8a93a6'), makeBird('#8a93a6'), makeBird('#d9a35a')];
// misc props
const cup = (() => { const g = grp(); add(g, new THREE.CylinderGeometry(.045, .035, .12, 16), std('#ffffff', .5)); bx(g, .095, .03, .095, std('#6a3a22'), 0, .045, 0); const sp = []; for (let i = 0; i < 10; i++) { const d = add(g, new THREE.SphereGeometry(.012 + i * .002, 8, 6), std('#6a3a22', .3), Math.sin(i) * .04, .1 + i * .035, Math.cos(i * 1.7) * .04); sp.push(d); } return { g }; })();
const busSign = (() => { const g = grp(223.4, 0, 12.4); add(g, new THREE.CylinderGeometry(.03, .03, 2.4, 8), std('#9aa4b8'), 0, 1.2, 0); add(g, new THREE.PlaneGeometry(.5, .5), new THREE.MeshBasicMaterial({ map: ctex(256, 256, (c, w, h) => { c.fillStyle = '#2f6fd6'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '900 64px Inter'; c.textAlign = 'center'; c.fillText('BUS', 128, 110); c.font = '700 40px Inter'; c.fillText('STOP', 128, 170); }).t }), 0, 2.2, .04); return g; })();
const fries = []; school.tables.forEach(tb => { for (let i = 0; i < 3; i++) { const fg = grp(tb.x - .7 + i * .7 - 30, .8, tb.z - .2, school.g); for (let j = 0; j < 6; j++) { const f = bx(fg, .015, .015, .09, std('#ffd25a', .5), (j - 2.5) * .02, .02, 0); f.rotation.y = j * .5; } fries.push(fg); } });
const trays = grp(0, 0, 0, school.g); for (let i = 0; i < 9; i++) bx(trays, .4, .03, .3, std(['#e46b5a', '#5aa0e4', '#f2b33d'][i % 3], .6), (i % 2) * .02, i * .035, 0);
const cart = (() => { const g = grp(302.5, 0, .2); bx(g, 1.4, .9, .7, std('#e9e4d6', .6), 0, .65, 0); for (const s of [-1, 1]) { const wh = add(g, new THREE.CylinderGeometry(.18, .18, .06, 16), std('#333'), s * .5, .18, .38); wh.rotation.x = Math.PI / 2; }
  add(g, new THREE.CylinderGeometry(.03, .03, 1.4, 8), std('#888'), 0, 1.6, 0); add(g, new THREE.ConeGeometry(1, .35, 8, 1, true), std('#e23b3b', .6, { side: THREE.DoubleSide }), 0, 2.4, 0);
  add(g, new THREE.PlaneGeometry(1.2, .3), new THREE.MeshBasicMaterial({ map: ctex(512, 128, (c, w, h) => { c.fillStyle = '#ffd34d'; c.fillRect(0, 0, w, h); c.fillStyle = '#c8261c'; c.font = '900 80px Inter'; c.textAlign = 'center'; c.fillText('HOT DOGS', 256, 92); }).t }), 0, .85, .36); return g; })();
const hotdog = (() => { const g = grp(); add(g, new THREE.CapsuleGeometry(.035, .14, 6, 12), std('#e8b56a', .7)).rotation.z = Math.PI / 2; add(g, new THREE.CapsuleGeometry(.022, .17, 6, 12), std('#b8432a', .5), 0, .02, 0).rotation.z = Math.PI / 2; return g; })();
const ketchup = (() => { const g = grp(); add(g, new THREE.CylinderGeometry(.035, .04, .18, 14), std('#d8261c', .4)); add(g, new THREE.ConeGeometry(.02, .05, 10), std('#d8261c', .4), 0, .11, 0); const st = add(g, new THREE.CylinderGeometry(.007, .009, .3, 8), std('#c81e14', .3), .0, .27, 0);
  for (let i = 0; i < 6; i++) add(g, new THREE.SphereGeometry(.01, 8, 6), std('#c81e14', .3), Math.sin(i) * .03, .4 + i * .02, Math.cos(i) * .03); return g; })();
const hat = (() => { const g = grp(); add(g, new THREE.CylinderGeometry(.16, .16, .2, 20), std('#22252e', .6), 0, .1, 0); add(g, new THREE.CylinderGeometry(.26, .26, .02, 24), std('#22252e', .6)); return g; })();
const sneeze = (() => { const g = grp(); const r = rng(3); for (let i = 0; i < 40; i++) add(g, new THREE.SphereGeometry(.006 + r() * .008, 6, 4), std('#dff2ff', .1, { transparent: true, opacity: .8 }), r() * .5, (r() - .5) * .25, (r() - .5) * .3); return g; })();
const bill = add(scene, new THREE.PlaneGeometry(.16, .07), new THREE.MeshBasicMaterial({ map: ctex(256, 112, (c, w, h) => { c.fillStyle = '#9fd39a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#2f6a3a'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#2f6a3a'; c.font = '900 64px Inter'; c.textAlign = 'center'; c.fillText('5', 128, 78); }).t, side: THREE.DoubleSide }));
const guitar = (() => { const g = grp(); add(g, new THREE.SphereGeometry(.15, 20, 14), std('#c9772f', .5)).scale.set(1, 1.2, .35); add(g, new THREE.SphereGeometry(.11, 20, 14), std('#c9772f', .5), 0, .17, 0).scale.set(1, 1.1, .35); add(g, new THREE.CircleGeometry(.04, 16), std('#2a1a10'), 0, .08, .055); bx(g, .05, .5, .03, std('#5a3a22'), 0, .5, 0); return g; })();
const card = add(scene, new THREE.PlaneGeometry(.22, .3), new THREE.MeshBasicMaterial({ map: ctex(300, 400, (c, w, h) => { c.fillStyle = '#ffe3ef'; c.fillRect(0, 0, w, h); c.fillStyle = '#e46b9a'; c.font = '900 46px Inter'; c.textAlign = 'center'; c.fillText('HAPPY', 150, 120); c.fillText('BIRTHDAY', 150, 175); c.fillText('MOM', 150, 230); c.font = '60px Inter'; c.fillText('♥', 150, 320); }).t, side: THREE.DoubleSide }));
const cake = (() => { const g = grp(); add(g, new THREE.CylinderGeometry(.16, .16, .14, 24), std('#ffd6e6', .6)); add(g, new THREE.CylinderGeometry(.165, .165, .03, 24), std('#ffffff', .6), 0, .07, 0); for (let i = 0; i < 5; i++) { const a = i * 1.26; add(g, new THREE.CylinderGeometry(.008, .008, .07, 6), std('#5ac8e6'), Math.cos(a) * .1, .12, Math.sin(a) * .1); add(g, new THREE.SphereGeometry(.012, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffcf4a' }), Math.cos(a) * .1, .165, Math.sin(a) * .1); } return g; })();
const wallClock = (() => { const g = grp(32.4, 2.4, -16.95); add(g, new THREE.CircleGeometry(.3, 40), std('#ffffff', .5)); add(g, new THREE.TorusGeometry(.3, .025, 8, 40), std('#22252e', .5));
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; bx(g, .015, .05, .01, std('#22252e'), Math.sin(a) * .25, Math.cos(a) * .25, .01).rotation.z = -a; }
  const hands = [[.012, .16], [.009, .23], [.004, .25]].map(([w, l], i) => { const p = grp(0, 0, .015 + i * .004, g); bx(p, w, l, .005, std(i === 2 ? '#e23b3b' : '#22252e'), 0, l / 2 - .03, 0); return p; });
  return { g, set(sec) { const s = sec % 60, m = (sec / 60) % 60, h = (sec / 3600) % 12; hands[0].rotation.z = -h / 12 * Math.PI * 2; hands[1].rotation.z = -m / 60 * Math.PI * 2; hands[2].rotation.z = -s / 60 * Math.PI * 2; } };
})();
const winLight = add(scene, new THREE.PlaneGeometry(1.1, 1.0), new THREE.MeshBasicMaterial({ color: '#ffd98a', toneMapped: false }), 61.6, 3.0, -3.3);
const SETS3 = { library: library.g };
function showSet(name) { showSet0(name); town.g.visible = name === 'town'; gym.g.visible = name === 'gym'; library.g.visible = name === 'library'; }

// ---------- cast ----------
const nev = makeChar({ hoodie: '#D2512E' });
const jake = makeChar({ hoodie: '#3fae6a', cap: '#f2f2f2', string: '#ffffff' });
const teacher = makeChar({ hoodie: '#7a8599', glasses: true, string: '#7a8599', sleeveFull: true });
const mom = makeChar({ hoodie: '#8a4fbf', scarf: '#f2a6c8', bun: '#3a2a22', string: '#8a4fbf', sleeveFull: true });
const driver = makeChar({ hoodie: '#2a4a7a', cap: '#2a4a7a', string: '#f2b33d', sleeveFull: true });
const vendor = makeChar({ hoodie: '#ffffff', cap: '#e23b3b', string: '#e23b3b', sleeveFull: true });
const kids = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3', '#ff8c42', '#7a8599'].map(h => makeChar({ hoodie: h, string: h }));
const CAST = [nev, jake, teacher, mom, driver, vendor, ...kids];
const extras = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3', '#3fae6a', '#ff8c42', '#e23b3b', '#7a8599', '#5ac8e6', '#c98f6a', '#8a4fbf'].map(c => makeExtra(c, town.g));
const phone = makePhone();
const stache = (() => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(.012, .07, 4, 10), std('#3a2a22', .8)); nev.head.add(m); nev.onHead(m, -.24, 0, .016); m.rotateZ(Math.PI / 2); m.userData.noOutline = true; return m; })();
const ALL_PROPS = [juice.g, ball, cup.g, trays, cart, hotdog, ketchup, hat, sneeze, bill, guitar, card, cake, ...birds.map(b => b.g)];

// ---------- helpers ----------
const blink = t => { const p = (t % 3.3) / 3.3; return p > .93 ? 1 - Math.abs(p - .965) / .035 : 0; };
const talk = (t, i) => t > ps(i) && t < pe(i) - .05 ? (Math.sin(t * 15) > 0 ? 'o' : 'flat') : null;
const yell = (t, i) => t > ps(i) && t < pe(i) - .05 ? (Math.sin(t * 15) > 0 ? 'yell' : 'o') : null;
const F = { calm: { brow: .3, mouth: 'flat' }, happy: { brow: -.2, mouth: 'smile' }, smug: { brow: -.6, mouth: 'smirk' }, sad: { brow: 1, mouth: 'frown' }, shock: { brow: 1, mouth: 'o', wide: true }, worried: { brow: .8, mouth: 'wavy' } };
const fb = (f, t) => ({ ...f, blink: f.blink ?? blink(t) });
const FZ = 4.37; // the frozen instant used for anyone who is frozen
const LIGHT = {
  morning: () => { lightRig(V(0, 1, 0), { key: 2.6, keyCol: '#ffe9cf', hemi: 2.6, sky: '#fff1e2', ground: '#8a7a90', bg: '#9f88d6', exposure: 1.35, fill: 1.4, fillCol: '#d9ccff' }); bedroom.day(true); bedroom.lamp.intensity = 0; },
  dawn: () => { lightRig(V(0, 1, 0), { key: 1.6, keyCol: '#ffd2b0', hemi: 2.0, sky: '#e8d0ff', ground: '#5a4a70', bg: '#7a6aa6', exposure: 1.4, fill: 1.2, fillCol: '#c8b8ff' }); bedroom.day(true); bedroom.lamp.intensity = .4; },
  night: () => { lightRig(V(0, 1, 0), { key: 2.0, keyCol: '#d9d6ff', hemi: 2.2, sky: '#c9c0f0', ground: '#4a4060', bg: '#3b3566', exposure: 1.45, fill: 1.4, fillCol: '#c8b8ff' }); bedroom.day(false); bedroom.lamp.intensity = .9; },
  dark: () => { lightRig(V(0, 1, 0), { key: 1.1, keyCol: '#a9a3e6', hemi: 1.5, sky: '#9d93d6', ground: '#2a2440', bg: '#241f42', exposure: 1.45 }); bedroom.day(false); bedroom.lamp.intensity = 0; },
  kitchen: () => { lightRig(V(120, 1, 0), { key: 2.5, keyCol: '#fff0dc', hemi: 2.5, sky: '#fff0dc', ground: '#7a6050', bg: '#d8a06a', exposure: 1.3 }); house.day(true); house.lamp.intensity = 0; },
  school: (z = 0) => lightRig(V(30, 1, z), { key: 2.2, keyCol: '#fff4e4', hemi: 2.3, sky: '#fff6ea', ground: '#7a8a80', bg: '#7cb8a6', exposure: 1.15, fill: 1.3 }),
  town: (x = 300) => lightRig(V(x, 1, 0), { key: 2.8, keyCol: '#fff4e0', hemi: 2.6, sky: '#cfe6ff', ground: '#7a9a60', bg: '#9fd0f5', exposure: 1.2, keyOff: V(12, 20, 16) }),
  gym: () => { lightRig(V(360, 1, 0), { key: 1.8, keyCol: '#fff4e0', hemi: 2.2, sky: '#fff6ea', ground: '#8a7050', bg: '#8798c8', exposure: 1.2 }); gym.spot.intensity = 0; },
  highway: () => lightRig(V(220, 1, 10), { key: 2.6, hemi: 2.4, sky: '#d8ecff', ground: '#6a8a5a', bg: '#a9cfff', exposure: 1.2, keyOff: V(30, 60, 40) }),
  library: () => lightRig(V(540, 1, 0), { key: 2.2, keyCol: '#fff0d8', hemi: 2.3, sky: '#fff0dc', ground: '#7a6050', bg: '#c4946a', exposure: 1.25 }),
  rain: () => lightRig(V(60, 1, 0), { key: .9, keyCol: '#9fb0ff', hemi: 1.4, sky: '#8a90d0', ground: '#20243a', bg: '#1e2140', exposure: 1.5 }),
};
const BED = { seat: V(0, .5, -.05), fwd: V(0, 0, 1) };
function holdSit(t, seat, fwd, o = {}) {
  const tmp = { handL: seat.clone().add(V(0, .4, .2)), handR: seat.clone().add(V(0, .4, .2)) };
  const i1 = sitPose(nev, seat, fwd, { t, lean: .32, face: fb(o.face || F.calm, t), ...tmp }); placePhone(phone, i1, {});
  const gL = phone.g.localToWorld(V(-.066, -.05, -.012)), gR = phone.g.localToWorld(V(.066, -.05, -.012));
  const i2 = sitPose(nev, seat, fwd, { t, lean: .32, face: fb(o.face || F.calm, t), handL: gL, handR: gR, handModeL: 'grip', handModeR: 'grip', handTargetL: phone.g.position, handTargetR: phone.g.position, look: o.look || phone.g.position, hide: o.hide });
  placePhone(phone, i2, {}); nev.root.visible = true; return i2;
}
function phoneCU(t, k, draw, o = {}) {
  holdSit(t, BED.seat, BED.fwd, { hide: { head: true, body: true, arms: true, legs: true } }); draw(phone);
  const n = phone.g.localToWorld(V(0, 0, 1)).sub(phone.g.position).normalize(); const tgt = phone.g.position.clone();
  look(tgt.clone().add(n.multiplyScalar(lerp(o.d0 ?? .25, o.d1 ?? .2, ease(k)))).add(V(.02 * Math.sin(k * 2), .01, 0)), tgt, 34);
}
function faceCU(info, k, o = {}) { const hc = info.hc, f = info.fwd; look(hc.clone().add(f.clone().multiplyScalar(lerp(o.d0 ?? .9, o.d1 ?? .72, ease(k)))).add(info.right.clone().multiplyScalar(o.side ?? .1)).add(V(0, o.dy ?? -.04, 0)), hc.clone().add(V(0, -.03, 0)), o.fov || 30); }
function headCU(c, k, off, o = {}) { const h = c.head.position; look(h.clone().add(off.clone().multiplyScalar(lerp(1, o.push ?? .85, ease(k)))), h.clone().add(V(0, o.ty ?? -.06, 0)), o.fov || 32); }
const blanket = (() => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .95, 8, 20), std('#e86f8f', .85)); m.scale.set(1.05, 1, .5); m.castShadow = m.receiveShadow = true; scene.add(m); m.visible = false; return m; })();
function lieNev(face, o = {}) { const hip = V(o.hipX ?? .35, .62, -.9); poseChar(nev, { elbowPole: (s, sh) => sh.clone().add(V(-.15, .45, .1)), hip, fwd: V(0, 0, -1), lean: -Math.PI / 2 + .1, footL: V(hip.x - .07, .6, 0), footR: V(hip.x + .1, .6, 0), handL: o.handL || V(.55, .62, -1.1), handR: o.handR || V(hip.x - .2, .62, -1.1), face, look: o.look || V(hip.x, 2, -1.6), hide: { legs: true } }); nev.root.visible = true; blanket.visible = true; blanket.quaternion.copy(nev.torso.quaternion); const bu = V(0, 1, 0).applyQuaternion(nev.torso.quaternion); blanket.position.copy(nev.torso.position).sub(bu.multiplyScalar(.42)); }
function sideHand(seat, fwd, s) { const f = fwd.clone().setY(0).normalize(), r = new THREE.Vector3().crossVectors(f, V(0, 1, 0)).normalize(); return seat.clone().add(r.multiplyScalar(s * .3)).add(f.multiplyScalar(.08)).add(V(0, .06, 0)); }
function sitBed(t, face, o = {}) { return sitPose(nev, V(.1, .5, -.4), o.fwd || V(-.3, 0, 1), { t, lean: o.lean ?? .1, face: fb(face, t), handL: o.handL || sideHand(V(.1, .5, -.4), o.fwd || V(-.3, 0, 1), -1), handR: o.handR || sideHand(V(.1, .5, -.4), o.fwd || V(-.3, 0, 1), 1), look: o.look || V(-.6, 1, 1.5) }); }
function app(ph, s) { const g = ph.cv.getContext('2d'); ph.g.visible = true; ph.light.intensity = s.light ?? .06; ph.tex.needsUpdate = true; const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  g.fillStyle = s.bg || '#0f1626'; g.fillRect(0, 0, 600, 1200); g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 30px Inter'; g.fillStyle = '#e8eef7'; g.fillText(s.time || '6:59', 44, 48);
  if (s.kind === 'rules') { g.fillStyle = '#fdf6d8'; g.fillRect(0, 90, 600, 1110); g.font = '900 50px Inter'; g.fillStyle = '#2a2030'; g.fillText('SNOOZE RULES', 44, 170);
    (s.items || []).forEach((txt, i) => { const y = 300 + i * 190; g.fillStyle = '#ff7a2a'; g.beginPath(); g.arc(70, y, 30, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '900 36px Inter'; g.textAlign = 'center'; g.fillText(String(i + 1), 70, y + 2); g.textAlign = 'left';
      g.fillStyle = '#2a2030'; g.font = '700 38px Inter'; txt.split('\n').forEach((l, j) => g.fillText(l, 125, y - 18 + j * 46)); }); }
  else if (s.kind === 'game') { g.fillStyle = '#1a1240'; g.fillRect(0, 90, 600, 1110); for (let i = 0; i < 12; i++) { g.fillStyle = ['#ff4d6d', '#ffd34d', '#4ee08a', '#5ac8e6'][i % 4]; g.fillRect(40 + (i * 97 + s.t * 120) % 520, 300 + (i % 4) * 160, 46, 46); }
    g.fillStyle = '#fff'; g.font = '900 54px Inter'; g.fillText('LEVEL ' + (s.level || 47), 44, 170); g.font = '700 36px Inter'; g.fillStyle = '#ffd34d'; g.fillText('HIGH SCORE!', 44, 1100); }
  else if (s.kind === 'stats') { g.fillStyle = '#10223a'; g.fillRect(0, 90, 600, 1110); g.font = '600 34px Inter'; g.fillStyle = '#9fc6ff'; g.fillText(s.title || 'Snooze history', 44, 160); g.font = '900 96px Inter'; g.fillStyle = '#7ff3ff'; g.fillText(s.big, 44, 290); g.font = '600 32px Inter'; g.fillStyle = '#c8d6ea'; g.fillText(s.sub || '', 44, 380);
    (s.bars || []).forEach((v, i) => { const x = 50 + i * 63; g.fillStyle = i === 7 ? '#ffd34d' : '#5ac8e6'; g.fillRect(x, 1000 - v * 480, 44, v * 480); g.font = '700 22px Inter'; g.fillStyle = '#c8d6ea'; g.textAlign = 'center'; g.fillText(['M', 'T', 'W', 'T', 'F', 'S', 'S', '+1'][i], x + 22, 1040); g.textAlign = 'left'; }); }
  else if (s.kind === 'calc') { g.fillStyle = '#111'; g.fillRect(0, 90, 600, 1110); g.textAlign = 'right'; g.font = '300 56px Inter'; g.fillStyle = '#9a9a9a'; g.fillText(s.top || '900 h ÷ 24', 560, 420); g.font = '300 140px Inter'; g.fillStyle = '#fff'; g.fillText(s.res || '37.5', 560, 560); g.font = '600 44px Inter'; g.fillStyle = '#ff9f2a'; g.fillText(s.unit || 'days', 560, 670); g.textAlign = 'left';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.fillStyle = c === 3 ? '#ff9f2a' : '#333'; g.beginPath(); g.arc(90 + c * 140, 800 + r * 100, 42, 0, 7); g.fill(); } }
  else if (s.kind === 'cal') { g.fillStyle = '#fbfbfd'; g.fillRect(0, 90, 600, 1110); g.font = '800 44px Inter'; g.fillStyle = '#e23b3b'; g.fillText('SATURDAY', 44, 170); g.font = '900 64px Inter'; g.fillStyle = '#22252e'; g.fillText("Mom's birthday 🎂", 44, 260);
    g.font = '600 36px Inter'; g.fillStyle = '#5a6a8a'; g.fillText('Calendar:  in 2 days', 44, 420); g.fillStyle = '#e23b3b'; g.fillText('You:  14 days of waiting', 44, 490); }
  else if (s.kind === 'clock') { g.fillStyle = '#05070d'; g.fillRect(0, 90, 600, 1110); g.font = '200 150px Inter'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(s.big || '7:42', 300, 420); g.font = '600 36px Inter'; g.fillStyle = '#ff6b6b'; g.fillText(s.sub || 'You overslept', 300, 520); g.textAlign = 'left'; }
}

// ---------- extra-time counter ----------
const SNOOZES = [ps(1) + .75, ps(12) + .9, ps(12) + 1.9, ps(12) + 2.9, ps(85) + .4];
const RAMPS = []; const ramp = (a, b, v0, v1, pw = 1) => RAMPS.push([a, b, v0, v1, pw]);
ramp(ps(1) + .75, ps(1) + .76, 0, 9); ramp(ps(12) + .9, ps(12) + .91, 9, 18); ramp(ps(12) + 1.9, ps(12) + 1.91, 18, 27); ramp(ps(12) + 2.9, ps(12) + 2.91, 27, 36);
ramp(ps(19), pe(19), 36, 81); ramp(ps(21), pe(21), 81, 171); ramp(ps(24), pe(24), 171, 351); ramp(ps(25), pe(25), 351, 1260, 1.5); ramp(ps(27), pe(27), 1260, 2160); ramp(ps(31), pe(38), 2160, 54000, 1.6);
ramp(ps(80) - .1, ps(80) + 1.3, 54000, 0, .4); ramp(ps(85) + .4, ps(85) + .41, 0, 9);
function extra(t) { let m = 0; for (const [a, b, v0, v1, pw] of RAMPS) if (t >= a) m = t >= b ? v1 : Math.round(v0 + (v1 - v0) * Math.pow((t - a) / (b - a), pw)); return m; }
const fmtT = m => m < 60 ? `${m} min` : m < 600 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${Math.round(m / 60).toLocaleString('en-US')} hours`;
const FROZEN = [[pe(3) - .08, ps(8) + .5], [ps(11), pe(11)], [ps(13), pe(17)], [ps(19), pe(19)], [ps(21), pe(23)], [ps(24), pe(24)], [ps(27), pe(30)], [ps(31), pe(33)], [ps(37), ps(37) + 1.4], [ps(50), pe(51)], [ps(56), pe(61)], [ps(85) + .4, END0]];
const frozenAt = t => FROZEN.some(([a, b]) => t >= a - .15 && t < b + .15);
const LABELS = [[0, 'Day 1 · 6:59 AM'], [10, 'Day 1'], [14, 'Day 1 · 7:30 AM'], [19, 'Day 1 · Math test'], [21, 'Day 1 · Lunch'], [24, 'Day 1 · 11:47 PM'], [25, 'Day 5 · Friday'], [27, 'Day 6 · Saturday'], [31, 'Day 10'], [35, 'Day 15'], [39, 'Day 19'], [46, 'Day 19 · Night'], [53, 'Day 20'], [56, ''], [63, 'Day 22 · Monday 6:59 AM'], [69, 'Day 22 · 8:41 AM'], [72, 'Day 22 · Lunch'], [77, 'Day 27 · Saturday'], [81, 'Day 27 · Night'], [82, '3:33 AM']];
const CAPS = { 5: 'Frozen mid-pour', 11: '1 snooze = 9 frozen minutes', 12: 'Snoozes stack', 13: 'Touch = they can move', 19: '5 snoozes = 45 minutes', 21: '10 snoozes = 90 minutes', 24: '20 snoozes = 3 hours', 25: '140 snoozes = 21 extra hours', 27: '100 snoozes = 15 hours', 30: 'Paid: $5', 38: 'Extra time: 900 hours', 44: '+2 inches in 3 weeks', 47: '900 hours = 37 days', 49: 'Calendar: 3 weeks  ·  Your body: 2 months', 59: 'Alone: 900 hours', 66: '4,000+ snoozes', 80: 'Extra time: 0' };

// ---------- shots ----------
const S = {};
const clockT = (s, col = '#ff4d4d', o = {}) => clock.set(s, col, o.on ?? 1, o.press ?? 0, o.shake ?? 0, o.plugged ?? 1);
const ringing = (t, s = '6:59') => clockT(s, Math.sin(t * 12) > 0 ? '#ff4d4d' : '#ff9a9a', { shake: Math.sin(t * 40) > 0 ? 1 : .2 });
// HOOK
S[0] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); ringing(t); lieNev(fb({ brow: .6, mouth: 'wavy', blink: .8 }, t)); look(V(lerp(1.4, .9, ease(k)), lerp(1.5, 1.2, k), lerp(1.7, 1.0, ease(k))), V(-.35, .6, -.7), 38); };
S[1] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); const hit = t > ps(1) + .75; const top = clock.top(); if (hit) clockT('6:59', '#ff4d4d', { press: t < ps(1) + 1.0 ? 1 : 0 }); else ringing(t);
  const reach = easeOut(prog(t, ps(1) + .1, ps(1) + .75)); lieNev(fb({ brow: -.4, mouth: 'frown', blink: 1 }, t), { hipX: -.12, handL: V(-.3, .66, -.85).lerp(top.clone().add(V(.02, .11, 0)), reach) });
  look(top.clone().add(V(.55, .25, .75)), top.clone().add(V(.05, -.08, 0)), 34); };
S[2] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); clockT('6:59'); const i = sitBed(t, { brow: lerp(0, .8, k), mouth: 'flat' }, { look: V(-.7, .7, -.6) }); nev.root.visible = true; look(V(lerp(1.6, 1.4, k), 1.35, lerp(1.6, 1.3, k)), V(-.1, .8, -.4), 40); };
// mom on the stairs, pouring juice
const MOMB = () => V(117.6, .8, .4);
function momStairs(t, tt, frozen) { const b = MOMB(); const p = b.clone().add(V(.25, 1.18, .3)), gl = b.clone().add(V(-.05, .98, .33));
  standPose(mom, b, V(0, 0, 1), { phase: frozen ? 1.2 : tt * 3, stride: .08, face: fb({ brow: -.3, mouth: frozen ? 'yell' : (yell(tt, 3) || 'smile'), blink: frozen ? 0 : undefined }, tt), handR: p.clone().add(V(-.05, -.02, 0)), handL: gl.clone().add(V(.03, -.04, 0)), look: V(120.5, 1.6, 2.5) }); mom.root.visible = true; return { p, gl }; }
S[3] = (t, k) => { LIGHT.kitchen(); showSet('house'); const fz = pe(3) - .08, tt = Math.min(t, fz); const { p, gl } = momStairs(t, tt, t >= fz); juice.set(p, gl, 0); look(V(lerp(119.6, 119.4, k), 1.75, lerp(2.4, 2.2, k)), V(117.8, 1.75, .5), 36); };
S[4] = (t, k) => { LIGHT.kitchen(); showSet('house'); const { p, gl } = momStairs(FZ, FZ, true); juice.set(p, gl, 0); const b = V(lerp(119.6, 118.9, ease(k)), 0, 1.3);
  standPose(nev, b, V(-1, 0, -.4), { phase: k < .6 ? t * 4 : 0, stride: k < .6 ? .14 : 0, face: fb(F.shock, t), look: mom.head.position, handR: k > .6 ? mom.head.position.clone().add(V(.25, -.05, .3)).lerp(b.clone().add(V(0, 1.3, 0)), .3 + .2 * Math.sin(t * 9)) : undefined, handModeR: 'open' }); nev.root.visible = true;
  const a = lerp(.1, .45, k); look(V(117.6 + Math.sin(a) * 2.6, 1.6, .5 + Math.cos(a) * 2.6), V(118.1, 1.5, .6), 38); };
S[5] = (t, k) => { LIGHT.kitchen(); showSet('house'); const { p, gl } = momStairs(FZ, FZ, true); juice.set(p, gl, 0); const c = p.clone().lerp(gl, .5); const a = lerp(-.6, .6, k); look(c.clone().add(V(Math.sin(a) * .8, .1, Math.cos(a) * .8)), c, 32); };
S[6] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); clockT('6:59'); const f = clock.front(); look(f.clone().add(V(.12, .05, lerp(.5, .38, ease(k)))), f, 30); };
S[7] = (t, k) => { LIGHT.kitchen(); showSet('house'); const { p, gl } = momStairs(FZ, FZ, true); juice.set(p, gl, 0); standPose(nev, V(119.2, 0, 1.2), V(-1, 0, -.3), { face: fb(F.shock, t), look: mom.head.position }); nev.root.visible = true;
  look(V(lerp(122.4, 122.0, k), lerp(2.0, 1.9, k), lerp(4.2, 3.8, k)), V(118.8, 1.0, .2), 44); };
S[8] = (t, k) => { LIGHT.kitchen(); showSet('house'); const t0 = ps(8) + .5, tt = t < t0 ? FZ : FZ + (t - t0); const { p, gl } = momStairs(tt, tt, t < t0); juice.set(p, gl.clone().add(V(0, -.0, 0)), clamp((t - t0) / .8));
  standPose(nev, V(119.2, 0, 1.2), V(-1, 0, -.3), { face: fb(F.shock, t), look: mom.head.position }); nev.root.visible = true; look(V(120.6, 1.5, 2.6), V(118.3, 1.0, .5), 40); };
S[9] = (t, k) => { LIGHT.kitchen(); showSet('house'); const b = MOMB(); standPose(mom, b, V(0, 0, 1), { face: fb({ brow: .8, mouth: talk(t, 9) || 'o' }, t), look: V(117.8, 0, 1.2), lean: .25, handL: b.clone().add(V(-.3, 1.0, .2)), handR: b.clone().add(V(.3, 1.0, .2)), handModeL: 'open', handModeR: 'open' }); mom.root.visible = true;
  juice.set(V(117.85, -5, .4), V(117.55, -5, .73), 1); juice.puddle.visible = true; juice.puddle.position.set(117.9, .006, 1.6); juice.puddle.scale.setScalar(1); if (k < .4) look(V(119.6, 1.6, 3.0), V(117.9, 1.1, 1.0), 44); else look(V(118.9, 1.8, 2.6), mom.head.position.clone().add(V(0, -.2, 0)), 36); };
// RULES
S[10] = (t, k) => { LIGHT.morning(); showSet('bedroom'); clockT('7:08'); const i = holdSit(t, BED.seat, BED.fwd, { face: F.smug, look: V(.3, 1.1, 1.4) }); app(phone, { kind: 'rules', items: [], time: '7:08' }); faceCU(i, k, { d0: 1.1, d1: .85, side: .25 }); };
const RULES = ['Every snooze =\n9 frozen minutes', 'Press again.\nThe minutes stack.', 'Touch someone =\nthey can move too'];
S[11] = (t, k) => { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'rules', items: RULES.slice(0, 1), time: '7:09' })); };
S[12] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); const pr = SNOOZES.slice(1, 4).some(s => t > s - .05 && t < s + .2) ? 1 : 0; clockT('6:59', '#ff4d4d', { press: pr }); const top = clock.top();
  const ph = Math.min(...SNOOZES.slice(1, 4).map(s => Math.abs(t - s))); lieNev(fb({ brow: -.5, mouth: 'smirk' }, t), { hipX: -.12, handL: top.clone().add(V(.02, .11 + clamp(ph * .5, 0, .15), 0)), look: top });
  look(top.clone().add(V(.5, .3, .7)), top.clone().add(V(0, -.05, 0)), 36); };
S[13] = (t, k) => { LIGHT.morning(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'rules', items: RULES, time: '7:10' })); };
// bus stop
function busStop(t, o = {}) { LIGHT.highway(); showSet('highway'); highway.bus.position.set(220, 0, 9); const dB = V(221.6, 0, 13.8);
  standPose(driver, dB, V(1, 0, .3), { phase: 1.1, stride: .14, face: { brow: -.2, mouth: 'o', blink: 0 }, handR: dB.clone().add(V(.35, 1.15, .25)), look: V(224, 1.6, 15) }); driver.root.visible = true; cup.g.visible = true; cup.g.position.copy(dB).add(V(.42, 1.12, .3)); cup.g.rotation.z = -.5;
  birds[0].set(V(222.8, 2.3, 12.2), .9, .5); birds[1].set(V(224.6, 2.9, 11.4), -.5, -1);
  const jb = V(223.8, 0, 13.4), nb = V(223.0, 0, 13.6); const jf = o.jakeFrozen;
  standPose(jake, jb.clone().add(V(0, o.jHop ? Math.max(0, Math.sin(t * 8)) * .07 : 0, 0)), V(-.2, 0, 1), { face: fb(jf ? { brow: 0, mouth: 'flat', blink: 0 } : (o.jFace || { brow: 1, mouth: yell(t, 15) || 'o', wide: true }), jf ? FZ : t), look: jf ? V(224, 1.5, 17) : (o.jLook || V(222.8, 2.3, 12.2)),
    handL: o.jUp ? jb.clone().add(V(-.4, 1.55, .1)) : undefined, handR: o.jUp ? jb.clone().add(V(.4, 1.55, .1)) : undefined, handModeL: o.jUp ? 'fist' : 'grip', handModeR: o.jUp ? 'fist' : 'grip' }); jake.root.visible = true;
  standPose(nev, nb, V(.5, 0, .5), { face: fb(o.nFace || F.smug, t), look: jake.head.position, handR: o.touch ? jake.root.position.clone() && jb.clone().add(V(-.16, 1.25, -.05)) : undefined }); nev.root.visible = true; }
S[14] = (t, k) => { busStop(t, { jakeFrozen: true, touch: k > .5, nFace: F.calm }); look(V(lerp(227.5, 226.8, k), 1.9, lerp(18.5, 17.6, k)), V(222.6, 1.3, 12.6), 40); };
S[15] = (t, k) => { busStop(t, { touch: true, nFace: F.smug, jLook: k < .45 ? V(224.6, 1.6, 16.5) : V(222.8, 2.3, 12.2) }); if (k < .45) headCU(jake, k / .45, V(.35, -.02, .85)); else { const b = birds[0].g.position; look(V(223.8, 1.9, 14.4), b, 30); } };
S[16] = (t, k) => { busStop(t, { touch: true, jFace: { brow: .6, mouth: 'flat' } }); look(V(lerp(223.4, 223.5, k), 1.45, lerp(15.6, 15.2, k)), V(223.4, 1.2, 13.5), 34); };
S[17] = (t, k) => { busStop(t, { touch: false, jHop: true, jUp: true, jFace: { brow: -.8, mouth: Math.sin(t * 12) > 0 ? 'yell' : 'smile' }, nFace: F.happy, jLook: V(224, 1.8, 18) }); look(V(lerp(225.5, 225.8, k), 1.5, lerp(17.2, 16.8, k)), V(223.4, 1.2, 13.4), 40); };
// DAY ONE
S[18] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(FZ, { frozen: true }); const x = lerp(294, 299, k), b = V(x, Math.abs(Math.sin(t * 5)) * .25, 1.4);
  standPose(nev, b, V(1, 0, 0), { phase: t * 5.5, stride: .24, face: fb({ brow: -.6, mouth: 'smile' }, t), look: V(x + 3, 1.6, 2), handL: b.clone().add(V(-.1, 1.65, -.3)), handR: b.clone().add(V(.1, 1.65, .3)), handModeL: 'fist', handModeR: 'fist' }); nev.root.visible = true;
  look(V(x + 1, 1.4, 5.5), b.clone().add(V(.5, 1.1, -.5)), 42); };
const CL = V(30, 0, -14);
function classroom(t, frozen, o = {}) { LIGHT.school(-14); showSet('school'); const tt = frozen ? FZ : t;
  [[-1.2, 0], [1.2, 0], [-1.2, 1.5]].forEach(([x, z], i) => { const c = kids[i]; sitPose(c, CL.clone().add(V(x, .45, z + .5)), V(0, 0, -1), { t: tt, lean: .35, face: fb({ brow: .2, mouth: 'flat', blink: frozen ? 0 : undefined }, tt + i), handL: CL.clone().add(V(x - .15, .8, z + .1)), handR: CL.clone().add(V(x + .1, .82 + (frozen ? 0 : Math.sin(tt * 8 + i) * .02), z)), look: CL.clone().add(V(x, .7, z)) }); c.root.visible = true; });
  const tb = CL.clone().add(V(-.35, 0, -1.8)); standPose(teacher, tb, V(0, 0, 1), { face: fb({ brow: o.tBrow ?? -.2, mouth: o.tMouth || 'flat', blink: frozen ? 0 : undefined }, tt), look: o.tLook || CL.clone().add(V(0, 1, 1)), handR: o.tHandR, handL: o.tHandL, handModeR: o.tHandR ? 'grip' : undefined }); teacher.root.visible = true;
  wallClock.set(frozen ? 8 * 3600 + 15 * 60 + 12 : 8 * 3600 + 41 * 60 + (t - ps(69)) * 60 * (o.fast ? 1 : 1 / 60) * 60); }
S[19] = (t, k) => { classroom(t, true); const nb = CL.clone().add(V(1.2, .45, 2)); sitPose(nev, nb, V(0, 0, -1), { t, lean: .4, face: fb({ brow: -.4, mouth: 'flat' }, t), handL: CL.clone().add(V(1.05, .8, 1.5)), handR: CL.clone().add(V(1.35 + Math.sin(t * 14) * .05, .8, 1.45)), look: CL.clone().add(V(1.2, .76, 1.45)) }); nev.root.visible = true;
  look(V(lerp(33.2, 32.8, k), 1.8, lerp(-10.6, -11, k)), V(30.4, 1.0, -13.6), 40); };
S[20] = (t, k) => { classroom(t, false, { tBrow: .9, tMouth: talk(t, 20) || 'o', tLook: CL.clone().add(V(1.2, 1.2, 2)), tHandR: CL.clone().add(V(.2, 1.0, -1.5)) }); school.paper.visible = true; school.setGrade('A'); school.paper.position.copy(CL).add(V(-.12 - 30, 1.33, -1.4 + 14)).add(V(0, 0, 0)); school.paper.position.set(.25, 1.0, -15.3); school.paper.rotation.set(0, 0, .1);
  headCU(teacher, k, V(.45, -.02, 1.05), { push: .85, fov: 36 }); };
// cafeteria
const CAF = V(30.2, 0, 3.7);
function cafeteria(t, o = {}) { LIGHT.school(); showSet('school'); fries.forEach(f => f.visible = true); kids.slice(0, 6).forEach((c, i) => { const tb = school.tables[i % 4], side = i < 4 ? -.65 : .65; sitPose(c, V(tb.x - .5 + (i % 2) * .9, .45, tb.z + side), V(0, 0, -Math.sign(side)), { t: FZ, lean: .25, face: { brow: -.2, mouth: i % 2 ? 'o' : 'smile', blink: 0 }, handL: V(tb.x - .5 + (i % 2) * .9 - .1, .82, tb.z + side * .5), handR: V(tb.x - .5 + (i % 2) * .9 + .1, 1.0 + i * .05, tb.z + side * .4), look: V(tb.x, 1.1, tb.z) }); c.root.visible = true; });
  const tb = school.tables[1], jb = V(tb.x + .9, .45, tb.z + .65); sitPose(jake, jb, V(0, 0, -1), { t, lean: .25, face: fb(o.jFace || { brow: -.6, mouth: Math.sin(t * 10) > 0 ? 'o' : 'smile' }, t), handR: V(jb.x + .05, o.eat === false ? .85 : lerp(.85, 1.08, Math.abs(Math.sin(t * 5))), jb.z - .25 - .15 * Math.abs(Math.sin(t * 5))), handL: V(jb.x - .2, .82, jb.z - .4), look: o.jLook || V(jb.x, 1.0, jb.z - 1) }); jake.root.visible = true;
  trays.visible = true; trays.position.set(tb.x - 30 + .45, .78, tb.z - .1); trays.scale.y = o.trays ?? 1; return { tb, jb }; }
S[21] = (t, k) => { const { tb } = cafeteria(t); standPose(nev, V(tb.x + 1.9, 0, tb.z + 1.1), V(-1, 0, -.4), { face: fb(F.smug, t), look: jake.head.position }); nev.root.visible = true; const a = lerp(.3, -.2, k); look(V(tb.x + Math.sin(a) * 4, 2.3, tb.z + Math.cos(a) * 4), V(tb.x + .4, .9, tb.z), 40); };
S[22] = (t, k) => { cafeteria(t, { eat: false, jFace: { brow: -.8, mouth: yell(t, 22) || 'smile' }, jLook: V(32.6, 1.3, -2.2) }); headCU(jake, k, V(.45, .02, -.8)); };
S[23] = (t, k) => { const { tb } = cafeteria(t, { eat: false, trays: lerp(1, .3, k), jFace: { brow: .7, mouth: 'frown' } }); const nb = V(tb.x + 1.6, 0, tb.z + .4); standPose(nev, nb, V(-1, 0, 0), { face: fb({ brow: -.2, mouth: 'flat' }, t), look: jake.head.position, handL: nb.clone().add(V(-.35, .95, -.12)), handR: nb.clone().add(V(-.35, .95, .12)) }); nev.root.visible = true;
  look(V(tb.x + 3.6, 1.6, tb.z + 2.4), V(tb.x + 1, .95, tb.z + .2), 38); };
S[24] = (t, k) => { LIGHT.night(); showSet('bedroom'); clockT('11:47', '#ff4d4d'); if (k < .45) phoneCU(t, k / .45, ph => app(ph, { kind: 'game', t, time: '11:47', level: 47 + Math.floor(k * 30) })); else { const i = holdSit(t, BED.seat, BED.fwd, { face: { brow: -.5, mouth: 'smile' } }); app(phone, { kind: 'game', t, time: '11:47', light: .4 }); faceCU(i, (k - .45) / .55, { d0: 1.2, d1: 1.0, side: .3 }); } };
S[25] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'stats', big: '+21 hours', sub: '140 snoozes this week', bars: [.2, .35, .3, .5, .9, 0, 0, 0], time: '9:14' })); };
S[26] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'stats', title: 'Your week', big: '8 days', sub: 'Everyone else: 7', bars: [.5, .5, .5, .5, .5, .5, .5, easeOut(prog(k, .2, .6)) * .5], time: '9:15' })); };
// SATURDAY downtown
function townExtras(t, o = {}) { extras.forEach((e, i) => { e.g.visible = true; const x = -9 + i * 1.6 + (i % 2) * .3, z = (i % 3) * .5 - .2 + 1.2; e.g.position.set(x, 0, z); e.g.rotation.y = (o.face ?? 0) + Math.sin(i) * .6; e.set(o.frozen ? FZ + i : t, { up: o.up ?? (o.frozen ? (i % 3 === 0 ? .5 : 0) : 0), bob: 0, talk: o.frozen ? 0 : (o.talk ?? 0), ph: i * 1.3, turn: o.frozen ? Math.sin(i * 2) * .5 : 0 }); if (o.frozen) { const sw = (i % 2 ? 1 : -1) * .55; e.arms[0].rotation.set(sw, 0, -.12); e.arms[1].rotation.set(-sw, 0, .12); if (i % 5 === 2) e.arms[1].rotation.set(-.3, 0, 2.5); } }); }
S[27] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); birds[0].set(V(299, 2.6, 2), .8, .3); const x = lerp(296.5, 299.5, k), b = V(x, 0, 2.4); standPose(nev, b, V(1, 0, 0), { phase: t * 4, stride: .16, face: fb(F.happy, t), look: V(x + 3, 1.6, 1) }); nev.root.visible = true;
  look(V(lerp(296, 298, k), 3.2, 9.5), V(lerp(298, 300, k), 1, 1.5), 42); };
const SNZ = () => extras[6]; // the sneezing guy
S[28] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); const g = SNZ(); const hp = g.head.getWorldPosition(V(0, 0, 0)); g.head.rotation.x = .35; g.head.getWorldPosition(hp);
  sneeze.visible = true; sneeze.position.copy(hp).add(V(.12, -.05, .15)); sneeze.rotation.y = -.6; birds[0].set(hp.clone().add(V(-.9, .9, .3)), 1.0, .4);
  const pk = prog(k, .45, .85); hat.visible = true; hat.position.copy(hp).add(V(0, lerp(.6, .17, easeOut(pk)), 0)); const nb = hp.clone().setY(0).add(V(.55, 0, .55));
  standPose(nev, nb, V(-1, 0, -1), { face: fb(F.smug, t), look: hp, handR: hat.position.clone().add(V(.05, .12, .05)), handL: k > .45 ? hat.position.clone().add(V(-.1, .12, .05)) : undefined }); nev.root.visible = true;
  if (k < .45) { look(hp.clone().add(V(-1.3, .5, 1.3)), hp.clone().add(V(-.4, .3, .1)), 38); } else look(hp.clone().add(V(.2, .1, 1.5)), hp.clone().add(V(.15, -.1, 0)), 36); };
S[29] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); cart.visible = true; const vb = V(302.5, 0, -.45); standPose(vendor, vb, V(0, 0, 1), { face: { brow: -.3, mouth: 'smile', blink: 0 }, handR: vb.clone().add(V(.25, 1.25, .45)), handL: vb.clone().add(V(-.15, 1.0, .5)), look: V(302.6, 1.0, .9) }); vendor.root.visible = true;
  ketchup.visible = true; ketchup.position.copy(vb).add(V(.25, 1.25, .5)); ketchup.rotation.set(Math.PI, 0, 0); ketchup.position.y += .0; hotdog.visible = true; hotdog.position.copy(vb).add(V(.2, .93, .55));
  const c = hotdog.position.clone().add(V(0, .15, 0)); const a = lerp(-.5, .5, k); look(c.clone().add(V(Math.sin(a) * 1.7, .35, 1.2 + Math.cos(a) * .6)), c, 36); };
S[30] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); cart.visible = true; const vb = V(302.5, 0, -.45); standPose(vendor, vb, V(0, 0, 1), { face: { brow: -.3, mouth: 'smile', blink: 0 }, handR: vb.clone().add(V(.25, 1.25, .45)), handL: vb.clone().add(V(-.15, 1.0, .5)), look: V(302.6, 1.0, .9) }); vendor.root.visible = true;
  const nb = V(302.9, 0, 1.25); const hd = nb.clone().add(V(-.1, 1.48 - .05 * Math.abs(Math.sin(t * 6)), .25)); hotdog.visible = true; hotdog.position.copy(hd); hotdog.rotation.y = 1.2;
  const bp = V(302.3, .91, .56); bill.visible = k > .5; bill.position.copy(bp); bill.rotation.set(-Math.PI / 2, 0, .3);
  standPose(nev, nb, V(-.3, 0, -1), { face: fb({ brow: -.4, mouth: k < .5 ? 'o' : 'smirk' }, t), handR: hd.clone().add(V(.05, -.05, 0)), handL: k > .5 ? bp.clone().add(V(0, .05, 0)) : undefined, look: k > .5 ? bp : hd.clone().add(V(0, .1, .3)) }); nev.root.visible = true;
  look(V(lerp(304.3, 304.0, k), 1.6, lerp(3.0, 2.7, k)), V(302.6, 1.2, .6), 38); };
// DAY TEN
S[31] = (t, k) => { LIGHT.morning(); showSet('bedroom'); clockT('6:59'); lieNev({ brow: -.2, mouth: 'smile', blink: 1 }); look(V(lerp(1.6, 1.2, k), 2.2, lerp(1.6, 1.2, k)), V(.2, .6, -.8), 40); };
S[32] = (t, k) => { LIGHT.morning(); showSet('bedroom'); clockT('6:59'); lieNev({ brow: -.2, mouth: 'smile', blink: 1 }); const h = nev.head.position; look(h.clone().add(V(.9, .5, .3)), h, 32); };
S[33] = (t, k) => { if (k < .5) { LIGHT.library(); showSet('library'); const kk = k / .5; library.pile.forEach((b, i) => b.visible = i < 6 + kk * 16); const nb = V(539.4, .45, .45); sitPose(nev, nb, V(0, 0, -1), { t, lean: .35, face: fb({ brow: -.5, mouth: 'flat' }, t), handL: V(539.25, .82, -.05), handR: V(539.6 + Math.sin(t * 20) * .03, .84, -.05), look: V(539.4, .78, -.1) }); nev.root.visible = true;
    look(V(lerp(542.5, 542, kk), 1.7, lerp(2.4, 2.0, kk)), V(540, 1.0, -.4), 40); }
  else { LIGHT.morning(); showSet('bedroom'); const kk = (k - .5) / .5; const i = sitPose(nev, V(.1, .5, -.4), V(0, 0, 1), { t, lean: .1, face: fb({ brow: -.3, mouth: 'smile' }, t), handL: V(-.05, .95, -.0), handR: V(.25, .82 + Math.sin(t * 16) * .03, .05), look: V(.1, .7, .4) }); nev.root.visible = true;
    guitar.visible = true; guitar.position.set(.18, .78, -.12); guitar.rotation.set(0, 0, 1.2); look(V(lerp(.9, .7, kk), 1.2, lerp(1.6, 1.3, kk)), V(.1, .95, -.3), 38); } };
S[34] = (t, k) => { LIGHT.morning(); showSet('bedroom'); const i = sitBed(t, { brow: -.5, mouth: talk(t, 34) || 'smirk' }, { fwd: V(0, 0, 1), look: V(.1, 1, 1.5) }); faceCU(i, k, { d0: .9, d1: .78, side: .15 }); };
S[35] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(29.4, 0, 12.6); standPose(jake, b, V(1, 0, .2), { face: fb({ brow: -.6, mouth: Math.sin(t * 13) > 0 ? 'o' : 'smile' }, t), handL: b.clone().add(V(.3, 1.3 + Math.sin(t * 6) * .1, -.2)), handR: b.clone().add(V(.35, 1.4 + Math.cos(t * 6) * .1, .25)), handModeL: 'open', handModeR: 'open', look: V(30.6, 1.2, 12.8) }); jake.root.visible = true;
  standPose(nev, V(30.6, 0, 12.8), V(-1, 0, -.1), { face: fb({ brow: .2, mouth: 'flat' }, t), look: jake.head.position }); nev.root.visible = true; look(V(30.1, 1.35, lerp(15.6, 15.0, k)), V(30, 1.2, 12.7), 38); };
// basketball
const COURT = V(360, 0, -1.2);
function court(t, o = {}) { LIGHT.gym(); showSet('gym'); gym.set(o.crowd ?? FZ, { up: o.up ?? 0, bob: o.bob ?? 0, talk: o.talk ?? 0 }); const tt = o.frozen ? FZ : t;
  [[-1.4, .3], [1.2, -.4], [-.3, -1.4], [1.6, .9]].forEach(([x, z], i) => { const c = kids[i]; const air = o.frozen && i === 0 ? .45 : 0; const b = COURT.clone().add(V(x, air, z)); standPose(c, b, V(0, 0, -1), { phase: tt * 4 + i, stride: o.frozen ? .2 : .2, face: { brow: -.4, mouth: 'o', blink: 0 }, handL: i === 0 ? b.clone().add(V(-.2, 1.8, -.1)) : undefined, handR: i === 0 ? b.clone().add(V(.2, 1.8, -.1)) : undefined, look: V(360, 3, -3.2) }); c.root.visible = true; }); }
S[36] = (t, k) => { court(t, { crowd: t, up: .3, talk: 1 }); const jb = V(361.2, 0, 1.0); standPose(jake, jb, V(-1, 0, -.4), { face: fb({ brow: -.7, mouth: yell(t, 36) || 'smile' }, t), handL: jb.clone().add(V(-.3, 1.5, -.1)), handR: jb.clone().add(V(.3, 1.5, -.1)), handModeL: 'fist', handModeR: 'fist', look: V(359.6, 1.4, .8) }); jake.root.visible = true;
  standPose(nev, V(359.6, 0, .9), V(1, 0, -.2), { face: fb(F.smug, t), look: jake.head.position }); nev.root.visible = true; ball.visible = true; ball.position.set(359.4, 1.2 + Math.abs(Math.sin(t * 6)) * .3, -1.0);
  if (k < .5) headCU(jake, k / .5, V(-.85, 0, -.3)); else look(V(362.6, 2.0, -.6), V(360.3, 1.3, .6), 42); };
S[37] = (t, k) => { const fz = k < .55; court(t, { frozen: fz, crowd: fz ? FZ : t, up: fz ? 0 : 1, bob: fz ? 0 : .12, talk: fz ? 0 : 1 }); const kk = prog(k, 0, .55); const rim = V(360, 3.05, -2.9);
  const bp = fz ? V(359.6, 1.6, -.4).lerp(rim.clone().add(V(0, .05, 0)), easeOut(kk)) : rim.clone().add(V(0, -1.2 * easeOut(prog(k, .55, .7)), 0)); ball.visible = true; ball.position.copy(bp);
  standPose(nev, V(359.9, 0, lerp(.2, -1.9, ease(kk))), V(0, 0, -1), { phase: fz ? t * 4 : 0, stride: fz ? .14 : 0, face: fb(F.smug, t), handR: fz ? bp.clone().add(V(.08, -.08, .05)) : undefined, look: rim }); nev.root.visible = true;
  const jb = V(360.7, 0, lerp(.6, -1.2, ease(kk))); standPose(jake, jb, V(-.2, 0, -1), { phase: fz ? t * 4 : 0, stride: fz ? .14 : 0, face: fb({ brow: -.8, mouth: fz ? 'smirk' : 'yell' }, t), handL: !fz ? jb.clone().add(V(-.35, 1.6, 0)) : undefined, handR: !fz ? jb.clone().add(V(.35, 1.6, 0)) : undefined, handModeL: 'fist', handModeR: 'fist', look: rim }); jake.root.visible = true;
  if (fz) look(V(363.6, 2.0, .6), V(360, 2.0, -1.6), 44); else look(V(364.2, 2.4, -2.2), V(359.5, 1.5, 1.6), 50); };
S[38] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'stats', big: '900 hours', sub: 'Extra time · and counting', bars: [.9, .95, 1, .9, 1, .95, 1, 1], time: '10:02' })); };
// THE TWIST
const DOOR = V(118.4, 0, -1.6);
S[39] = (t, k) => { LIGHT.kitchen(); showSet('house'); const mb = V(119.85, 0, -1.4); const nb = V(lerp(119.6, 118.75, ease(prog(k, 0, .6))), 0, lerp(-.3, -1.4, ease(prog(k, 0, .6))));
  standPose(nev, nb, k < .6 ? V(-.8, 0, -1) : V(1, 0, .45), { phase: k < .6 ? t * 4 : 0, stride: k < .6 ? .14 : 0, face: fb(F.calm, t), look: k > .6 ? V(119.85, 1.5, -1.4) : V(117, 1.3, -2.4) }); nev.root.visible = true;
  standPose(mom, mb, V(-1, 0, .45), { face: fb({ brow: .5, mouth: 'flat' }, t), look: nev.head.position, handL: k > .5 ? mb.clone().add(V(-.38, 1.0, .1)) : undefined, handModeL: 'open' }); mom.root.visible = true;
  look(V(lerp(119.5, 119.3, k), 1.45, lerp(1.7, 1.3, k)), V(119.3, 1.15, -1.4), 40); };
S[40] = (t, k) => { LIGHT.kitchen(); showSet('house'); const mb = V(119.85, 0, -1.4); const nh = V(118.75, 1.42, -1.4); standPose(mom, mb, V(-1, 0, .45), { face: fb({ brow: .6, mouth: talk(t, 40) || 'o' }, t), look: nh, handR: nh.clone().add(V(.1, .24, 0)), handModeR: 'open' }); mom.root.visible = true;
  standPose(nev, V(118.75, 0, -1.4), V(1, 0, .45), { face: fb({ brow: .2, mouth: 'flat' }, t), look: mom.head.position }); nev.root.visible = true; if (k < .55) headCU(mom, k / .55, V(-.6, -.03, .55)); else look(V(119.3, 1.4, .45), V(119.3, 1.25, -1.4), 38); };
S[41] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(30, 0, lerp(15, 13.5, k)); standPose(nev, b, V(0, 0, -1), { phase: t * 3.5, stride: .12, face: fb({ brow: .6, mouth: 'wavy' }, t), look: b.clone().add(V(0, 0, -.4)) }); nev.root.visible = true; look(b.clone().add(V(.8, 1.05, -2.7)), b.clone().add(V(0, .72, 0)), 40); };
S[42] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(30.6, 0, 12.8); standPose(nev, b, V(-1, 0, -.1), { face: fb(F.worried, t), handR: nev.head.position.clone().add(V(0, .16, .05)), handModeR: 'open', look: V(29, 1.4, 13) }); nev.root.visible = true; headCU(nev, k, V(-.75, .05, .5)); };
S[43] = (t, k) => { LIGHT.kitchen(); showSet('house'); marks.f(false); standPose(nev, V(118.65, 0, -2.2), V(1, 0, .1), { face: fb(F.calm, t), look: V(120, 1.3, -2.0) }); nev.root.visible = true; look(V(lerp(119.9, 119.6, k), 1.35, lerp(.2, -.2, k)), V(118.4, 1.15, -2.4), 40); };
S[44] = (t, k) => { LIGHT.kitchen(); showSet('house'); marks.f(k > .3); standPose(nev, V(119.05, 0, -2.15), V(-.3, 0, 1), { face: fb(k > .4 ? F.shock : F.calm, t), look: V(118.4, 1.4, -2.4) }); nev.root.visible = true; look(V(118.2, 1.45, -1.3), V(118.4, 1.35, -2.4), 34); };
S[45] = (t, k) => { LIGHT.school(14); showSet('school'); const b = V(29.4, 0, 12.6); standPose(jake, b, V(1, 0, .2), { face: fb({ brow: .9, mouth: talk(t, 45) || 'o', wide: true }, t), handR: nev.head.position.clone().add(V(-.25, -.08, 0)), pointDirR: V(1, 0, 0), handModeR: 'point', look: nev.head.position }); jake.root.visible = true;
  standPose(nev, V(30.6, 0, 12.8), V(-1, 0, -.1), { face: fb(F.worried, t), look: jake.head.position }); nev.root.visible = true; if (k < .5) headCU(jake, k / .5, V(.85, 0, .3)); else headCU(nev, (k - .5) / .5, V(-.7, -.06, .35), { push: .7 }); };
S[46] = (t, k) => { LIGHT.night(); showSet('bedroom'); clockT('11:02'); const i = holdSit(t, BED.seat, BED.fwd, { face: F.worried }); app(phone, { kind: 'calc', time: '11:02', light: .4 }); look(V(lerp(1.5, 1.2, k), 1.5, lerp(1.9, 1.5, k)), V(0, .85, -.1), 38); };
S[47] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'calc', time: '11:03', res: k < .3 ? '900' : '37.5', top: k < .3 ? '' : '900 h ÷ 24', unit: k < .3 ? 'hours' : 'days' })); };
S[48] = (t, k) => { LIGHT.night(); showSet('bedroom'); const i = holdSit(t, BED.seat, BED.fwd, { face: F.sad, look: V(.3, 1.1, 1.4) }); app(phone, { kind: 'calc', time: '11:03', light: .4 }); faceCU(i, k, { d0: 1.0, d1: .8 }); };
S[49] = (t, k) => { LIGHT.night(); showSet('bedroom'); const i = sitBed(t, F.sad, { fwd: V(0, 0, 1), look: V(0, .6, 1.5) }); nev.root.visible = true; look(V(lerp(-1.4, -1.2, k), 1.7, lerp(2.4, 2.1, k)), V(.2, .9, -.4), 44); };
S[50] = (t, k) => { LIGHT.kitchen(); showSet('house'); const b = V(119.9, 0, -1.6); standPose(mom, b, V(0, 0, 1), { face: { brow: -.3, mouth: 'smile', blink: 0 }, handL: b.clone().add(V(-.3, 1.0, .2)), look: V(119.9, 1.4, 2) }); mom.root.visible = true;
  const nb = V(lerp(121.8, 119.0, k), 0, -.4); standPose(nev, nb, V(-1, 0, 0), { phase: t * 3.5, stride: .12, face: fb(F.calm, t), look: V(117, 1.3, -.4) }); nev.root.visible = true; look(V(120.3, 1.4, 2.4), V(120, 1.1, -.9), 44); };
S[51] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); const x = lerp(301, 297, k), b = V(x, 0, 2.6); standPose(nev, b, V(-1, 0, 0), { phase: t * 3, stride: .11, face: fb(F.sad, t), look: V(x - 3, 1.3, 2.6) }); nev.root.visible = true; look(V(299, lerp(5.2, 4.2, k), 10.5), V(299, .8, 1.8), 40); };
S[52] = (t, k) => { LIGHT.night(); showSet('bedroom'); const i = sitBed(t, F.sad, { fwd: V(0, 0, 1), handR: V(.1, 1.18, -.2), look: V(0, 1, 1.5) }); faceCU(i, k, { d0: .85, d1: .7 }); };
S[53] = (t, k) => { const { jb } = cafeteria(t, { eat: false, jFace: { brow: -.7, mouth: Math.sin(t * 13) > 0 ? 'yell' : 'smile' }, jLook: V(32.3, 1.2, -2.3) }); kids.forEach(c => c.root.visible = false); trays.visible = false; const nb = V(jb.x, .45, jb.z - 1.3); sitPose(nev, nb, V(0, 0, 1), { t, lean: .2, face: fb({ brow: .2, mouth: 'flat' }, t), handL: V(jb.x - .15, .82, jb.z - 1.0), handR: V(jb.x + .15, .82, jb.z - 1.0), look: jake.head.position }); nev.root.visible = true;
  look(V(jb.x + lerp(2.2, 2.0, k), 1.4, jb.z - .65), V(jb.x, 1.0, jb.z - .65), 40); };
S[54] = (t, k) => { cafeteria(t, { eat: false, jFace: { brow: .8, mouth: talk(t, 54) || 'frown' }, jLook: V(32.3, 1.2, -2.3) }); kids.forEach(c => c.root.visible = false); trays.visible = false; headCU(jake, k, V(.45, .02, -.8)); };
S[55] = (t, k) => { LIGHT.night(); showSet('bedroom'); phoneCU(t, k, ph => app(ph, { kind: 'cal', time: '9:30' })); };
S[56] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); birds[0].set(V(297.5, 2.4, 3), .8, .3); birds[1].set(V(299, 3.1, 2.4), -.6, -1); const b = V(298.2, 0, 3.2); standPose(nev, b, V(0, 0, 1), { face: fb(F.worried, t), look: V(298.2 + Math.sin(t * .6) * 1.2, 1.45, 6) }); nev.root.visible = true; headCU(nev, k, V(.5, .05, 1.1)); };
S[57] = (t, k) => { LIGHT.town(); showSet('town'); townExtras(t, { frozen: true }); birds[0].set(V(296, 2.6, 2.5), .8, .3); birds[1].set(V(301, 3.2, 1.8), -.6, -1); birds[2].set(V(299, 2.2, 3.4), .3, 2); look(V(lerp(292, 294, k), 2.0, 8), V(lerp(298, 300, k), 1.2, 1.4), 40); };
S[58] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clockT('6:59'); const f = clock.front(); look(f.clone().add(V(.18, .08, lerp(.7, .4, ease(k)))), f, 32); };
S[59] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clockT('6:59'); const i = sitBed(t, F.sad, { fwd: V(0, 0, 1), lean: .45, handL: V(-.1, .75, .05), handR: V(.3, .75, .05), look: V(0, .4, 1) }); look(V(lerp(-.6, -1.4, k), lerp(1.4, 2.2, k), lerp(1.4, 3.0, k)), V(.1, .8, -.4), 40); };
const MK = V(120.9, 0, -1.6);
function momFrozen() { standPose(mom, MK, V(0, 0, 1), { face: { brow: -.3, mouth: 'smile', blink: 0 }, handL: MK.clone().add(V(-.3, 1.0, .25)), handR: MK.clone().add(V(.25, 1.05, .2)), look: V(120.9, 1.45, .6) }); mom.root.visible = true; }
S[60] = (t, k) => { LIGHT.kitchen(); showSet('house'); momFrozen(); const nb = V(120.9, 0, -.85); standPose(nev, nb, V(0, 0, -1), { face: fb({ brow: 1, mouth: talk(t, 60) || 'frown' }, t), look: mom.head.position, handR: k > .5 ? mom.head.position.clone().add(V(.15, 0, .3 + .05 * Math.sin(t * 8))) : undefined, handModeR: 'open' }); nev.root.visible = true;
  look(V(lerp(122.6, 122.3, k), 1.45, lerp(.6, .3, k)), V(120.9, 1.3, -1.2), 36); };
S[61] = (t, k) => { LIGHT.kitchen(); showSet('house'); momFrozen(); standPose(nev, V(120.9, 0, -.85), V(0, 0, -1), { face: fb(F.sad, t), look: mom.head.position, hide: { head: true } }); nev.root.visible = true; headCU(mom, k, V(.25, -.02, .8), { push: .8 }); };
// TRYING TO STOP
S[62] = (t, k) => { LIGHT.night(); showSet('bedroom'); clockT('11:58'); const i = sitBed(t, { brow: .3, mouth: 'flat' }, { look: clock.front() }); look(V(lerp(.9, .7, k), 1.1, lerp(1.3, 1.1, k)), V(-.3, .75, -.5), 38); };
S[63] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); ringing(t); lieNev(fb({ brow: .7, mouth: 'wavy', blink: .3 }, t)); look(V(lerp(1.2, .9, k), 1.5, lerp(1.3, 1.0, k)), V(-.35, .6, -.7), 38); };
S[64] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); ringing(t); const top = clock.top(); lieNev(fb({ brow: .7, mouth: 'wavy' }, t), { hipX: -.12, handL: V(-.3, .66, -.85).lerp(top.clone().add(V(.02, .14, 0)), ease(k) * .85).add(V(Math.sin(t * 30) * .006, 0, 0)), look: top }); look(top.clone().add(V(.55, .25, .75)), top.clone().add(V(.05, -.04, 0)), 34); };
S[65] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); ringing(t); const top = clock.top(); lieNev(fb({ brow: .9, mouth: 'frown' }, t), { hipX: -.12, handL: top.clone().add(V(.02, .14 - .03 * ease(k), 0)).add(V(Math.sin(t * 34) * .008, 0, 0)), look: top }); look(top.clone().add(V(.45, .2, .62)), top.clone().add(V(.02, .0, 0)), 32); };
S[66] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); ringing(t); const f = clock.front(); look(f.clone().add(V(-.1, .2, lerp(.6, .45, k))), f.clone().add(V(0, .05, 0)), 32); };
S[67] = (t, k) => { LIGHT.dawn(); showSet('bedroom'); const pull = easeOut(prog(k, .25, .45)); if (pull < .5) ringing(t); else clockT('', '#000', { on: 0 }); clock.set(pull < .5 ? '6:59' : '', '#ff4d4d', pull < .5 ? 1 : 0, 0, 0, 1 - pull);
  const pp = clock.plug.position; standPose(nev, V(-1.75, 0, .35), V(-.6, 0, -1), { hipDY: -.3, lean: .5, face: fb({ brow: -.6, mouth: 'frown' }, t), look: pp, handR: pp.clone().add(V(.05, .03, 0)) }); nev.root.visible = true; look(V(-1.0, 1.5, 1.5), V(-1.95, .45, -.25), 44); };
S[68] = (t, k) => { LIGHT.morning(); showSet('bedroom'); clockT('', '#000', { on: 0, plugged: 0 }); const i = holdSit(t, BED.seat, BED.fwd, { face: fb({ brow: lerp(.9, -.3, k), mouth: k < .5 ? 'o' : 'smile' }, t), look: V(.3, 1.1, 1.4) }); app(phone, { kind: 'clock', big: '7:42', sub: 'Late. For real.', light: .3 }); faceCU(i, k, { d0: 1.1, d1: .9 }); };
S[69] = (t, k) => { classroom(t, false, { tBrow: -.7, tMouth: talk(t, 69) || 'flat', tLook: CL.clone().add(V(2.6, 1.3, .8)) }); standPose(nev, CL.clone().add(V(2.6, 0, .8)), V(-1, 0, -.4), { face: fb({ brow: -.2, mouth: 'smile' }, t), look: teacher.head.position }); nev.root.visible = true; if (k < .5) headCU(teacher, k / .5, V(.5, -.03, 1.0)); else look(V(31.9, 1.4, -10.9), V(31.2, 1.2, -13.6), 40); };
S[70] = (t, k) => { classroom(t, false, { fast: 1 }); const c = wallClock.g.position; look(c.clone().add(V(-.1, -.05, lerp(1.4, 1.0, ease(k)))), c, 32); };
S[71] = (t, k) => { classroom(t, false, { fast: 1 }); const nb = CL.clone().add(V(1.2, .45, 2)); sitPose(nev, nb, V(0, 0, -1), { t, lean: .2, face: fb(F.happy, t), handL: CL.clone().add(V(1.05, .8, 1.5)), handR: CL.clone().add(V(1.35, .8, 1.5)), look: wallClock.g.position }); nev.root.visible = true; look(V(lerp(33.6, 33.2, k), 1.6, lerp(-9.6, -10, k)), V(30.6, 1.3, -14.4), 44); };
// HAPPY END
function hallTalk(t, jFace, nFace, o = {}) { LIGHT.school(14); showSet('school'); const b = V(29.4, 0, 12.6); standPose(jake, b, V(1, 0, .2), { face: fb(jFace, t), handL: o.jUp ? b.clone().add(V(.1, 1.6, -.2)) : undefined, handR: o.jUp ? b.clone().add(V(.5, 1.5, .2)) : undefined, handModeL: o.jUp ? 'fist' : 'grip', handModeR: o.jUp ? 'fist' : 'grip', look: V(30.6, 1.35, 12.8) }); jake.root.visible = true;
  standPose(nev, V(30.6, 0, 12.8), V(-1, 0, -.1), { face: fb(nFace, t), look: jake.head.position, handR: o.nGest ? V(30.25, 1.15 + Math.sin(t * 5) * .1, 13.0) : undefined, handModeR: 'open' }); nev.root.visible = true; }
S[72] = (t, k) => { hallTalk(t, { brow: .7, mouth: 'o' }, { brow: .2, mouth: Math.sin(t * 13) > 0 ? 'o' : 'flat' }, { nGest: 1 }); look(V(lerp(30.3, 30.1, k), 1.35, lerp(15.6, 15.0, k)), V(30, 1.2, 12.7), 38); };
S[73] = (t, k) => { hallTalk(t, { brow: -.6, mouth: yell(t, 73) || 'smile' }, F.happy, { jUp: k > .5 }); headCU(jake, k, V(.85, 0, .35)); };
S[74] = (t, k) => { hallTalk(t, { brow: -.8, mouth: Math.sin(t * 12) > 0 ? 'yell' : 'smile' }, { brow: -.6, mouth: Math.sin(t * 11) > 0 ? 'o' : 'smile' }, { jUp: 1 }); look(V(30.2, 1.4, 15.2), V(30, 1.2, 12.7), 40); };
S[75] = (t, k) => { hallTalk(t, { brow: .4, mouth: talk(t, 75) || 'flat' }, F.calm); headCU(jake, k, V(.85, 0, .35), { push: .8 }); };
S[76] = (t, k) => { hallTalk(t, { brow: -.2, mouth: 'smile' }, F.happy); headCU(nev, k, V(-.6, -.04, .5)); };
const KB = V(120.9, 0, -1.6);
function kitchenBday(t, mFace, o = {}) { LIGHT.kitchen(); showSet('house'); cake.visible = true; cake.position.set(121.6, .99, -2.1); const cp = V(121.1, 1.04, -1.15); card.visible = true; card.position.copy(cp); card.rotation.set(-.2, Math.PI, 0); card.rotateY(Math.PI);
  standPose(mom, KB, V(0, 0, 1), { face: fb(mFace, t), handL: cp.clone().add(V(-.09, -.1, 0)), handR: cp.clone().add(V(.09, -.1, 0)), look: o.mLook || cp }); mom.root.visible = true;
  standPose(nev, V(121.2, 0, -.55), V(-.3, 0, -1), { face: fb(o.nFace || F.happy, t), look: mom.head.position, handR: o.give ? cp.clone().add(V(.05, -.12, .06)) : undefined }); nev.root.visible = true; }
S[77] = (t, k) => { kitchenBday(t, { brow: .3, mouth: 'o' }, { give: k < .6 }); look(V(lerp(123.3, 123.0, k), 1.55, lerp(.9, .6, k)), V(121.0, 1.2, -1.3), 38); };
S[78] = (t, k) => { kitchenBday(t, { brow: .9, mouth: talk(t, 78) || 'smile' }, { mLook: k > .6 ? V(121.2, 1.4, -.55) : undefined }); headCU(mom, k, V(.25, -.03, .85)); };
S[79] = (t, k) => { kitchenBday(t, F.happy, { mLook: V(121.2, 1.4, -.55) }); headCU(nev, k, V(-.45, -.04, -.6)); };
S[80] = (t, k) => { kitchenBday(t, F.happy, { mLook: V(121.2, 1.4, -.55) }); look(V(lerp(123.8, 123.4, k), 1.8, lerp(1.6, 1.3, k)), V(121.0, 1.1, -1.2), 42); };
// 3:33 AM
S[81] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clockT('', '#000', { on: 0, plugged: 0 }); lieNev({ brow: -.1, mouth: 'smile', blink: 1 }); look(V(lerp(1.5, 1.2, k), 1.7, lerp(1.6, 1.3, k)), V(.1, .6, -.8), 40); };
S[82] = (t, k) => { LIGHT.dark(); showSet('bedroom'); const on = k > .55 && (k > .8 || Math.sin(t * 40) > 0); clockT('3:33', '#ff4d4d', { on: on ? 1 : 0, plugged: 0 }); lieNev({ brow: -.1, mouth: 'smile', blink: 1 }); look(V(lerp(.4, .2, k), 1.1, lerp(.7, .5, k)), V(-.6, .55, -.65), 36); };
S[83] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clock.set('3:33', Math.sin(t * 12) > 0 ? '#ff4d4d' : '#ff9a9a', 1, 0, Math.sin(t * 40) > 0 ? 1 : .2, 0); const f = clock.front(); look(f.clone().add(V(.1, .06, .42)), f, 30); };
S[84] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clock.set('3:33', Math.sin(t * 12) > 0 ? '#ff4d4d' : '#ff9a9a', 1, 0, Math.sin(t * 40) > 0 ? 1 : .2, 0); look(V(lerp(-.6, -.8, k), .9, lerp(.8, .6, k)), V(-1.3, .25, -.5), 40); };
S[85] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clock.set(t > ps(85) + .4 ? 'SNOOZED' : '3:33', '#7ff3ff', 1, 0, 0, 0); const f = clock.front(); look(f.clone().add(V(.05, .04, lerp(.45, .34, ease(k)))), f, 30); };
S[86] = (t, k) => { LIGHT.dark(); showSet('bedroom'); clock.set('SNOOZED', '#7ff3ff', 1, 0, 0, 0); const i = sitBed(t, F.shock, { look: V(-.5, 1.1, 1.5) }); faceCU(i, k, { d0: 1.0, d1: .8 }); };
function rainSt(t) { LIGHT.rain(); showSet('street'); street.setRain(FZ, 1); winLight.visible = false; }
S[87] = (t, k) => { rainSt(t); look(V(lerp(58, 59.5, k), 2.4, 7.5), V(lerp(59, 60.5, k), 1.8, 0), 44); };
S[88] = (t, k) => { rainSt(t); winLight.visible = k > .45; winLight.material.color.set(k > .45 ? '#ffd98a' : '#222'); look(V(lerp(60.6, 61.0, k), 2.0, lerp(6.5, 5.5, k)), V(61.6, 3.0, -3.4), 34); };
S[89] = (t, k) => { rainSt(t); winLight.visible = true; look(V(60, lerp(3.2, 3.6, k), lerp(9.5, 9.0, k)), V(60.5, 3.0, -2), 46); };
const WINDOWS = TL.map((l, i) => ({ start: i === 0 ? 0 : l.start - .15, fn: S[l.id], i: l.id }));
WINDOWS.forEach((w, i) => { w.end = i + 1 < WINDOWS.length ? WINDOWS[i + 1].start : END0; });

// ---------- overlay ----------
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
function txt(s, x, y, size, col, align = 'left', w = 800, stroke = 0) { og.save(); og.font = `${w} ${size}px Inter`; og.textAlign = align; og.textBaseline = 'middle'; og.shadowColor = 'rgba(0,0,0,.55)'; og.shadowBlur = 10; og.shadowOffsetY = 3;
  if (stroke) { og.lineJoin = 'round'; og.lineWidth = stroke; og.strokeStyle = 'rgba(20,12,4,.9)'; og.strokeText(s, x, y); } og.fillStyle = col; og.fillText(s, x, y); og.restore(); }
function goldTitle(lines, y0, size, a) { og.save(); og.globalAlpha = a; og.translate(W / 2, y0); og.scale(lerp(1.08, 1, a), lerp(1.08, 1, a));
  lines.forEach((s, i) => { const y = i * size * 1.18; og.font = `900 ${size}px Inter`; og.textAlign = 'center'; og.textBaseline = 'middle'; og.lineJoin = 'round'; og.lineWidth = size * .18; og.strokeStyle = '#06202a'; og.strokeText(s, 0, y);
    const gr = og.createLinearGradient(0, y - size / 2, 0, y + size / 2); gr.addColorStop(0, '#e8feff'); gr.addColorStop(.55, '#7ff3ff'); gr.addColorStop(1, '#2bb6d6'); og.fillStyle = gr; og.shadowColor = 'rgba(80,220,255,.6)'; og.shadowBlur = 30; og.fillText(s, 0, y); og.shadowBlur = 0; }); og.restore(); }
function overlay(t) {
  const fzA = frozenAt(t) ? 1 : 0; og.filter = fzA ? 'saturate(0.78) brightness(1.02)' : 'none'; og.drawImage(renderer.domElement, 0, 0); og.filter = 'none';
  if (fzA) { og.save(); og.globalCompositeOperation = 'soft-light'; og.fillStyle = 'rgba(90,200,255,.55)'; og.fillRect(0, 0, W, H); og.restore(); }
  const v = og.createRadialGradient(W / 2, H / 2, H * .5, W / 2, H / 2, H * 1.05); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, fzA ? 'rgba(10,40,70,.4)' : 'rgba(0,0,0,.25)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
  const w = WINDOWS.find(w => t >= w.start && t < w.end); const li = w ? w.i : -1;
  if (t < END0) {
    // extra-time counter
    const m = extra(t), last = SNOOZES.filter(d => t >= d).pop() ?? -9, pop = 1 + .25 * Math.max(0, 1 - (t - last) / .3);
    const aged = t >= ps(47) + 1 && t < ps(72) - .15;
    if (t > ps(1) + .7 && li !== 7) { const col = aged ? '#ff6b6b' : m === 0 ? '#4ee08a' : '#7ff3ff', s = aged ? '+37 days older' : fmtT(m), lab = aged ? 'YOUR BODY' : 'EXTRA TIME';
      og.save(); og.translate(W - 60, 70); og.scale(pop, pop); txt(s, 0, 0, 46, col, 'right', 800); og.restore(); txt(lab, W - 60, 118, 22, '#ffffff', 'right', 700);
      og.save(); og.translate(W - 60, 70); og.scale(pop, pop); og.font = '800 46px Inter'; const tw = og.measureText(s).width; og.lineWidth = 4; og.strokeStyle = col; og.beginPath(); og.arc(-tw - 34, 2, 15, 0, 7); og.stroke(); og.beginPath(); og.moveTo(-tw - 34, -13); og.lineTo(-tw - 34, -20); og.moveTo(-tw - 34, 2); og.lineTo(-tw - 34, -7); og.stroke(); og.restore(); }
    if (fzA) { og.save(); og.globalAlpha = .9; og.fillStyle = '#7ff3ff'; og.fillRect(W / 2 - 74, 50, 12, 34); og.fillRect(W / 2 - 54, 50, 12, 34); og.restore(); txt('TIME FROZEN', W / 2 - 30, 68, 30, '#e8feff', 'left', 800); }
    for (const d of SNOOZES) { const a = t - d; if (a >= 0 && a < .9) { og.save(); og.globalAlpha = a < .1 ? a / .1 : 1 - prog(a, .55, .9); txt('+9 min', W / 2, H - 190 - easeOut(a / .9) * 70, 76, '#7ff3ff', 'center', 900, 12); og.restore(); } }
    let lab = ''; for (const [i, l] of LABELS) if (t >= ps(i) - .15) lab = l; if (lab && li !== 7) txt(lab, 60, 64, 38, '#ffffff');
    if (CAPS[li] !== undefined) { const a = Math.min(easeOut(prog(t, w.start + .2, w.start + .5)), 1 - prog(t, w.end - .25, w.end)); og.save(); og.globalAlpha = a; txt(CAPS[li], W / 2, H - 90, 44, '#ffffff', 'center', 800, 9); og.restore(); }
    if (li === 7) { const a = Math.min(easeOut(prog(t, ps(7) + .3, ps(7) + .9)), 1); goldTitle(['WHAT IF YOUR SNOOZE BUTTON', 'COULD FREEZE TIME?'], H * .17, 84, a); }
    if (li === 32 || li === 31) { [0, 1, 2].forEach(j => { const a = ((t * .7 + j * .33) % 1); og.save(); og.globalAlpha = Math.sin(a * Math.PI); txt('z', W * .55 + j * 40 + a * 60, H * .38 - a * 160, 50 + j * 14, '#ffffff', 'center', 900, 8); og.restore(); }); }
    if (li === 83 || li === 84 || li === 0 || li === 63) { const a = Math.sin(t * 12) > 0 ? 1 : 0; if (a) txt('BEEP', W * .26, H * .3, 64, '#ff6b6b', 'center', 900, 10); }
    if (li === 89) { const a = easeOut(prog(t, ps(89) + .2, ps(89) + .8)); goldTitle(['WHAT WOULD YOU DO WITH', 'NINE FROZEN MINUTES?'], H * .15, 72, a); }
  }
  for (const x of WINDOWS) { const d = Math.abs(t - x.start); if (x.start > 0 && d < .05) { og.fillStyle = `rgba(0,0,0,${.5 * (1 - d / .05)})`; og.fillRect(0, 0, W, H); } }
  const snap = Math.abs(t - (ps(8) + .5)); if (snap < .25) { og.fillStyle = `rgba(255,255,255,${.7 * (1 - snap / .25)})`; og.fillRect(0, 0, W, H); }
  if (t < .3) { og.fillStyle = `rgba(0,0,0,${1 - t / .3})`; og.fillRect(0, 0, W, H); }
  if (t >= END0) { const a = easeOut(prog(t, END0, END0 + .6)); const gr = og.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2b2350'); gr.addColorStop(1, '#4a3a7a'); og.save(); og.globalAlpha = a; og.fillStyle = gr; og.fillRect(0, 0, W, H);
    og.textAlign = 'center'; og.textBaseline = 'middle'; og.font = '800 46px Inter'; og.fillStyle = '#00e5ff'; og.shadowColor = '#00e5ff'; og.shadowBlur = 25; og.fillText('B R E V A N E', W / 2, 150); og.shadowBlur = 0;
    og.font = '500 30px Inter'; og.fillStyle = '#cfc6f0'; og.fillText('Impossible ideas. Real consequences.', W / 2, 205);
    og.strokeStyle = 'rgba(255,255,255,.35)'; og.lineWidth = 4; og.setLineDash([14, 10]); og.strokeRect(220, 330, 880, 495); og.beginPath(); og.arc(1460, 578, 170, 0, 7); og.stroke(); og.setLineDash([]);
    og.font = '800 40px Inter'; og.fillStyle = 'rgba(255,255,255,.75)'; og.fillText('WATCH NEXT', 660, 578); og.fillText('SUBSCRIBE', 1460, 578); og.restore();
    if (t > DURATION - .6) { og.fillStyle = `rgba(0,0,0,${prog(t, DURATION - .6, DURATION)})`; og.fillRect(0, 0, W, H); } }
  return out;
}

// ---------- CONTRAST PASS (Ep3 review: white heads vanished on white walls/chairs) ----------
// 1) set surfaces that are near-white/pale-grey -> clear mid-tone pastel (hue per set area)  2) every character gets a dark ink outline
(() => {
  const isChar = o => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.char) return true; return false; };
  const SET_HUE = x => [.74, .45, .08, .56, .95, .13, .62, .33][Math.abs(Math.floor((x + 15) / 30)) % 8];
  const hsl = {}, wp = new THREE.Vector3(), bb = new THREE.Box3(), sz = new THREE.Vector3(), done = new Map();
  const OL = new THREE.MeshBasicMaterial({ color: '#2a2342', side: THREE.BackSide });
  const meshes = []; scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const m = o.material; if (!m || Array.isArray(m) || !m.color) continue;
    if (isChar(o)) { // outline
      if (m === OL || o.userData.noOutline || m.color.getHexString() === '0b0d14' || m.isMeshBasicMaterial) continue;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const r = g.boundingSphere.radius; if (r < .03) continue;
      const ol = new THREE.Mesh(g, OL); ol.castShadow = ol.receiveShadow = false; ol.raycast = () => {};
      if (g.type === 'CylinderGeometry' && g.parameters.height === 1) { const k = 1 + .011 / g.parameters.radiusTop; ol.scale.set(k, 1, k); }
      else if (g.type === 'TorusGeometry') { const k = 1 + .011 / g.parameters.tube * .35; ol.scale.set(k, k, k); }
      else ol.scale.setScalar(1 + .011 / Math.min(r, .25)); o.add(ol); continue; }
    if (m.map || m.transparent || !m.isMeshStandardMaterial || (m.emissive && m.emissiveIntensity > .2 && m.emissive.getHex() !== 0)) continue;
    const gt = o.geometry.type; if (gt === 'CircleGeometry' || gt === 'ConeGeometry') continue;
    o.getWorldPosition(wp); bb.setFromObject(o); bb.getSize(sz); if (gt === 'PlaneGeometry' && Math.max(sz.x, sz.y, sz.z) < 2) continue; // road paint
    m.color.getHSL(hsl); if (hsl.l < .7 && !(hsl.l >= .58 && hsl.s < .3)) continue;
    let nm = done.get(m); if (!nm) { nm = m.clone(); const h = hsl.s < .12 ? SET_HUE(wp.x) : hsl.h; nm.color.setHSL(h, Math.max(hsl.s, .4), .55 + Math.max(0, hsl.l - .6) * .25); done.set(m, nm); }
    o.material = nm;
  }
})();

window.frame = (t, q = .92) => {
  for (const c of CAST) c.root.visible = false; for (const e of extras) e.g.visible = false; for (const p of ALL_PROPS) p.visible = false; fries.forEach(f => f.visible = false); blanket.visible = false;
  phone.g.visible = false; school.paper.visible = false; street.umb.visible = false; school.tray.position.set(0, -5, 0); gym.spot.intensity = 0; bloom.strength = .28;
  clock.plug.visible = false; winLight.visible = false; library.pile.forEach(b => b.visible = true); extras.forEach(e => e.head.rotation.x = 0);
  stache.visible = t >= ps(45) - .15 && t < ps(72) - .15; marks.f(false); clock.set('6:59', '#ff4d4d', 1, 0, 0, 1);
  if (t < END0) { const w = WINDOWS.find(w => t >= w.start && t < w.end) || WINDOWS[WINDOWS.length - 1]; w.fn(t, clamp((t - w.start) / (w.end - w.start))); }
  else { showSet('none'); }
  composer.render(); return overlay(t).toDataURL('image/jpeg', q);
};
window.DUR = DURATION; window.ready = true; window.TIMING = TL; window.END0 = END0;
