// Ep2 extra sets: neighborhood exterior (x=300), gym + stage (x=360), news studio (x=420), lake/boat (x=480). Cheap crowd extras.
import { THREE, scene, std, box, mesh, canvasTex, V, rng } from './core.js';
import { SETS } from './sets.js';
function group(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); return g; }
const sign = (w, h, txt, bg, fg, font = '900 120px Inter') => new THREE.MeshBasicMaterial({ map: canvasTex(1024, Math.round(1024 * h / w), (c, W, H) => { c.fillStyle = bg; c.fillRect(0, 0, W, H); c.fillStyle = fg; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, W / 2, H / 2 + 6); }) });

// ---------- cheap crowd extra ----------
const HEAD = std('#f3f6fb', .45), EYE = std('#0b0d14', .3);
export function makeExtra(col, parent) {
  const g = new THREE.Group(); (parent || scene).add(g); g.userData.char = true; const m = std(col, .75);
  const body = mesh(g, new THREE.CapsuleGeometry(.15, .35, 6, 14), m, 0, .62, 0);
  mesh(g, new THREE.CapsuleGeometry(.06, .3, 4, 8), std('#1a1f2b', .8), -.07, .2, 0); mesh(g, new THREE.CapsuleGeometry(.06, .3, 4, 8), std('#1a1f2b', .8), .07, .2, 0);
  const head = new THREE.Group(); g.add(head); head.position.y = 1.08; mesh(head, new THREE.SphereGeometry(.2, 20, 14), HEAD);
  for (const s of [-1, 1]) { const e = mesh(head, new THREE.SphereGeometry(.035, 10, 8), EYE, s * .07, .02, .175); e.scale.set(1, 1.4, .5); }
  const mouth = mesh(head, new THREE.SphereGeometry(.03, 10, 8), EYE, 0, -.08, .18); mouth.scale.set(1.2, .6, .4);
  const arms = [-1, 1].map(s => { const p = new THREE.Group(); g.add(p); p.position.set(s * .18, .85, 0); const a = mesh(p, new THREE.CapsuleGeometry(.045, .26, 4, 8), m, 0, -.16, 0); mesh(p, new THREE.SphereGeometry(.05, 8, 6), HEAD, 0, -.33, 0); return p; });
  return { g, head, mouth, arms, set(t, o = {}) { const up = o.up ?? 0, bob = o.bob ?? 0, talk = o.talk ?? 0;
    g.position.y = Math.max(0, Math.sin(t * 7 + (o.ph || 0))) * bob;
    arms[0].rotation.z = -lerpA(.15, 2.7, up) - Math.sin(t * 7 + (o.ph || 0)) * .25 * up; arms[1].rotation.z = lerpA(.15, 2.7, up) + Math.cos(t * 7 + (o.ph || 0)) * .25 * up;
    mouth.scale.y = talk ? (Math.sin(t * 15 + (o.ph || 0)) > 0 ? 1.6 : .5) : .5; head.rotation.y = o.turn || 0; } };
}
const lerpA = (a, b, k) => a + (b - a) * k;

