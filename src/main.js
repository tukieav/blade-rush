// Blade Rush — neon knife-throw arcade for CrazyGames
// All assets procedural (Canvas 2D + WebAudio). No engine, own angular kinematics.
import * as SDK from './sdk.js';
import * as AU from './audio.js';

const GAME_W = 540, GAME_H = 960;
const CX = 270, TARGET_Y = 300;
const BLADE_LEN = 88, BLADE_W = 16;
const BLADE_GAP = 0.175; // ~10 deg angular collision
const CRYSTAL_GAP = 0.21;
const THROW_SPEED = 2600;

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

// ---------- state ----------
let state = 'menu'; // menu | playing | throwing | break | dying | gameover
let level = 1, score = 0, best = 0;
let combo = 0, comboTimer = 0;
let stuck = [];        // [{rel}]  relative angles on target
let crystals = [];     // [{rel, alive}]
let bladesLeft = 0, bladesTotal = 0;
let targetAngle = 0, baseSpeed = 1.4, dirSign = 1, patternT = 0, irregular = false, boss = false;
let targetR = 150;
let throwY = 0;        // tip y of flying blade
let readyBlade = true;
let deadBlade = null;  // {x,y,vx,vy,rot,vr}
let pieces = [];       // breaking target chunks
let particles = [];
let floats = [];
let trail = [];
let shake = 0, shakeX = 0, shakeY = 0;
let breakT = 0, dieT = 0, flashT = 0;
let continueUsed = false, canContinue = false;
let deathSnapshot = null;
let time = 0;
let muted = false;

// ---------- levels ----------
function isBoss(lv) { return lv % 5 === 0; }
function setupLevel(lv) {
  boss = isBoss(lv);
  targetR = boss ? 190 : 150;
  stuck = [];
  crystals = [];
  bladesTotal = Math.min(5 + Math.floor(lv * 0.8), 12) + (boss ? 3 : 0);
  bladesLeft = bladesTotal;
  targetAngle = 0;
  patternT = 0;
  dirSign = (lv % 2 === 0) ? -1 : 1;
  baseSpeed = Math.min(1.1 + lv * 0.13, 3.2) * (boss ? 1.15 : 1);
  irregular = lv >= 6;
  const nCry = boss ? 2 : (1 + (lv % 3 === 0 ? 1 : 0));
  for (let i = 0; i < nCry; i++) {
    let a, ok = false, tries = 0;
    while (!ok && tries++ < 40) {
      a = Math.random() * Math.PI * 2;
      ok = crystals.every(c => angDist(c.rel, a) > 0.5);
    }
    crystals.push({ rel: a, alive: true });
  }
  readyBlade = true;
  throwY = 0;
  trail = [];
}

function angDist(a, b) {
  let d = Math.abs((a - b) % (Math.PI * 2));
  return Math.min(d, Math.PI * 2 - d);
}
function norm(a) { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; }

// ---------- rotation ----------
function angVel(dt) {
  patternT += dt;
  if (!irregular) return baseSpeed * dirSign;
  // sinusoidal acceleration, momentary stops, direction flips
  const s = Math.sin(patternT * 0.9) + 0.55 * Math.sin(patternT * 2.3 + 1.7);
  return baseSpeed * dirSign * s * 1.1;
}

// ---------- actions ----------
function startGame() {
  level = 1; score = 0; combo = 0; comboTimer = 0;
  continueUsed = false;
  setupLevel(level);
  state = 'playing';
  SDK.gameplayStart();
  AU.unlockAudio();
}

function throwBlade() {
  if (state !== 'playing' || !readyBlade) return;
  readyBlade = false;
  state = 'throwing';
  throwY = GAME_H - 60; // tip position
  trail = [];
  AU.throwSound();
}

