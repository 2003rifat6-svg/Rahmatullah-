// Environments. Each set is a Group placed far from the others; only the active one is visible.
import { THREE, scene, std, box, mesh, canvasTex, V, rng } from './core.js';

function group(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); return g; }
function cityTex(day) {
  return canvasTex(1024, 768, (g, w, h) => {
    const sg = g.createLinearGradient(0, 0, 0, h);
    if (day) { sg.addColorStop(0, '#7fb6f0'); sg.addColorStop(1, '#ffd9a8'); } else { sg.addColorStop(0, '#1b2350'); sg.addColorStop(.75, '#4b3f86'); sg.addColorStop(1, '#8a5d9a'); }
    g.fillStyle = sg; g.fillRect(0, 0, w, h);
    if (day) { g.fillStyle = '#fff4d6'; g.shadowColor = '#fff1cc'; g.shadowBlur = 80; g.beginPath(); g.arc(780, 200, 70, 0, 7); g.fill(); g.shadowBlur = 0; }
    else { g.fillStyle = '#fff5df'; g.shadowColor = '#fff1cc'; g.shadowBlur = 60; g.beginPath(); g.arc(760, 150, 60, 0, 7); g.fill(); g.shadowBlur = 0; const r = rng(5); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${.3 + .6 * r()})`; g.fillRect(r() * w, r() * h * .45, 2, 2); } }
    let x = 0; const r2 = rng(9);
    while (x < w) { const bw = 60 + r2() * 110, bh = 180 + r2() * 330; g.fillStyle = day ? '#6b7fa6' : '#141433'; g.fillRect(x, h - bh, bw - 8, bh);
      for (let y = h - bh + 18; y < h - 12; y += 30) for (let xx = x + 10; xx < x + bw - 20; xx += 22) if (r2() < .3) { g.fillStyle = day ? 'rgba(220,235,255,.7)' : 'rgba(255,205,130,.85)'; g.fillRect(xx, y, 9, 14); }
      x += bw; }
  });
}
const NIGHT = cityTex(false), DAY = cityTex(true);

// ---------- BEDROOM (origin) ----------
export const bedroom = (() => {
  const g = group(0, 0);
  const floor = mesh(g, new THREE.PlaneGeometry(10, 10), std('#3a4466', .7)); floor.rotation.x = -Math.PI / 2;
  const wall = std('#46578a', .95);
  const back = mesh(g, new THREE.PlaneGeometry(10, 5), wall, 0, 2.5, -1.9); const side = mesh(g, new THREE.PlaneGeometry(10, 5), wall, -2.2, 2.5, 0); side.rotation.y = Math.PI / 2;
  const win = mesh(g, new THREE.PlaneGeometry(1.5, 1.05), new THREE.MeshBasicMaterial({ map: NIGHT, toneMapped: false, color: '#99a8cc' }), -0.55, 1.55, -1.88);
  const frameMat = std('#e7dccb', .6);
  for (const [w, h, x, y] of [[1.6, .06, -0.55, 2.08], [1.6, .06, -0.55, 1.02], [.06, 1.1, -1.32, 1.55], [.06, 1.1, .22, 1.55], [.04, 1.05, -0.55, 1.55]]) box(g, w, h, .06, frameMat, x, y, -1.86);
  const bedMat = std('#2a3558', .7);
  box(g, 2.0, .32, 1.95, bedMat, .55, .16, -.85); box(g, 1.94, .16, 1.9, std('#e6e3dc', .9), .55, .4, -.85);
  const blanket = box(g, 1.96, .08, 1.2, std('#3c5aa0', .95), .55, .5, -.55);
  const pillow = mesh(g, new THREE.CapsuleGeometry(.14, .55, 6, 16), std('#f0ede6', .9), .95, .56, -1.6); pillow.rotation.z = Math.PI / 2;
  box(g, 2.05, .9, .08, bedMat, .55, .6, -1.84);
  const stand = box(g, .48, .52, .42, std('#5a4a6a', .7), -0.85, .26, -0.6);
  const lampShade = mesh(g, new THREE.CylinderGeometry(.1, .15, .18, 24, 1, true), std('#f3d29b', .6, { side: THREE.DoubleSide, emissive: '#f3b06a', emissiveIntensity: .5 }), -0.95, .88, -0.68);
  box(g, .03, .3, .03, std('#2a2030'), -0.95, .67, -0.68);
  const lamp = new THREE.PointLight('#ffb36b', 0, 4, 1.6); lamp.position.set(-0.95, .9, -0.6); g.add(lamp);
  const clockBody = box(g, .26, .1, .09, std('#0b0d14', .3), -0.8, .57, -0.55, .35);
  const clockCv = document.createElement('canvas'); clockCv.width = 256; clockCv.height = 96; const clockTex = new THREE.CanvasTexture(clockCv); clockTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.24, .085), new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false })); face.position.z = .0455; clockBody.add(face);
  function setClock(txt) { const c = clockCv.getContext('2d'); c.fillStyle = '#04070d'; c.fillRect(0, 0, 256, 96); c.font = '700 70px "JetBrains Mono"'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#7ff3ff'; c.fillText(txt, 128, 52); clockTex.needsUpdate = true; }
  // desk with charger near the window (for the plugged-in phone)
  const desk = box(g, 1.0, .05, .5, std('#6a4e3a', .7), 1.6, .74, -1.5); for (const dx of [-.45, .45]) box(g, .05, .72, .05, std('#4a3628'), 1.6 + dx, .36, -1.5);
  const poster = mesh(g, new THREE.PlaneGeometry(.55, .75), new THREE.MeshBasicMaterial({ map: canvasTex(400, 540, (c, w, h) => { c.fillStyle = '#2F3B57'; c.fillRect(0, 0, w, h); c.fillStyle = '#F2A65A'; c.beginPath(); c.arc(200, 210, 110, 0, 7); c.fill(); c.fillStyle = '#EADBC8'; c.font = '900 54px Inter'; c.textAlign = 'center'; c.fillText('SUNSET', 200, 440); }) }), 1.6, 1.7, -1.87);
  return { g, win, lamp, setClock, seat: V(0, .5, -.05), bedTop: .5, nightstandTop: V(-0.85, .53, -0.6), desk: V(1.6, .77, -1.5),
    day(on) { win.material.map = on ? DAY : NIGHT; win.material.color.set(on ? '#ffffff' : '#99a8cc'); win.material.needsUpdate = true; } };
})();

// ---------- SCHOOL: cafeteria (x=30), classroom (x=30,z=-14), hallway (x=30,z=14) ----------
export const school = (() => {
  const g = group(30, 0);
  const tiles = canvasTex(512, 512, (c, w, h) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#e9e4d6' : '#c9d6c8'; c.fillRect(x * 64, y * 64, 64, 64); } });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(8, 8);
  const floor = mesh(g, new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ map: tiles, roughness: .6 })); floor.rotation.x = -Math.PI / 2;
  const wall = std('#9cc7b4', .9);
  mesh(g, new THREE.PlaneGeometry(16, 5), wall, 0, 2.5, -4); const sw = mesh(g, new THREE.PlaneGeometry(16, 5), wall, -5, 2.5, 0); sw.rotation.y = Math.PI / 2;
  for (const x of [-3, 0, 3]) mesh(g, new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: DAY, toneMapped: false }), x, 2.0, -3.98);
  const table = std('#d8cfc0', .6), bench = std('#6f8fbf', .7);
  const tables = [];
  for (const [x, z] of [[-1.6, -1.6], [1.4, -1.6], [-1.6, .9], [1.4, .9]]) {
    box(g, 2.2, .06, .8, table, x, .74, z); for (const dx of [-1, 1]) box(g, .06, .72, .6, std('#8a8f99'), x + dx, .36, z);
    for (const dz of [-.65, .65]) box(g, 2.2, .06, .3, bench, x, .45, z + dz);
    for (let i = 0; i < 3; i++) { const tx = x - .7 + i * .7; box(g, .36, .03, .26, std(['#e46b5a', '#5aa0e4', '#f2b33d'][i]), tx, .78, z - .2); mesh(g, new THREE.SphereGeometry(.05, 12, 8), std('#f2d08a'), tx - .07, .81, z - .2); }
    tables.push(V(x, 0, z));
  }
  const puddle = mesh(g, new THREE.CircleGeometry(.28, 32), std('#eef6ff', .05, { metalness: .2, emissive: '#cfe6ff', emissiveIntensity: .25 }), .2, .008, 2.6); puddle.rotation.x = -Math.PI / 2; puddle.scale.set(1.4, 1, 1);
  const tray = box(g, .4, .03, .3, std('#e46b5a'), 0, -1, 0); // flying tray (montage)
  // classroom
  const cl = new THREE.Group(); cl.position.set(0, 0, -14); g.add(cl);
  mesh(cl, new THREE.PlaneGeometry(10, 5), std('#e6d7b8', .9), 0, 2.5, -3); const board = mesh(cl, new THREE.PlaneGeometry(3.2, 1.3), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 420, (c, w, h) => { c.fillStyle = '#25493a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2f2e8'; c.font = '700 90px Inter'; c.fillText('QUIZ: CHAPTER 7', 80, 170); c.font = '500 50px Inter'; c.fillText('No phones. No talking.', 80, 300); }) }), 0, 1.7, -2.97);
  const deskM = std('#c99b6b', .7);
  for (const [x, z] of [[-1.2, 0], [1.2, 0], [-1.2, 1.5], [1.2, 1.5]]) { box(cl, .8, .05, .55, deskM, x, .74, z); for (const dx of [-.35, .35]) box(cl, .04, .72, .04, std('#555'), x + dx, .36, z); box(cl, .45, .45, .45, std('#6f8fbf'), x, .225, z + .5); }
  const paperCv = document.createElement('canvas'); paperCv.width = 256; paperCv.height = 340; const paperTex = new THREE.CanvasTexture(paperCv); paperTex.colorSpace = THREE.SRGBColorSpace;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(.21, .28), new THREE.MeshBasicMaterial({ map: paperTex, side: THREE.DoubleSide })); g.add(paper);
  function setGrade(gr) { const c = paperCv.getContext('2d'); c.fillStyle = '#fbfaf5'; c.fillRect(0, 0, 256, 340); c.strokeStyle = '#c9d4e6'; for (let y = 60; y < 340; y += 28) { c.beginPath(); c.moveTo(16, y); c.lineTo(240, y); c.stroke(); }
    c.font = '900 170px Inter'; c.fillStyle = gr === 'A' ? '#2bb36b' : '#e23b3b'; c.textAlign = 'center'; c.fillText(gr, 128, 250); paperTex.needsUpdate = true; }
  // hallway
  const hw = new THREE.Group(); hw.position.set(0, 0, 14); g.add(hw);
  const lockerM = std('#3e6fb3', .5, { metalness: .2 });
  for (let i = 0; i < 14; i++) { for (const sx of [-1.6, 1.6]) { const l = box(hw, .5, 1.8, .4, lockerM, sx, .9, -6 + i * .55); l.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; } }
  mesh(hw, new THREE.PlaneGeometry(4, 5), std('#dfe7ee'), 0, 2.5, -6.5);
  return { g, tables, puddle, tray, paper, setGrade, classroom: cl, hallway: hw };
})();

// ---------- STREET in the rain (x=60) ----------
export const street = (() => {
  const g = group(60, 0);
  const road = mesh(g, new THREE.PlaneGeometry(40, 8), std('#3a3f4a', .9), 0, .001, 3); road.rotation.x = -Math.PI / 2;
  const walk = mesh(g, new THREE.PlaneGeometry(40, 3), std('#8f97a6', .8), 0, .02, -1); walk.rotation.x = -Math.PI / 2;
  const r = rng(3);
  for (let i = 0; i < 12; i++) { const h = 3 + r() * 6, w = 2.5 + r() * 2; const b = box(g, w, h, 2, std(['#7a8aa8', '#a48b7a', '#8aa39a', '#9a8aa8'][i % 4], .9), -18 + i * 3.2, h / 2, -4.5);
    const wt = canvasTex(256, 256, (c) => { c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, 256, 256); for (let y = 20; y < 256; y += 50) for (let x = 20; x < 256; x += 60) { c.fillStyle = '#cfe0f0'; c.fillRect(x, y, 32, 30); } });
    const facade = mesh(g, new THREE.PlaneGeometry(w * .9, h * .9), new THREE.MeshStandardMaterial({ map: wt, transparent: true }), -18 + i * 3.2, h / 2, -3.49); }
  // rain
  const N = 2500, pos = new Float32Array(N * 6); const seeds = [];
  const rr = rng(11); for (let i = 0; i < N; i++) seeds.push([rr() * 20 - 10, rr() * 6, rr() * 9 - 4, 6 + rr() * 3]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: .55 })); g.add(rain);
  function setRain(t, on = 1) { rain.visible = on > 0; const a = geo.attributes.position.array;
    seeds.forEach(([x, y, z, sp], i) => { const yy = ((y - t * sp) % 6 + 6) % 6; a.set([x, yy, z, x + .02, yy + .25, z], i * 6); }); geo.attributes.position.needsUpdate = true; }
  // umbrella
  const umb = new THREE.Group(); g.add(umb);
  mesh(umb, new THREE.SphereGeometry(.55, 24, 12, 0, Math.PI * 2, 0, Math.PI * .38), std('#2f6fd6', .6, { side: THREE.DoubleSide }), 0, 0, 0);
  mesh(umb, new THREE.CylinderGeometry(.01, .01, .9, 8), std('#222'), 0, -.45, 0);
  return { g, setRain, umb };
})();

// ---------- SHOE STORE (x=90) ----------
export const store = (() => {
  const g = group(90, 0);
  const floor = mesh(g, new THREE.PlaneGeometry(12, 12), std('#d9cbb5', .7)); floor.rotation.x = -Math.PI / 2;
  mesh(g, new THREE.PlaneGeometry(12, 5), std('#f1e4d0', .9), 0, 2.5, -2.5);
  const shelfM = std('#ffffff', .6);
  const sneakerCols = ['#e4572e', '#2f6fd6', '#f2b33d', '#2bb36b', '#9b5de5', '#ffffff'];
  for (let row = 0; row < 4; row++) { box(g, 3.6, .04, .4, shelfM, 0, .5 + row * .45, -2.25);
    for (let i = 0; i < 6; i++) { const s = mesh(g, new THREE.CapsuleGeometry(.06, .16, 4, 10), std(sneakerCols[(i + row) % 6], .5), -1.5 + i * .6, .58 + row * .45, -2.2); s.rotation.z = Math.PI / 2; } }
  const held = mesh(g, new THREE.CapsuleGeometry(.065, .17, 4, 10), std('#e4572e', .5)); held.rotation.z = Math.PI / 2;
  const tag = mesh(g, new THREE.PlaneGeometry(.5, .2), new THREE.MeshBasicMaterial({ map: canvasTex(256, 100, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 100); c.fillStyle = '#e23b3b'; c.font = '900 56px Inter'; c.textAlign = 'center'; c.fillText('$189.99', 128, 70); }) }), 0, 2.4, -2.48);
  return { g, held };
})();

// ---------- HOUSE: entry + kitchen (x=120) ----------
export const house = (() => {
  const g = group(120, 0);
  const floor = mesh(g, new THREE.PlaneGeometry(12, 12), std('#9a6b4b', .7)); floor.rotation.x = -Math.PI / 2;
  const wall = std('#e8c9a0', .9);
  mesh(g, new THREE.PlaneGeometry(12, 5), wall, 0, 2.5, -2.5); const sw = mesh(g, new THREE.PlaneGeometry(12, 5), wall, -3, 2.5, 0); sw.rotation.y = Math.PI / 2;
  box(g, 1.0, 2.1, .08, std('#6b4a35', .6), -1.6, 1.05, -2.45); mesh(g, new THREE.SphereGeometry(.03, 10, 8), std('#d8b36a', .3, { metalness: .8 }), -1.2, 1.0, -2.39);
  const table = box(g, .6, .05, .35, std('#5a4033', .7), -.4, .85, -2.2); for (const dx of [-.25, .25]) box(g, .04, .83, .04, std('#3a2a22'), -.4 + dx, .42, -2.2);
  const bowl = mesh(g, new THREE.CylinderGeometry(.09, .06, .05, 20), std('#7fa0c8', .4), -.4, .9, -2.2);
  const keys = new THREE.Group(); g.add(keys); mesh(keys, new THREE.TorusGeometry(.018, .004, 8, 16), std('#d8b36a', .3, { metalness: .8 })); box(keys, .012, .05, .004, std('#c0c6cf', .3, { metalness: .8 }), 0, -.035, 0); box(keys, .03, .02, .012, std('#222'), .02, .0, 0);
  // kitchen
  box(g, 2.4, .9, .6, std('#f4f1ea', .6), 1.6, .45, -2.15); box(g, 2.4, .04, .62, std('#c9b9a4', .5), 1.6, .92, -2.15);
  box(g, 2.4, .7, .35, std('#f4f1ea', .6), 1.6, 1.9, -2.3);
  const lamp = new THREE.PointLight('#ffc27a', 0, 6, 1.4); lamp.position.set(.5, 2.2, -.5); g.add(lamp);
  const winM = new THREE.MeshBasicMaterial({ map: DAY, toneMapped: false }); const win = mesh(g, new THREE.PlaneGeometry(1.2, .9), winM, .4, 1.6, -2.48);
  return { g, keys, bowl, lamp, win, day(on) { winM.map = on ? DAY : NIGHT; winM.needsUpdate = true; } };
})();

// ---------- HIGHWAY (x=220) ----------
export const highway = (() => {
  const g = group(220, 0);
  const ground = mesh(g, new THREE.PlaneGeometry(400, 400), std('#7fa36a', .95)); ground.rotation.x = -Math.PI / 2;
  const roadM = std('#45484f', .9);
  const hwy = mesh(g, new THREE.PlaneGeometry(400, 14), roadM, 0, .01, -60); hwy.rotation.x = -Math.PI / 2;
  const local = mesh(g, new THREE.PlaneGeometry(6, 200), roadM, 0, .01, 20); local.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 40; i++) { const l = mesh(g, new THREE.PlaneGeometry(.15, 1.5), std('#f2f2f2'), 0, .02, -80 + i * 5); l.rotation.x = -Math.PI / 2; }
  const r = rng(4); const carCols = ['#e4572e', '#2f6fd6', '#f2f2f2', '#2bb36b', '#333', '#f2b33d'];
  for (let i = 0; i < 70; i++) { const c = box(g, 4, 1.4, 1.9, std(carCols[i % 6], .4), -120 + i * 3.6 + r(), .7, -62 + (i % 3) * 2.4); }
  // smoke column
  const smoke = new THREE.Group(); g.add(smoke); smoke.position.set(10, 0, -62);
  for (let i = 0; i < 14; i++) mesh(smoke, new THREE.SphereGeometry(2 + i * .45, 16, 12), std('#5d5d66', 1, { transparent: true, opacity: .55 }), (r() - .5) * 3 + i * .6, 2 + i * 2.2, (r() - .5) * 2);
  // school bus + mom's car on the local road
  const bus = new THREE.Group(); g.add(bus); box(bus, 2.6, 2.8, 9, std('#f2b632', .5), 0, 1.6, 0); for (let i = 0; i < 5; i++) box(bus, 2.62, .8, 1.2, std('#22314a', .2), 0, 2.2, -3 + i * 1.6); bus.position.set(0, 0, 10);
  const car = new THREE.Group(); g.add(car); box(car, 1.9, 1.0, 4.2, std('#8a4fbf', .4), 0, .7, 0); box(car, 1.7, .7, 2.2, std('#2a3048', .2), 0, 1.45, -.2); car.position.set(0, 0, 18);
  return { g, bus, car };
})();

export const SETS = { bedroom, school, street, store, house, highway };
export function showSet(name) { for (const k in SETS) SETS[k].g.visible = k === name; }
