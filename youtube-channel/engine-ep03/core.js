// Brevane episode engine — core: renderer, helpers, characters, phone.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export { THREE };
export const VERT = new URLSearchParams(location.search).get('v') === '1';
export const W = VERT ? 1080 : 1920, H = VERT ? 1920 : 1080;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const ease = k => (k = clamp(k), k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const Y = V(0, 1, 0);
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- renderer ----------
export const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const scene = new THREE.Scene(); scene.background = new THREE.Color('#24305a');
export const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 200);
export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.45, 0.93); composer.addPass(bloom);
composer.addPass(new OutputPass());
export function look(p, target, fov = 35) { camera.position.copy(p); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(target); }

// ---------- lights ----------
export const hemi = new THREE.HemisphereLight('#a9bcf0', '#2a3050', 1.9); scene.add(hemi);
export const key = new THREE.DirectionalLight('#fff3e6', 1.9); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .1, far: 30 }); scene.add(key, key.target);
export const fill = new THREE.DirectionalLight('#b5c8ff', 1.2); scene.add(fill, fill.target);
export function lightRig(center, o = {}) {
  key.position.copy(center).add(o.keyOff || V(1.5, 3, 2.5)); key.target.position.copy(center); key.intensity = o.key ?? 1.9; key.color.set(o.keyCol || '#fff3e6');
  fill.position.copy(center).add(V(-2, 2.5, -2.5)); fill.target.position.copy(center); fill.intensity = o.fill ?? 1.2; fill.color.set(o.fillCol || '#b5c8ff');
  hemi.intensity = o.hemi ?? 1.9; hemi.color.set(o.sky || '#a9bcf0'); hemi.groundColor.set(o.ground || '#2a3050');
  scene.background.set(o.bg || '#24305a'); renderer.toneMappingExposure = o.exposure ?? 1.35;
}

// ---------- materials & primitives ----------
export const std = (c, r = .8, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });
export function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
export function box(parent, w, h, d, mat, x, y, z, ry = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; parent.add(m); return m; }
export function mesh(parent, geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; }

// ---------- characters ----------
const SKIN = std('#f3f6fb', .45);
const INK = std('#0b0d14', .3);
const HR = .2;
function limb(parent, r, mat) { const g = new THREE.Group(); parent.add(g);
  const cyl = mesh(g, new THREE.CylinderGeometry(r, r, 1, 20), mat), j1 = mesh(g, new THREE.SphereGeometry(r, 20, 12), mat), j2 = mesh(g, new THREE.SphereGeometry(r, 20, 12), mat); return { g, cyl, j1, j2 }; }
function setLimb(L, a, b) { const d = b.clone().sub(a), len = d.length();
  L.cyl.position.copy(a.clone().add(b).multiplyScalar(.5)); L.cyl.scale.set(1, Math.max(len, 1e-4), 1); L.cyl.quaternion.setFromUnitVectors(Y, d.normalize()); L.j1.position.copy(a); L.j2.position.copy(b); }