function impact() {
  const rel = norm(Math.PI / 2 - targetAngle);
  // hit an existing blade? -> game over
  for (const b of stuck) {
    if (angDist(b.rel, rel) < BLADE_GAP) { startDeath(); return; }
  }
  // crystal?
  for (const c of crystals) {
    if (c.alive && angDist(c.rel, rel) < CRYSTAL_GAP) {
      c.alive = false;
      const bonus = 50 * Math.max(1, combo);
      score += bonus;
      addFloat('+' + bonus, CX, TARGET_Y + targetR, '#7df9ff');
      crystalParticles(rel);
      AU.crystalSound();
    }
  }
  // stick!
  stuck.push({ rel });
  bladesLeft--;
  combo++;
  comboTimer = 1.6;
  const pts = 10 * combo;
  score += pts;
  addFloat('+' + pts + (combo > 1 ? '  x' + combo : ''), CX, TARGET_Y + targetR + 60, '#ffe14d');
  shake = Math.min(4 + combo * 1.5, 16);
  splinterParticles();
  AU.hitSound(combo);
  flashT = 0.06;
  if (bladesLeft <= 0) {
    breakTarget();
  } else {
    state = 'playing';
    readyBlade = true;
  }
}

function breakTarget() {
  state = 'break';
  breakT = 0;
  shake = boss ? 26 : 18;
  AU.breakSound();
  pieces = [];
  const n = boss ? 10 : 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 260 + Math.random() * 320;
    pieces.push({
      x: CX, y: TARGET_Y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12,
      a0: a, size: targetR * (0.35 + Math.random() * 0.3), boss,
    });
  }
  // stuck blades fly off too
  for (const b of stuck) {
    const wa = targetAngle + b.rel;
    pieces.push({
      x: CX + Math.cos(wa) * targetR, y: TARGET_Y + Math.sin(wa) * targetR,
      vx: Math.cos(wa) * 420, vy: Math.sin(wa) * 420 - 120,
      rot: wa - Math.PI / 2, vr: (Math.random() - 0.5) * 10, blade: true,
    });
  }
  burstParticles(CX, TARGET_Y, boss ? 90 : 50);
  const lvBonus = (boss ? 500 : 100) * level;
  score += lvBonus;
  addFloat((boss ? 'BOSS DOWN! +' : 'LEVEL CLEAR! +') + lvBonus, CX, TARGET_Y, boss ? '#ff5df1' : '#7dff8a');
  if (boss) { AU.bossSound(); SDK.happytime(); }
}

function startDeath() {
  AU.clangSound();
  shake = 20;
  deadBlade = { x: CX, y: TARGET_Y + targetR + BLADE_LEN * 0.5, vx: (Math.random() - 0.5) * 300, vy: 350, rot: -Math.PI / 2, vr: 9 + Math.random() * 5 };
  deathSnapshot = { stuck: stuck.map(b => ({ ...b })), crystals: crystals.map(c => ({ ...c })), bladesLeft, level, targetAngle };
  state = 'dying';
  dieT = 0;
}

function doGameOver() {
  state = 'gameover';
  canContinue = !continueUsed;
  SDK.gameplayStop();
  AU.gameOverSound();
  const total = level * 1000 + score;
  if (total > best) { best = total; SDK.saveBest(best); }
}

async function tryContinue() {
  if (!canContinue) return;
  canContinue = false; continueUsed = true;
  const ok = await SDK.requestAd('rewarded', {
    onStart: () => { AU.setMuted(true); },
    onFinish: () => { AU.setMuted(muted); },
  });
  if (ok || !SDK.sdkAvailable()) {
    // restore level from death point
    const s = deathSnapshot;
    if (s) { stuck = s.stuck; crystals = s.crystals; bladesLeft = s.bladesLeft; targetAngle = s.targetAngle; }
    deadBlade = null; combo = 0;
    readyBlade = true;
    state = 'playing';
    SDK.gameplayStart();
    addFloat('CONTINUE!', CX, GAME_H * 0.5, '#7dff8a');
  }
}