// ---------- NEIGHBORHOOD EXTERIOR (x=300) ----------
export const town = (() => {
  const g = group(300, 0);
  const grass = mesh(g, new THREE.PlaneGeometry(120, 120), std('#8fcf7a', .95)); grass.rotation.x = -Math.PI / 2;
  const road = mesh(g, new THREE.PlaneGeometry(120, 6), std('#5b5f6b', .9), 0, .01, 4); road.rotation.x = -Math.PI / 2;
  const walk = mesh(g, new THREE.PlaneGeometry(120, 1.6), std('#d9d4c8', .9), 0, .02, 0.4); walk.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 30; i++) { const l = mesh(g, new THREE.PlaneGeometry(1.2, .12), std('#f4f1e6'), -60 + i * 4, .02, 4); l.rotation.x = -Math.PI / 2; }
  const r = rng(21);
  function houseAt(x, z, wall, roof) { const h = new THREE.Group(); g.add(h); h.position.set(x, 0, z);
    box(h, 4, 2.6, 3.4, std(wall, .85), 0, 1.3, 0); const rf = mesh(h, new THREE.ConeGeometry(3.1, 1.5, 4), std(roof, .8), 0, 3.35, 0); rf.rotation.y = Math.PI / 4; rf.scale.set(1, 1, .85);
    box(h, .8, 1.5, .08, std('#7a4a35', .6), 0, .75, 1.72); for (const s of [-1, 1]) box(h, .8, .7, .06, std('#bfe3ff', .2, { emissive: '#ffe7b0', emissiveIntensity: .15 }), s * 1.2, 1.5, 1.72);
    return h; }
  const cols = [['#f2e3c6', '#c4553f'], ['#cfe3f2', '#4a5f8a'], ['#f5d1dc', '#7a4f6b'], ['#e6f0cf', '#5a7a3f'], ['#f2d9a6', '#8a5a3a']];
  const houses = []; for (let i = 0; i < 9; i++) { const [w, rf] = cols[i % 5]; houses.push(houseAt(-24 + i * 6, -4.5 - (i % 2) * .6, w, rf)); }
  function tree(x, z, s = 1) { mesh(g, new THREE.CylinderGeometry(.12 * s, .16 * s, 1.4 * s, 8), std('#7a5236'), x, .7 * s, z); mesh(g, new THREE.SphereGeometry(.9 * s, 12, 10), std('#5fae5a', .9), x, 1.9 * s, z); }
  for (let i = 0; i < 16; i++) tree(-27 + i * 3.6 + r() * .8, -1.6 - r() * .4, .8 + r() * .4);
  // school
  const sch = new THREE.Group(); g.add(sch); sch.position.set(30, 0, -8);
  box(sch, 16, 5, 6, std('#c9694f', .85), 0, 2.5, 0); box(sch, 16.4, .4, 6.4, std('#e8e2d6'), 0, 5.1, 0);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) box(sch, 1.2, 1.1, .08, std('#bfe3ff', .2), -6 + i * 2, 1.6 + j * 2, 3.02);
  box(sch, 2.4, 2.2, .1, std('#3a4a6a', .4), 0, 1.1, 3.03);
  const plate = mesh(sch, new THREE.PlaneGeometry(6, .9), sign(6, .9, 'MAPLE RIDGE HIGH', '#2a3a5a', '#ffffff', '900 110px Inter'), 0, 4.2, 3.06);
  mesh(sch, new THREE.CylinderGeometry(.06, .06, 7, 8), std('#ddd'), 9.5, 3.5, 4); const flag = mesh(sch, new THREE.PlaneGeometry(1.4, .9), std('#3b6fd6', .7, { side: THREE.DoubleSide }), 10.2, 6.4, 4);
  // driveway car with bow + taco truck
  const car = new THREE.Group(); g.add(car); car.position.set(-6, 0, -1.2);
  box(car, 1.9, .8, 4, std('#8a4fbf', .35, { metalness: .3 }), 0, .6, 0); box(car, 1.7, .65, 2.1, std('#cfe6ff', .15), 0, 1.25, -.2);
  for (const [x, z] of [[-.95, 1.2], [.95, 1.2], [-.95, -1.3], [.95, -1.3]]) { const w = mesh(car, new THREE.CylinderGeometry(.33, .33, .25, 16), std('#222'), x, .33, z); w.rotation.z = Math.PI / 2; }
  const bow = new THREE.Group(); car.add(bow); bow.position.set(0, 1.62, -.2); for (const s of [-1, 1]) { const b = mesh(bow, new THREE.TorusGeometry(.22, .07, 8, 16), std('#e23b3b', .5), s * .2, 0, 0); b.rotation.y = Math.PI / 2; } mesh(bow, new THREE.SphereGeometry(.1, 10, 8), std('#e23b3b', .5));
  const truck = new THREE.Group(); g.add(truck); truck.position.set(6, 0, 2.6);
  box(truck, 5, 2.6, 2.3, std('#f2b632', .5), 0, 1.6, 0); box(truck, 2.6, 1, .06, std('#2a2030'), .3, 2, 1.17);
  const tsign = mesh(truck, new THREE.PlaneGeometry(3.6, .8), sign(3.6, .8, 'TACO KING', '#e23b3b', '#fff4d6', '900 150px Inter'), 0, 3.25, 1.18);
  for (const x of [-1.6, 1.6]) { const w = mesh(truck, new THREE.CylinderGeometry(.42, .42, .3, 16), std('#222'), x, .42, 1.05); w.rotation.x = Math.PI / 2; }
  return { g, houses, sch, car, truck, flag };
})();

// ---------- GYM + STAGE (x=360) ----------
export const gym = (() => {
  const g = group(360, 0);
  const wood = canvasTex(512, 512, (c) => { for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#d9a764' : '#cf9a57'; c.fillRect(0, i * 32, 512, 32); } c.strokeStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 16; i++) { c.beginPath(); c.moveTo(0, i * 32); c.lineTo(512, i * 32); c.stroke(); } });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(6, 6);
  const floor = mesh(g, new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: wood, roughness: .5 })); floor.rotation.x = -Math.PI / 2;
  const wall = std('#cfd8ea', .9); mesh(g, new THREE.PlaneGeometry(30, 10), wall, 0, 5, -6);
  for (const s of [-1, 1]) { const w = mesh(g, new THREE.PlaneGeometry(30, 10), wall, s * 11, 5, 0); w.rotation.y = -s * Math.PI / 2; }
  box(g, 8, .9, 3, std('#5a3a6a', .6), 0, .45, -4.4); // stage
  mesh(g, new THREE.PlaneGeometry(9, 4.5), std('#8a2a3a', .8), 0, 3.1, -5.95);
  const banner = mesh(g, new THREE.PlaneGeometry(6, 1.1), sign(6, 1.1, 'TALENT SHOW', '#ffd34d', '#5a2a10', '900 150px Inter'), 0, 4.6, -5.9);
  const spot = new THREE.SpotLight('#fff1d6', 0, 14, .35, .5, 1.2); spot.position.set(0, 7, 2); spot.target.position.set(0, .9, -4.2); g.add(spot, spot.target);
  // bleachers + crowd (both sides facing the stage)
  const cols = ['#2f6fd6', '#f2b33d', '#9b5de5', '#e46b9a', '#4aa3a3', '#3fae6a', '#ff8c42', '#e23b3b', '#7a8599', '#5ac8e6'];
  const crowd = []; const r = rng(8);
  for (let row = 0; row < 4; row++) { box(g, 18, .35, .9, std('#9aa4b8', .7), 0, .18 + row * .4, 1.2 + row * .9);
    for (let i = 0; i < 16; i++) { const e = makeExtra(cols[(i + row * 3) % 10], g); e.g.position.set(-7.6 + i * 1.0 + (r() - .5) * .2, .35 + row * .4, 1.2 + row * .9); e.g.rotation.y = Math.PI + (r() - .5) * .3; e.base = e.g.position.y; crowd.push(e); } }
  return { g, crowd, spot, set(t, o) { crowd.forEach((e, i) => { e.set(t, { up: o.up, bob: o.bob, talk: o.talk, ph: i * 1.7 }); e.g.position.y += e.base; }); } };
})();

