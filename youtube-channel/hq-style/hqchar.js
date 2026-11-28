// Brevane HQ character — big glossy head, 3D eyes/brows, knit hoodie, cargo pants, sneakers, glove hands.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, k) => a + (b - a) * k;

// ---------- procedural fabric normal maps ----------
function normalMap(size, hfn, strength = 2, rep = [1, 1]) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = hfn(x / size, y / size);
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + (x + 1) % size] - h[y * size + (x - 1 + size) % size], hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    let nx = -hx * strength, ny = -hy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); const i = (y * size + x) * 4;
    img.data[i] = (nx / l * .5 + .5) * 255; img.data[i + 1] = (ny / l * .5 + .5) * 255; img.data[i + 2] = (nz / l * .5 + .5) * 255; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); return t;
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noiseGrid = (() => { const n = 64, a = new Float32Array(n * n); for (let i = 0; i < n * n; i++) a[i] = rnd(); return (u, v, f) => { const x = u * f, y = v * f, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (i, j) => a[((((yi + j) % n) + n) % n) * n + ((((xi + i) % n) + n) % n)]; const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  return lerp(lerp(s(0, 0), s(1, 0), sx), lerp(s(0, 1), s(1, 1), sx), sy); }; })();
const KNIT = normalMap(512, (u, v) => .5 * Math.abs(Math.sin(u * Math.PI * 96)) + .35 * Math.sin(v * Math.PI * 2 * 64 + Math.sin(u * Math.PI * 96) * 1.5) * .3 + noiseGrid(u, v, 32) * .5 + noiseGrid(u, v, 8) * .8, 3.5, [4, 4]);
const RIB = normalMap(256, (u, v) => Math.abs(Math.sin(u * Math.PI * 24)) + noiseGrid(u, v, 16) * .15, 5, [2, 1]);
const TWILL = normalMap(512, (u, v) => .35 * Math.sin((u + v) * Math.PI * 2 * 60) + noiseGrid(u, v, 32) * .6 + noiseGrid(u, v, 6) * 1.2, 3, [3, 3]);
const SHOE = normalMap(256, (u, v) => noiseGrid(u, v, 48) * .5, 2, [2, 2]);