async function playAgain() {
  await SDK.requestAd('midgame', {
    onStart: () => { AU.setMuted(true); },
    onFinish: () => { AU.setMuted(muted); },
  });
  startGame();
}

// ---------- fx ----------
function addFloat(txt, x, y, color) { floats.push({ txt, x, y, color, t: 0 }); }
function splinterParticles() {
  const y = TARGET_Y + targetR;
  for (let i = 0; i < 14; i++) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const sp = 120 + Math.random() * 260;
    particles.push({ x: CX, y, vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1) * 0.4, vy: -Math.abs(Math.sin(a)) * sp, t: 0, life: 0.5 + Math.random() * 0.3, c: boss ? '#9fb4c8' : '#c8955f', s: 2 + Math.random() * 3 });
  }
}
function crystalParticles(rel) {
  const wa = targetAngle + rel;
  const x = CX + Math.cos(wa) * targetR, y = TARGET_Y + Math.sin(wa) * targetR;
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 300;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.6 + Math.random() * 0.4, c: '#7df9ff', s: 2 + Math.random() * 2.5, glow: true });
  }
}
function burstParticles(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 480;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100, t: 0, life: 0.7 + Math.random() * 0.6, c: ['#ffe14d', '#ff5df1', '#7df9ff', '#c8955f'][i % 4], s: 2 + Math.random() * 4, glow: i % 3 === 0 });
  }
}

// ---------- update ----------
function update(dt) {
  time += dt;
  if (state === 'playing' || state === 'throwing' || state === 'break') {
    targetAngle = norm(targetAngle + angVel(dt) * dt);
  }
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

  if (state === 'throwing') {
    throwY -= THROW_SPEED * dt;
    trail.push({ y: throwY, t: 0 });
    if (throwY <= TARGET_Y + targetR) { throwY = TARGET_Y + targetR; impact(); }
  }
  if (state === 'break') {
    breakT += dt;
    for (const p of pieces) {
      p.vy += 1400 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    if (breakT > 1.15) {
      level++;
      setupLevel(level);
      state = 'playing';
      addFloat(boss ? 'BOSS FIGHT!' : 'LEVEL ' + level, CX, TARGET_Y - targetR - 40, boss ? '#ff5df1' : '#ffffff');
    }
  }
  if (state === 'dying') {
    dieT += dt;
    if (deadBlade) {
      deadBlade.vy += 1600 * dt;
      deadBlade.x += deadBlade.vx * dt; deadBlade.y += deadBlade.vy * dt;
      deadBlade.rot += deadBlade.vr * dt;
    }
    if (dieT > 1.0) doGameOver();
  }

  for (const p of particles) { p.t += dt; p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  particles = particles.filter(p => p.t < p.life);
  for (const f of floats) f.t += dt;
  floats = floats.filter(f => f.t < 1.2);
  for (const t of trail) t.t += dt;
  trail = trail.filter(t => t.t < 0.25);

  if (shake > 0) {
    shake = Math.max(0, shake - dt * 60);
    shakeX = (Math.random() - 0.5) * shake; shakeY = (Math.random() - 0.5) * shake;
  } else { shakeX = shakeY = 0; }
  if (flashT > 0) flashT -= dt;
}

// ---------- draw ----------
let woodCache = null, bossCache = null;
function targetTexture(r, isBoss) {
  const c = document.createElement('canvas');
  c.width = c.height = r * 2 + 8;
  const t = c.getContext('2d');
  t.translate(r + 4, r + 4);
  if (!isBoss) {
    // wooden disc with grain rings
    const grad = t.createRadialGradient(0, 0, 8, 0, 0, r);
    grad.addColorStop(0, '#a06a38'); grad.addColorStop(0.7, '#7d4e26'); grad.addColorStop(1, '#5c3618');
    t.fillStyle = grad; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
    for (let i = 1; i <= 7; i++) {
      t.strokeStyle = 'rgba(60,34,12,' + (0.25 + (i % 2) * 0.15) + ')';
      t.lineWidth = 2 + (i % 3);
      t.beginPath(); t.arc(0, 0, r * i / 8 + Math.sin(i * 3.7) * 4, 0, Math.PI * 2); t.stroke();
    }
    // grain streaks
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      t.strokeStyle = 'rgba(50,28,10,0.22)'; t.lineWidth = 1.5;
      t.beginPath(); t.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
      t.lineTo(Math.cos(a + 0.15) * r * 0.92, Math.sin(a + 0.15) * r * 0.92); t.stroke();
    }
  } else {
    // boss: dark metal panels
    const grad = t.createRadialGradient(-r * 0.3, -r * 0.3, 10, 0, 0, r);
    grad.addColorStop(0, '#5a6a80'); grad.addColorStop(0.6, '#38455a'); grad.addColorStop(1, '#222c3d');
    t.fillStyle = grad; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      t.strokeStyle = 'rgba(10,14,22,0.7)'; t.lineWidth = 3;
      t.beginPath(); t.moveTo(0, 0); t.lineTo(Math.cos(a) * r, Math.sin(a) * r); t.stroke();
      // rivets
      t.fillStyle = '#8899b0';
      const rr = r * 0.8;
      t.beginPath(); t.arc(Math.cos(a + 0.39) * rr, Math.sin(a + 0.39) * rr, 4, 0, Math.PI * 2); t.fill();
    }
    t.strokeStyle = 'rgba(255,93,241,0.5)'; t.lineWidth = 4;
    t.beginPath(); t.arc(0, 0, r * 0.45, 0, Math.PI * 2); t.stroke();
  }
  return c;
}

