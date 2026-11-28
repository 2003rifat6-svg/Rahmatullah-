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
      if (m === OL || m.color.getHexString() === '0b0d14' || m.isMeshBasicMaterial) continue;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const r = g.boundingSphere.radius; if (r < .03) continue;
      const ol = new THREE.Mesh(g, OL); ol.castShadow = ol.receiveShadow = false; ol.raycast = () => {};
      if (g.type === 'CylinderGeometry' && g.parameters.height === 1) { const k = 1 + .011 / g.parameters.radiusTop; ol.scale.set(k, 1, k); }
      else if (g.type === 'TorusGeometry') { const k = 1 + .011 / g.parameters.tube * .35; ol.scale.set(k, k, k); }
      else ol.scale.setScalar(1 + .011 / Math.min(r, .25)); o.add(ol); continue; }
    if (m.map || m.transparent || !m.isMeshStandardMaterial || (m.emissive && m.emissiveIntensity > .2 && m.emissive.getHex() !== 0)) continue;
    const gt = o.geometry.type; if (gt === 'CircleGeometry' || gt === 'ConeGeometry') continue;
    o.getWorldPosition(wp); bb.setFromObject(o); bb.getSize(sz); if (gt === 'PlaneGeometry' && Math.max(sz.x, sz.y, sz.z) < 2) continue; // road paint
    m.color.getHSL(hsl); if (hsl.l < .7) continue;
    let nm = done.get(m); if (!nm) { nm = m.clone(); const h = hsl.s < .12 ? SET_HUE(wp.x) : hsl.h; nm.color.setHSL(h, Math.max(hsl.s, .38), .6 + (hsl.l - .7) * .25); done.set(m, nm); }
    o.material = nm;
  }
})();
