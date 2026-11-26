// Phone screen drawing (600x1200 canvas). All modes share a status bar.
const CY = '#00e5ff';
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function status(g, o) {
  g.font = '600 30px Inter'; g.fillStyle = '#e8eef7'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(o.time || '3:33', 44, 48);
  const pct = o.battery ?? 100, low = pct <= 20;
  g.strokeStyle = '#e8eef7'; g.lineWidth = 3; rr(g, 600 - 112, 35, 56, 26, 6); g.stroke(); g.fillStyle = '#e8eef7'; g.fillRect(600 - 55, 43, 4, 10);
  g.fillStyle = low ? '#ff4d4d' : '#e8eef7'; g.fillRect(600 - 108, 39, 48 * Math.max(.04, pct / 100), 18);
  g.font = '600 24px Inter'; g.textAlign = 'right'; g.fillStyle = low ? '#ff6b6b' : '#e8eef7'; g.fillText(pct + '%', 600 - 122, 49); g.textAlign = 'left';
  if (o.dot) { g.save(); g.shadowColor = CY; g.shadowBlur = 20 * o.dot; g.fillStyle = CY; g.beginPath(); g.arc(600 - 182 - (o.dotX || 0), 48, 9 * (o.dotScale || 1), 0, Math.PI * 2); g.fill(); g.restore(); }
}
function bg(g, col) { g.fillStyle = col || '#0f1626'; g.fillRect(0, 0, 600, 1200); }
function avatar(g, x, y, r, kind) {
  g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  const cols = { jake: '#3fae6a', teacher: '#7a8599', mom: '#a05ad0', you: '#f3f6fb', bank: '#2f6fd6', weather: '#f2b33d', system: '#00b8cc' };
  g.fillStyle = cols[kind] || '#556'; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  if (kind === 'you') { // Nev's face
    g.fillStyle = '#0b0d14'; g.beginPath(); g.ellipse(x - r * .32, y - r * .05, r * .12, r * .18, 0, 0, 7); g.ellipse(x + r * .32, y - r * .05, r * .12, r * .18, 0, 0, 7); g.fill();
  } else if (kind === 'weather') { g.fillStyle = '#fff'; g.font = `800 ${r * 1.1}px Inter`; g.textAlign = 'center'; g.fillText('!', x, y + 4); g.textAlign = 'left'; }
  else if (kind === 'bank') { g.fillStyle = '#fff'; g.font = `800 ${r}px Inter`; g.textAlign = 'center'; g.fillText('$', x, y + 4); g.textAlign = 'left'; }
  else { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `800 ${r}px Inter`; g.textAlign = 'center'; g.fillText((kind || '?')[0].toUpperCase(), x, y + 3); g.textAlign = 'left'; }
  g.restore();
}
function card(g, y, n, a = 1) {
  g.save(); g.globalAlpha = a;
  const h = n.big ? 230 : 170;
  g.fillStyle = n.red ? 'rgba(80,20,28,.92)' : 'rgba(34,44,70,.92)'; rr(g, 26, y, 548, h, 26); g.fill();
  if (n.glow) { g.shadowColor = n.glowCol || CY; g.shadowBlur = 30; g.strokeStyle = n.glowCol || CY; g.lineWidth = 4; g.stroke(); g.shadowBlur = 0; }
  avatar(g, 82, y + 56, 30, n.who);
  g.font = '700 30px Inter'; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(n.title, 128, y + 46);
  g.font = '500 22px Inter'; g.fillStyle = n.tagCol || '#9fb0c8'; g.textAlign = 'right'; g.fillText(n.tag || 'now', 552, y + 46); g.textAlign = 'left';
  g.font = '500 29px Inter'; g.fillStyle = '#dfe6f2';
  const words = n.body.split(' '); let line = '', ly = y + 100;
  for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > 500) { g.fillText(line, 50, ly); line = w; ly += 38; } else line = test; }
  g.fillText(line, 50, ly);
  g.restore(); return h;
}
export function drawPhoneUI(g, s) {
  const mode = s.mode || 'settings';
  if (mode === 'off') { bg(g, '#05070c'); return; }
  if (mode === 'restart') { bg(g, '#000'); g.save(); g.translate(300, 600); g.rotate((s.t || 0) * 4); g.strokeStyle = '#9fb0c8'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 50, 0, 4.5); g.stroke(); g.restore();
    g.font = '600 30px Inter'; g.fillStyle = '#9fb0c8'; g.textAlign = 'center'; g.fillText(s.label || 'Restarting...', 300, 720); g.textAlign = 'left'; return; }
  if (mode === 'bigtoggle') {
    const grd = g.createRadialGradient(300, 600, 50, 300, 600, 700); grd.addColorStop(0, '#0d3a4a'); grd.addColorStop(1, '#05101a'); g.fillStyle = grd; g.fillRect(0, 0, 600, 1200);
    g.textAlign = 'center'; g.font = '900 64px Inter'; g.fillStyle = '#e8fdff'; g.fillText('HIDDEN', 300, 330); g.fillText('MODE', 300, 410);
    g.save(); g.shadowColor = CY; g.shadowBlur = 60; g.fillStyle = CY; rr(g, 90, 520, 420, 210, 105); g.fill(); g.restore();
    g.beginPath(); g.arc(405, 625, 88, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.font = '900 70px Inter'; g.fillStyle = '#04202a'; g.fillText('ON', 200, 650); g.textAlign = 'left'; return;
  }
  if (mode === 'settings') {
    bg(g); status(g, s);
    const scroll = s.scroll || 0;
    g.save(); g.beginPath(); g.rect(0, 90, 600, 1110); g.clip();
    g.font = '800 54px Inter'; g.fillStyle = '#fff'; g.fillText('Settings', 40, 150 - scroll * .25);
    const names = ['Wi-Fi', 'Bluetooth', 'Notifications', 'Sounds', 'Focus', 'Screen Time', 'Display', 'Battery', 'Privacy', 'Storage', 'General'];
    const cols = ['#3a7bd5', '#4a5fd0', '#d05a5a', '#d0507f', '#6a5ad0', '#7a5ad0', '#3a8bd5', '#3fbf6f', '#3a7bd5', '#7a8599', '#7a8599'];
    names.forEach((n, i) => { const y = 220 + i * 100 - scroll; if (y < 60 || y > 1200) return;
      g.fillStyle = '#151e33'; rr(g, 30, y, 540, 86, 18); g.fill(); g.fillStyle = cols[i]; rr(g, 54, y + 21, 44, 44, 11); g.fill();
      g.font = '500 32px Inter'; g.fillStyle = '#e8eef7'; g.fillText(n, 122, y + 44); });
    g.restore();
    const y = 880;
    if (s.gone) { // the row has vanished: glitchy empty gap
      g.fillStyle = '#0f1626'; g.fillRect(20, y - 6, 560, 132);
      g.strokeStyle = `rgba(0,229,255,${.25 + .2 * Math.sin((s.t || 0) * 20)})`; g.setLineDash([12, 10]); g.lineWidth = 3; rr(g, 30, y, 540, 120, 22); g.stroke(); g.setLineDash([]);
    } else if ((s.rowIn || 0) > 0) {
      g.save(); g.globalAlpha = s.rowIn; g.shadowColor = CY; g.shadowBlur = 30;
      g.fillStyle = '#082331'; rr(g, 30, y, 540, 120, 22); g.fill(); g.strokeStyle = CY; g.lineWidth = 4; g.stroke(); g.shadowBlur = 0;
      g.font = '800 40px Inter'; g.fillStyle = '#e8fdff'; g.fillText('Hidden Mode', 60, y + 61);
      const tx = 410, ty = y + 30, k = s.knob || 0; g.fillStyle = k > .5 ? CY : '#3a4459'; rr(g, tx, ty, 120, 60, 30); g.fill();
      g.beginPath(); g.arc(tx + 30 + k * 60, ty + 30, 25, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore();
    }
  } else if (mode === 'lock' || mode === 'notif') {
    const grd = g.createLinearGradient(0, 0, 0, 1200); grd.addColorStop(0, s.wall1 || '#1c2448'); grd.addColorStop(1, s.wall2 || '#3a2a5a'); g.fillStyle = grd; g.fillRect(0, 0, 600, 1200);
    status(g, s);
    if (mode === 'lock') { g.font = '200 150px Inter'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(s.bigTime || s.time || '3:33', 300, 250); g.font = '500 30px Inter'; g.fillText(s.date || 'Tuesday, November 4', 300, 145); g.textAlign = 'left'; }
    let y = mode === 'lock' ? 380 : 130;
    for (const n of (s.notifs || [])) { const a = n.a ?? 1; if (a <= 0) continue; const off = (1 - a) * 40; const h = card(g, y + off, n, a); y += h + 18; }
    if (s.empty) { g.font = '500 32px Inter'; g.fillStyle = `rgba(159,176,200,${s.empty})`; g.textAlign = 'center'; g.fillText('No Notifications', 300, 640); g.textAlign = 'left'; }
  } else if (mode === 'battery') {
    bg(g, '#0b1020'); status(g, s);
    const pct = s.pct ?? 100, low = pct <= 20, col = low ? '#ff4d4d' : pct <= 60 ? '#f2b33d' : '#3fd07a';
    g.strokeStyle = '#e8eef7'; g.lineWidth = 10; rr(g, 140, 330, 320, 560, 46); g.stroke(); g.fillStyle = '#e8eef7'; rr(g, 240, 296, 120, 34, 10); g.fill();
    const fh = 520 * Math.max(.02, pct / 100); g.fillStyle = col; g.shadowColor = col; g.shadowBlur = low ? 30 : 0; rr(g, 160, 870 - fh, 280, fh, 30); g.fill(); g.shadowBlur = 0;
    g.font = '900 120px Inter'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(pct + '%', 300, 1010);
    if (s.plugged) { g.font = '800 70px Inter'; g.fillStyle = '#f2b33d'; g.fillText('⚡', 300, 620); }
    if (s.delta) { g.font = '900 80px Inter'; g.fillStyle = '#ff4d4d'; g.globalAlpha = s.deltaA ?? 1; g.fillText(s.delta, 300, 1120); g.globalAlpha = 1; }
    if (s.label) { g.font = '700 34px Inter'; g.fillStyle = '#9fb0c8'; g.fillText(s.label, 300, 200); }
    g.textAlign = 'left';
  } else if (mode === 'popup') {
    const grd = g.createLinearGradient(0, 0, 0, 1200); grd.addColorStop(0, '#081624'); grd.addColorStop(1, '#0c2a36'); g.fillStyle = grd; g.fillRect(0, 0, 600, 1200); status(g, s);
    g.save(); g.shadowColor = CY; g.shadowBlur = 40; g.fillStyle = '#0d2533'; rr(g, 40, 300, 520, 420, 34); g.fill(); g.strokeStyle = CY; g.lineWidth = 5; g.stroke(); g.restore();
    g.textAlign = 'center'; g.font = '800 40px Inter'; g.fillStyle = '#fff'; g.fillText('Hidden Mode', 300, 380); g.fillText('Update Available', 300, 430);
    g.font = '500 30px Inter'; g.fillStyle = '#bfe9f2'; g.fillText('Install tonight at 3:33 AM?', 300, 510);
    g.fillStyle = CY; rr(g, 80, 590, 200, 80, 20); g.fill(); g.fillStyle = '#3a4459'; rr(g, 320, 590, 200, 80, 20); g.fill();
    g.font = '800 32px Inter'; g.fillStyle = '#04202a'; g.fillText('Install', 180, 632); g.fillStyle = '#fff'; g.fillText('Later', 420, 632); g.textAlign = 'left';
    if (s.under) card(g, 780, s.under, s.underA ?? 1);
  }
  if (s.shake) { g.save(); g.strokeStyle = `rgba(255,60,60,${.5 + .5 * Math.sin((s.t || 0) * 40)})`; g.lineWidth = 18; g.strokeRect(0, 0, 600, 1200); g.restore(); }
  if (s.flash) { g.fillStyle = `rgba(170,250,255,${s.flash})`; g.fillRect(0, 0, 600, 1200); }
}