function drawBlade(x, y, rot, scale = 1, glow = true) {
  g.save(); g.translate(x, y); g.rotate(rot + Math.PI / 2); g.scale(scale, scale);
  // rot points along blade direction (tip forward). Draw tip at (0,-L/2)... we draw blade pointing up.
  const L = BLADE_LEN, W = BLADE_W;
  if (glow) { g.shadowColor = '#7df9ff'; g.shadowBlur = 14; }
  // energy blade
  const grad = g.createLinearGradient(0, -L * 0.55, 0, L * 0.1);
  grad.addColorStop(0, '#e8ffff'); grad.addColorStop(0.5, '#7df9ff'); grad.addColorStop(1, '#2b8fd4');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, -L * 0.58);
  g.quadraticCurveTo(W * 0.55, -L * 0.2, W * 0.4, L * 0.05);
  g.lineTo(-W * 0.4, L * 0.05);
  g.quadraticCurveTo(-W * 0.55, -L * 0.2, 0, -L * 0.58);
  g.fill();
  g.shadowBlur = 0;
  // core line
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -L * 0.5); g.lineTo(0, 0); g.stroke();
  // guard + handle
  g.fillStyle = '#1a2436';
  g.fillRect(-W * 0.62, L * 0.05, W * 1.24, W * 0.35);
  const hg = g.createLinearGradient(0, L * 0.1, 0, L * 0.5);
  hg.addColorStop(0, '#3a4a66'); hg.addColorStop(1, '#141c2c');
  g.fillStyle = hg;
  g.fillRect(-W * 0.3, L * 0.1, W * 0.6, L * 0.34);
  g.fillStyle = '#ff5df1';
  g.fillRect(-W * 0.3, L * 0.42, W * 0.6, W * 0.28);
  g.restore();
}

function drawCrystal(x, y, rot, s = 1) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.shadowColor = '#7df9ff'; g.shadowBlur = 16;
  const grad = g.createLinearGradient(0, -18, 0, 18);
  grad.addColorStop(0, '#d8fbff'); grad.addColorStop(0.5, '#7df9ff'); grad.addColorStop(1, '#2fa4d8');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, -20); g.lineTo(12, -4); g.lineTo(8, 16); g.lineTo(-8, 16); g.lineTo(-12, -4);
  g.closePath(); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -20); g.lineTo(0, 16); g.moveTo(-12, -4); g.lineTo(12, -4); g.stroke();
  g.restore();
}