function ik(a, target, l1, l2, pole) {
  const d = Math.min(a.distanceTo(target), l1 + l2 - 1e-4), dir = target.clone().sub(a).normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pv = pole.clone().sub(a); pv.sub(dir.clone().multiplyScalar(pv.dot(dir))); if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0); pv.normalize();
  return { mid: a.clone().add(dir.clone().multiplyScalar(cosA * l1)).add(pv.multiplyScalar(sinA * l1)), end: a.clone().add(dir.multiplyScalar(d)) };
}
function makeHand(parent) {
  const g = new THREE.Group(); parent.add(g);
  const palm = mesh(g, new THREE.SphereGeometry(1, 20, 14), SKIN); palm.scale.set(.027, .03, .016);
  const fingers = [-1.5, -.5, .5, 1.5].map(k => { const f = new THREE.Group(); g.add(f); f.position.set(k * .0112, .024, 0);
    const seg = mesh(f, new THREE.CapsuleGeometry(.0066, .021, 4, 10), SKIN); seg.position.y = .0135; return f; });
  const thumb = new THREE.Group(); g.add(thumb); thumb.position.set(.024, 0, .006); thumb.rotation.z = -.95;
  const ts = mesh(thumb, new THREE.CapsuleGeometry(.0072, .018, 4, 10), SKIN); ts.position.y = .012;
  g.userData = { fingers, thumb }; return g;
}
function orientHand(g, el, hp, target, mode, pointDir, side) {
  const dir = pointDir ? pointDir.clone().normalize() : hp.clone().sub(el).normalize();
  g.position.copy(hp); if (pointDir) g.position.sub(dir.clone().multiplyScalar(.034));
  g.quaternion.setFromUnitVectors(Y, dir);
  const n0 = V(0, 0, 1).applyQuaternion(g.quaternion), n = target.clone().sub(hp); n.sub(dir.clone().multiplyScalar(n.dot(dir)));
  if (n.lengthSq() > 1e-8) { n.normalize(); g.rotateOnWorldAxis(dir, Math.atan2(dir.dot(new THREE.Vector3().crossVectors(n0, n)), n0.dot(n))); }
  const { fingers, thumb } = g.userData;
  const curl = mode === 'open' ? .15 : mode === 'fist' ? 1.5 : 1.05;
  fingers.forEach((f, i) => { const idx = i === 3; f.rotation.x = mode === 'point' ? (idx ? .1 : 1.2) : curl; f.scale.set(1, mode === 'point' && !idx ? .35 : 1, 1); });
  thumb.rotation.x = mode === 'point' ? 1.3 : mode === 'open' ? .1 : .5; thumb.rotation.z = mode === 'point' ? -.35 : -.95; thumb.scale.set(1, mode === 'point' ? .5 : 1, 1);
}

