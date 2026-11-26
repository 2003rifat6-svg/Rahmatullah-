// Brevane 3D hook — everything modeled in code with three.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const W = 1920, H = 1080, DURATION = 20;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- timeline ----------
const T = { s2: 4.4, s3: 10.6, s4: 14.3, s5: 16.6, flip: 14.9 };
const CAPTIONS = [
  [0.3, 3.9, "There's a setting on your phone you've never seen."],
  [4.6, 7.96, 'It only shows up at 3:33 AM.'],
  [8.6, 10.47, "It's called... Hidden Mode."],
  [11.0, 14.23, 'And no matter what happens... never turn it on.'],
  [15.2, 17.6, 'You turned it on.'],
];

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#070b16'); scene.fog = new THREE.Fog('#070b16', 4, 9);
const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 50);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.4, 0.45, 0.93); composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- materials ----------
const M = {
  skin: new THREE.MeshPhysicalMaterial({ color: '#e9eef6', roughness: .5, clearcoat: .15, clearcoatRoughness: .5 }),
  ink: new THREE.MeshStandardMaterial({ color: '#06080e', roughness: .25 }),
  hoodie: new THREE.MeshStandardMaterial({ color: '#22345e', roughness: .8 }),
  pants: new THREE.MeshStandardMaterial({ color: '#1a1f2b', roughness: .85 }),
  shoe: new THREE.MeshStandardMaterial({ color: '#e8ecf3', roughness: .6 }),
  string: new THREE.MeshStandardMaterial({ color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: .6 }),
  eyeGlow: new THREE.MeshStandardMaterial({ color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 0 }),
};