let stars = [];
function initStars() {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 90; i++) stars.push({ x: rnd() * GAME_W, y: rnd() * GAME_H, r: rnd() * 1.8 + 0.4, tw: rnd() * 6 });
}
initStars();

function drawBG() {
  const bg = g.createLinearGradient(0, 0, 0, GAME_H);
  bg.addColorStop(0, '#0a0c18'); bg.addColorStop(0.5, '#111530'); bg.addColorStop(1, '#1a1040');
  g.fillStyle = bg; g.fillRect(0, 0, GAME_W, GAME_H);
  for (const s of stars) {
    g.fillStyle = 'rgba(180,220,255,' + (0.25 + 0.4 * Math.abs(Math.sin(time * 0.7 + s.tw))) + ')';
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
  }
}

function drawTarget() {
  if (!woodCache) woodCache = targetTexture(150, false);
  if (!bossCache) bossCache = targetTexture(190, true);
  const tex = boss ? bossCache : woodCache;
  g.save();
  g.translate(CX, TARGET_Y);
  // neon rim glow
  g.shadowColor = boss ? '#ff5df1' : '#7df9ff'; g.shadowBlur = 24;
  g.strokeStyle = boss ? '#ff5df1' : '#7df9ff'; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, targetR + 4, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0;
  g.rotate(targetAngle);
  g.drawImage(tex, -tex.width / 2, -tex.height / 2);
  g.restore();
  // stuck blades (handles sticking out, rotating with target)
  for (const b of stuck) {
    const wa = targetAngle + b.rel;
    const bx = CX + Math.cos(wa) * (targetR + BLADE_LEN * 0.18);
    const by = TARGET_Y + Math.sin(wa) * (targetR + BLADE_LEN * 0.18);
    // blade points INTO the target => direction of tip = towards center = wa+PI
    drawBladeStuck(wa);
  }
  // crystals on rim
  for (const c of crystals) {
    if (!c.alive) continue;
    const wa = targetAngle + c.rel;
    const x = CX + Math.cos(wa) * (targetR - 6);
    const y = TARGET_Y + Math.sin(wa) * (targetR - 6);
    drawCrystal(x, y, wa + Math.PI / 2, 1);
  }
}

function drawBladeStuck(wa) {
  // stuck depth: tip inside disc; handle sticks out along wa
  const depth = 30; // how deep tip is inside
  const cx = CX + Math.cos(wa) * (targetR - depth + BLADE_LEN * 0.58);
  const cy = TARGET_Y + Math.sin(wa) * (targetR - depth + BLADE_LEN * 0.58);
  // drawBlade draws pointing up with rot+PI/2 rotation; tip direction should be -wa direction (towards center)
  drawBlade(cx, cy, wa + Math.PI, 1, false);
}

function drawHUD() {
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.font = '800 44px "Segoe UI", sans-serif';
  g.fillText(String(score), CX, 18);
  g.font = '600 20px "Segoe UI", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillText((boss ? 'BOSS — LEVEL ' : 'LEVEL ') + level, CX, 68);
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '600 16px "Segoe UI", sans-serif';
  g.fillText('BEST ' + best, 14, 20);
  // combo
  if (combo > 1 && comboTimer > 0) {
    g.textAlign = 'center';
    g.fillStyle = '#ffe14d';
    g.font = '800 ' + (26 + Math.min(combo, 8) * 2) + 'px "Segoe UI", sans-serif';
    g.fillText('COMBO x' + combo, CX, 100);
  }
  // blade icons counter (left side)
  for (let i = 0; i < bladesTotal; i++) {
    const used = i < bladesTotal - bladesLeft;
    const y = GAME_H - 80 - i * 30;
    g.save(); g.translate(26, y); g.rotate(-Math.PI / 2); g.scale(0.28, 0.28);
    g.globalAlpha = used ? 0.22 : 1;
    drawBlade(0, 0, -Math.PI / 2, 1, !used);
    g.restore(); g.globalAlpha = 1;
  }
}