// ---------- NEWS STUDIO (x=420) ----------
export const studio = (() => {
  const g = group(420, 0);
  const floor = mesh(g, new THREE.PlaneGeometry(14, 14), std('#1d2a4a', .4)); floor.rotation.x = -Math.PI / 2;
  mesh(g, new THREE.PlaneGeometry(14, 6), std('#203a6e', .8), 0, 3, -3);
  const scrCv = document.createElement('canvas'); scrCv.width = 1280; scrCv.height = 720; const scrTex = new THREE.CanvasTexture(scrCv); scrTex.colorSpace = THREE.SRGBColorSpace;
  const screen = mesh(g, new THREE.PlaneGeometry(4.2, 2.36), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }), 1.6, 2.1, -2.95);
  box(g, 3.2, 1.0, 1.0, std('#e8ecf3', .4), 0, .5, -.6); box(g, 3.3, .06, 1.1, std('#3b6fd6', .4), 0, 1.02, -.6);
  const front = mesh(g, new THREE.PlaneGeometry(3.2, .5), sign(3.2, .5, 'BNN NEWS', '#e23b3b', '#ffffff', '900 120px Inter'), 0, .55, -.09);
  function draw(t) { const c = scrCv.getContext('2d'); const gr = c.createLinearGradient(0, 0, 0, 720); gr.addColorStop(0, '#0b2a6a'); gr.addColorStop(1, '#06163a'); c.fillStyle = gr; c.fillRect(0, 0, 1280, 720);
    c.fillStyle = '#e23b3b'; c.fillRect(0, 70, 1280, 110); c.fillStyle = '#fff'; c.font = '900 76px Inter'; c.textBaseline = 'middle'; c.fillText('BREAKING', 50, 126);
    c.font = '900 120px Inter'; c.fillStyle = '#ffd34d'; c.fillText('THE $1 NAME', 60, 330); c.font = '600 54px Inter'; c.fillStyle = '#dfe6f2'; c.fillText('Mystery charges hit 14 million Americans', 62, 450);
    c.fillStyle = '#ffd34d'; c.fillRect(0, 610, 1280, 110); c.fillStyle = '#10204a'; c.font = '700 48px Inter'; const tk = 'SAY IT AND PAY IT  •  POLICE: "DO NOT SAY THE NAME"  •  BANKS CONFUSED  •  '; c.fillText(tk + tk, 40 - (t * 160) % 1400, 666); scrTex.needsUpdate = true; }
  return { g, draw };
})();

// ---------- LAKE + BOAT (x=480) ----------
export const lake = (() => {
  const g = group(480, 0);
  const water = mesh(g, new THREE.PlaneGeometry(200, 200), std('#5ab0d6', .25, { metalness: .1 })); water.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 5; i++) { const m = mesh(g, new THREE.ConeGeometry(8 + i * 2, 9 + i * 3, 5), std(['#7f9cab', '#8fb0bf', '#a6c4cf'][i % 3], .9), -30 + i * 14, 3, -40 - i * 4); const cap = mesh(g, new THREE.ConeGeometry(3.2, 3, 5), std('#f4f8fb'), -30 + i * 14, 6.6 + i * 1.5, -40 - i * 4); }
  const boat = new THREE.Group(); g.add(boat); box(boat, 1.8, .6, 4.2, std('#c94f3a', .6), 0, .3, 0); box(boat, 1.3, 1.1, 1.3, std('#f4f1ea', .6), 0, 1.0, .9);
  const rod = mesh(boat, new THREE.CylinderGeometry(.015, .02, 2.2, 6), std('#3a2a22'), .5, 1.6, -1.2); rod.rotation.x = -.8;
  return { g, boat };
})();
Object.assign(SETS, { town, gym, studio, lake });
