import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { makeHQ } from './hqchar.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const W = 1920, H = 1080;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#1a1838');
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .35;
const camera = new THREE.PerspectiveCamera(30, W / H, .05, 100);

// lights
scene.add(new THREE.HemisphereLight('#b9c4ff', '#3a2a40', .45));
const key = new THREE.DirectionalLight('#fff1e2', 2.6); key.position.set(-2.5, 4.5, 5); key.castShadow = true; key.shadow.mapSize.set(4096, 4096); key.shadow.radius = 6; key.shadow.bias = -.0004; key.shadow.normalBias = .01;
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 3, bottom: -1, near: .5, far: 15 }); scene.add(key);
const rimP = new THREE.DirectionalLight('#ff5fa8', 2.2); rimP.position.set(-4, 2.5, -3); scene.add(rimP);
const rimB = new THREE.DirectionalLight('#5f8bff', 2.4); rimB.position.set(4, 2.5, -3); scene.add(rimB);
const fillF = new THREE.PointLight('#ffd9c0', 3, 8, 1.5); fillF.position.set(0, 1.6, 3.2); scene.add(fillF);

// set: glossy floor with soft reflection, neon back wall, plants
const mirror = new Reflector(new THREE.PlaneGeometry(30, 30), { textureWidth: 1024, textureHeight: 512, color: '#8a8aa0' }); mirror.rotation.x = -Math.PI / 2; mirror.position.y = -.001; scene.add(mirror);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshPhysicalMaterial({ color: '#4a4466', roughness: .35, metalness: 0, transparent: true, opacity: .78, clearcoat: .6 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wallM = new THREE.MeshStandardMaterial({ color: '#2b2f6a', roughness: .7 });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), wallM); wall.position.set(0, 5, -5); scene.add(wall);
for (let i = -5; i <= 5; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.5, .2), new THREE.MeshStandardMaterial({ color: i % 2 ? '#353a7e' : '#262a5e', roughness: .6 })); p.position.set(i * 1.9, 2.25, -4.8); scene.add(p); }
const neon = (c, x, y, w, h) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, .05), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, -4.65); scene.add(m); const l = new THREE.PointLight(c, 8, 6, 2); l.position.set(x, y, -4); scene.add(l); };
neon('#ff4fa0', -3.1, 2.4, .12, 3.6); neon('#4fd8ff', 3.3, 2.6, .12, 3.8); neon('#ffb84f', .6, 4.2, 3, .1); neon('#a45fff', -1.2, 3.9, 1.6, .08);
const leafM = new THREE.MeshStandardMaterial({ color: '#2f8a4a', roughness: .6 }), potM = new THREE.MeshStandardMaterial({ color: '#e9e4dc', roughness: .5 });
for (const [x, z, s] of [[-4.3, -2.6, 1.2], [4.4, -2.2, 1.3], [-2.2, -4, 1], [2.4, -4, .9]]) { const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.28, .22, .5, 24), potM); pot.position.y = .25; g.add(pot);
  for (let i = 0; i < 14; i++) { const a = i * 2.4, lf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), leafM); lf.scale.set(.09, .45, .03); lf.position.set(Math.cos(a) * .18, .85 + (i % 3) * .2, Math.sin(a) * .18); lf.rotation.set(Math.sin(a) * .7, a, Math.cos(a) * .7); g.add(lf); } }

// characters: same Nev, 4 expressions
const lineup = [['happy', 'happy'], ['angry', 'angry'], ['think', 'think'], ['shock', 'shock']];
const chars = lineup.map(([e, p], i) => { const c = makeHQ({ expr: e, pose: p }); c.position.set((i - 1.5) * 1.05, 0, 0); c.rotation.y = (1.5 - i) * .1; scene.add(c); return c; });
// floating symbols
const font = new FontLoader().parse(await (await fetch('/node_modules/three/examples/fonts/helvetiker_bold.typeface.json')).json());
const sym = (ch, p, rz) => { const g = new TextGeometry(ch, { font, size: .28, depth: .07, bevelEnabled: true, bevelSize: .012, bevelThickness: .015, curveSegments: 10 }); g.center();
  const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#ffc92e', emissive: '#ff9f00', emissiveIntensity: .35, roughness: .3, clearcoat: 1 })); m.position.copy(p); m.rotation.z = rz; m.castShadow = true; scene.add(m); };
sym('?', V(.95, 2.12, .1), -.2); sym('!', V(2.0, 2.12, .1), -.35);

const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: .0035, maxblur: .008 }); composer.addPass(bokeh);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), .22, .4, .97)); composer.addPass(new OutputPass());

const VIEWS = {
  sheet: () => { camera.fov = 30; camera.position.set(0, 1.15, 6.4); camera.lookAt(0, .98, 0); bokeh.uniforms.focus.value = 6.4; },
  portrait: () => { camera.fov = 24; camera.position.set(-1.15, 1.6, 2.1); camera.lookAt(-1.48, 1.35, 0); bokeh.uniforms.focus.value = 2.2; },
  face: () => { camera.fov = 22; camera.position.set(-.3, 1.62, 1.75); camera.lookAt(-.52, 1.5, 0); bokeh.uniforms.focus.value = 1.75; },
};
window.shot = v => { VIEWS[v](); camera.updateProjectionMatrix(); composer.render(); return renderer.domElement.toDataURL('image/jpeg', .93); };
window.ready = true;