// ---------- face texture (patch over the front of the head) ----------
const PH0 = -.9, PHL = 1.8, TH0 = .45, THL = 1.45, FS = 2048;     // patch spans yaw [-.9,.9], pitch [-1.0,.45]
function faceCanvas(ex) {
  const c = document.createElement('canvas'); c.width = c.height = FS; const g = c.getContext('2d');
  const at = (yaw, pitch, fn) => { const X = (yaw - PH0) / PHL * FS, Y = (TH0 - pitch) / THL * FS; g.save(); g.setTransform(FS / PHL / Math.cos(pitch), 0, 0, FS / THL, X, Y); fn(); g.restore(); };
  // soft eye-socket shading (gives the "set in" depth)
  for (const s of [-1, 1]) at(s * .32, .05, () => { const r = g.createRadialGradient(0, 0, .2, 0, 0, .34); r.addColorStop(0, 'rgba(150,120,135,.32)'); r.addColorStop(1, 'rgba(150,120,135,0)'); g.fillStyle = r; g.beginPath(); g.ellipse(0, 0, .34, .38, 0, 0, 7); g.fill(); });
  // blush
  if (ex.blush) for (const s of [-1, 1]) at(s * .43, -.22, () => { const r = g.createRadialGradient(0, 0, 0, 0, 0, .12); r.addColorStop(0, `rgba(255,140,150,${ex.blush})`); r.addColorStop(1, 'rgba(255,140,150,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, .12, 0, 7); g.fill(); });
  // chin / under-mouth soft shade
  at(0, -.5, () => { const r = g.createRadialGradient(0, 0, 0, 0, 0, .25); r.addColorStop(0, 'rgba(160,130,140,.12)'); r.addColorStop(1, 'rgba(160,130,140,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, .25, 0, 7); g.fill(); });
  at(0, -.34, () => {
    g.lineCap = g.lineJoin = 'round';
    const mouthFill = path => { g.save(); path(); g.clip();
        const r = g.createLinearGradient(0, -.05, 0, .14); r.addColorStop(0, '#2a0a10'); r.addColorStop(1, '#6a1c24'); g.fillStyle = r; g.fillRect(-.3, -.3, .6, .6);
        g.fillStyle = '#ef6f7c'; g.beginPath(); g.ellipse(0, ex.tongueY ?? .11, .075, .045, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,190,195,.5)'; g.beginPath(); g.ellipse(-.02, (ex.tongueY ?? .11) - .015, .03, .012, 0, 0, 7); g.fill();
        if (ex.teeth) { g.fillStyle = '#fbfbf8'; g.fillRect(-.3, -.3, .6, .3 + ex.teeth); }
        g.restore(); path(); g.strokeStyle = '#3a1016'; g.lineWidth = .012; g.stroke(); };
    if (ex.mouth === 'grin') mouthFill(() => { g.beginPath(); g.moveTo(-.13, -.025); g.quadraticCurveTo(0, .0, .13, -.025); g.bezierCurveTo(.12, .09, .06, .14, 0, .14); g.bezierCurveTo(-.06, .14, -.12, .09, -.13, -.025); g.closePath(); });
    if (ex.mouth === 'shock') mouthFill(() => { g.beginPath(); g.ellipse(0, .04, .07, .095, 0, 0, 7); });
    const line = (pts, w = .022) => { g.strokeStyle = '#2e1a1e'; g.lineWidth = w; g.beginPath(); g.moveTo(...pts[0]); g.quadraticCurveTo(...pts[1], ...pts[2]); g.stroke(); };
    if (ex.mouth === 'frown') line([[-.075, .05], [0, -.03], [.075, .05]]);
    if (ex.mouth === 'hmm') line([[-.06, .03], [.0, -.015], [.065, .01]], .02);
    if (ex.mouth === 'smile') line([[-.08, -.01], [0, .07], [.08, -.01]]);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------- expressions ----------
export const EXPR = {
  happy: { brow: [[.43, .41, .05], [.43, .41, .05]], lid: [.08, .08], slant: 0, gaze: [0, .1], mouth: 'grin', teeth: .015, blush: .35 },
  angry: { brow: [[.29, .45, -.01], [.29, .45, -.01]], lid: [.4, .4], slant: .38, gaze: [0, -.15], mouth: 'frown', blush: 0, iris: '#5a2414' },
  think: { brow: [[.37, .38, .0], [.47, .44, .05]], lid: [.22, .14], slant: 0, gaze: [.45, .55], mouth: 'hmm', blush: .12 },
  shock: { brow: [[.5, .47, .05], [.5, .47, .05]], lid: [0, 0], slant: 0, gaze: [0, 0], mouth: 'shock', teeth: 0, tongueY: .12, blush: .3, big: 1.08, pupil: .8 },
  neutral: { brow: [[.42, .41, .03], [.42, .41, .03]], lid: [.12, .12], slant: 0, gaze: [0, 0], mouth: 'smile', blush: .15 },
};

// ---------- pose library (arm targets written as RIGHT arm; char faces +z, char right = -x) ----------
const S = V(-.29, 1.07, -.01);
export const POSES = {
  happy: { R: { e: V(-.44, .86, .12), w: V(-.38, 1.0, .3), hand: 'thumb', y: V(.6, 0, -.8), x: V(0, 1, 0) },
           L: { e: V(-.36, .86, -.02), w: V(-.17, .75, .2), hand: null } },
  angry: { R: { e: V(-.32, .86, .2), w: V(.16, .93, .27), hand: 'fist', y: V(1, .05, .1), x: V(0, 1, 0) },
           L: { e: V(-.32, .87, .16), w: V(.17, .87, .22), hand: 'fist', y: V(1, -.05, .1), x: V(0, 1, 0) } },
  think: { R: { e: V(-.24, .78, .22), w: V(-.06, .99, .27), hand: 'point', y: V(.12, 1, .05), x: V(0, 0, 1) },
           L: { e: V(-.33, .82, .1), w: V(.13, .83, .27), hand: 'fist', y: V(1, 0, 0), x: V(0, 1, 0) } },
  shock: { R: { e: V(-.45, .92, .14), w: V(-.31, 1.23, .2), hand: 'open', y: V(.22, 1, .05), x: V(0, 0, 1) },
           L: { e: V(-.45, .92, .14), w: V(-.31, 1.23, .2), hand: 'open', y: V(.22, 1, .05), x: V(0, 0, 1) } },
  idle:  { R: { e: V(-.35, .84, 0), w: V(-.37, .63, .03), hand: 'relax', y: V(0, -1, .1), x: V(0, 0, 1) },
           L: { e: V(-.35, .84, 0), w: V(-.37, .63, .03), hand: 'relax', y: V(0, -1, .1), x: V(0, 0, 1) } },
};

export function makeHQ(o = {}) {
  const col = o.hoodie || '#D2512E', shoeCol = o.shoe || col, strCol = o.string || '#f4f4f0';
  const ex = EXPR[o.expr || 'neutral'], pose = POSES[o.pose || 'idle'];
  const root = new THREE.Group();
  const add = (geo, mat, p, parent = root) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.copy(p); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const skin = new THREE.MeshPhysicalMaterial({ color: '#f7f4f1', roughness: .38, clearcoat: .45, clearcoatRoughness: .3, sheen: .5, sheenColor: new THREE.Color('#ffe1d8'), sheenRoughness: .5 });
  const hood = new THREE.MeshPhysicalMaterial({ color: col, roughness: .88, normalMap: KNIT, normalScale: new THREE.Vector2(.35, .35), sheen: .5, sheenColor: new THREE.Color(col).lerp(new THREE.Color('#fff'), .25), sheenRoughness: .8 });
  const hoodRib = hood.clone(); hoodRib.normalMap = RIB; hoodRib.normalScale = new THREE.Vector2(1.4, 1.4);
  const pants = new THREE.MeshPhysicalMaterial({ color: '#1e1e24', roughness: .9, normalMap: TWILL, normalScale: new THREE.Vector2(1, 1), sheen: .6, sheenColor: new THREE.Color('#5a5a6a'), sheenRoughness: .8 });
  const black = new THREE.MeshStandardMaterial({ color: '#030202', roughness: .7, envMapIntensity: .08 });

  // ---- head ----
  const R = .38, HC = V(0, 1.55, .02);
  const head = new THREE.Group(); head.position.copy(HC); root.add(head);
  add(new THREE.SphereGeometry(R, 128, 96), skin, null, head);
  const face = add(new THREE.SphereGeometry(R + .0015, 96, 96, Math.PI / 2 + PH0, PHL, Math.PI / 2 - TH0, THL),
    new THREE.MeshPhysicalMaterial({ map: faceCanvas(ex), transparent: true, roughness: .4, clearcoat: .45, clearcoatRoughness: .3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), null, head);
  face.castShadow = false;
  const dir = (yaw, pitch) => V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  // eyes
  const sclera = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: .08, clearcoat: 1, clearcoatRoughness: .02 });
  const irisM = new THREE.MeshPhysicalMaterial({ color: ex.iris || '#3b2316', roughness: .15, clearcoat: 1, clearcoatRoughness: .02 });
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  [-1, 1].forEach((s, i) => {
    const n = dir(s * .32, .05), e = new THREE.Group(); e.position.copy(n.clone().multiplyScalar(R - .018)); e.lookAt(n.clone().multiplyScalar(5)); head.add(e);
    const big = ex.big || 1, sc = V(.088 * big, .106 * big, .05);
    add(new THREE.SphereGeometry(1, 64, 48), sclera, null, e).scale.copy(sc);
    const gx = (ex.gaze[0]) * .022, gy = ex.gaze[1] * .026, pu = ex.pupil || 1;
    const iris = add(new THREE.SphereGeometry(1, 48, 32), irisM, V(gx, gy, .04), e); iris.scale.set(.06 * big, .066 * big, .018);
    const pup = add(new THREE.SphereGeometry(1, 32, 24), black, V(gx, gy, .047), e); pup.scale.set(.038 * pu * big, .042 * pu * big, .018);
    add(new THREE.SphereGeometry(.019, 16, 12), glint, V(gx + .022, gy + .028, .061), e).castShadow = false;
    add(new THREE.SphereGeometry(.009, 12, 10), glint, V(gx - .02, gy - .026, .06), e).castShadow = false;
    // upper lid (hemisphere sweeping down over the eyeball)
    const cover = ex.lid[i]; if (cover > .01) { const lg = new THREE.Group(); lg.scale.set(sc.x * 1.07, sc.y * 1.07, sc.z * 1.25); e.add(lg);
      const lid = add(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), skin, null, lg); lid.rotation.order = 'ZYX';
      lid.rotation.x = -Math.PI / 2 + cover * Math.PI; lid.rotation.z = s * ex.slant; }
  });
  // brows: tapered tubes lying on the skull
  [-1, 1].forEach((s, i) => {
    const [inn, out, arch] = ex.brow[i], pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(dir(s * (.12 + .4 * t), lerp(inn, out, t) + arch * Math.sin(Math.PI * t)).multiplyScalar(R + .008)); }
    const cv = new THREE.CatmullRomCurve3(pts), TS = 40, RS = 16, geo = new THREE.TubeGeometry(cv, TS, .032, RS, false), p = geo.attributes.position;
    for (let a = 0; a <= TS; a++) { const t = a / TS, c = cv.getPointAt(t), f = .3 + .7 * Math.pow(Math.sin(Math.PI * Math.min(.999, .08 + t * .95)), .5);
      for (let b = 0; b <= RS; b++) { const j = a * (RS + 1) + b; const v = V(p.getX(j), p.getY(j), p.getZ(j)).sub(c); const nrm = c.clone().normalize(); const dn = v.dot(nrm);
        v.sub(nrm.clone().multiplyScalar(dn * .45)); v.multiplyScalar(f).add(c); p.setXYZ(j, v.x, v.y, v.z); } }
    geo.computeVertexNormals(); add(geo, black, null, head);
    for (const t of [0, 1]) { const sp = add(new THREE.SphereGeometry(.032 * (t ? .3 : .42), 16, 12), black, cv.getPointAt(t), head); }
  });
  if (o.curl !== false) { // Nev's signature little hair curl
    const pts = []; for (let k = 0; k <= 30; k++) { const t = k / 30, a = t * Math.PI * 1.7; pts.push(V(.03 * Math.sin(a) - .01, R - .01 + t * .07 + .025 * (1 - Math.cos(a)), .06 + .035 * Math.cos(a) - t * .04)); }
    const cv = new THREE.CatmullRomCurve3(pts), geo = new THREE.TubeGeometry(cv, 40, .014, 10, false); add(geo, black, null, head); add(new THREE.SphereGeometry(.014, 10, 8), black, cv.getPointAt(1), head); }

  // ---- hoodie torso ----
  const torso = new THREE.Group(); torso.scale.z = .8; root.add(torso);
  const prof = [[.255, .66], [.285, .72], [.3, .84], [.3, .97], [.285, 1.05], [.24, 1.11], [.14, 1.16], [.001, 1.17]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(prof, 64), hood, null, torso);
  const wb = add(new THREE.CylinderGeometry(.262, .255, .085, 64, 1, true), hoodRib, V(0, .655, 0), torso);
  add(new THREE.TorusGeometry(.258, .012, 10, 64), hoodRib, V(0, .612, 0), torso).rotation.x = Math.PI / 2;
  // kangaroo pocket (raised patch with rolled edges)
  const pk = [[.288, .7], [.302, .71], [.312, .79], [.31, .85], [.296, .862]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(pk, 40, -.62, 1.24), hood, null, torso);
  for (const s of [-1, 1]) { const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10, y = lerp(.71, .85, t), r = lerp(.302, .31, Math.sin(Math.PI * t)) + .004, ph = s * lerp(.62, .5, t);
      pts.push(V(r * Math.sin(ph), y, r * Math.cos(ph))); } add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, .007, 8, false), hood, null, torso); }
  // hood bunched around the neck + drawstrings
  const hb = add(new THREE.TorusGeometry(.19, .07, 24, 64), hood, V(0, 1.15, -.02)); hb.rotation.x = Math.PI / 2 - .12; hb.scale.set(1.08, 1, .9);
  add(new THREE.SphereGeometry(1, 32, 24), hood, V(0, 1.2, -.19)).scale.set(.21, .14, .1);
  const strM = new THREE.MeshPhysicalMaterial({ color: strCol, roughness: .5, sheen: .5 }), tip = new THREE.MeshStandardMaterial({ color: '#e8e8ec', roughness: .25, metalness: .3 });
  for (const s of [-1, 1]) { const pts = [V(s * .055, 1.13, .2), V(s * .06, 1.05, .243), V(s * .065, .97, .25), V(s * .07, .91, .248)];
    const cv = new THREE.CatmullRomCurve3(pts); add(new THREE.TubeGeometry(cv, 24, .0095, 10, false), strM);
    add(new THREE.TorusGeometry(.013, .005, 8, 16), black, pts[0]);
    const tp = add(new THREE.CylinderGeometry(.011, .011, .035, 12), tip, V(s * .071, .89, .248)); }

  // ---- arms ----
  function arm(side, a) {
    const g = new THREE.Group(); if (side > 0) g.scale.x = -1; root.add(g);
    const e = a.e, w = a.w, sh = S.clone(); const d = w.clone().sub(e).normalize();
    const cv = new THREE.CatmullRomCurve3([sh, sh.clone().lerp(e, .55).add(V(0, 0, 0)), e, e.clone().lerp(w, .5), w.clone().sub(d.clone().multiplyScalar(.04))], false, 'centripetal');
    const TS = 48, RS = 20, geo = new THREE.TubeGeometry(cv, TS, .075, RS, false), p = geo.attributes.position;
    for (let k = 0; k <= TS; k++) { const t = k / TS, c = cv.getPointAt(t), f = lerp(1.12, .86, t) * (1 + .05 * Math.sin(t * Math.PI * 7));
      for (let b = 0; b <= RS; b++) { const j = k * (RS + 1) + b, v = V(p.getX(j), p.getY(j), p.getZ(j)).sub(c).multiplyScalar(f).add(c); p.setXYZ(j, v.x, v.y, v.z); } }
    geo.computeVertexNormals(); const m = add(geo, hood, null, g); m.geometry.attributes.uv.array.forEach((_, i, arr) => { if (i % 2 === 0) arr[i] *= 3; });
    add(new THREE.SphereGeometry(.085, 24, 18), hood, sh, g); add(new THREE.SphereGeometry(.069, 20, 14), hood, e, g);
    // ribbed cuff
    const cuffEnd = w.clone().sub(d.clone().multiplyScalar(.01)); const cuff = add(new THREE.CylinderGeometry(.056, .06, .06, 32, 1, false), hoodRib, cuffEnd.clone().sub(d.clone().multiplyScalar(.03)), g);
    cuff.quaternion.setFromUnitVectors(V(0, 1, 0), d);
    if (a.hand) { const h = hand(a.hand); h.position.copy(w); const y = a.y.clone().normalize(), x = a.x.clone().sub(y.clone().multiplyScalar(a.x.dot(y))).normalize(), z = new THREE.Vector3().crossVectors(x, y);
      h.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); g.add(h); }
  }
  // glove hand: +y fingers, +x thumb side, +z back of hand
  function hand(shape) {
    const h = new THREE.Group(); h.scale.setScalar(1.4); const gm = skin;
    const palm = add(new THREE.SphereGeometry(1, 32, 24), gm, V(0, .05, 0), h); palm.scale.set(.052, .058, .03);
    const curl = { thumb: [1.6, 1.7], fist: [1.6, 1.7], point: [1.6, 1.7], open: [.12, .1], relax: [.5, .4] }[shape];
    [.03, .01, -.01, -.029].forEach((x, i) => { let c = curl; if (shape === 'point' && i === 0) c = [.05, .05];
      const l1 = [.036, .04, .038, .03][i], f1 = new THREE.Group(); f1.position.set(x * (shape === 'open' ? 1.15 : 1), .095, 0); f1.rotation.x = -c[0]; f1.rotation.z = shape === 'open' ? -x * .9 : 0; h.add(f1);
      add(new THREE.CapsuleGeometry(.0155, l1, 6, 14), gm, V(0, l1 / 2, 0), f1);
      const f2 = new THREE.Group(); f2.position.y = l1; f2.rotation.x = -c[1]; f1.add(f2); add(new THREE.CapsuleGeometry(.0145, l1 * .8, 6, 14), gm, V(0, l1 * .4, 0), f2); });
    const t1 = new THREE.Group(); t1.position.set(.042, .03, -.008); h.add(t1);
    if (shape === 'thumb') { t1.rotation.set(.15, 0, -1.45); } else if (shape === 'fist' || shape === 'point') { t1.rotation.set(-.9, 0, -.5); } else { t1.rotation.set(-.2, 0, -.75); }
    add(new THREE.CapsuleGeometry(.018, .035, 6, 14), gm, V(0, .028, 0), t1);
    const t2 = new THREE.Group(); t2.position.y = .05; t2.rotation.x = shape === 'thumb' ? .05 : -.4; t1.add(t2); add(new THREE.CapsuleGeometry(.017, .028, 6, 14), gm, V(0, .02, 0), t2);
    return h;
  }
  arm(-1, pose.R); { const L = pose.L; arm(1, L); }

  // ---- legs: cargo pants ----
  add(new THREE.SphereGeometry(1, 32, 24), pants, V(0, .66, 0)).scale.set(.25, .1, .19);
  for (const s of [-1, 1]) {
    const leg = add(new THREE.CylinderGeometry(.105, .09, .52, 40, 6, true), pants, V(s * .12, .4, 0)); leg.rotation.z = s * .03;
    const lp = leg.geometry.attributes.position; for (let j = 0; j < lp.count; j++) { const y = lp.getY(j), x = lp.getX(j), z = lp.getZ(j); const k = 1 + .03 * Math.sin(y * 40 + x * 30) * (y < -.15 ? 1 : .3); lp.setXYZ(j, x * k, y, z * k); } leg.geometry.computeVertexNormals();
    add(new THREE.TorusGeometry(.088, .022, 12, 40), pants, V(s * .135, .155, 0)).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(.094, .014, 10, 40), pants, V(s * .13, .2, 0)).rotation.x = Math.PI / 2 + .1;
    // cargo pocket + flap + button
    const pkt = add(new RoundedBoxGeometry(.045, .15, .13, 3, .015), pants, V(s * .215, .4, .01)); pkt.rotation.z = s * .03;
    const fl = add(new RoundedBoxGeometry(.05, .04, .14, 3, .012), pants, V(s * .222, .48, .01)); fl.rotation.z = s * .03;
    add(new THREE.CylinderGeometry(.009, .009, .006, 12), black, V(s * .25, .475, .01)).rotation.z = Math.PI / 2;
  }
  // ---- sneakers ----
  const shoeM = new THREE.MeshPhysicalMaterial({ color: shoeCol, roughness: .55, normalMap: SHOE, clearcoat: .2 }), white = new THREE.MeshPhysicalMaterial({ color: '#f7f7f5', roughness: .45, clearcoat: .3 });
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.scale.setScalar(1.22); sh.position.set(s * .14, 0, .04); sh.rotation.y = s * .12; root.add(sh);
    add(new RoundedBoxGeometry(.15, .055, .31, 4, .025), white, V(0, .028, .01), sh);
    add(new THREE.BoxGeometry(.152, .008, .3), new THREE.MeshStandardMaterial({ color: '#c9c9cc', roughness: .6 }), V(0, .012, .01), sh);
    add(new THREE.SphereGeometry(1, 32, 24), shoeM, V(0, .085, -.02), sh).scale.set(.073, .075, .13);
    add(new THREE.SphereGeometry(1, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2), white, V(0, .05, .09), sh).scale.set(.07, .05, .07);
    add(new THREE.TorusGeometry(.06, .016, 10, 28), shoeM, V(0, .16, -.05), sh).rotation.x = Math.PI / 2 + .25;
    for (let k = 0; k < 4; k++) { const z = .05 - k * .035, y = .135 + k * .008; const l = add(new RoundedBoxGeometry(.085, .012, .016, 2, .005), white, V(0, y, z), sh); l.rotation.x = .25; }
    // side flash (original wave mark)
    for (const sd of [-1, 1]) { const pts = [V(sd * .074, .055, .07), V(sd * .078, .09, .02), V(sd * .076, .07, -.04), V(sd * .072, .1, -.09)];
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, .008, 8, false), white, null, sh); }
  }
  root.traverse(m => { if (m.isMesh && m.material.transparent) m.castShadow = false; });
  return root;
}