function drawButton(x, y, w, h, label, color, small) {
  g.save();
  g.shadowColor = color; g.shadowBlur = 18;
  g.fillStyle = 'rgba(16,22,40,0.92)';
  roundRect(x - w / 2, y - h / 2, w, h, 14); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = color; g.lineWidth = 3;
  roundRect(x - w / 2, y - h / 2, w, h, 14); g.stroke();
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 ' + (small ? 24 : 32) + 'px "Segoe UI", sans-serif';
  g.fillText(label, x, y + 2);
  g.restore();
}
function roundRect(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const BTN = {
  play: { x: CX, y: 640, w: 260, h: 74 },
  continue: { x: CX, y: 560, w: 320, h: 70 },
  again: { x: CX, y: 660, w: 300, h: 70 },
};

function draw() {
  g.save();
  g.translate(shakeX, shakeY);
  drawBG();

  if (state === 'menu') {
    // demo target
    drawTarget();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#7df9ff'; g.shadowBlur = 26;
    g.fillStyle = '#ffffff';
    g.font = '900 74px "Segoe UI", sans-serif';
    g.fillText('BLADE', CX, 520 - 44);
    g.fillText('RUSH', CX, 520 + 34);
    g.shadowBlur = 0;
    drawButton(BTN.play.x, BTN.play.y, BTN.play.w, BTN.play.h, 'PLAY', '#7df9ff');
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 20px "Segoe UI", sans-serif';
    g.fillText('Tap to throw. Don\u2019t hit other blades!', CX, 720);
    g.fillText('BEST: ' + best, CX, 760);
    drawBlade(CX, GAME_H - 60 - BLADE_LEN * 0.1, -Math.PI / 2, 1, true);
  } else if (state === 'playing' || state === 'throwing' || state === 'break' || state === 'dying') {
    if (state !== 'break') drawTarget();
    // breaking pieces
    for (const p of pieces) {
      if (state !== 'break') break;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      if (p.blade) { drawBlade(0, 0, -Math.PI / 2, 1, false); }
      else {
        g.fillStyle = p.boss ? '#38455a' : '#7d4e26';
        g.strokeStyle = p.boss ? '#8899b0' : '#5c3618'; g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-p.size * 0.5, -p.size * 0.3); g.lineTo(p.size * 0.5, -p.size * 0.4);
        g.lineTo(p.size * 0.4, p.size * 0.4); g.lineTo(-p.size * 0.35, p.size * 0.35);
        g.closePath(); g.fill(); g.stroke();
      }
      g.restore();
    }
    // flying blade + trail
    if (state === 'throwing') {
      for (const t of trail) {
        const a = 1 - t.t / 0.25;
        g.fillStyle = 'rgba(125,249,255,' + (a * 0.35) + ')';
        g.fillRect(CX - 4 * a, t.y + BLADE_LEN * 0.3, 8 * a, 26);
      }
      drawBlade(CX, throwY + BLADE_LEN * 0.58, -Math.PI / 2, 1, true);
    }
    // ready blade at bottom
    if (state === 'playing' && readyBlade) {
      drawBlade(CX, GAME_H - 60 - BLADE_LEN * 0.1 + Math.sin(time * 5) * 3, -Math.PI / 2, 1, true);
    }
    // dead bouncing blade
    if (state === 'dying' && deadBlade) {
      drawBlade(deadBlade.x, deadBlade.y, deadBlade.rot, 1, true);
    }
    drawHUD();
  } else if (state === 'gameover') {
    drawTarget();
    g.fillStyle = 'rgba(6,8,16,0.82)'; g.fillRect(0, 0, GAME_W, GAME_H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff5df1'; g.shadowBlur = 24;
    g.fillStyle = '#ffffff'; g.font = '900 62px "Segoe UI", sans-serif';
    g.fillText('GAME OVER', CX, 300);
    g.shadowBlur = 0;
    g.font = '700 30px "Segoe UI", sans-serif';
    g.fillText('Level ' + level + '   •   Score ' + score, CX, 380);
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = '600 22px "Segoe UI", sans-serif';
    g.fillText('BEST: ' + best, CX, 424);
    if (canContinue) drawButton(BTN.continue.x, BTN.continue.y, BTN.continue.w, BTN.continue.h, '\u25B6 CONTINUE (AD)', '#7dff8a', true);
    drawButton(BTN.again.x, BTN.again.y, BTN.again.w, BTN.again.h, 'PLAY AGAIN', '#7df9ff', true);
  }

  // particles
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    if (p.glow) { g.shadowColor = p.c; g.shadowBlur = 8; }
    g.fillStyle = p.c; g.globalAlpha = a;
    g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    g.globalAlpha = 1; g.shadowBlur = 0;
  }
  // floats
  for (const f of floats) {
    const a = 1 - f.t / 1.2;
    g.globalAlpha = a;
    g.fillStyle = f.color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 30px "Segoe UI", sans-serif';
    g.fillText(f.txt, f.x, f.y - f.t * 60);
    g.globalAlpha = 1;
  }
  if (flashT > 0) {
    g.fillStyle = 'rgba(255,255,255,' + (flashT * 3) + ')';
    g.fillRect(0, 0, GAME_W, GAME_H);
  }
  g.restore();
}

