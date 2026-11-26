// Brevane hook v4 — rigged human mannequin (Xbot, mixamo skeleton with fingers), toon look,
// warm room, cyan only on phone + eyes. Poses solved with world-space aim + 2-bone IK.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

const W = 1920, H = 1080, DURATION = 20;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const S = { B: 4.2, C: 6.3, D: 8.4, E: 10.6, F: 14.3, G: 16.3, FLIP: 15.0 };
const CAPTIONS = [
  [0.3, 3.9, "There's a setting on your phone you've never seen."],
  [4.6, 7.96, 'It only shows up at 3:33 AM.'],
  [8.6, 10.47, "It's called... Hidden Mode."],
  [11.0, 14.23, 'And no matter what happens... never turn it on.'],
  [15.25, 17.4, 'You turned it on.'],
];

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0042, defaultColor: [0.06, 0.05, 0.08] });
const scene = new THREE.Scene(); scene.background = new THREE.Color('#2a1c22');
const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 50);

// toon gradient
const grad = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const toon = (c, extra = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...extra });

// ---------- room (warm) ----------
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function box(w, h, d, mat, x, y, z, ry = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; scene.add(m); return m; }
const wallMat = toon('#B9775A'), floorMat = toon('#6B4130'), woodMat = toon('#8A5236'), darkWood = toon('#5A3324');
box(12, .02, 12, floorMat, 0, -.01, 0);
box(12, 5, .1, wallMat, 0, 2.5, -2.0);
box(.1, 5, 12, wallMat, -2.6, 2.5, 0);
// skirting
box(12, .12, .04, darkWood, 0, .06, -1.94);
// window (cool night outside = contrast with warm room)
const winTex = canvasTex(1024, 768, (g, w, h) => {
  const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, '#1d2350'); sg.addColorStop(.75, '#4b3f86'); sg.addColorStop(1, '#8a5d9a'); g.fillStyle = sg; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff5df'; g.shadowColor = '#fff1cc'; g.shadowBlur = 60; g.beginPath(); g.arc(760, 150, 60, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
  const r = rng(5); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${.3 + .6 * r()})`; g.fillRect(r() * w, r() * h * .45, 2, 2); }
  let x = 0; const r2 = rng(9);
  while (x < w) { const bw = 60 + r2() * 110, bh = 180 + r2() * 330; g.fillStyle = '#141433'; g.fillRect(x, h - bh, bw - 8, bh);
    for (let y = h - bh + 18; y < h - 12; y += 30) for (let xx = x + 10; xx < x + bw - 20; xx += 22) if (r2() < .3) { g.fillStyle = 'rgba(255,205,130,.85)'; g.fillRect(xx, y, 9, 14); }
    x += bw; }
});
const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), new THREE.MeshBasicMaterial({ map: winTex, toneMapped: false })); win.position.set(-0.9, 1.65, -1.94); scene.add(win);
for (const [w, h, x, y] of [[1.64, .08, -0.9, 2.24], [1.64, .08, -0.9, 1.06], [.08, 1.2, -1.68, 1.65], [.08, 1.2, -.12, 1.65], [.05, 1.12, -0.9, 1.65]]) box(w, h, .08, toon('#EADBC8'), x, y, -1.9);
// curtains
for (const x of [-1.85, .05]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, 1.9, 12, 1, true, 0, Math.PI), toon('#7E2E3A', { side: THREE.DoubleSide })); c.position.set(x, 1.5, -1.85); c.rotation.y = Math.PI; scene.add(c); }
// poster
const poster = new THREE.Mesh(new THREE.PlaneGeometry(.55, .75), new THREE.MeshBasicMaterial({ map: canvasTex(400, 540, (g, w, h) => { g.fillStyle = '#2F3B57'; g.fillRect(0, 0, w, h); g.fillStyle = '#F2A65A'; g.beginPath(); g.arc(200, 210, 110, 0, Math.PI * 2); g.fill(); g.fillStyle = '#EADBC8'; g.font = '900 54px Inter'; g.textAlign = 'center'; g.fillText('SUNSET', 200, 440); }) }));
poster.position.set(1.55, 1.7, -1.94); scene.add(poster);
// bed (Nev sits on the edge, facing +z)
box(1.6, .3, 2.1, woodMat, .55, .15, -.95);
box(1.56, .16, 2.05, toon('#EFE6D8'), .55, .38, -.95);
box(1.58, .08, 1.3, toon('#8C2F39'), .55, .49, -.65);
box(1.62, .95, .08, darkWood, .55, .7, -1.98);
const pillow = new THREE.Mesh(new THREE.CapsuleGeometry(.13, .5, 6, 16), toon('#F6EFE3')); pillow.rotation.z = Math.PI / 2; pillow.position.set(.7, .55, -1.72); scene.add(pillow);
// nightstand, lamp, clock
box(.5, .55, .45, woodMat, -0.75, .275, -0.55);
box(.04, .32, .04, darkWood, -0.82, .71, -0.68);
const shade = new THREE.Mesh(new THREE.CylinderGeometry(.11, .17, .2, 24, 1, true), toon('#F3C98B', { side: THREE.DoubleSide, emissive: '#F3B06A', emissiveIntensity: .6 })); shade.position.set(-0.82, .92, -0.68); scene.add(shade);
const clockBody = box(.22, .1, .1, toon('#2A1E24'), -0.62, .6, -0.45, .35);
const clockCanvas = document.createElement('canvas'); clockCanvas.width = 256; clockCanvas.height = 110; const clockTex = new THREE.CanvasTexture(clockCanvas); clockTex.colorSpace = THREE.SRGBColorSpace;
const clockFace = new THREE.Mesh(new THREE.PlaneGeometry(.2, .086), new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false })); clockFace.position.z = .051; clockBody.add(clockFace);
function drawClock(txt) { const g = clockCanvas.getContext('2d'); g.fillStyle = '#120c10'; g.fillRect(0, 0, 256, 110); g.font = '800 74px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#FF7A4A'; g.fillText(txt, 128, 58); clockTex.needsUpdate = true; }
// rug
const rug = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), toon('#C8A27A')); rug.rotation.x = -Math.PI / 2; rug.position.set(.2, .005, .5); rug.receiveShadow = true; scene.add(rug);

// ---------- lights (warm key from lamp, cool fill from window) ----------
scene.add(new THREE.HemisphereLight('#ffd9b8', '#3a2228', .9));
const lamp = new THREE.PointLight('#ffb36b', 2.2, 6, 1.4); lamp.position.set(-0.82, .95, -0.55); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); scene.add(lamp);
const key = new THREE.DirectionalLight('#ffe2c4', 1.4); key.position.set(1.8, 3, 2.5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); scene.add(key);
const moon = new THREE.DirectionalLight('#8fa2ff', .6); moon.position.set(-1.5, 2, -3); scene.add(moon);
const phoneLight = new THREE.PointLight('#7ff3ff', .25, 1.2, 2); scene.add(phoneLight);
const eyeLight = new THREE.PointLight('#00e5ff', 0, 1.5, 2); scene.add(eyeLight);

// ---------- phone ----------
const phone = new THREE.Group(); scene.add(phone);
const phoneBody = new THREE.Mesh(new THREE.BoxGeometry(.075, .155, .009), toon('#1b1f2b')); phone.add(phoneBody);
const ui = document.createElement('canvas'); ui.width = 540; ui.height = 1120; const uiTex = new THREE.CanvasTexture(ui); uiTex.colorSpace = THREE.SRGBColorSpace;
const screen = new THREE.Mesh(new THREE.PlaneGeometry(.068, .141), new THREE.MeshBasicMaterial({ map: uiTex, toneMapped: false })); screen.position.z = .0047; phone.add(screen);
function drawUI(t, o) {
  const g = ui.getContext('2d'), w = 540, h = 1120, { scroll = 0, rowIn = 0, knob = 0, flash = 0 } = o;
  g.fillStyle = '#0f1626'; g.fillRect(0, 0, w, h);
  g.font = '600 28px Inter'; g.fillStyle = '#e8eef7'; g.textBaseline = 'middle'; g.fillText('3:33', 40, 44);
  g.save(); g.beginPath(); g.rect(0, 80, w, h - 80); g.clip();
  g.font = '800 50px Inter'; g.fillStyle = '#fff'; g.fillText('Settings', 34, 130 - scroll * .25);
  const names = ['Wi-Fi', 'Bluetooth', 'Notifications', 'Sounds', 'Focus', 'Screen Time', 'Display', 'Battery', 'Privacy', 'Storage', 'General'];
  const cols = ['#3a7bd5', '#4a5fd0', '#d05a5a', '#d0507f', '#6a5ad0', '#7a5ad0', '#3a8bd5', '#3fbf6f', '#3a7bd5', '#7a8599', '#7a8599'];
  names.forEach((n, i) => { const y = 200 + i * 92 - scroll; if (y < 60 || y > h) return;
    g.fillStyle = '#172138'; g.beginPath(); g.roundRect(26, y, w - 52, 78, 16); g.fill();
    g.fillStyle = cols[i]; g.beginPath(); g.roundRect(48, y + 19, 40, 40, 10); g.fill();
    g.font = '500 30px Inter'; g.fillStyle = '#e8eef7'; g.fillText(n, 108, y + 40); });
  g.restore();
  if (rowIn > 0) { const y = 820; g.save(); g.globalAlpha = rowIn; g.shadowColor = '#00e5ff'; g.shadowBlur = 30;
    g.fillStyle = '#08283a'; g.beginPath(); g.roundRect(26, y, w - 52, 116, 20); g.fill(); g.strokeStyle = '#00e5ff'; g.lineWidth = 5; g.stroke(); g.shadowBlur = 0;
    g.font = '800 40px Inter'; g.fillStyle = '#e8fdff'; g.fillText('Hidden Mode', 54, y + 58);
    const tx = w - 170, ty = y + 30; g.fillStyle = knob > .5 ? '#00e5ff' : '#3a4459'; g.beginPath(); g.roundRect(tx, ty, 112, 56, 28); g.fill();
    g.beginPath(); g.arc(tx + 28 + knob * 56, ty + 28, 23, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore(); }
  if (flash > 0) { g.fillStyle = `rgba(170,250,255,${flash})`; g.fillRect(0, 0, w, h); }
  uiTex.needsUpdate = true;
}
// toggle position in phone-local coords (canvas 540x1120 -> plane .068 x .141)
const TOGGLE = V((540 - 170 + 28 + 56 - 270) / 540 * .068, (560 - 878) / 1120 * .141, .006);

// ---------- character ----------
let rig = null, bones = {}, mixer = null, idle = null, facePlane = null, faceCtx = null, faceTex = null, rest = {};
const B = n => bones['mixamorig' + n] || bones['mixamorig:' + n];
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
function wpos(b) { return b.getWorldPosition(new THREE.Vector3()); }
// rotate bone so that the direction to its child points toward target (world)
function aim(bone, child, target) {
  bone.updateMatrixWorld(true);
  const from = wpos(child).sub(wpos(bone)).normalize(), to = target.clone().sub(wpos(bone)).normalize();
  const dq = new THREE.Quaternion().setFromUnitVectors(from, to);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq))); bone.updateMatrixWorld(true);
}
function rotWorld(bone, axis, ang) {
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const dq = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), ang);
  bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq))); bone.updateMatrixWorld(true);
}
// 2-bone IK with pole vector
function ik2(a, b, c, target, pole) {
  const A = wpos(a), L1 = wpos(b).distanceTo(A), L2 = wpos(c).distanceTo(wpos(b));
  const d = Math.min(A.distanceTo(target), L1 + L2 - 1e-4), dir = target.clone().sub(A).normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pv = pole.clone().sub(A); pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
  const mid = A.clone().add(dir.clone().multiplyScalar(cosA * L1)).add(pv.multiplyScalar(sinA * L1));
  aim(a, b, mid); aim(b, c, A.clone().add(dir.multiplyScalar(d)));
}
const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
function curlHand(side, amt, thumbAmt = amt, indexAmt = amt) {
  const hand = B(side + 'Hand'); hand.updateMatrixWorld(true);
  const across = wpos(B(side + 'HandIndex1')).sub(wpos(B(side + 'HandPinky1')));
  const up = wpos(B(side + 'HandMiddle1')).sub(wpos(hand)); const palmN = new THREE.Vector3().crossVectors(across, up).normalize();
  for (const f of fingers) for (let j = 1; j <= 3; j++) {
    const b = B(`${side}Hand${f}${j}`); if (!b) continue;
    const a = f === 'Thumb' ? thumbAmt * (j === 1 ? .3 : .6) : (f === 'Index' ? indexAmt : amt) * (j === 1 ? .9 : 1.1);
    rotWorld(b, f === 'Thumb' ? up : across, (side === 'Left' ? -1 : 1) * a);
  }
}

const loader = new GLTFLoader();
loader.load('/models/Xbot.glb', g => {
  rig = g.scene; scene.add(rig);
  rig.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    o.material = o.name.includes('001') || (o.material.name || '').includes('Joints') ? toon('#2B2F3F') : toon('#F1F2F5'); } });
  mixer = new THREE.AnimationMixer(rig); idle = mixer.clipAction(g.animations.find(a => a.name === 'idle')); idle.play();
  rig.updateMatrixWorld(true);
  for (const n in bones) rest[n] = bones[n].quaternion.clone();
  // face: canvas texture on a sphere cap attached to the head bone
  const head = B('Head'), top = B('HeadTop_End'); const hc = wpos(head), ht = wpos(top);
  const headCenter = hc.clone().lerp(ht, .45), R = hc.distanceTo(ht) * .52;
  const fc = document.createElement('canvas'); fc.width = 512; fc.height = 512; faceCtx = fc.getContext('2d'); faceTex = new THREE.CanvasTexture(fc); faceTex.colorSpace = THREE.SRGBColorSpace;
  facePlane = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 48, 32, Math.PI * .25, Math.PI * .5, Math.PI * .25, Math.PI * .5),
    new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, toneMapped: false, depthWrite: false, depthTest: false }));
  facePlane.renderOrder = 10; facePlane.material.userData.outlineParameters = { visible: false };
  facePlane.position.copy(headCenter); scene.add(facePlane); head.attach(facePlane);
  window.ready = true;
});

function drawFace(o) {
  const g = faceCtx, w = 512, h = 512; g.clearRect(0, 0, w, h);
  const glow = o.glow || 0, blink = o.blink || 0, lx = (o.look?.x || 0) * 30, ly = (o.look?.y || 0) * 20;
  for (const s of [-1, 1]) {
    const ex = 256 + s * 88 + lx, ey = 268 + ly, rx = 34, ry = 52 * (1 - .9 * blink);
    if (glow > 0) { const hg = g.createRadialGradient(ex, ey, 0, ex, ey, 110); hg.addColorStop(0, `rgba(0,229,255,${.7 * glow})`); hg.addColorStop(1, 'rgba(0,229,255,0)'); g.fillStyle = hg; g.fillRect(ex - 110, ey - 110, 220, 220);
      g.beginPath(); g.ellipse(ex, ey, rx * 1.15, ry * 1.05, 0, 0, Math.PI * 2); g.fillStyle = `rgb(${lerp(20, 0, glow)},${lerp(22, 229, glow)},${lerp(30, 255, glow)})`; g.fill();
      g.beginPath(); g.ellipse(ex, ey, rx * .5 * glow, ry * .5 * glow, 0, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
    else { g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = '#141620'; g.fill();
      if (blink < .5) { g.beginPath(); g.arc(ex - 11, ey - 18, 11, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); } }
    const b = o.brow ?? 0, by = ey - 52 - 30; g.beginPath(); g.lineCap = 'round'; g.lineWidth = 17; g.strokeStyle = '#141620';
    g.moveTo(ex - s * 46, by - b * 20); g.lineTo(ex + s * 42, by + b * 7); g.stroke();
  }
  const mx = 256 + lx * .8, my = 385 + ly; g.lineWidth = 15; g.strokeStyle = '#141620'; g.lineCap = 'round'; g.beginPath();
  const m = o.mouth || 'flat';
  if (m === 'frown') { g.moveTo(mx - 42, my + 12); g.quadraticCurveTo(mx, my - 22, mx + 42, my + 12); }
  else if (m === 'smirk') { g.moveTo(mx - 40, my + 3); g.quadraticCurveTo(mx + 6, my + 20, mx + 48, my - 14); }
  else if (m === 'wavy') { g.moveTo(mx - 44, my); for (let i = 1; i <= 4; i++) g.quadraticCurveTo(mx - 44 + (i - .5) * 22, my + (i % 2 ? -11 : 11), mx - 44 + i * 22, my); }
  else { g.moveTo(mx - 30, my); g.lineTo(mx + 30, my); }
  g.stroke(); faceTex.needsUpdate = true;
}

// ---------- pose: sitting on bed edge, phone in both hands ----------
const HIPS = V(.0, .5, -.05);
function pose(t, o) {
  // start from idle mocap (natural micro-motion), then override
  mixer.setTime(t % 10); rig.updateMatrixWorld(true);
  const hips = B('Hips');
  // place hips on the bed edge
  const hw = wpos(hips); rig.position.add(HIPS.clone().sub(hw)); rig.updateMatrixWorld(true);
  const breathe = Math.sin(t * 1.6) * .004;
  // spine: lean forward toward the phone
  const lean = o.lean ?? .35;
  const spineDir = V(0, Math.cos(lean), Math.sin(lean));
  const sp = [B('Spine'), B('Spine1'), B('Spine2'), B('Neck')];
  for (let i = 0; i < 3; i++) { const base = wpos(sp[i]); aim(sp[i], sp[i + 1], base.add(spineDir.clone().multiplyScalar(.2)).add(V(0, breathe, 0))); }
  // legs: knees forward, feet on floor
  for (const [s, x] of [['Left', .11], ['Right', -.11]]) {
    ik2(B(s + 'UpLeg'), B(s + 'Leg'), B(s + 'Foot'), V(x * 1.15, .09, .42), V(x, .6, 1.5));
    aim(B(s + 'Foot'), B(s + 'ToeBase'), V(x * 1.2, .02, .6));
  }
  // phone placement (in front of chest, facing the face)
  const neck = wpos(B('Neck'));
  const ph = o.phonePos || neck.clone().add(V(0, -.26, .3));
  phone.position.copy(ph); phone.lookAt(wpos(B('Head')).add(V(0, .05, 0))); phone.updateMatrixWorld(true);
  phoneLight.position.copy(ph).add(V(0, .06, .05));
  // hands grip the phone sides, thumbs on the screen
  // phone local +x = Nev's right side. Left hand cradles the phone from behind.
  const gL = phone.localToWorld(V(-.022, -.045, -.04));
  ik2(B('LeftArm'), B('LeftForeArm'), B('LeftHand'), gL, wpos(B('LeftArm')).add(V(.5, -.6, -.4)));
  aim(B('LeftHand'), B('LeftHandMiddle1'), phone.localToWorld(V(.05, -.01, -.03)));
  curlHand('Left', .75, .35);
  // right index finger works the screen (scroll / press)
  const tip = phone.localToWorld(o.indexLocal || V(.004, -.02 + Math.sin(t * 6) * .012, .008));
  const handR = phone.localToWorld((o.indexLocal || V(.004, -.02, .008)).clone().add(V(.065, -.075, .035)));
  ik2(B('RightArm'), B('RightForeArm'), B('RightHand'), handR, wpos(B('RightArm')).add(V(-.5, -.6, -.4)));
  aim(B('RightHand'), B('RightHandIndex1'), tip);
  curlHand('Right', .95, .6, .05);
  // head: look at the phone (or up)
  const look = o.lookAt || ph;
  aim(B('Neck'), B('Head'), wpos(B('Neck')).add(look.clone().sub(wpos(B('Neck'))).normalize().multiplyScalar(.04).add(V(0, .09, 0))));
  aim(B('Head'), B('HeadTop_End'), wpos(B('Head')).add(V(0, 1, 0).applyAxisAngle(V(1, 0, 0), o.headPitch ?? .45)));
  rig.updateMatrixWorld(true);
}

// ---------- overlay ----------
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
function overlay(t) {
  og.drawImage(renderer.domElement, 0, 0);
  const v = og.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.4)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
  for (const c of [S.B, S.C, S.D, S.E, S.F, S.G]) { const d = Math.abs(t - c); if (d < .08) { og.fillStyle = `rgba(0,0,0,${.9 * (1 - d / .08)})`; og.fillRect(0, 0, W, H); } }
  if (t < .3) { og.fillStyle = `rgba(0,0,0,${1 - t / .3})`; og.fillRect(0, 0, W, H); }
  if (t > 19.4) { og.fillStyle = `rgba(0,0,0,${prog(t, 19.4, 20)})`; og.fillRect(0, 0, W, H); }
  for (const [a, b, s] of CAPTIONS) if (t >= a && t <= b) {
    const al = Math.min(prog(t, a, a + .2), 1 - prog(t, b - .2, b)); og.save(); og.globalAlpha = al; og.font = '800 52px Inter'; og.textAlign = 'center'; og.textBaseline = 'middle';
    const tw = og.measureText(s).width; og.fillStyle = 'rgba(12,10,16,.65)'; og.beginPath(); og.roundRect(W / 2 - tw / 2 - 34, H - 170, tw + 68, 88, 22); og.fill();
    og.fillStyle = s === 'You turned it on.' ? '#7FF3FF' : '#fff'; og.fillText(s, W / 2, H - 125); og.restore(); }
  return out;
}
function look(p, target, fov) { camera.position.copy(p); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(target); }
const blink = (t, ts) => ts.reduce((b, s) => Math.max(b, 1 - Math.abs(t - s) / .09), 0) * 1;

window.frame = (t, q = .92) => {
  drawClock(t < 5.2 ? '3:32' : '3:33');
  let face = { brow: .3, mouth: 'flat', blink: Math.max(0, blink(t, [2.2, 7.4, 12.4])) };
  let ui = { scroll: 0, rowIn: 0, knob: 0, flash: 0 }, po = {};
  eyeLight.intensity = 0; phoneLight.intensity = .25;
  const scrollT = Math.sin(t * 6) * .006;
  if (t < S.B) { // A wide
    po = { thumbTarget: null }; pose(t, po);
    const k = ease(prog(t, 0, S.B));
    look(V(lerp(1.9, 1.45, k), lerp(1.35, 1.2, k), lerp(2.5, 1.9, k)), V(-.1, .85, -.3), 38);
    ui.scroll = ease(prog(t, 0, 4)) * 120;
  } else if (t < S.C) { // B clock insert
    pose(t, {}); const k = ease(prog(t, S.B, S.C));
    look(V(-0.45, .72, -0.05 + .05 * k), V(-0.62, .6, -0.45), 26);
  } else if (t < S.D) { // C medium 3/4, leaning in
    const k = ease(prog(t, S.C, S.D)); pose(t, { lean: .35 + .1 * k }); face = { ...face, brow: .3 + .4 * k };
    look(V(.9, 1.12, .95), V(.0, .95, .05), 30); ui.scroll = 120 + k * 200;
  } else if (t < S.E) { // D over-the-shoulder on the phone
    pose(t, { lean: .45, indexLocal: V(.004, .03 + Math.sin(t * 6) * .006 * (1 - prog(t, 8.6, 8.9)), .008) }); ui = { scroll: 320 + ease(prog(t, S.D, 9)) * 100, rowIn: easeOut(prog(t, 8.7, 9.3)) };
    const hd = wpos(B('Head')); look(hd.clone().lerp(phone.position, .38).add(V(.05, .1, 0)), phone.position, 30);
  } else if (t < S.F) { // E face close-up
    const k = ease(prog(t, S.E, S.F)); pose(t, { lean: .45, headPitch: .25 }); ui = { scroll: 420, rowIn: 1 };
    const gulp = Math.max(0, 1 - Math.abs(t - 13.4) / .25);
    face = { brow: .95, mouth: gulp > .2 ? 'wavy' : 'frown', blink: blink(t, [12.4]), look: { x: 0, y: .3 } };
    const hd = wpos(B('Head')); look(hd.clone().add(V(.05, .02, lerp(.75, .62, k))), hd.clone().add(V(0, .07, 0)), 30);
  } else if (t < S.G) { // F thumb presses toggle (OTS)
    const appr = ease(prog(t, S.F, S.FLIP)), flip = ease(prog(t, S.FLIP, S.FLIP + .25)), away = ease(prog(t, 15.7, 16.2));
    const tl = V(.004, -.02, .008).lerp(TOGGLE.clone().add(V(-.008 + flip * .016, 0, .004)), appr * (1 - away));
    pose(t, { lean: .45, indexLocal: tl });
    ui = { scroll: 420, rowIn: 1, knob: flip, flash: t > S.FLIP + .2 ? .55 * (1 - prog(t, S.FLIP + .2, 15.9)) : 0 };
    phoneLight.intensity = .25 + (t > S.FLIP + .2 ? .8 * (1 - prog(t, S.FLIP + .2, 16)) : 0);
    const hd = wpos(B('Head')); look(hd.clone().lerp(phone.position, .35).add(V(.05, .1, 0)), phone.position, 28);
  } else { // G eyes ignite, he sits up
    const g = easeOut(prog(t, S.G + .3, S.G + 1.4)), k = ease(prog(t, S.G, 20));
    pose(t, { lean: lerp(.45, .1, g), headPitch: lerp(.4, -.05, g) });
    face = { brow: lerp(.9, -.6, g), mouth: g > .7 ? 'smirk' : 'frown', glow: g, look: { x: 0, y: lerp(.3, 0, g) } };
    eyeLight.intensity = .5 * g; eyeLight.position.copy(wpos(B('Head'))).add(V(0, .08, .25));
    const hd = wpos(B('Head')); look(hd.clone().add(V(.15, -.05, lerp(1.1, .9, k))), hd.clone().add(V(0, -.05, 0)), 30);
  }
  drawFace(face); drawUI(t, ui);
  effect.render(scene, camera);
  return overlay(t).toDataURL('image/jpeg', q);
};
window.DUR = DURATION;