// ---------- room ----------
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: '#121a2b', roughness: .7 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ color: '#16203a', roughness: .95 });
const back = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), wallMat); back.position.set(0, 2.5, -1.9); back.receiveShadow = true; scene.add(back);
const side = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), wallMat); side.position.set(-2.2, 2.5, 0); side.rotation.y = Math.PI / 2; scene.add(side);
// window with night city
const winTex = canvasTex(1024, 720, (g, w, h) => {
  const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, '#0b1a38'); sg.addColorStop(1, '#22365e'); g.fillStyle = sg; g.fillRect(0, 0, w, h);
  g.fillStyle = '#eef3fb'; g.shadowColor = '#bcd6ff'; g.shadowBlur = 60; g.beginPath(); g.arc(760, 150, 62, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
  const r = rng(5); for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${.3 + .6 * r()})`; g.fillRect(r() * w, r() * h * .45, 2, 2); }
  let x = 0; const r2 = rng(9);
  while (x < w) { const bw = 60 + r2() * 110, bh = 160 + r2() * 330; g.fillStyle = '#060a14'; g.fillRect(x, h - bh, bw - 8, bh);
    for (let y = h - bh + 18; y < h - 12; y += 30) for (let xx = x + 10; xx < x + bw - 20; xx += 22) if (r2() < .3) { g.fillStyle = r2() < .2 ? 'rgba(0,229,255,.9)' : 'rgba(255,210,140,.75)'; g.fillRect(xx, y, 9, 14); }
    x += bw; }
});
const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.05), new THREE.MeshBasicMaterial({ map: winTex, toneMapped: false, color: '#8899bb' }));
win.position.set(-0.55, 1.55, -1.88); scene.add(win);
const frameMat = new THREE.MeshStandardMaterial({ color: '#2a3654', roughness: .6 });
for (const [w, h, x, y] of [[1.6, .06, -0.55, 2.08], [1.6, .06, -0.55, 1.02], [.06, 1.1, -1.32, 1.55], [.06, 1.1, .22, 1.55], [.04, 1.05, -0.55, 1.55], [1.5, .04, -0.55, 1.55]]) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, .06), frameMat); b.position.set(x, y, -1.86); scene.add(b);
}
// bed
const bedMat = new THREE.MeshStandardMaterial({ color: '#1b2744', roughness: .7 });
const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.0, .32, 1.95), bedMat); bedFrame.position.set(0.55, .16, -0.85); bedFrame.castShadow = bedFrame.receiveShadow = true; scene.add(bedFrame);
const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.94, .16, 1.9), new THREE.MeshStandardMaterial({ color: '#c9d3e6', roughness: .9 })); mattress.position.set(0.55, .4, -0.85); mattress.receiveShadow = true; scene.add(mattress);
const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.96, .08, 1.2), new THREE.MeshStandardMaterial({ color: '#2f4577', roughness: .95 })); blanket.position.set(0.55, .5, -0.55); blanket.rotation.x = .02; blanket.castShadow = blanket.receiveShadow = true; scene.add(blanket);
const pillow = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .55, 6, 16), new THREE.MeshStandardMaterial({ color: '#e1e7f2', roughness: .9 })); pillow.rotation.z = Math.PI / 2; pillow.position.set(0.95, .56, -1.6); scene.add(pillow);
const headboard = new THREE.Mesh(new THREE.BoxGeometry(2.05, .9, .08), bedMat); headboard.position.set(0.55, .6, -1.84); scene.add(headboard);
// nightstand + clock
const stand = new THREE.Mesh(new THREE.BoxGeometry(.48, .52, .42), new THREE.MeshStandardMaterial({ color: '#233052', roughness: .7 })); stand.position.set(-0.85, .26, -0.6); stand.castShadow = true; scene.add(stand);
const clockBody = new THREE.Mesh(new THREE.BoxGeometry(.26, .1, .09), M.ink); clockBody.position.set(-0.85, .57, -0.6); clockBody.rotation.y = .35; scene.add(clockBody);
const clockTex = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#04070d'; g.fillRect(0, 0, w, h); g.font = '700 70px "JetBrains Mono"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#7ff3ff'; g.fillText('3:33', w / 2, h / 2 + 4); });
const clockFace = new THREE.Mesh(new THREE.PlaneGeometry(.24, .085), new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false })); clockFace.position.set(0, 0, .0455); clockBody.add(clockFace);
const clockLight = new THREE.PointLight('#00e5ff', .25, .8); clockLight.position.set(-0.8, .62, -0.5); scene.add(clockLight);

// ---------- Nev ----------
const nev = new THREE.Group(); scene.add(nev);
function part(geo, mat, parent = nev) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function limb(r, mat) { const g = new THREE.Group(); nev.add(g); const cyl = part(new THREE.CylinderGeometry(r, r, 1, 20), mat, g); const j1 = part(new THREE.SphereGeometry(r, 20, 12), mat, g); const j2 = part(new THREE.SphereGeometry(r, 20, 12), mat, g); return { g, cyl, j1, j2 }; }
function setLimb(L, a, b) {
  const d = b.clone().sub(a), len = d.length();
  L.cyl.position.copy(a.clone().add(b).multiplyScalar(.5)); L.cyl.scale.set(1, len, 1);
  L.cyl.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); L.j1.position.copy(a); L.j2.position.copy(b);
}
// torso (hoodie)
const torso = part(new THREE.CapsuleGeometry(.14, .26, 8, 24), M.hoodie); torso.position.set(0, .78, 0); torso.scale.set(1, 1, .82);
const hood = part(new THREE.TorusGeometry(.12, .045, 12, 32), M.hoodie); hood.position.set(0, .96, -.02); hood.rotation.x = Math.PI / 2.2;
for (const s of [-1, 1]) { const st = part(new THREE.CylinderGeometry(.007, .007, .12, 8), M.string); st.position.set(s * .04, .87, .115); }
// legs
const legs = [-1, 1].map(s => ({ th: limb(.065, M.pants), sh: limb(.055, M.pants), foot: part(new THREE.SphereGeometry(.07, 20, 12), M.shoe), s }));
// arms
const arms = [-1, 1].map(s => ({ up: limb(.05, M.hoodie), fo: limb(.038, M.skin), hand: part(new THREE.SphereGeometry(.03, 24, 16), M.skin), s }));
// head + face
const head = new THREE.Group(); nev.add(head);
const HR = .2;
const skull = part(new THREE.SphereGeometry(HR, 48, 32), M.skin, head);
const neck = part(new THREE.CylinderGeometry(.045, .05, .1, 16), M.skin); neck.position.set(0, .99, 0);
function onHead(mesh, ax, ay, off = 0) { // ax: up/down angle, ay: left/right angle (radians)
  const dir = V(Math.sin(ay) * Math.cos(ax), Math.sin(ax), Math.cos(ay) * Math.cos(ax));
  mesh.position.copy(dir.clone().multiplyScalar(HR + off)); mesh.lookAt(dir.clone().multiplyScalar(5)); return mesh;
}
const eyes = [-1, 1].map(s => {
  const e = onHead(part(new THREE.SphereGeometry(1, 24, 16), M.ink, head), .06, s * .36, -.004); e.scale.set(.03, .046, .02);
  const glint = onHead(part(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), head), .1, s * .36 - .05, .012); glint.scale.set(.009, .009, .004);
  const glow = onHead(part(new THREE.SphereGeometry(1, 24, 16), M.eyeGlow, head), .06, s * .36, .0); glow.scale.set(.034, .05, .02); glow.visible = false;
  const brow = part(new THREE.CapsuleGeometry(.009, .06, 4, 8), M.ink, head); brow.userData.s = s;
  return { e, glint, glow, brow, s };
});
function setBrows(worry) { // worry 1 = worried (inner up), -1 = confident (inner down)
  for (const E of eyes) { onHead(E.brow, .3, E.s * .34, .002); E.brow.rotateZ(Math.PI / 2 - E.s * worry * .35); }
}
const mouth = part(new THREE.TorusGeometry(.03, .0065, 8, 24, Math.PI * .7), M.ink, head);
function setMouth(kind) { // 'frown' | 'smirk' | 'flat'
  onHead(mouth, -.36, 0, .0); mouth.rotateX(0);
  if (kind === 'frown') mouth.rotateZ((Math.PI - Math.PI * .7) / 2);
  else if (kind === 'smirk') { mouth.rotateZ(Math.PI + (Math.PI - Math.PI * .7) / 2); mouth.rotateZ(.25); }
  else { mouth.rotateZ((Math.PI - Math.PI * .7) / 2); mouth.scale.set(1, .25, 1); return; }
  mouth.scale.set(1, 1, 1);
}

// phone
const phone = new THREE.Group(); scene.add(phone);
const phoneBody = part(new THREE.BoxGeometry(.078, .158, .009), new THREE.MeshStandardMaterial({ color: '#0a0d16', roughness: .3, metalness: .4 }), phone);
const uiCanvas = document.createElement('canvas'); uiCanvas.width = 600; uiCanvas.height = 1200;
const uiTex = new THREE.CanvasTexture(uiCanvas); uiTex.colorSpace = THREE.SRGBColorSpace;
const screen = new THREE.Mesh(new THREE.PlaneGeometry(.07, .14), new THREE.MeshBasicMaterial({ map: uiTex, toneMapped: false, color: '#d8dde6' })); screen.position.z = .0047; phone.add(screen);
const phoneLight = new THREE.PointLight('#a8f3ff', .035, 1.2, 2); phone.add(phoneLight); phoneLight.position.set(0, .02, .2);

function drawUI(t, o) {
  const g = uiCanvas.getContext('2d'), w = 600, h = 1200, { scroll = 0, rowIn = 0, knob = 0, flash = 0 } = o;
  g.fillStyle = '#0c1322'; g.fillRect(0, 0, w, h);
  g.font = '600 30px Inter'; g.fillStyle = '#e8eef7'; g.textBaseline = 'middle'; g.fillText('3:33', 50, 50);
  g.strokeStyle = '#e8eef7'; g.lineWidth = 3; g.beginPath(); g.roundRect(w - 105, 37, 52, 26, 6); g.stroke(); g.fillStyle = '#e8eef7'; g.fillRect(w - 101, 41, 40, 18);
  g.save(); g.beginPath(); g.rect(0, 90, w, h - 90); g.clip();
  g.font = '800 54px Inter'; g.fillStyle = '#fff'; g.fillText('Settings', 40, 150 - scroll * .25);
  const names = ['Wi-Fi', 'Bluetooth', 'Notifications', 'Sounds', 'Focus', 'Screen Time', 'Display', 'Battery', 'Privacy', 'Storage', 'General'];
  const cols = ['#3a7bd5', '#4a5fd0', '#d05a5a', '#d0507f', '#6a5ad0', '#7a5ad0', '#3a8bd5', '#3fbf6f', '#3a7bd5', '#7a8599', '#7a8599'];
  names.forEach((n, i) => {
    const y = 220 + i * 100 - scroll; if (y < 60 || y > h) return;
    g.fillStyle = '#151e33'; g.beginPath(); g.roundRect(30, y, w - 60, 86, 18); g.fill();
    g.fillStyle = cols[i]; g.beginPath(); g.roundRect(54, y + 21, 44, 44, 11); g.fill();
    g.font = '500 32px Inter'; g.fillStyle = '#e8eef7'; g.fillText(n, 122, y + 44);
    g.strokeStyle = '#59647a'; g.lineWidth = 4; g.beginPath(); g.moveTo(w - 80, y + 31); g.lineTo(w - 66, y + 43); g.lineTo(w - 80, y + 55); g.stroke();
  });
  g.restore();
  if (rowIn > 0) {
    const y = 880; g.save(); g.globalAlpha = rowIn; g.shadowColor = '#00e5ff'; g.shadowBlur = 30 + 15 * Math.sin(t * 5);
    g.fillStyle = '#082331'; g.beginPath(); g.roundRect(30, y, w - 60, 120, 22); g.fill(); g.strokeStyle = '#00e5ff'; g.lineWidth = 4; g.stroke(); g.shadowBlur = 0;
    g.font = '800 40px Inter'; g.fillStyle = '#e8fdff'; g.fillText('Hidden Mode', 60, y + 61);
    const tx = w - 190, ty = y + 30; g.fillStyle = knob > .5 ? '#00e5ff' : '#3a4459'; g.beginPath(); g.roundRect(tx, ty, 120, 60, 30); g.fill();
    g.beginPath(); g.arc(tx + 30 + knob * 60, ty + 30, 25, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore();
  }
  if (flash > 0) { g.fillStyle = `rgba(170,250,255,${flash})`; g.fillRect(0, 0, w, h); }
  uiTex.needsUpdate = true;
}
const TOGGLE_LOCAL = V((450 / 600 - .5) * .07, (.5 - 940 / 1200) * .14, .006);

// particles
const pGeo = new THREE.BufferGeometry(); const N = 260, pos = new Float32Array(N * 3), seeds = [];
const pr = rng(42); for (let i = 0; i < N; i++) seeds.push([pr() * 2.4 - 1.2, pr() * 1.6 + .3, pr() * 1.6 - .9, .05 + pr() * .15]);
pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const pMat = new THREE.PointsMaterial({ color: '#00e5ff', size: .012, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
const pts = new THREE.Points(pGeo, pMat); scene.add(pts);

// lights
scene.add(new THREE.HemisphereLight('#4a62a0', '#0b1020', .9));
const moon = new THREE.DirectionalLight('#9db8ff', 1.4); moon.position.set(-1.2, 3, -3); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); scene.add(moon);
const rim = new THREE.SpotLight('#6f8fff', 6, 6, .6, .6); rim.position.set(1.5, 2.2, -1.6); rim.target.position.set(0, 1, 0); scene.add(rim, rim.target);
const glowLight = new THREE.PointLight('#00e5ff', 0, 3, 1.5); scene.add(glowLight);
const key = new THREE.DirectionalLight('#dfe8ff', .9); key.position.set(.8, 1.8, 2.5); key.target.position.set(0, 1, 0); scene.add(key, key.target);

// ---------- pose ----------
const HEAD_C = V(0, 1.16, .03), PHONE_C = V(0, .93, .32);
function pose(t, o) {
  const breathe = Math.sin(t * 1.6) * .006;
  torso.position.y = .78 + breathe;
  head.position.copy(HEAD_C).add(V(0, breathe, 0));
  head.rotation.set(.32 + (o.headUp || 0), Math.sin(t * .5) * .03, 0);
  for (const L of legs) { const hip = V(L.s * .08, .56, 0), knee = V(L.s * .1, .56, .36), foot = V(L.s * .11, .1, .4);
    setLimb(L.th, hip, knee); setLimb(L.sh, knee, foot); L.foot.position.copy(foot).add(V(0, -.03, .04)); L.foot.scale.set(1, .6, 1.4); }
  // phone in front of chest, facing the face
  phone.position.copy(PHONE_C).add(V(0, breathe, 0)); phone.lookAt(head.position); phone.updateMatrixWorld(true);
  for (const A of arms) {
    const sh = V(A.s * .17, .93 + breathe, 0), el = V(A.s * .22, .76, .16);
    let hand = phone.localToWorld(V(A.s * .066, -.05, -.012));
    if (A.s === 1 && o.thumb) hand = o.thumb;
    setLimb(A.up, sh, el); setLimb(A.fo, el, hand); A.hand.position.copy(hand);
  }
}

function showArms() { torso.visible = hood.visible = neck.visible = true; for (const A of arms) { A.up.g.visible = A.fo.g.visible = A.hand.visible = true; A.hand.scale.setScalar(1); } }
function povArms(thumb) { torso.visible = hood.visible = neck.visible = false; for (const A of arms) { A.up.g.visible = A.fo.g.visible = false; A.hand.visible = thumb && A.s === 1; A.hand.scale.setScalar(thumb ? .55 : 1); } }
// ---------- camera helpers ----------
function look(p, target, fov) { camera.position.copy(p); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(target); }

// ---------- overlay (captions, vignette, grain) ----------
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
function overlay(t) {
  og.drawImage(renderer.domElement, 0, 0);
  const v = og.createRadialGradient(W / 2, H / 2, H * .38, W / 2, H / 2, H * .95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
  const r = rng(Math.floor(t * 30) + 3); og.fillStyle = 'rgba(255,255,255,.03)'; for (let i = 0; i < 900; i++) og.fillRect(r() * W, r() * H, 2, 2);
  for (const c of [T.s2, T.s3, T.s4, T.s5]) { const d = Math.abs(t - c); if (d < .1) { og.fillStyle = `rgba(0,0,0,${1 - d / .1})`; og.fillRect(0, 0, W, H); } }
  if (t < .3) { og.fillStyle = `rgba(0,0,0,${1 - t / .3})`; og.fillRect(0, 0, W, H); }
  if (t > 19.4) { og.fillStyle = `rgba(0,0,0,${prog(t, 19.4, 20)})`; og.fillRect(0, 0, W, H); }
  for (const [a, b, s] of CAPTIONS) if (t >= a && t <= b) {
    const al = Math.min(prog(t, a, a + .2), 1 - prog(t, b - .2, b)); og.save(); og.globalAlpha = al;
    og.font = '800 54px Inter'; og.textAlign = 'center'; og.textBaseline = 'middle';
    const tw = og.measureText(s).width; og.fillStyle = 'rgba(5,7,13,.7)'; og.beginPath(); og.roundRect(W / 2 - tw / 2 - 36, H - 168, tw + 72, 90, 22); og.fill();
    og.fillStyle = s === 'You turned it on.' ? '#7ff3ff' : '#fff'; og.fillText(s, W / 2, H - 122); og.restore();
  }
  return out;
}

// ---------- frame ----------
window.frame = (t, q = .92) => {
  let o = {}; bloom.strength = .4; showArms();
  setBrows(.8); setMouth('frown'); nev.visible = true; head.visible = true;
  for (const E of eyes) { E.e.visible = true; E.glint.visible = true; E.glow.visible = false; }
  M.eyeGlow.emissiveIntensity = 0; glowLight.intensity = 0; pMat.opacity = 0;
  phoneLight.intensity = .035; scene.background.set('#070b16');
  let ui = { scroll: 0, rowIn: 0, knob: 0, flash: 0 };

  if (t < T.s2) { // S1 wide bedroom, slow dolly in
    const k = ease(prog(t, 0, T.s2)); setBrows(.7); setMouth('flat');
    pose(t, o); ui = { scroll: 0 };
    look(V(lerp(1.9, 1.15, k), lerp(1.45, 1.3, k), lerp(2.7, 1.75, k)), V(-0.1, .95, -0.35), 38);
  } else if (t < T.s3) { // S2 POV on phone screen
    pose(t, o); head.visible = false; povArms(false);
    ui = { scroll: ease(prog(t, 4.6, 7.6)) * 430, rowIn: easeOut(prog(t, 8.3, 8.9)) };
    const n = phone.localToWorld(V(0, 0, 1)).sub(phone.position).normalize();
    const d = lerp(.33, .29, prog(t, T.s2, T.s3));
    look(phone.position.clone().add(n.multiplyScalar(d)), phone.position, 34);
  } else if (t < T.s4) { // S3 face close-up, worried
    const k = ease(prog(t, T.s3, T.s4)); setBrows(1); setMouth('frown');
    pose(t, o); ui = { scroll: 430, rowIn: 1 };
    const bl = Math.abs(t - 12.6) < .08; for (const E of eyes) { E.e.scale.y = bl ? .006 : .046; }
    look(V(.06, lerp(1.0, 1.03, k), lerp(.95, .8, k)), V(0, 1.12, .03), 30);
  } else if (t < T.s5) { // S4 thumb flips toggle
    for (const E of eyes) E.e.scale.y = .046;
    pose(t, {});
    const appr = ease(prog(t, T.s4, T.flip)), flip = ease(prog(t, T.flip, T.flip + .3)), away = ease(prog(t, 15.6, 16.4));
    const from = V(.08, -.11, .03), to = TOGGLE_LOCAL.clone().add(V(-.014 + flip * .028, -.004, .016));
    const tl = from.clone().lerp(to, appr).lerp(from, away);
    pose(t, { thumb: phone.localToWorld(tl) }); head.visible = false; povArms(true);
    ui = { scroll: 430, rowIn: 1, knob: flip, flash: t > T.flip + .25 ? .55 * (1 - prog(t, T.flip + .25, T.flip + .9)) : 0 };
    phoneLight.intensity = .035 + (t > T.flip + .25 ? .12 * (1 - prog(t, T.flip + .25, 16)) : 0);
    const n = phone.localToWorld(V(0, 0, 1)).sub(phone.position).normalize();
    const shake = t > T.flip + .25 && t < 15.9 ? (1 - prog(t, T.flip + .25, 15.9)) * .004 : 0;
    look(phone.position.clone().add(n.multiplyScalar(.27)).add(V(Math.sin(t * 60) * shake, Math.cos(t * 50) * shake, 0)), phone.position, 34);
  } else { // S5 eyes ignite
    const g = easeOut(prog(t, T.s5 + .2, T.s5 + 1.4)), k = ease(prog(t, T.s5, 20));
    setBrows(lerp(1, -.7, g)); setMouth(g > .6 ? 'smirk' : 'frown');
    pose(t, { headUp: -.12 * g }); ui = { scroll: 430, rowIn: 1, knob: 1 };
    for (const E of eyes) { E.e.visible = g < .05; E.glint.visible = g < .05; E.glow.visible = g >= .05; E.glow.scale.set(.03, .046, .02); }
    M.eyeGlow.emissiveIntensity = 1.3 * g; glowLight.intensity = .12 * g; glowLight.position.copy(head.position).add(V(0, 0, .35));
    bloom.strength = .4 + .3 * g; pMat.opacity = .85 * g;
    const sh = t < T.s5 + .6 ? (1 - prog(t, T.s5, T.s5 + .6)) * .006 : 0;
    look(V(.04 + Math.sin(t * 55) * sh, lerp(1.08, 1.12, k), lerp(.9, .62, k)), V(0, 1.14, .03), 30);
  }
  drawUI(t, ui);
  const arr = pGeo.attributes.position.array;
  seeds.forEach(([x, y, z, sp], i) => { arr[i * 3] = x + Math.sin(t + i) * .02; arr[i * 3 + 1] = .3 + ((y - .3 + t * sp) % 1.6); arr[i * 3 + 2] = z; });
  pGeo.attributes.position.needsUpdate = true;
  composer.render();
  return overlay(t).toDataURL('image/jpeg', q);
};
window.DUR = DURATION; window.ready = true;