// ---------- input ----------
function gamePos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (GAME_W / r.width),
    y: (e.clientY - r.top) * (GAME_H / r.height),
  };
}
function inBtn(p, b) { return Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2; }

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  AU.unlockAudio();
  const p = gamePos(e);
  if (state === 'menu') {
    if (inBtn(p, BTN.play)) { AU.uiSound(); startGame(); }
  } else if (state === 'playing') {
    throwBlade();
  } else if (state === 'gameover') {
    if (canContinue && inBtn(p, BTN.continue)) { AU.uiSound(); tryContinue(); }
    else if (inBtn(p, BTN.again)) { AU.uiSound(); playAgain(); }
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    AU.unlockAudio();
    if (state === 'menu') startGame();
    else if (state === 'playing') throwBlade();
  }
});

// ---------- resize ----------
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = Math.min(vw / GAME_W, vh / GAME_H);
  canvas.width = GAME_W; canvas.height = GAME_H;
  canvas.style.width = (GAME_W * s) + 'px';
  canvas.style.height = (GAME_H * s) + 'px';
}
window.addEventListener('resize', resize);
resize();

// ---------- loop ----------
let lastT = 0;
function frame(ts) {
  const dt = Math.min((ts - lastT) / 1000, 0.05);
  lastT = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(async () => {
  await SDK.initSDK();
  SDK.loadingStart();
  best = SDK.loadBest();
  muted = SDK.getMuteSetting();
  AU.setMuted(muted);
  SDK.onSettingsChange((s) => { muted = !!s.muteAudio; AU.setMuted(muted); });
  setupLevel(1);
  SDK.loadingStop();
  requestAnimationFrame(frame);
})();

// ---------- debug hook ----------
if (new URLSearchParams(location.search).get('debug') === '1') {
  window.__astro = {
    forceGameOver: () => { if (state === 'playing' || state === 'throwing') startDeath(); dieT = 2; doGameOver(); },
    getState: () => ({ state, level, score, bladesLeft, bladesTotal, combo, best, canContinue, continueUsed, stuck: stuck.length }),
    addScore: (n) => { score += n; },
    throwNow: () => throwBlade(),
    winLevel: () => { if (state === 'playing') { bladesLeft = 0; breakTarget(); } },
  };
}