export function makeChar(o = {}) {
  const root = new THREE.Group(); scene.add(root); root.userData.char = true;
  const hoodie = std(o.hoodie || '#D2512E', .75), pants = std(o.pants || '#1a1f2b', .85), shoe = std(o.shoe || '#e8ecf3', .6);
  const c = { root, hoodie, o };
  c.torso = mesh(root, new THREE.CapsuleGeometry(.14, .26, 8, 24), hoodie);
  c.hood = mesh(root, new THREE.TorusGeometry(.12, .045, 12, 32), hoodie);
  c.strings = [-1, 1].map(() => mesh(root, new THREE.CylinderGeometry(.007, .007, .12, 8), std(o.string || '#00e5ff', .5, { emissive: o.string || '#00e5ff', emissiveIntensity: .5 })));
  c.neck = mesh(root, new THREE.CylinderGeometry(.045, .05, .1, 16), SKIN);
  c.legs = [-1, 1].map(s => ({ th: limb(root, .065, pants), sh: limb(root, .055, pants), foot: mesh(root, new THREE.SphereGeometry(.07, 20, 12), shoe), s }));
  c.arms = [-1, 1].map(s => ({ up: limb(root, .05, hoodie), fo: limb(root, .038, o.sleeveFull ? hoodie : SKIN), hand: makeHand(root), s }));
  // head
  const head = new THREE.Group(); root.add(head); c.head = head;
  mesh(head, new THREE.SphereGeometry(HR, 48, 32), SKIN);
  const onHead = (m, ax, ay, off = 0) => { const dir = V(Math.sin(ay) * Math.cos(ax), Math.sin(ax), Math.cos(ay) * Math.cos(ax)); m.position.copy(dir.clone().multiplyScalar(HR + off)); m.lookAt(dir.clone().multiplyScalar(5)); return m; };
  c.onHead = onHead;
  const glowM = std('#00e5ff', .3, { emissive: '#00e5ff', emissiveIntensity: 0 }); c.glowM = glowM;
  c.eyes = [-1, 1].map(s => {
    const e = onHead(mesh(head, new THREE.SphereGeometry(1, 24, 16), INK), .06, s * .36, -.004); e.scale.set(.03, .046, .02);
    const gl = onHead(mesh(head, new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff' })), .1, s * .36 - .05, .012); gl.scale.set(.009, .009, .004);
    const glow = onHead(mesh(head, new THREE.SphereGeometry(1, 24, 16), glowM), .06, s * .36, 0); glow.scale.set(.034, .05, .02); glow.visible = false;
    const brow = mesh(head, new THREE.CapsuleGeometry(.009, .06, 4, 8), INK);
    return { e, gl, glow, brow, s };
  });
  c.mouth = mesh(head, new THREE.TorusGeometry(.03, .0065, 8, 24, Math.PI * .7), INK);
  c.mouthO = mesh(head, new THREE.TorusGeometry(.018, .0065, 8, 24), INK);
  // accessories
  if (o.cap) { const cap = std(o.cap, .7); const dome = mesh(head, new THREE.SphereGeometry(HR * 1.03, 32, 16, 0, Math.PI * 2, 0, Math.PI * .42), cap);
    const brim = mesh(head, new THREE.CylinderGeometry(.12, .12, .015, 24, 1, false, 0, Math.PI), cap); brim.position.set(0, HR * .62, -HR * .55); brim.rotation.set(-.25, Math.PI / 2, 0); brim.scale.set(1, 1, 1); }
  if (o.glasses) { for (const s of [-1, 1]) { const r = onHead(mesh(head, new THREE.TorusGeometry(.042, .006, 8, 24), INK), .06, s * .36, .01); }
    const br = mesh(head, new THREE.CylinderGeometry(.005, .005, .05, 6), INK); onHead(br, .09, 0, .012); br.rotateZ(Math.PI / 2); }
  if (o.scarf) { c.scarf = mesh(root, new THREE.TorusGeometry(.085, .04, 12, 24), std(o.scarf, .8)); }
  if (o.bun) { mesh(head, new THREE.SphereGeometry(.075, 20, 14), std(o.bun, .8), 0, HR * .92, -HR * .35); }
  return c;
}

export function setFace(c, f = {}) {
  const g = f.glow || 0;
  for (const E of c.eyes) {
    c.onHead(E.brow, .3, E.s * .34, .002); E.brow.rotateZ(Math.PI / 2 - E.s * (f.brow ?? 0) * .35);
    E.e.visible = E.gl.visible = g < .05; E.glow.visible = g >= .05;
    E.e.scale.set(.03 * (f.wide ? 1.15 : 1), .046 * (1 - .92 * (f.blink || 0)) * (f.wide ? 1.15 : 1), .02);
    E.e.visible = E.e.visible; E.e.position.y; // keep
  }
  c.glowM.emissiveIntensity = 1.1 * g;
  const m = f.mouth || 'flat'; c.mouth.visible = m !== 'o'; c.mouthO.visible = m === 'o';
  c.onHead(c.mouth, -.36, (f.mouthX || 0), 0); c.onHead(c.mouthO, -.38, 0, 0);
  if (m === 'smile') { c.mouth.rotateZ(Math.PI + Math.PI * .15); c.mouth.scale.set(1, 1, 1); }
  else if (m === 'smirk') { c.mouth.rotateZ(Math.PI + Math.PI * .15); c.mouth.rotateZ(.25); c.mouth.scale.set(1, 1, 1); }
  else if (m === 'frown') { c.mouth.rotateZ(Math.PI * .15); c.mouth.scale.set(1, 1, 1); }
  else if (m === 'wavy') { c.mouth.rotateZ(Math.PI * .15); c.mouth.scale.set(1.1, .45, 1); }
  else if (m === 'yell') { c.mouth.rotateZ(Math.PI * .15); c.mouth.scale.set(1.2, 1.5, 1); }
  else { c.mouth.rotateZ(Math.PI * .15); c.mouth.scale.set(1, .25, 1); }
}

// pose a character. All points in world space.
// p: { hip, fwd, lean, side (tilt), handL, handR, footL, footR, look, handModeL/R, handTargetL/R, pointDirR, elbowPole, visible:{...} }
export function poseChar(c, p) {
  const fwd = p.fwd.clone().setY(0).normalize(), right = new THREE.Vector3().crossVectors(fwd, Y).normalize();
  const lean = p.lean || 0;
  const up = Y.clone().multiplyScalar(Math.cos(lean)).add(fwd.clone().multiplyScalar(Math.sin(lean)));
  if (p.side) up.add(right.clone().multiplyScalar(p.side)).normalize();
  const z = fwd.clone().sub(up.clone().multiplyScalar(fwd.dot(up))).normalize(), x = new THREE.Vector3().crossVectors(up, z);
  const basis = new THREE.Matrix4().makeBasis(x, up, z), q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const hip = p.hip;
  c.torso.position.copy(hip).add(up.clone().multiplyScalar(.22)); c.torso.quaternion.copy(q); c.torso.scale.set(1, 1, .82);
  const neck = hip.clone().add(up.clone().multiplyScalar(.43));
  const hn = up.clone().multiplyScalar(Math.cos(.35)).sub(z.clone().multiplyScalar(Math.sin(.35)));
  c.hood.position.copy(neck).sub(z.clone().multiplyScalar(.025)); c.hood.quaternion.setFromUnitVectors(V(0, 0, 1), hn);
  c.strings.forEach((st, i) => { st.position.copy(neck).sub(up.clone().multiplyScalar(.09)).add(z.clone().multiplyScalar(.112)).add(x.clone().multiplyScalar((i ? 1 : -1) * .04)); st.quaternion.copy(q); });
  c.neck.position.copy(neck).add(up.clone().multiplyScalar(.03)); c.neck.quaternion.copy(q);
  if (c.scarf) { c.scarf.position.copy(neck).add(up.clone().multiplyScalar(.03)); c.scarf.quaternion.setFromUnitVectors(V(0, 0, 1), up); }
  // head
  const hc = neck.clone().add(up.clone().multiplyScalar(.17)); c.head.position.copy(hc); c.head.up.copy(up);
  c.head.lookAt(p.look || hc.clone().add(z));
  // legs
  for (const L of c.legs) {
    const hj = hip.clone().add(x.clone().multiplyScalar(-L.s * .085));
    const foot = L.s < 0 ? p.footL : p.footR;
    const r = ik(hj, foot, .40, .43, hj.clone().add(fwd.clone().multiplyScalar(1.2)).add(Y.clone().multiplyScalar(.1)));
    setLimb(L.th, hj, r.mid); setLimb(L.sh, r.mid, r.end);
    L.foot.position.copy(r.end).add(V(0, -.035, 0)).add(fwd.clone().multiplyScalar(.04)); L.foot.scale.set(1, .6, 1.4);
    L.foot.quaternion.setFromUnitVectors(V(0, 0, 1), (p.footDir || fwd).clone().setY(0).normalize());
    if (p.footDir) L.foot.quaternion.setFromUnitVectors(V(0, 0, 1), p.footDir.clone().normalize());
  }
  // arms
  for (const A of c.arms) {
    const sh = neck.clone().sub(up.clone().multiplyScalar(.06)).add(x.clone().multiplyScalar(-A.s * .17));
    const target = A.s < 0 ? p.handL : p.handR;
    const pole = p.elbowPole ? p.elbowPole(A.s, sh) : sh.clone().sub(fwd.clone().multiplyScalar(.25)).sub(up.clone().multiplyScalar(.5)).add(x.clone().multiplyScalar(-A.s * .35));
    const r = ik(sh, target, .26, .25, pole);
    setLimb(A.up, sh, r.mid); setLimb(A.fo, r.mid, r.end);
    const mode = (A.s < 0 ? p.handModeL : p.handModeR) || 'grip';
    const tgt = (A.s < 0 ? p.handTargetL : p.handTargetR) || r.end.clone().add(fwd.clone().multiplyScalar(.2)).sub(x.clone().multiplyScalar(A.s * .2));
    orientHand(A.hand, r.mid, r.end, tgt, mode, A.s > 0 ? p.pointDirR : p.pointDirL, A.s);
  }
  if (p.face) setFace(c, p.face);
  const vis = p.hide || {};
  c.root.visible = !vis.all;
  c.head.visible = !vis.head; c.torso.visible = c.hood.visible = c.neck.visible = !vis.body; c.strings.forEach(s => s.visible = !vis.body);
  for (const A of c.arms) { A.up.g.visible = A.fo.g.visible = !vis.arms; A.hand.visible = !(vis.arms && !(vis.keepHandR && A.s > 0)); A.hand.scale.setScalar(vis.keepHandR && A.s > 0 ? .55 : 1); }
  for (const L of c.legs) { L.th.g.visible = L.sh.g.visible = L.foot.visible = !vis.legs; }
  return { neck, up, fwd, right, x, z, hc };
}

// convenience poses ------------------------------------------------------
export function standPose(c, base, fwd, o = {}) {
  const f = fwd.clone().normalize(), r = new THREE.Vector3().crossVectors(f, Y).normalize();
  const ph = o.phase ?? 0, stride = o.stride ?? 0, bob = stride ? Math.abs(Math.cos(ph)) * .02 : 0;
  const hip = base.clone().add(V(0, .82 - bob + (o.hipDY || 0), 0));
  const footL = base.clone().add(r.clone().multiplyScalar(-.1)).add(f.clone().multiplyScalar(Math.sin(ph) * stride)).add(V(0, .1 + Math.max(0, Math.cos(ph)) * stride * .35, 0));
  const footR = base.clone().add(r.clone().multiplyScalar(.1)).add(f.clone().multiplyScalar(-Math.sin(ph) * stride)).add(V(0, .1 + Math.max(0, -Math.cos(ph)) * stride * .35, 0));
  const shY = hip.y + .37;
  const swing = stride ? Math.sin(ph) * stride * .7 : 0;
  const handL = o.handL || base.clone().add(V(0, shY - .5, 0)).add(r.clone().multiplyScalar(-.21)).add(f.clone().multiplyScalar(-swing + .04));
  const handR = o.handR || base.clone().add(V(0, shY - .5, 0)).add(r.clone().multiplyScalar(.21)).add(f.clone().multiplyScalar(swing + .04));
  return poseChar(c, { hip, fwd: f, lean: o.lean ?? .04, footL, footR, handL, handR, look: o.look, face: o.face, handModeL: o.handModeL || 'grip', handModeR: o.handModeR || 'grip',
    handTargetL: o.handTargetL, handTargetR: o.handTargetR, pointDirR: o.pointDirR, side: o.side, hide: o.hide, elbowPole: o.elbowPole });
}
export function sitPose(c, seat, fwd, o = {}) {
  const f = fwd.clone().normalize(), r = new THREE.Vector3().crossVectors(f, Y).normalize();
  const hip = seat.clone().add(V(0, .06 + Math.sin((o.t || 0) * 1.6) * .004, 0));
  const floorY = o.floorY ?? 0;
  const footL = V(seat.x, floorY + .1, seat.z).add(f.clone().multiplyScalar(.4)).add(r.clone().multiplyScalar(-.12));
  const footR = V(seat.x, floorY + .1, seat.z).add(f.clone().multiplyScalar(.4)).add(r.clone().multiplyScalar(.12));
  return poseChar(c, { hip, fwd: f, lean: o.lean ?? .3, footL, footR, handL: o.handL, handR: o.handR, look: o.look, face: o.face, handModeL: o.handModeL, handModeR: o.handModeR,
    handTargetL: o.handTargetL, handTargetR: o.handTargetR, pointDirR: o.pointDirR, hide: o.hide, elbowPole: o.elbowPole, side: o.side });
}

// ---------- phone ----------
export function makePhone() {
  const g = new THREE.Group(); scene.add(g);
  mesh(g, new THREE.BoxGeometry(.078, .158, .009), std('#14182a', .3, { metalness: .4 }));
  const cv = document.createElement('canvas'); cv.width = 600; cv.height = 1200; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.07, .14), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: '#e6e9ef' })); scr.position.z = .0047; g.add(scr);
  const light = new THREE.PointLight('#a8f3ff', .05, 1.2, 2); light.position.set(0, .02, .15); g.add(light);
  return { g, cv, tex, scr, light };
}
// hold a phone in front of chest (character pose already computed with pose info)
export function placePhone(ph, info, o = {}) {
  const pos = info.neck.clone().add(info.fwd.clone().multiplyScalar(o.dist ?? .3)).sub(info.up.clone().multiplyScalar(o.drop ?? .26)).add(info.right.clone().multiplyScalar(o.dx || 0));
  ph.g.position.copy(pos); ph.g.lookAt(info.hc.clone().add(V(0, .05, 0))); ph.g.updateMatrixWorld(true);
  return pos;
}
export const TOGGLE_LOCAL = V((450 / 600 - .5) * .07, (.5 - 940 / 1200) * .14, .006);
