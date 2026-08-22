// Blade Rush — neon knife-throw arcade for CrazyGames
// All assets procedural (Canvas 2D + WebAudio). No engine, own angular kinematics.
import * as SDK from './sdk.js';
import * as AU from './audio.js';
import * as META from './meta.js';

const GAME_W = 540, GAME_H = 960;
const CX = 270, TARGET_Y = 300;
const BLADE_LEN = 88, BLADE_W = 16;
// Collision follows the solid blade spine, not its intentionally generous glow.
const BLADE_CORE_W = BLADE_W * 0.46;
const CRYSTAL_GAP = 0.21;
const THROW_SPEED = 2600;
const FIXED_STEP = 1 / 120;
const MAX_PARTICLES = 180, MAX_CONFETTI = 90, MAX_TRAIL = 18;
const MAX_FLOATS = 20, MAX_TOASTS = 4, MAX_PIECES = 30;

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

// The simulation intentionally stays in a stable portrait coordinate space.  The
// renderer projects that action lane into a full-bleed DPR canvas and uses the
// remaining desktop width for the live arena broadcast.
let viewW = 0, viewH = 0, pixelRatio = 1;
let stageScale = 1, stageX = 0, stageY = 0;
let firstHitThisRun = false;

// ---------- state ----------
let state = 'menu'; // menu | playing | throwing | break | dying | gameover | shop | bosses | missions
let level = 1, score = 0, best = 0;
let combo = 0, comboTimer = 0;
let stuck = [];        // [{rel}]  relative angles on target
let crystals = [];     // [{rel, alive}]
let bladesLeft = 0, bladesTotal = 0;
let targetAngle = 0, baseSpeed = 1.4, dirSign = 1, patternT = 0, irregular = false, boss = false;
let bossInfo = null;   // current boss variant from META.BOSSES
let targetR = 150;
let throwY = 0;        // tip y of flying blade
let readyBlade = true;
let deadBlade = null;  // {x,y,vx,vy,rot,vr}
let pieces = [];       // breaking target chunks
let particles = [];
let floats = [];
let trail = [];
let toasts = [];       // [{txt, sub, t, color}] top banners (missions, daily)
let shake = 0, shakeX = 0, shakeY = 0;
let breakT = 0, dieT = 0, flashT = 0;
let slowmo = 0;        // real-time seconds of slow motion left (blade-blade clash)
let targetType = 'wood'; // wood | metal | energy (visual only)
let ambient = [];      // ambient falling sparks in the arena
let confetti = [];     // boss-defeat confetti pieces
let continueUsed = false, canContinue = false;
let deathSnapshot = null;
let time = 0;
let muted = false;
let runTime = 0;       // seconds since run start (dynamic difficulty)
let runShards = 0;     // shards earned this run (for x2 ad)
let runBosses = 0;     // bosses killed this run
let x2Used = false;
let onboardingVisible = false; // persistent, first-level visual control teaching
let shopScroll = 0;
let paused = false;
const pauseReasons = new Set();
let reducedMotion = false;

// ---------- levels ----------
function isBoss(lv) { return lv % 5 === 0; }
function setupLevel(lv) {
  boss = isBoss(lv);
  bossInfo = boss ? META.bossForLevel(lv) : null;
  // The onboarding levels are generous without changing collision/timing rules.
  targetR = boss ? 190 : (lv <= 2 ? 172 : 150);
  targetType = boss ? 'boss' : (lv % 7 === 0 ? 'energy' : (lv % 3 === 0 ? 'metal' : 'wood'));
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
function boundedPush(list, item, max) { if (list.length >= max) list.shift(); list.push(item); }
function bladeCoreGap() { return Math.asin(Math.min(0.99, (BLADE_CORE_W * 0.5) / Math.max(1, targetR))); }

function patternState() {
  const ease = 0.72 + 0.28 * Math.min(runTime / 60, 1);
  if (level <= 4) return { kind: 'steady', speed: baseSpeed * ease, direction: dirSign, cue: 0, dual: false, phase: 0 };
  const phase = patternT % 6;
  const variant = (level + (boss ? 1 : 0)) % 3;
  if (variant === 0) {
    const reversing = phase >= 3.4;
    return { kind: 'reverse', speed: baseSpeed * ease, direction: dirSign * (reversing ? -1 : 1), cue: phase >= 2.55 && phase < 3.4 ? (phase - 2.55) / .85 : 0, dual: false, phase, active: reversing };
  }
  if (variant === 1) {
    const pulse = phase >= 2.2 && phase < 3.8;
    const pulseT = pulse ? Math.sin((phase - 2.2) / 1.6 * Math.PI) : 0;
    return { kind: 'pulse', speed: baseSpeed * ease * (1 + pulseT * .5), direction: dirSign, cue: phase >= 1.35 && phase < 2.2 ? (phase - 1.35) / .85 : 0, dual: false, phase, active: pulse };
  }
  return { kind: 'dual', speed: baseSpeed * ease * .82, direction: dirSign, cue: phase < 1.2 ? 1 - phase / 1.2 : 0, dual: true, phase, active: true };
}

// Rotation patterns are explicit, telegraphed cadence states rather than opaque noise.
function angVel() { const p = patternState(); return p.speed * p.direction; }

// ---------- shards ----------
function gainShards(n, x, y) {
  runShards += n;
  META.addShards(n);
  addFloat('+' + n + ' \u25C6', x, y, '#7df9ff');
  AU.shardSound();
}
function onMissions(done) {
  if (!done.length) return;
  const reward = done.reduce((total, m) => total + m.reward, 0);
  const one = done.length === 1;
  // A single outcome card keeps simultaneous milestones readable instead of
  // stacking notifications over the live target.
  boundedPush(toasts, {
    txt: one ? 'MISSION COMPLETE' : done.length + ' MISSIONS COMPLETE',
    sub: one ? done[0].desc + '  +' + done[0].reward + ' \u25C6' : '+' + reward + ' \u25C6 rewards',
    t: 0, color: '#7dff8a',
  }, MAX_TOASTS);
  AU.missionSound();
  SDK.happytime();
}

// ---------- actions ----------
function startGame() {
  level = 1; score = 0; combo = 0; comboTimer = 0;
  continueUsed = false;
  runTime = 0; runShards = 0; runBosses = 0; x2Used = false;
  // The cue is a first-save teaching moment, not recurring run-start copy.
  onboardingVisible = !META.M.onboardingSeen;
  firstHitThisRun = false;
  // The daily toast has had a full menu exposure; do not let it cover the
  // opening target or compete with the in-play teaching cue.
  toasts = toasts.filter(t => !t.txt.startsWith('DAILY BONUS'));
  setupLevel(level);
  state = 'playing';
  onMissions(META.bump('runs', 1));
  SDK.gameplayStart();
  AU.unlockAudio();
}

function throwBlade() {
  if (state !== 'playing' || !readyBlade) return;
  if (onboardingVisible) {
    onboardingVisible = false;
    META.completeOnboarding();
  }
  readyBlade = false;
  state = 'throwing';
  throwY = GAME_H - 60; // tip position
  trail = [];
  hintT = 0;
  AU.throwSound();
}

function impact() {
  const rel = norm(Math.PI / 2 - targetAngle);
  // hit an existing blade? -> game over
  for (const b of stuck) {
    if (angDist(b.rel, rel) < bladeCoreGap()) { startDeath(); return; }
  }
  // crystal?
  for (const c of crystals) {
    if (c.alive && angDist(c.rel, rel) < CRYSTAL_GAP) {
      c.alive = false;
      const bonus = 50 * Math.max(1, combo);
      score += bonus;
      addFloat('+' + bonus, CX, TARGET_Y + targetR, '#7df9ff');
      gainShards(META.perk() === 'crystal' ? 3 : 2, CX, TARGET_Y + targetR + 34);
      onMissions(META.bump('crystals', 1));
      crystalParticles(rel);
      AU.crystalSound();
    }
  }
  // stick!
  stuck.push({ rel, wob: reducedMotion ? 0.35 : 1, wt: 0 });
  bladesLeft--;
  combo++;
  comboTimer = 1.6;
  const doneCombo = META.bump('bestCombo', combo, true);
  const doneThrows = META.bump('throws', 1);
  onMissions(doneCombo.concat(doneThrows));
  const pts = 10 * combo;
  score += pts;
  addFloat('+' + pts + (combo > 1 ? '  x' + combo : ''), CX, TARGET_Y + targetR + 60, '#ffe14d');
  shake = Math.min(4 + combo * 1.5, 16);
  splinterParticles();
  const openingHit = !firstHitThisRun && runTime < 30;
  sparkBurst(CX, TARGET_Y + targetR, openingHit ? 38 : 10 + combo * 2);
  if (openingHit) {
    firstHitThisRun = true;
    burstParticles(CX, TARGET_Y + targetR, 24);
    addFloat('FIRST STRIKE!', CX, TARGET_Y + targetR + 88, '#7df9ff');
    flashT = reducedMotion ? 0.04 : 0.14;
  }
  AU.hitSound(combo);
  flashT = reducedMotion ? 0.025 : 0.06;
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
  shake = reducedMotion ? 4 : (boss ? 26 : 18);
  AU.breakSound();
  pieces = [];
  const n = boss ? 10 : 7;
  const metal = bossInfo ? bossInfo.metal : null;
  let tex = null;
  try {
    tex = boss && bossInfo ? bossTexture(bossInfo, 190) : targetCaches.get(targetType + ':' + targetR);
  } catch (e) {}
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 260 + Math.random() * 320;
    boundedPush(pieces, {
      x: CX, y: TARGET_Y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12,
      a0: a, size: targetR * (0.35 + Math.random() * 0.3), boss, metal, tex,
      span: (Math.PI * 2 / n) * (0.85 + Math.random() * 0.3), r0: targetR,
    }, MAX_PIECES);
  }
  // stuck blades fly off too
  for (const b of stuck) {
    const wa = targetAngle + b.rel;
    boundedPush(pieces, {
      x: CX + Math.cos(wa) * targetR, y: TARGET_Y + Math.sin(wa) * targetR,
      vx: Math.cos(wa) * 420, vy: Math.sin(wa) * 420 - 120,
      rot: wa - Math.PI / 2, vr: (Math.random() - 0.5) * 10, blade: true,
    }, MAX_PIECES);
  }
  burstParticles(CX, TARGET_Y, boss ? 90 : 50);
  const lvBonus = (boss ? 500 : 100) * level;
  score += lvBonus;
  addFloat((boss ? 'BOSS DOWN! +' : 'LEVEL CLEAR! +') + lvBonus, CX, TARGET_Y, boss ? '#ff5df1' : '#7dff8a');
  const lvShards = (boss ? 10 : 3) + (META.perk() === 'level' ? 2 : 0);
  gainShards(lvShards, CX, TARGET_Y + 46);
  if (boss) {
    AU.bossSound(); SDK.happytime();
    runBosses++;
    confettiBurst(CX, TARGET_Y, 70);
    onMissions(META.recordBossKill(bossInfo.id));
    onMissions(META.bump('bestBossRun', runBosses, true));
  } else {
    AU.levelUpSound();
  }
}

function startDeath() {
  AU.clangSound();
  shake = reducedMotion ? 4 : 26;
  slowmo = 0.2;      // dramatic slow motion on blade-blade clash
  flashT = reducedMotion ? 0.04 : 0.16;
  clashBurst(CX, TARGET_Y + targetR);
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
  onMissions(META.bump('bestLevel', level, true));
}

async function tryContinue() {
  if (!canContinue) return;
  canContinue = false; continueUsed = true;
  const ok = await SDK.requestAd('rewarded', {
    onStart: () => { pauseGameplay('ad'); AU.setMuted(true); },
    onFinish: () => { AU.setMuted(muted); resumeGameplay('ad'); },
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

async function tryDouble() {
  if (x2Used || runShards <= 0) return;
  x2Used = true;
  const ok = await SDK.requestAd('rewarded', {
    onStart: () => { pauseGameplay('ad'); AU.setMuted(true); },
    onFinish: () => { AU.setMuted(muted); resumeGameplay('ad'); },
  });
  if (ok || !SDK.sdkAvailable()) {
    META.addShards(runShards);
    boundedPush(toasts, { txt: 'SHARDS DOUBLED', sub: '+' + runShards + ' \u25C6', t: 0, color: '#7df9ff' }, MAX_TOASTS);
    runShards *= 2;
    AU.buySound();
  }
}

async function playAgain() {
  // A new attempt is always instant. An optional natural-break ad may pause only
  // after the attempt has started; it never gates the restart itself.
  startGame();
  SDK.requestAd('midgame', {
    onStart: () => { pauseGameplay('ad'); AU.setMuted(true); },
    onFinish: () => { AU.setMuted(muted); resumeGameplay('ad'); },
  });
}

// ---------- fx ----------
function addFloat(txt, x, y, color) { boundedPush(floats, { txt, x, y, color, t: 0 }, MAX_FLOATS); }
function splinterParticles() {
  const y = TARGET_Y + targetR;
  for (let i = 0; i < 14; i++) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const sp = 120 + Math.random() * 260;
    const col = boss || targetType === 'metal' ? '#9fb4c8' : targetType === 'energy' ? '#7df9ff' : '#c8955f';
    boundedPush(particles, { x: CX, y, vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1) * 0.4, vy: -Math.abs(Math.sin(a)) * sp, t: 0, life: 0.5 + Math.random() * 0.3, c: col, s: 2 + Math.random() * 3, glow: targetType === 'energy' }, MAX_PARTICLES);
  }
}
function crystalParticles(rel) {
  const wa = targetAngle + rel;
  const x = CX + Math.cos(wa) * targetR, y = TARGET_Y + Math.sin(wa) * targetR;
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 300;
    boundedPush(particles, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.6 + Math.random() * 0.4, c: '#7df9ff', s: 2 + Math.random() * 2.5, glow: true }, MAX_PARTICLES);
  }
}
function burstParticles(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 480;
    boundedPush(particles, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100, t: 0, life: 0.7 + Math.random() * 0.6, c: ['#ffe14d', '#ff5df1', '#7df9ff', '#c8955f'][i % 4], s: 2 + Math.random() * 4, glow: i % 3 === 0 }, MAX_PARTICLES);
  }
}
// hot sparks on blade impact (bright, short-lived, streaky)
function sparkBurst(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = 220 + Math.random() * 420;
    boundedPush(particles, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.25 + Math.random() * 0.3, c: i % 3 === 0 ? '#ffffff' : '#ffd24d', s: 1.5 + Math.random() * 2, glow: true, streak: true }, MAX_PARTICLES);
  }
}
// blade-blade clash: huge white flash + metal shards flying
function clashBurst(x, y) {
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 620;
    boundedPush(particles, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, t: 0, life: 0.4 + Math.random() * 0.5, c: i % 4 === 0 ? '#ffffff' : i % 4 === 1 ? '#ffd24d' : i % 4 === 2 ? '#aab6cc' : '#ff8a5d', s: 2 + Math.random() * 3.5, glow: true, streak: i % 2 === 0 }, MAX_PARTICLES);
  }
}
// boss defeat confetti (colored rectangles with spin + drag)
function confettiBurst(x, y, n) {
  const cols = ['#7df9ff', '#ff5df1', '#ffe14d', '#7dff8a', '#ffab3d', '#c66bff'];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 450;
    boundedPush(confetti, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 14, t: 0, life: 1.6 + Math.random() * 1.0, c: cols[i % cols.length], w: 5 + Math.random() * 6, h: 3 + Math.random() * 4 }, MAX_CONFETTI);
  }
}
// ambient falling embers in the arena background
function spawnAmbient() {
  if (ambient.length < 26 && Math.random() < 0.25) {
    ambient.push({ x: Math.random() * GAME_W, y: -8, vx: (Math.random() - 0.5) * 18, vy: 22 + Math.random() * 34, s: 0.8 + Math.random() * 1.6, tw: Math.random() * 6, c: Math.random() < 0.5 ? '#7df9ff' : '#ff5df1' });
  }
}

// ---------- update ----------
function update(dt) {
  const realDt = dt;
  if (slowmo > 0) { slowmo = Math.max(0, slowmo - realDt); dt *= 0.25; }
  time += dt;
  spawnAmbient();
  for (const a of ambient) { a.x += a.vx * realDt; a.y += a.vy * realDt; }
  ambient = ambient.filter(a => a.y < GAME_H + 10);
  for (const c of confetti) {
    c.t += realDt; c.vy += 620 * realDt; c.vx *= (1 - 1.6 * realDt);
    c.x += c.vx * realDt; c.y += c.vy * realDt; c.rot += c.vr * realDt;
  }
  confetti = confetti.filter(c => c.t < c.life);
  for (const b of stuck) { if (b.wob > 0) { b.wt += realDt; b.wob = Math.max(0, b.wob - realDt * 2.4); } }
  if (state === 'playing' || state === 'throwing' || state === 'break') {
    runTime += dt;
    patternT += dt;
    targetAngle = norm(targetAngle + angVel() * dt);
  }
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

  if (state === 'throwing') {
    throwY -= THROW_SPEED * dt;
    boundedPush(trail, { y: throwY, t: 0 }, MAX_TRAIL);
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
      addFloat(boss ? 'BOSS FIGHT!' : 'LEVEL ' + level, CX, TARGET_Y - targetR - 40, boss ? (bossInfo ? bossInfo.rim : '#ff5df1') : '#ffffff');
      if (boss && bossInfo) addFloat(bossInfo.name, CX, TARGET_Y - targetR - 4, bossInfo.rim);
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
  for (const t of toasts) t.t += dt;
  toasts = toasts.filter(t => t.t < 3.2);

  if (shake > 0) {
    shake = Math.max(0, shake - dt * 60);
    shakeX = (Math.random() - 0.5) * shake; shakeY = (Math.random() - 0.5) * shake;
  } else { shakeX = shakeY = 0; }
  if (flashT > 0) flashT -= dt;
}

// ---------- draw ----------
const targetCaches = new Map();
const bossCaches = new Map();
function targetTexture(r, bossDef, type = 'wood') {
  const c = document.createElement('canvas');
  c.width = c.height = r * 2 + 8;
  const t = c.getContext('2d');
  t.translate(r + 4, r + 4);
  if (!bossDef && type === 'wood') {
    // wooden disc: plank grain, scorched bullseye center, worn edge
    const grad = t.createRadialGradient(0, 0, 8, 0, 0, r);
    grad.addColorStop(0, '#b3793f'); grad.addColorStop(0.55, '#8a5a2c'); grad.addColorStop(0.85, '#6b4220'); grad.addColorStop(1, '#4a2c12');
    t.fillStyle = grad; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
    // wavy grain rings (organic, not perfect circles)
    for (let i = 1; i <= 7; i++) {
      t.strokeStyle = 'rgba(56,32,12,' + (0.3 + (i % 2) * 0.18) + ')';
      t.lineWidth = 2 + (i % 3);
      t.beginPath();
      const rr = r * i / 8;
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.12) {
        const wob = Math.sin(a * 3 + i * 2.1) * 3 + Math.sin(a * 7 + i) * 1.5;
        const px = Math.cos(a) * (rr + wob), py = Math.sin(a) * (rr + wob);
        if (a === 0) t.moveTo(px, py); else t.lineTo(px, py);
      }
      t.stroke();
    }
    // grain streaks
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      t.strokeStyle = 'rgba(46,26,10,0.26)'; t.lineWidth = 1.5;
      t.beginPath(); t.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
      t.lineTo(Math.cos(a + 0.15) * r * 0.92, Math.sin(a + 0.15) * r * 0.92); t.stroke();
    }
    // scorched / hammered bullseye center
    const burn = t.createRadialGradient(0, 0, 0, 0, 0, r * 0.34);
    burn.addColorStop(0, 'rgba(28,14,4,0.85)'); burn.addColorStop(0.6, 'rgba(48,26,10,0.5)'); burn.addColorStop(1, 'rgba(48,26,10,0)');
    t.fillStyle = burn; t.beginPath(); t.arc(0, 0, r * 0.34, 0, Math.PI * 2); t.fill();
    t.strokeStyle = 'rgba(255,190,90,0.35)'; t.lineWidth = 2.5;
    t.beginPath(); t.arc(0, 0, r * 0.2, 0, Math.PI * 2); t.stroke();
    t.strokeStyle = 'rgba(255,190,90,0.18)'; t.lineWidth = 2;
    t.beginPath(); t.arc(0, 0, r * 0.34, 0, Math.PI * 2); t.stroke();
    // random nicks & scratches from previous throws
    let sd = 13;
    const srnd = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
    for (let i = 0; i < 12; i++) {
      const a = srnd() * Math.PI * 2, rr = r * (0.3 + srnd() * 0.6);
      t.strokeStyle = 'rgba(30,16,6,0.5)'; t.lineWidth = 1 + srnd() * 1.5;
      t.beginPath(); t.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      t.lineTo(Math.cos(a) * rr + (srnd() - 0.5) * 22, Math.sin(a) * rr + (srnd() - 0.5) * 22); t.stroke();
    }
    // top-left sheen
    const sheen = t.createRadialGradient(-r * 0.4, -r * 0.4, 0, -r * 0.4, -r * 0.4, r * 1.1);
    sheen.addColorStop(0, 'rgba(255,235,200,0.16)'); sheen.addColorStop(0.5, 'rgba(255,235,200,0)');
    t.fillStyle = sheen; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
  } else if (!bossDef && type === 'metal') {
    // brushed steel disc with rivets, scratches and radial panels
    const grad = t.createRadialGradient(-r * 0.3, -r * 0.35, 8, 0, 0, r);
    grad.addColorStop(0, '#9aa8bc'); grad.addColorStop(0.45, '#6b7a90'); grad.addColorStop(0.8, '#49566b'); grad.addColorStop(1, '#333e50');
    t.fillStyle = grad; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
    // brushed concentric texture
    for (let i = 0; i < 34; i++) {
      t.strokeStyle = 'rgba(255,255,255,' + (0.02 + (i % 3) * 0.015) + ')';
      t.lineWidth = 1;
      t.beginPath(); t.arc(0, 0, r * (0.1 + 0.88 * i / 34), 0, Math.PI * 2); t.stroke();
    }
    // panel seams
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      t.strokeStyle = 'rgba(14,18,26,0.6)'; t.lineWidth = 2.5;
      t.beginPath(); t.moveTo(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28); t.lineTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96); t.stroke();
    }
    // rivets ring (outer + inner)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const rr of [r * 0.86, r * 0.4]) {
        if (rr < r * 0.5 && i % 2) continue;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        const rg = t.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 4.5);
        rg.addColorStop(0, '#dce6f2'); rg.addColorStop(0.6, '#8a98ac'); rg.addColorStop(1, '#3a4658');
        t.fillStyle = rg; t.beginPath(); t.arc(x, y, 4.2, 0, Math.PI * 2); t.fill();
      }
    }
    // scratches
    let sd = 29;
    const srnd = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
    for (let i = 0; i < 14; i++) {
      const a = srnd() * Math.PI * 2, rr = r * (0.2 + srnd() * 0.7);
      t.strokeStyle = i % 2 ? 'rgba(220,232,244,0.28)' : 'rgba(16,20,30,0.4)'; t.lineWidth = 1;
      t.beginPath(); t.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      t.lineTo(Math.cos(a) * rr + (srnd() - 0.5) * 40, Math.sin(a) * rr + (srnd() - 0.5) * 40); t.stroke();
    }
    // hub
    const hub = t.createRadialGradient(-3, -3, 1, 0, 0, r * 0.16);
    hub.addColorStop(0, '#c4d0e0'); hub.addColorStop(0.7, '#5a6880'); hub.addColorStop(1, '#2c3646');
    t.fillStyle = hub; t.beginPath(); t.arc(0, 0, r * 0.14, 0, Math.PI * 2); t.fill();
    t.strokeStyle = 'rgba(10,14,22,0.8)'; t.lineWidth = 2;
    t.beginPath(); t.arc(0, 0, r * 0.14, 0, Math.PI * 2); t.stroke();
  } else if (!bossDef && type === 'energy') {
    // energy disc: dark glass with cyan plasma core + hex ring segments
    const grad = t.createRadialGradient(0, 0, 4, 0, 0, r);
    grad.addColorStop(0, '#103a4e'); grad.addColorStop(0.5, '#0c2438'); grad.addColorStop(1, '#081420');
    t.fillStyle = grad; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
    // circuit-like arcs
    for (let i = 0; i < 9; i++) {
      const rr = r * (0.25 + i * 0.08);
      const a0 = i * 1.7, span = 0.6 + (i % 3) * 0.8;
      t.strokeStyle = 'rgba(125,249,255,' + (0.14 + (i % 2) * 0.12) + ')';
      t.lineWidth = 1.5 + (i % 2);
      t.beginPath(); t.arc(0, 0, rr, a0, a0 + span); t.stroke();
      t.fillStyle = 'rgba(125,249,255,0.5)';
      t.beginPath(); t.arc(Math.cos(a0 + span) * rr, Math.sin(a0 + span) * rr, 2.2, 0, Math.PI * 2); t.fill();
    }
    // hex segment ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      t.strokeStyle = 'rgba(125,249,255,0.35)'; t.lineWidth = 3;
      t.beginPath(); t.arc(0, 0, r * 0.9, a + 0.04, a + Math.PI / 6 - 0.04); t.stroke();
    }
    // plasma core (drawn bright; pulse handled live in drawTarget)
    const core = t.createRadialGradient(0, 0, 0, 0, 0, r * 0.3);
    core.addColorStop(0, 'rgba(220,252,255,0.95)'); core.addColorStop(0.4, 'rgba(125,249,255,0.55)'); core.addColorStop(1, 'rgba(125,249,255,0)');
    t.fillStyle = core; t.beginPath(); t.arc(0, 0, r * 0.3, 0, Math.PI * 2); t.fill();
  } else {
    // boss: dark metal panels tinted per boss variant + unique face
    const m = bossDef.metal;
    const grad = t.createRadialGradient(-r * 0.3, -r * 0.3, 10, 0, 0, r);
    grad.addColorStop(0, m[0]); grad.addColorStop(0.6, m[1]); grad.addColorStop(1, m[2]);
    t.fillStyle = grad; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      t.strokeStyle = 'rgba(10,14,22,0.7)'; t.lineWidth = 3;
      t.beginPath(); t.moveTo(0, 0); t.lineTo(Math.cos(a) * r, Math.sin(a) * r); t.stroke();
      // rivets
      const rr = r * 0.8;
      const rx = Math.cos(a + 0.39) * rr, ry = Math.sin(a + 0.39) * rr;
      const rg = t.createRadialGradient(rx - 1.5, ry - 1.5, 0.5, rx, ry, 5);
      rg.addColorStop(0, '#e0eaf6'); rg.addColorStop(0.6, '#8899b0'); rg.addColorStop(1, '#333e50');
      t.fillStyle = rg; t.beginPath(); t.arc(rx, ry, 4.5, 0, Math.PI * 2); t.fill();
    }
    // rune ring in boss color
    t.strokeStyle = bossDef.rim; t.globalAlpha = 0.55; t.lineWidth = 4;
    t.beginPath(); t.arc(0, 0, r * 0.52, 0, Math.PI * 2); t.stroke();
    t.globalAlpha = 0.35;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      t.beginPath(); t.moveTo(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48);
      t.lineTo(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56); t.stroke();
    }
    t.globalAlpha = 1;
    // dark vignette so face pops against the metal (behind face)
    const vig = t.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0.3)'); vig.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = vig; t.beginPath(); t.arc(0, 0, r * 0.72, 0, Math.PI * 2); t.fill();
    // unique menacing face per boss (eyes + mouth variants)
    const id = bossDef.id;
    const F = r / 110; // face scale factor so features read at any radius
    t.save();
    t.shadowColor = bossDef.rim; t.shadowBlur = 22;
    t.fillStyle = bossDef.rim;
    const ey = -r * 0.16, ex = r * 0.2;
    t.save(); t.scale(F, F);
    const exs = ex / F, eys = ey / F;
    // eyes: angry slanted shapes, variant per id
    for (const s of [-1, 1]) {
      t.beginPath();
      if (id % 4 === 0) { // slanted daggers
        t.moveTo(s * exs - s * 20, eys - 14); t.lineTo(s * exs + s * 22, eys + 3); t.lineTo(s * exs - s * 14, eys + 14);
      } else if (id % 4 === 1) { // furious triangles
        t.moveTo(s * exs - s * 21, eys - 3); t.lineTo(s * exs + s * 17, eys - 17); t.lineTo(s * exs + s * 17, eys + 11);
      } else if (id % 4 === 2) { // narrow visor slits
        t.rect(s * exs - 21, eys - 6, 42, 11);
      } else { // round glow cores
        t.arc(s * exs, eys, 13, 0, Math.PI * 2);
      }
      t.closePath(); t.fill();
    }
    // mouth
    t.beginPath();
    const my = (r * 0.16) / F;
    if (id % 3 === 0) { // jagged grin
      t.moveTo(-38, my);
      for (let k = 0; k <= 6; k++) t.lineTo(-38 + k * (76 / 6), my + (k % 2 ? 15 : 0));
      t.lineTo(38, my + 9); t.lineTo(-38, my + 9);
    } else if (id % 3 === 1) { // grim slash
      t.rect(-34, my, 68, 7);
    } else { // vents
      for (let k = 0; k < 4; k++) t.rect(-32 + k * 19, my, 12, 17);
    }
    t.fill();
    t.restore();
    t.restore();
    // horns / spikes decoration on rim
    t.fillStyle = m[0];
    t.strokeStyle = 'rgba(10,14,22,0.8)'; t.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.5;
      const bx = Math.cos(a) * r * 0.94, by = Math.sin(a) * r * 0.94;
      t.save(); t.translate(bx, by); t.rotate(a + Math.PI / 2);
      t.beginPath(); t.moveTo(-9, 0); t.lineTo(0, -20 - (i === 1 ? 8 : 0)); t.lineTo(9, 0); t.closePath();
      t.fill(); t.stroke(); t.restore();
    }
  }
  return c;
}
function bossTexture(bossDef, r) {
  const key = bossDef.id + ':' + r;
  if (!bossCaches.has(key)) bossCaches.set(key, targetTexture(r, bossDef));
  return bossCaches.get(key);
}

function prismColor(off = 0) {
  return 'hsl(' + (((time * 90 + off) % 360) | 0) + ',100%,70%)';
}

function drawBlade(x, y, rot, scale = 1, glow = true, skin = null) {
  const B = skin || META.equippedBlade();
  const glowC = B.glow === 'prism' ? prismColor() : B.glow;
  g.save(); g.translate(x, y); g.rotate(rot + Math.PI / 2); g.scale(scale, scale);
  const L = BLADE_LEN, W = BLADE_W * (B.shape === 'wide' ? 1.35 : B.shape === 'slim' ? 0.72 : 1);
  if (glow) { g.shadowColor = glowC; g.shadowBlur = 14; }
  // energy blade
  const grad = g.createLinearGradient(0, -L * 0.55, 0, L * 0.1);
  if (B.glow === 'prism') {
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, prismColor()); grad.addColorStop(1, prismColor(120));
  } else {
    grad.addColorStop(0, B.edge[0]); grad.addColorStop(0.5, B.edge[1]); grad.addColorStop(1, B.edge[2]);
  }
  g.fillStyle = grad;
  g.beginPath();
  if (B.shape === 'jagged') {
    g.moveTo(0, -L * 0.58);
    g.lineTo(W * 0.5, -L * 0.34); g.lineTo(W * 0.28, -L * 0.26);
    g.lineTo(W * 0.52, -L * 0.1); g.lineTo(W * 0.4, L * 0.05);
    g.lineTo(-W * 0.4, L * 0.05); g.lineTo(-W * 0.52, -L * 0.1);
    g.lineTo(-W * 0.28, -L * 0.26); g.lineTo(-W * 0.5, -L * 0.34);
    g.closePath();
  } else if (B.shape === 'curved') {
    g.moveTo(0, -L * 0.58);
    g.bezierCurveTo(W * 0.9, -L * 0.35, -W * 0.1, -L * 0.15, W * 0.4, L * 0.05);
    g.lineTo(-W * 0.4, L * 0.05);
    g.bezierCurveTo(-W * 0.7, -L * 0.25, W * 0.1, -L * 0.4, 0, -L * 0.58);
    g.closePath();
  } else {
    g.moveTo(0, -L * 0.58);
    g.quadraticCurveTo(W * 0.55, -L * 0.2, W * 0.4, L * 0.05);
    g.lineTo(-W * 0.4, L * 0.05);
    g.quadraticCurveTo(-W * 0.55, -L * 0.2, 0, -L * 0.58);
  }
  g.fill();
  g.shadowBlur = 0;
  // metallic specular: bright edge highlight down one side of the blade
  const spec = g.createLinearGradient(-W * 0.5, 0, W * 0.5, 0);
  spec.addColorStop(0, 'rgba(255,255,255,0)');
  spec.addColorStop(0.32, 'rgba(255,255,255,0.55)');
  spec.addColorStop(0.45, 'rgba(255,255,255,0.1)');
  spec.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = spec;
  g.beginPath();
  g.moveTo(0, -L * 0.58);
  g.quadraticCurveTo(W * 0.55, -L * 0.2, W * 0.4, L * 0.05);
  g.lineTo(-W * 0.4, L * 0.05);
  g.quadraticCurveTo(-W * 0.55, -L * 0.2, 0, -L * 0.58);
  g.fill();
  // core fuller line (bright spine)
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -L * 0.5); g.lineTo(0, 0); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-W * 0.18, -L * 0.4); g.lineTo(-W * 0.18, -L * 0.02); g.stroke();
  // crossguard with beveled metal + colored tips
  const gg = g.createLinearGradient(0, L * 0.05, 0, L * 0.05 + W * 0.35);
  gg.addColorStop(0, '#4a5a78'); gg.addColorStop(0.5, '#22304a'); gg.addColorStop(1, '#121a2c');
  g.fillStyle = gg;
  roundRectPath(-W * 0.66, L * 0.05, W * 1.32, W * 0.36, 3); g.fill();
  g.fillStyle = glowC; g.globalAlpha = 0.85;
  g.beginPath(); g.arc(-W * 0.6, L * 0.05 + W * 0.18, W * 0.12, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(W * 0.6, L * 0.05 + W * 0.18, W * 0.12, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  // wrapped grip: alternating leather bands + side shading
  const hg = g.createLinearGradient(-W * 0.3, 0, W * 0.3, 0);
  hg.addColorStop(0, '#4a5a78'); hg.addColorStop(0.4, '#2c3a54'); hg.addColorStop(1, '#101828');
  g.fillStyle = hg;
  roundRectPath(-W * 0.3, L * 0.1, W * 0.6, L * 0.34, 3); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = 0; k < 4; k++) g.fillRect(-W * 0.3, L * (0.14 + k * 0.075), W * 0.6, L * 0.028);
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.fillRect(-W * 0.26, L * 0.1, W * 0.1, L * 0.34);
  // pommel gem with glow + facet highlight
  g.save();
  g.shadowColor = B.gem === '#ffffff' ? glowC : B.gem; g.shadowBlur = 8;
  const gemG = g.createRadialGradient(-W * 0.08, L * 0.46, 1, 0, L * 0.5, W * 0.34);
  gemG.addColorStop(0, '#ffffff'); gemG.addColorStop(0.4, B.gem); gemG.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gemG;
  g.beginPath(); g.arc(0, L * 0.5, W * 0.3, 0, Math.PI * 2); g.fill();
  g.restore();
  g.restore();
}
function roundRectPath(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
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

// ---------- full-bleed desktop arena ----------
function drawArenaPanel(x, y, w, h, color, title, lines) {
  g.save();
  const glow = 0.55 + Math.sin(time * 2 + x * 0.01) * 0.18;
  g.fillStyle = 'rgba(7,13,31,0.84)';
  roundRect(x, y, w, h, 14); g.fill();
  g.strokeStyle = hexA(color, glow); g.lineWidth = 2;
  g.shadowColor = color; g.shadowBlur = 14;
  roundRect(x, y, w, h, 14); g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = color; g.font = '800 13px "Segoe UI", sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(title, x + 15, y + 14);
  g.strokeStyle = hexA(color, 0.32); g.lineWidth = 1;
  g.beginPath(); g.moveTo(x + 15, y + 35); g.lineTo(x + w - 15, y + 35); g.stroke();
  let yy = y + 52;
  for (const line of lines) {
    g.fillStyle = line.color || 'rgba(235,245,255,0.82)';
    g.font = (line.bold ? '700 ' : '600 ') + (line.small ? '11' : '13') + 'px "Segoe UI", sans-serif';
    g.fillText(line.text, x + 15, yy);
    if (line.progress != null) {
      const bw = w - 30;
      g.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(x + 15, yy + 18, bw, 7, 4); g.fill();
      g.fillStyle = color; roundRect(x + 15, yy + 18, Math.max(7, bw * line.progress), 7, 4); g.fill();
      yy += 14;
    }
    yy += line.gap || 25;
  }
  g.restore();
}

function drawArenaCrowd(horizon) {
  // Three moving seating tiers give the wings depth instead of a decorative frame.
  for (let tier = 0; tier < 3; tier++) {
    const y = horizon - 122 + tier * 34;
    g.fillStyle = 'rgba(' + (8 + tier * 3) + ',' + (13 + tier * 4) + ',' + (31 + tier * 8) + ',0.88)';
    g.fillRect(0, y, viewW, 38);
    for (let i = 0; i < Math.ceil(viewW / 22); i++) {
      const x = i * 22 + (tier % 2) * 8;
      const bob = Math.sin(time * (1.5 + tier * 0.2) + i * 1.71) * 2;
      const lit = (i + tier * 3) % 7 === 0;
      g.fillStyle = lit ? (i % 2 ? 'rgba(255,93,241,0.55)' : 'rgba(125,249,255,0.55)') : 'rgba(16,22,43,0.94)';
      g.beginPath(); g.arc(x, y + 9 + bob, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(7,10,22,0.96)'; g.fillRect(x - 5, y + 13 + bob, 10, 16);
    }
    g.strokeStyle = tier === 0 ? 'rgba(125,249,255,0.23)' : 'rgba(255,255,255,0.09)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y + 36); g.lineTo(viewW, y + 36); g.stroke();
  }
}

function drawSponsorBoard(x, y, w, label, color) {
  g.save();
  const pulse = 0.58 + Math.sin(time * 3 + x * 0.02) * 0.18;
  g.fillStyle = 'rgba(10,18,40,0.86)'; roundRect(x, y, w, 34, 5); g.fill();
  g.strokeStyle = hexA(color, pulse); g.lineWidth = 1.5; g.shadowColor = color; g.shadowBlur = 9;
  roundRect(x, y, w, 34, 5); g.stroke(); g.shadowBlur = 0;
  g.fillStyle = color; g.font = '800 12px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + 18);
  g.restore();
}

function drawArena() {
  const bg = g.createLinearGradient(0, 0, 0, viewH);
  bg.addColorStop(0, '#050817'); bg.addColorStop(0.47, '#111a42'); bg.addColorStop(1, '#080d22');
  g.fillStyle = bg; g.fillRect(0, 0, viewW, viewH);
  // arena ceiling trusses
  g.strokeStyle = 'rgba(105,142,205,0.16)'; g.lineWidth = 2;
  for (let x = -80; x < viewW + 100; x += 92) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(viewW / 2, viewH * 0.44); g.stroke();
  }
  // Live moving spotlights sweep across the room, converging behind the target.
  const focusX = stageX + CX * stageScale, focusY = stageY + TARGET_Y * stageScale;
  g.save(); g.globalCompositeOperation = 'lighter';
  const rigs = [
    { x: viewW * 0.08, c: '#7df9ff', p: 0 }, { x: viewW * 0.31, c: '#ff5df1', p: 1.9 },
    { x: viewW * 0.69, c: '#7df9ff', p: 3.2 }, { x: viewW * 0.92, c: '#ffe14d', p: 4.6 },
  ];
  for (const r of rigs) {
    const tx = focusX + Math.sin(time * 0.7 + r.p) * Math.min(viewW * 0.18, 230);
    const grad = g.createLinearGradient(r.x, -20, tx, focusY + 90);
    grad.addColorStop(0, hexA(r.c, 0.17)); grad.addColorStop(1, hexA(r.c, 0));
    g.fillStyle = grad; g.beginPath(); g.moveTo(r.x - 26, -20); g.lineTo(r.x + 26, -20); g.lineTo(tx + 78, focusY + 95); g.lineTo(tx - 78, focusY + 95); g.closePath(); g.fill();
  }
  const halo = g.createRadialGradient(focusX, focusY, 40, focusX, focusY, Math.max(330, viewH * 0.48));
  halo.addColorStop(0, 'rgba(125,249,255,0.12)'); halo.addColorStop(1, 'rgba(125,249,255,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(focusX, focusY, Math.max(330, viewH * 0.48), 0, Math.PI * 2); g.fill(); g.restore();
  const horizon = Math.min(viewH * 0.72, focusY + 250 * stageScale);
  drawArenaCrowd(horizon);
  // reflective stage floor
  const floor = g.createLinearGradient(0, horizon, 0, viewH);
  floor.addColorStop(0, 'rgba(39,60,109,0.72)'); floor.addColorStop(0.18, 'rgba(13,22,52,0.88)'); floor.addColorStop(1, 'rgba(4,7,20,0.98)');
  g.fillStyle = floor; g.beginPath(); g.moveTo(0, horizon); g.lineTo(viewW, horizon); g.lineTo(viewW, viewH); g.lineTo(0, viewH); g.closePath(); g.fill();
  g.save(); g.globalAlpha = 0.35;
  for (let y = horizon + 18; y < viewH; y += 34) { g.strokeStyle = 'rgba(125,249,255,0.23)'; g.beginPath(); g.moveTo(0, y); g.lineTo(viewW, y); g.stroke(); }
  for (let x = -viewW; x < viewW * 2; x += 86) { g.strokeStyle = 'rgba(255,93,241,0.12)'; g.beginPath(); g.moveTo(focusX, horizon); g.lineTo(x, viewH); g.stroke(); }
  g.restore();
  // Sponsor boards are deliberately outside the action lane so play stays legible.
  drawSponsorBoard(26, 42, 138, 'NOVA // LIVE', '#7df9ff');
  drawSponsorBoard(viewW - 164, 42, 138, 'RUSH LEAGUE', '#ff5df1');
  if (viewW / viewH >= 1.12) {
    const wing = Math.min(270, Math.max(154, stageX - 58));
    const mission = META.MISSIONS.find(m => !META.M.missionsDone.includes(m.id)) || META.MISSIONS[0];
    const progress = META.missionProgress(mission) / mission.target;
    drawArenaPanel(28, Math.max(105, viewH * 0.18), wing, 190, '#ff5df1', 'BOSS PROGRESSION', [
      { text: 'NEXT // ' + META.bossForLevel(level + (5 - level % 5)).name, bold: true, color: '#ffffff' },
      { text: 'SECTOR ' + Math.ceil(level / 5) + '  •  LEVEL ' + level, small: true, color: 'rgba(235,245,255,0.64)' },
      { text: '◉  ' + META.M.bossesSeen.length + ' / ' + META.BOSSES.length + ' defeated', color: '#ffb3f4' },
      { text: 'ARENA RANK: ROOKIE', small: true, color: '#7df9ff' },
    ]);
    drawArenaPanel(viewW - wing - 28, Math.max(105, viewH * 0.18), wing, 214, '#7df9ff', 'BLADE LOADOUT', [
      { text: META.equippedBlade().name, bold: true, color: '#ffffff' },
      { text: 'EQUIPPED // READY', small: true, color: '#7dff8a' },
      { text: 'MISSION: ' + mission.desc.toUpperCase(), small: true, color: '#ffe14d' },
      { text: META.missionProgress(mission) + ' / ' + mission.target, progress, color: '#ffffff' },
      { text: combo > 1 ? 'COMBO x' + combo + ' // HOT' : 'COMBO // BUILD IT', color: combo > 1 ? '#ff5df1' : 'rgba(235,245,255,0.65)' },
    ]);
    drawSponsorBoard(28, viewH - 70, wing, 'HYPERSTEEL', '#ffe14d');
    drawSponsorBoard(viewW - wing - 28, viewH - 70, wing, 'CRYSTALCORE', '#7dff8a');
  }
}

function drawBG() {
  const bg = g.createLinearGradient(0, 0, 0, GAME_H);
  bg.addColorStop(0, '#070912'); bg.addColorStop(0.45, '#101430'); bg.addColorStop(1, '#1c1044');
  g.fillStyle = bg; g.fillRect(0, 0, GAME_W, GAME_H);
  for (const s of stars) {
    g.fillStyle = 'rgba(180,220,255,' + (0.25 + 0.4 * Math.abs(Math.sin(time * 0.7 + s.tw))) + ')';
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
  }
  // spotlight beams converging on the target from top corners
  const beams = [
    { x0: -40, sway: Math.sin(time * 0.5) * 30 },
    { x0: GAME_W + 40, sway: Math.sin(time * 0.5 + 2.4) * 30 },
  ];
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const b of beams) {
    const tx = CX + b.sway, ty = TARGET_Y;
    const grad = g.createLinearGradient(b.x0, -40, tx, ty);
    grad.addColorStop(0, 'rgba(125,180,255,0.10)');
    grad.addColorStop(1, 'rgba(125,180,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(b.x0, -40);
    g.lineTo(tx - 90, ty + 60); g.lineTo(tx + 90, ty + 60);
    g.closePath(); g.fill();
  }
  // soft halo behind the target
  const halo = g.createRadialGradient(CX, TARGET_Y, 40, CX, TARGET_Y, 320);
  halo.addColorStop(0, 'rgba(90,60,190,0.22)'); halo.addColorStop(0.6, 'rgba(60,40,140,0.10)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(CX, TARGET_Y, 320, 0, Math.PI * 2); g.fill();
  g.restore();
  // neon side strips (arcade cabinet feel)
  for (const sx of [10, GAME_W - 10]) {
    const pulse = 0.35 + 0.2 * Math.sin(time * 2 + sx);
    g.save();
    g.shadowColor = '#ff5df1'; g.shadowBlur = 12;
    g.strokeStyle = 'rgba(255,93,241,' + pulse + ')'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(sx, 120); g.lineTo(sx, GAME_H - 120); g.stroke();
    g.shadowColor = '#7df9ff';
    g.strokeStyle = 'rgba(125,249,255,' + (0.55 - pulse * 0.4) + ')'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(sx + (sx < CX ? 6 : -6), 150); g.lineTo(sx + (sx < CX ? 6 : -6), GAME_H - 150); g.stroke();
    g.restore();
  }
  // crowd silhouettes along the bottom (dark arena audience)
  g.fillStyle = 'rgba(6,8,16,0.85)';
  g.beginPath();
  g.moveTo(0, GAME_H);
  for (let i = 0; i <= 14; i++) {
    const x = i * (GAME_W / 14);
    const h = 26 + Math.abs(Math.sin(i * 2.7)) * 22 + Math.sin(time * 1.4 + i * 1.9) * 3;
    g.quadraticCurveTo(x - GAME_W / 28, GAME_H - h - 12, x, GAME_H - h);
  }
  g.lineTo(GAME_W, GAME_H); g.closePath(); g.fill();
  // ambient drifting embers
  for (const a of ambient) {
    g.fillStyle = a.c;
    g.globalAlpha = 0.25 + 0.3 * Math.abs(Math.sin(time * 2 + a.tw));
    g.beginPath(); g.arc(a.x, a.y, a.s, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // faint floor glow under play area
  const fg = g.createRadialGradient(CX, GAME_H - 30, 10, CX, GAME_H - 30, 260);
  fg.addColorStop(0, 'rgba(125,249,255,0.10)'); fg.addColorStop(1, 'rgba(125,249,255,0)');
  g.fillStyle = fg; g.fillRect(0, GAME_H - 240, GAME_W, 240);
}

function safestRelativeAngle() {
  let bestAngle = Math.PI / 2, bestClearance = -1;
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2;
    const bladeClearance = stuck.length ? Math.min(...stuck.map(b => angDist(a, b.rel))) : Math.PI;
    const crystalClearance = crystals.filter(c => c.alive).length ? Math.min(...crystals.filter(c => c.alive).map(c => angDist(a, c.rel))) : Math.PI;
    const clearance = Math.min(bladeClearance, crystalClearance * .72);
    if (clearance > bestClearance) { bestClearance = clearance; bestAngle = a; }
  }
  return bestAngle;
}

function drawPatternTelegraph(rim) {
  const p = patternState();
  const beginner = level <= 4;
  if (!beginner && !boss && p.cue <= 0 && !p.dual) return;
  g.save();
  g.translate(CX, TARGET_Y);
  const motion = reducedMotion ? 0 : Math.sin(time * 8) * 0.08;
  if (beginner || p.dual) {
    const safe = targetAngle + safestRelativeAngle();
    const width = beginner ? .40 : .22;
    g.shadowColor = '#7dff8a'; g.shadowBlur = 18;
    g.strokeStyle = 'rgba(125,255,138,0.95)'; g.lineWidth = 10;
    g.beginPath(); g.arc(0, 0, targetR + 18, safe - width + motion, safe + width + motion); g.stroke();
    if (p.dual) {
      g.beginPath(); g.arc(0, 0, targetR + 18, safe + Math.PI - width, safe + Math.PI + width); g.stroke();
    }
    g.shadowBlur = 0;
  }
  const arrowA = -Math.PI / 2;
  g.rotate(arrowA);
  g.strokeStyle = p.direction > 0 ? '#7df9ff' : '#ff5df1'; g.lineWidth = 4;
  g.shadowColor = g.strokeStyle; g.shadowBlur = 12;
  g.beginPath(); g.arc(0, 0, targetR + 38, p.direction > 0 ? -.7 : .7, p.direction > 0 ? .7 : -.7, p.direction < 0); g.stroke();
  g.shadowBlur = 0;
  const label = patternLabel(p, beginner);
  if (beginner || p.cue > 0 || boss || p.dual) {
    g.rotate(-arrowA);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 13px "Segoe UI", sans-serif';
    g.fillStyle = p.cue > 0 || boss ? (boss && bossInfo ? bossInfo.rim : '#ffe14d') : rim;
    g.fillText(label, 0, targetR + 54);
  }
  g.restore();
}

function patternLabel(p, beginner = level <= 4) {
  if (beginner) return p.direction > 0 ? 'ROTATE ↻' : 'ROTATE ↺';
  if (p.kind === 'reverse') {
    if (p.active) return 'REVERSING NOW';
    return p.cue > 0 ? 'REVERSAL INCOMING' : 'REVERSAL IN ' + Math.max(0, 3.4 - p.phase).toFixed(1) + 's';
  }
  if (p.kind === 'pulse') {
    if (p.active) return 'SPEED PULSE ACTIVE';
    return p.cue > 0 ? 'SPEED PULSE INCOMING' : 'PULSE IN ' + Math.max(0, 2.2 - p.phase).toFixed(1) + 's';
  }
  return 'TWO SAFE WINDOWS';
}

function drawTarget() {
  let tex;
  if (boss && bossInfo) tex = bossTexture(bossInfo, 190);
  else {
    const key = targetType + ':' + targetR;
    if (!targetCaches.has(key)) targetCaches.set(key, targetTexture(targetR, null, targetType));
    tex = targetCaches.get(key);
  }
  const rim = boss && bossInfo ? bossInfo.rim : (targetType === 'metal' ? '#bfd4ee' : targetType === 'energy' ? '#7df9ff' : '#ffab3d');
  if (state === 'playing' || state === 'throwing') drawPatternTelegraph(rim);
  g.save();
  g.translate(CX, TARGET_Y);
  // boss aura: pulsing colored haze + orbiting motes
  if (boss && bossInfo) {
    const pul = 0.5 + 0.5 * Math.sin(time * 3);
    const aur = g.createRadialGradient(0, 0, targetR * 0.7, 0, 0, targetR * 1.45 + pul * 14);
    aur.addColorStop(0, 'rgba(0,0,0,0)');
    aur.addColorStop(0.6, hexA(bossInfo.rim, 0.10 + pul * 0.08));
    aur.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = aur; g.beginPath(); g.arc(0, 0, targetR * 1.5 + pul * 14, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 6; i++) {
      const a = time * 1.2 + (i / 6) * Math.PI * 2;
      const rr = targetR * 1.22 + Math.sin(time * 2.4 + i) * 8;
      g.fillStyle = bossInfo.rim;
      g.globalAlpha = 0.5 + 0.3 * Math.sin(time * 3 + i);
      g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  // energy disc: live pulsing core glow over the cached texture
  // neon rim glow
  g.shadowColor = rim; g.shadowBlur = 24;
  g.strokeStyle = rim; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, targetR + 4, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0;
  // rotating specular highlight on the rim (metallic sheen)
  const hlA = -targetAngle * 0.7 - 0.9;
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, targetR + 4, hlA - 0.45, hlA + 0.45); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.beginPath(); g.arc(0, 0, targetR + 4, hlA + Math.PI - 0.3, hlA + Math.PI + 0.3); g.stroke();
  g.lineCap = 'butt';
  g.rotate(targetAngle);
  g.drawImage(tex, -tex.width / 2, -tex.height / 2);
  g.restore();
  // energy core pulse (screen-space, on top of rotation)
  if (!boss && targetType === 'energy') {
    const pul = 0.6 + 0.4 * Math.sin(time * 5);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const core = g.createRadialGradient(CX, TARGET_Y, 0, CX, TARGET_Y, targetR * 0.34);
    core.addColorStop(0, 'rgba(200,250,255,' + (0.5 * pul) + ')');
    core.addColorStop(1, 'rgba(125,249,255,0)');
    g.fillStyle = core; g.beginPath(); g.arc(CX, TARGET_Y, targetR * 0.34, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // stuck blades (handles sticking out, rotating with target)
  for (const b of stuck) {
    const wa = targetAngle + b.rel;
    drawBladeStuck(wa, b);
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

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

function drawBladeStuck(wa, b) {
  const depth = 30; // how deep tip is inside
  // springy oscillation right after impact (decaying sine)
  const wob = b && b.wob > 0 ? Math.sin(b.wt * 34) * b.wob * 0.12 : 0;
  const cx = CX + Math.cos(wa) * (targetR - depth + BLADE_LEN * 0.58);
  const cy = TARGET_Y + Math.sin(wa) * (targetR - depth + BLADE_LEN * 0.58);
  drawBlade(cx, cy, wa + Math.PI + wob, 1, false);
}

function drawShardCounter(x, y, n, align = 'right') {
  g.save();
  g.textAlign = align; g.textBaseline = 'top';
  g.font = '700 20px "Segoe UI", sans-serif';
  g.shadowColor = '#7df9ff'; g.shadowBlur = 8;
  g.fillStyle = '#7df9ff';
  g.fillText('\u25C6 ' + n, x, y);
  g.restore();
}

function drawHUD() {
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.font = '800 44px "Segoe UI", sans-serif';
  g.fillText(String(score), CX, 18);
  g.font = '600 20px "Segoe UI", sans-serif';
  g.fillStyle = boss && bossInfo ? bossInfo.rim : 'rgba(255,255,255,0.65)';
  g.fillText(boss && bossInfo ? bossInfo.name + ' — LEVEL ' + level : 'LEVEL ' + level, CX, 68);
  // boss progress counter
  if (!boss) {
    const toBoss = 5 - (level % 5);
    g.fillStyle = 'rgba(255,93,241,0.75)';
    g.font = '700 16px "Segoe UI", sans-serif';
    g.fillText('BOSS IN ' + toBoss, CX, 94);
  }
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '600 16px "Segoe UI", sans-serif';
  g.fillText('BEST ' + best, 14, 20);
  drawShardCounter(GAME_W - 14, 20, META.M.shards);
  // A compact, always-live quest makes the first session's goal obvious.
  const activeMission = META.MISSIONS.find(m => !META.M.missionsDone.includes(m.id));
  if (activeMission && runTime < 30) {
    const prog = META.missionProgress(activeMission);
    const missionY = GAME_H - 315;
    g.save();
    g.fillStyle = 'rgba(5,12,28,0.82)'; roundRect(CX - 146, missionY, 292, 42, 10); g.fill();
    g.strokeStyle = 'rgba(125,249,255,0.48)'; g.lineWidth = 1.5; roundRect(CX - 146, missionY, 292, 42, 10); g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'top'; g.font = '700 12px "Segoe UI", sans-serif'; g.fillStyle = '#ffe14d';
    g.fillText('LIVE MISSION  ' + activeMission.desc.toUpperCase(), CX - 132, missionY + 8);
    g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.fillText(prog + ' / ' + activeMission.target, CX + 132, missionY + 8);
    g.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(CX - 132, missionY + 26, 264, 6, 3); g.fill();
    g.fillStyle = '#7df9ff'; roundRect(CX - 132, missionY + 26, Math.max(6, 264 * prog / activeMission.target), 6, 3); g.fill();
    g.restore();
  }
  // combo
  if (combo > 1 && comboTimer > 0) {
    g.textAlign = 'center';
    const heat = Math.min(combo / 8, 1);
    const pop = comboTimer > 1.45 ? (comboTimer - 1.45) * 6 : 0; // punch-in on new hit
    g.save();
    g.shadowColor = heat > 0.6 ? '#ff5df1' : '#ffe14d';
    g.shadowBlur = 8 + heat * 26 + pop * 10;
    g.fillStyle = heat > 0.6 ? '#ffb3f4' : '#ffe14d';
    g.font = '800 ' + ((26 + Math.min(combo, 8) * 2) * (1 + pop * 0.12)) + 'px "Segoe UI", sans-serif';
    g.fillText('COMBO x' + combo, CX, 118);
    if (combo >= 5) {
      g.font = '700 14px "Segoe UI", sans-serif';
      g.fillStyle = '#ffffff'; g.shadowBlur = 6;
      g.fillText(combo >= 8 ? 'UNSTOPPABLE!' : 'ON FIRE!', CX, 152);
    }
    g.restore();
  }
  drawOnboardingCue();
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

function drawOnboardingCue() {
  if (!onboardingVisible || level !== 1 || state !== 'playing') return;
  const pulse = 0.72 + (reducedMotion ? 0 : Math.sin(time * 5) * 0.18);
  const y = GAME_H - 204;
  g.save();
  g.globalAlpha = pulse;
  g.shadowColor = '#7df9ff'; g.shadowBlur = 18;
  g.fillStyle = 'rgba(7,12,28,0.84)';
  roundRect(CX - 158, y - 34, 316, 68, 14); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = '#7df9ff'; g.lineWidth = 2;
  roundRect(CX - 158, y - 34, 316, 68, 14); g.stroke();
  drawBlade(CX - 108, y, -Math.PI / 2, 0.42, true);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.font = '800 19px "Segoe UI", sans-serif';
  g.fillText('CLICK / SPACE', CX - 70, y - 10);
  g.fillStyle = '#7df9ff'; g.font = '700 14px "Segoe UI", sans-serif';
  g.fillText('TO THROW', CX - 70, y + 14);
  g.restore();
}

function drawToasts() {
  // Reserve the target and its predictive cue while the player can throw.
  // The latest card carries the outcome without competing with that decision.
  const layout = toastLayout();
  let y = layout.top;
  for (const t of layout.visible) {
    const a = t.t < 0.25 ? t.t / 0.25 : t.t > 2.7 ? Math.max(0, 1 - (t.t - 2.7) / 0.5) : 1;
    g.save(); g.globalAlpha = a;
    g.shadowColor = t.color; g.shadowBlur = 16;
    g.fillStyle = 'rgba(14,20,38,0.94)';
    roundRect(CX - 190, y, 380, 62, 12); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = t.color; g.lineWidth = 2;
    roundRect(CX - 190, y, 380, 62, 12); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = t.color; g.font = '800 20px "Segoe UI", sans-serif';
    g.fillText(t.txt, CX, y + 20);
    g.fillStyle = '#ffffff'; g.font = '600 16px "Segoe UI", sans-serif';
    g.fillText(t.sub, CX, y + 44);
    g.restore();
    y += 74;
  }
}

function toastLayout() {
  const inPlay = activeGameplay();
  return { visible: inPlay ? toasts.slice(-1) : toasts, top: inPlay ? 542 : 150 };
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
  play: { x: CX, y: 620, w: 260, h: 74 },
  // 64 logical pixels keeps every mobile action above a 44px physical target.
  shop: { x: 110, y: 720, w: 170, h: 64 },
  bosses: { x: 285, y: 720, w: 160, h: 64 },
  missions: { x: 452, y: 720, w: 155, h: 64 },
  continue: { x: CX, y: 520, w: 320, h: 66 },
  x2: { x: CX, y: 604, w: 320, h: 64 },
  again: { x: CX, y: 686, w: 300, h: 66 },
  back: { x: 80, y: 46, w: 120, h: 64 },
};

// shop grid geometry (3 cols x 4 rows)
function shopCell(i) {
  const col = i % 3, row = Math.floor(i / 3);
  return { x: 96 + col * 174, y: 210 + row * 178, w: 158, h: 162 };
}

function drawShop() {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#7df9ff'; g.shadowBlur = 18;
  g.fillStyle = '#ffffff'; g.font = '900 44px "Segoe UI", sans-serif';
  g.fillText('ARMORY', CX, 60);
  g.shadowBlur = 0;
  drawShardCounter(GAME_W - 18, 34, META.M.shards);
  drawButton(BTN.back.x, BTN.back.y, BTN.back.w, BTN.back.h, '\u2190 BACK', '#8899b0', true);
  for (let i = 0; i < META.BLADES.length; i++) {
    const b = META.BLADES[i];
    const c = shopCell(i);
    const owned = META.M.owned.includes(b.id);
    const eq = META.M.equipped === b.id;
    const afford = META.M.shards >= b.cost;
    const color = eq ? '#7dff8a' : owned ? '#7df9ff' : afford ? '#ffe14d' : '#3a4a66';
    g.save();
    g.shadowColor = color; g.shadowBlur = eq ? 16 : 8;
    g.fillStyle = 'rgba(14,20,38,0.92)';
    roundRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, 12); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = color; g.lineWidth = eq ? 3 : 2;
    roundRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, 12); g.stroke();
    g.restore();
    if (eq) {
      // rotating showcase on a glowing pedestal for the equipped blade
      g.save();
      const pg = g.createRadialGradient(c.x, c.y + 34, 2, c.x, c.y + 34, 40);
      pg.addColorStop(0, 'rgba(125,249,255,0.5)'); pg.addColorStop(1, 'rgba(125,249,255,0)');
      g.fillStyle = pg;
      g.beginPath(); g.ellipse(c.x, c.y + 34, 44, 12, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(125,249,255,0.7)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(c.x, c.y + 34, 34, 9, 0, 0, Math.PI * 2); g.stroke();
      g.restore();
      const sway = Math.sin(time * 1.6) * 0.35;
      drawBlade(c.x, c.y - 14, -Math.PI / 2 + sway, 0.72 + Math.sin(time * 1.6 + 1.2) * 0.04, true, b);
    } else {
      drawBlade(c.x, c.y - 14, -Math.PI / 2, 0.72, true, b);
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = '700 13px "Segoe UI", sans-serif';
    g.fillText(b.name, c.x, c.y + 44);
    g.font = '600 12px "Segoe UI", sans-serif';
    if (eq) { g.fillStyle = '#7dff8a'; g.fillText('EQUIPPED', c.x, c.y + 62); }
    else if (owned) { g.fillStyle = '#7df9ff'; g.fillText('TAP TO EQUIP', c.x, c.y + 62); }
    else { g.fillStyle = afford ? '#ffe14d' : 'rgba(255,255,255,0.4)'; g.fillText('\u25C6 ' + b.cost, c.x, c.y + 62); }
    if (b.perk) {
      g.fillStyle = '#ff5df1'; g.font = '600 10px "Segoe UI", sans-serif';
      g.fillText(META.PERK_TEXT[b.perk], c.x, c.y - 66);
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '600 16px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.fillText('Earn \u25C6 shards from crystals, levels and missions', CX, GAME_H - 34);
}

function drawBossGallery() {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff5df1'; g.shadowBlur = 18;
  g.fillStyle = '#ffffff'; g.font = '900 44px "Segoe UI", sans-serif';
  g.fillText('BOSS GALLERY', CX, 60);
  g.shadowBlur = 0;
  drawButton(BTN.back.x, BTN.back.y, BTN.back.w, BTN.back.h, '\u2190 BACK', '#8899b0', true);
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 18px "Segoe UI", sans-serif';
  g.fillText(META.M.bossesSeen.length + ' / ' + META.BOSSES.length + ' DEFEATED', CX, 108);
  for (let i = 0; i < META.BOSSES.length; i++) {
    const b = META.BOSSES[i];
    const seen = META.M.bossesSeen.includes(b.id);
    const col = i % 2, row = Math.floor(i / 2);
    const x = 150 + col * 240, y = 220 + row * 185;
    g.save();
    if (seen) {
      const tex = bossTexture(b, 190);
      g.translate(x, y);
      g.shadowColor = b.rim; g.shadowBlur = 14;
      g.strokeStyle = b.rim; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 62, 0, Math.PI * 2); g.stroke();
      g.shadowBlur = 0;
      g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.clip();
      g.drawImage(tex, -60, -60, 120, 120);
    } else {
      g.translate(x, y);
      g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.font = '900 44px "Segoe UI", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', 0, 2);
    }
    g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = seen ? b.rim : 'rgba(255,255,255,0.35)';
    g.font = '700 15px "Segoe UI", sans-serif';
    g.fillText(seen ? b.name : '???', x, y + 82);
  }
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '600 16px "Segoe UI", sans-serif';
  g.fillText('A new boss appears every 5 levels', CX, GAME_H - 34);
}

function drawMissions() {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ffe14d'; g.shadowBlur = 18;
  g.fillStyle = '#ffffff'; g.font = '900 44px "Segoe UI", sans-serif';
  g.fillText('MISSIONS', CX, 60);
  g.shadowBlur = 0;
  drawButton(BTN.back.x, BTN.back.y, BTN.back.w, BTN.back.h, '\u2190 BACK', '#8899b0', true);
  drawShardCounter(GAME_W - 18, 34, META.M.shards);
  let y = 132;
  for (const m of META.MISSIONS) {
    const done = META.M.missionsDone.includes(m.id);
    const prog = META.missionProgress(m);
    g.save();
    g.fillStyle = 'rgba(14,20,38,0.9)';
    roundRect(40, y, GAME_W - 80, 62, 10); g.fill();
    g.strokeStyle = done ? '#7dff8a' : 'rgba(125,249,255,0.35)'; g.lineWidth = 2;
    roundRect(40, y, GAME_W - 80, 62, 10); g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = done ? '#7dff8a' : '#ffffff'; g.font = '700 17px "Segoe UI", sans-serif';
    g.fillText((done ? '\u2713 ' : '') + m.desc, 58, y + 20);
    // progress bar
    if (!done) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(58, y + 38, 280, 12, 6); g.fill();
      g.fillStyle = '#7df9ff';
      if (prog > 0) { roundRect(58, y + 38, Math.max(12, 280 * prog / m.target), 12, 6); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 13px "Segoe UI", sans-serif';
      g.fillText(prog + ' / ' + m.target, 350, y + 44);
    } else {
      g.fillStyle = 'rgba(125,255,138,0.7)'; g.font = '600 13px "Segoe UI", sans-serif';
      g.fillText('COMPLETE', 58, y + 44);
    }
    g.textAlign = 'right';
    g.fillStyle = '#ffe14d'; g.font = '700 17px "Segoe UI", sans-serif';
    g.fillText('\u25C6 ' + m.reward, GAME_W - 58, y + 31);
    g.restore();
    y += 72;
  }
}

function draw() {
  // Reset to CSS-pixel coordinates for the full viewport, then project the
  // fixed mechanical playfield into the centre of the arena.
  g.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  g.clearRect(0, 0, viewW, viewH);
  drawArena();
  g.save();
  g.translate(stageX + shakeX * stageScale, stageY + shakeY * stageScale);
  g.scale(stageScale, stageScale);
  drawBG();

  if (state === 'menu') {
    // demo target
    drawTarget();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // neon arcade sign: chromatic offset layers + flicker
    const flick = Math.random() < 0.02 ? 0.6 : 1;
    g.font = '900 74px "Segoe UI", sans-serif';
    g.globalAlpha = 0.8 * flick;
    g.fillStyle = '#ff5df1';
    g.fillText('BLADE', CX - 3, 520 - 44); g.fillText('RUSH', CX - 3, 520 + 34);
    g.fillStyle = '#7df9ff';
    g.fillText('BLADE', CX + 3, 520 - 44); g.fillText('RUSH', CX + 3, 520 + 34);
    g.globalAlpha = flick;
    g.shadowColor = '#7df9ff'; g.shadowBlur = 30;
    g.fillStyle = '#ffffff';
    g.fillText('BLADE', CX, 520 - 44);
    g.fillText('RUSH', CX, 520 + 34);
    g.shadowBlur = 0; g.globalAlpha = 1;
    // underline slash
    g.strokeStyle = '#ffe14d'; g.lineWidth = 4; g.shadowColor = '#ffe14d'; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(CX - 130, 588); g.lineTo(CX + 130, 588); g.stroke();
    g.shadowBlur = 0;
    drawButton(BTN.play.x, BTN.play.y, BTN.play.w, BTN.play.h, 'PLAY', '#7df9ff');
    drawButton(BTN.shop.x, BTN.shop.y, BTN.shop.w, BTN.shop.h, '\u2694 ARMORY', '#ffe14d', true);
    drawButton(BTN.bosses.x, BTN.bosses.y, BTN.bosses.w, BTN.bosses.h, '\u25C9 BOSSES', '#ff5df1', true);
    drawButton(BTN.missions.x, BTN.missions.y, BTN.missions.w, BTN.missions.h, '\u2605 QUESTS', '#7dff8a', true);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 20px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Tap to throw. Don\u2019t hit other blades!', CX, 790);
    g.fillText('BEST: ' + best, CX, 824);
    drawShardCounter(GAME_W - 14, 20, META.M.shards);
    if (META.M.streak.count > 1) {
      g.fillStyle = '#ffe14d'; g.font = '700 18px "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillText('\u2600 DAY ' + META.M.streak.count + ' STREAK', 14, 26);
    }
    drawBlade(CX, GAME_H - 60 - BLADE_LEN * 0.1, -Math.PI / 2, 1, true);
  } else if (state === 'shop') {
    drawShop();
  } else if (state === 'bosses') {
    drawBossGallery();
  } else if (state === 'missions') {
    drawMissions();
  } else if (state === 'playing' || state === 'throwing' || state === 'break' || state === 'dying') {
    if (state !== 'break') drawTarget();
    // breaking pieces
    for (const p of pieces) {
      if (state !== 'break') break;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      if (p.blade) { drawBlade(0, 0, -Math.PI / 2, 1, false); }
      else if (p.tex) {
        // textured wedge chunk cut from the actual target
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, p.r0, p.a0, p.a0 + p.span);
        g.closePath();
        g.clip();
        g.drawImage(p.tex, -p.tex.width / 2, -p.tex.height / 2);
        // shaded fracture edge
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(p.a0) * p.r0, Math.sin(p.a0) * p.r0); g.stroke();
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(p.a0 + p.span) * p.r0, Math.sin(p.a0 + p.span) * p.r0); g.stroke();
      } else {
        g.fillStyle = p.metal ? p.metal[1] : '#7d4e26';
        g.strokeStyle = p.metal ? '#8899b0' : '#5c3618'; g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-p.size * 0.5, -p.size * 0.3); g.lineTo(p.size * 0.5, -p.size * 0.4);
        g.lineTo(p.size * 0.4, p.size * 0.4); g.lineTo(-p.size * 0.35, p.size * 0.35);
        g.closePath(); g.fill(); g.stroke();
      }
      g.restore();
    }
    // flying blade + trail
    if (state === 'throwing') {
      const B = META.equippedBlade();
      const trailC = B.glow === 'prism' ? prismColor() : B.glow;
      // tapered glowing ribbon trail
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const t of trail) {
        const a = 1 - t.t / 0.25;
        const w = 9 * a;
        g.globalAlpha = a * 0.3;
        g.shadowColor = trailC; g.shadowBlur = 10;
        g.fillStyle = trailC;
        g.beginPath();
        g.ellipse(CX, t.y + BLADE_LEN * 0.42, w, 20 * a + 8, 0, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = a * 0.5;
        g.shadowBlur = 0;
        g.fillStyle = '#ffffff';
        g.beginPath(); g.ellipse(CX, t.y + BLADE_LEN * 0.42, w * 0.3, 14 * a + 5, 0, 0, Math.PI * 2); g.fill();
      }
      g.restore();
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
    g.fillText('GAME OVER', CX, 280);
    g.shadowBlur = 0;
    g.font = '700 30px "Segoe UI", sans-serif';
    g.fillText('Level ' + level + '   •   Score ' + score, CX, 356);
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = '600 22px "Segoe UI", sans-serif';
    g.fillText('BEST: ' + best, CX, 398);
    g.fillStyle = '#7df9ff'; g.font = '700 24px "Segoe UI", sans-serif';
    g.fillText('\u25C6 ' + runShards + ' shards earned', CX, 440);
    if (canContinue) drawButton(BTN.continue.x, BTN.continue.y, BTN.continue.w, BTN.continue.h, '\u25B6 CONTINUE (AD)', '#7dff8a', true);
    if (!x2Used && runShards > 0) drawButton(BTN.x2.x, BTN.x2.y, BTN.x2.w, BTN.x2.h, '\u25C6 x2 SHARDS (AD)', '#7df9ff', true);
    drawButton(BTN.again.x, BTN.again.y, BTN.again.w, BTN.again.h, 'PLAY AGAIN', '#ffe14d', true);
  }

  // particles
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    if (p.glow) { g.shadowColor = p.c; g.shadowBlur = 8; }
    g.fillStyle = p.c; g.globalAlpha = a;
    if (p.streak) {
      // motion-streaked spark
      g.strokeStyle = p.c; g.lineWidth = p.s;
      g.beginPath(); g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke();
    } else {
      g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
  }
  // confetti (boss defeat)
  for (const c of confetti) {
    const a = Math.min(1, 2.5 * (1 - c.t / c.life));
    g.save(); g.globalAlpha = a; g.translate(c.x, c.y); g.rotate(c.rot);
    g.fillStyle = c.c;
    g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    g.restore();
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
  drawToasts();
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
    x: (e.clientX - r.left - stageX) / stageScale,
    y: (e.clientY - r.top - stageY) / stageScale,
  };
}
function inBtn(p, b) { return Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2; }

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  AU.unlockAudio();
  const p = gamePos(e);
  if (state === 'menu') {
    if (inBtn(p, BTN.play)) { AU.uiSound(); startGame(); }
    else if (inBtn(p, BTN.shop)) { AU.uiSound(); state = 'shop'; }
    else if (inBtn(p, BTN.bosses)) { AU.uiSound(); state = 'bosses'; }
    else if (inBtn(p, BTN.missions)) { AU.uiSound(); state = 'missions'; }
  } else if (state === 'shop') {
    if (inBtn(p, BTN.back)) { AU.uiSound(); state = 'menu'; return; }
    for (let i = 0; i < META.BLADES.length; i++) {
      const c = shopCell(i);
      if (Math.abs(p.x - c.x) < c.w / 2 && Math.abs(p.y - c.y) < c.h / 2) {
        const b = META.BLADES[i];
        if (META.M.owned.includes(b.id)) {
          if (META.equipBlade(b.id)) AU.uiSound();
        } else if (META.buyBlade(b.id)) {
          AU.buySound();
          toasts.push({ txt: 'UNLOCKED', sub: b.name, t: 0, color: '#ffe14d' });
          SDK.happytime();
        }
        break;
      }
    }
  } else if (state === 'bosses' || state === 'missions') {
    if (inBtn(p, BTN.back)) { AU.uiSound(); state = 'menu'; }
  } else if (state === 'playing') {
    throwBlade();
  } else if (state === 'gameover') {
    if (canContinue && inBtn(p, BTN.continue)) { AU.uiSound(); tryContinue(); }
    else if (!x2Used && runShards > 0 && inBtn(p, BTN.x2)) { AU.uiSound(); tryDouble(); }
    else if (inBtn(p, BTN.again)) { AU.uiSound(); playAgain(); }
  }
});
window.addEventListener('keydown', (e) => {
  // Physical codes keep the single action in the same place on QWERTY/AZERTY
  // and other layouts. `key` is intentionally never consulted for gameplay.
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    AU.unlockAudio();
    if (state === 'menu') startGame();
    else if (state === 'playing') throwBlade();
    else if (state === 'gameover') playAgain();
  }
  // Escape is only a convenience: every collection panel also has its visible
  // Back button and Backspace works when fullscreen consumes Escape.
  if ((e.code === 'Escape' || e.code === 'Backspace') && (state === 'shop' || state === 'bosses' || state === 'missions')) {
    e.preventDefault();
    state = 'menu';
  }
});

function activeGameplay() { return state === 'playing' || state === 'throwing' || state === 'break' || state === 'dying'; }
function pauseGameplay(reason) {
  pauseReasons.add(reason);
  if (paused || !activeGameplay()) return;
  paused = true;
  SDK.gameplayStop();
  AU.setPaused(true);
}
function resumeGameplay(reason) {
  pauseReasons.delete(reason);
  if (!paused || pauseReasons.size || !activeGameplay()) return;
  paused = false;
  lastT = 0;
  AU.setPaused(false);
  SDK.gameplayStart();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGameplay('hidden'); else resumeGameplay('hidden');
});
window.addEventListener('blur', () => pauseGameplay('blur'));
window.addEventListener('focus', () => resumeGameplay('blur'));

// ---------- resize ----------
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  viewW = vw; viewH = vh;
  // Fit the interactive lane on mobile; desktop retains its useful height and
  // devotes the rest of the viewport to the arena broadcast rather than bars.
  stageScale = Math.min(vw / GAME_W, vh / GAME_H);
  stageX = (vw - GAME_W * stageScale) * 0.5;
  stageY = (vh - GAME_H * stageScale) * 0.5;
  canvas.width = Math.max(1, Math.round(vw * pixelRatio));
  canvas.height = Math.max(1, Math.round(vh * pixelRatio));
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}
window.addEventListener('resize', resize);
resize();

// ---------- loop ----------
let lastT = 0, accumulator = 0;
function frame(ts) {
  const dt = Math.min((ts - lastT) / 1000, 0.1);
  lastT = ts;
  if (!paused) {
    accumulator = Math.min(accumulator + dt, 0.25);
    while (accumulator >= FIXED_STEP) {
      update(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  }
  draw();
  requestAnimationFrame(frame);
}

let booted = false;
// ---------- boot ----------
(async () => {
  await SDK.initSDK();
  SDK.loadingStart();
  best = SDK.loadBest();
  META.load();
  muted = SDK.getMuteSetting();
  AU.setMuted(muted);
  SDK.onSettingsChange((s) => { muted = !!s.muteAudio; AU.setMuted(muted); });
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = motionQuery.matches;
  motionQuery.addEventListener('change', (e) => { reducedMotion = e.matches; });
  const daily = META.checkDaily();
  if (daily) boundedPush(toasts, { txt: 'DAILY BONUS — DAY ' + daily.day, sub: '+' + daily.reward + ' \u25C6 shards', t: 0, color: '#ffe14d' }, MAX_TOASTS);
  if (state === 'menu') setupLevel(1); // don't reset a game started before boot finished
  SDK.loadingStop();
  booted = true;
  requestAnimationFrame(frame);
})();

// ---------- debug hook ----------
if (new URLSearchParams(location.search).get('debug') === '1') {
  window.__astro = {
    booted: () => booted,
    forceGameOver: () => { if (state === 'playing' || state === 'throwing') startDeath(); dieT = 2; doGameOver(); },
    getState: () => ({
      state, level, score, bladesLeft, bladesTotal, combo, best, canContinue, continueUsed, stuck: stuck.length, onboardingVisible,
      shards: META.M.shards, owned: META.M.owned.slice(), equipped: META.M.equipped,
      bossesSeen: META.M.bossesSeen.slice(), missionsDone: META.M.missionsDone.slice(),
      stats: { ...META.M.stats }, streak: { ...META.M.streak }, runShards, x2Used,
    }),
    addScore: (n) => { score += n; },
    addShards: (n) => { META.addShards(n); },
    throwNow: () => throwBlade(),
    winLevel: () => { if (state === 'playing') { bladesLeft = 0; breakTarget(); } },
    setLevel: (n) => { level = n; setupLevel(n); state = 'playing'; },
    buyBlade: (id) => META.buyBlade(id),
    equipBlade: (id) => META.equipBlade(id),
    openShop: () => { state = 'shop'; },
    openBosses: () => { state = 'bosses'; },
    openMissions: () => { state = 'missions'; },
    goMenu: () => { state = 'menu'; },
    resetMeta: () => { localStorage.removeItem('bladerush.meta'); },
    getLayout: () => ({
      viewW, viewH, pixelRatio, stageScale, stageX, stageY,
      minControlPx: Math.min(BTN.shop.h, BTN.bosses.h, BTN.missions.h, BTN.back.h) * stageScale,
      x2ControlPx: BTN.x2.h * stageScale,
    }),
    getDebugCounts: () => ({ particles: particles.length, confetti: confetti.length, trail: trail.length, floats: floats.length, toasts: toasts.length, pieces: pieces.length, pauseReasons: pauseReasons.size }),
    getPatternForTest: () => { const p = patternState(); return { ...p, label: patternLabel(p) }; },
    getToastLayoutForTest: () => {
      const layout = toastLayout();
      return { top: layout.top, bottom: layout.top + (layout.visible.length ? 62 : 0), count: layout.visible.length, targetBottom: TARGET_Y + targetR, cueBottom: TARGET_Y + targetR + 62 };
    },
    setStuckAngles: (angles) => { stuck = angles.map(rel => ({ rel, wob: 0, wt: 0 })); },
    checkImpactAt: (rel) => stuck.some(b => angDist(b.rel, norm(rel)) < bladeCoreGap()),
    setPausedForTest: (v) => { if (v) pauseGameplay('test'); else resumeGameplay('test'); },
    simulateCadence: (hz, seconds) => {
      level = 6; setupLevel(6); state = 'playing'; runTime = 50; patternT = 0; targetAngle = 0;
      let carry = 0;
      for (let i = 0; i < Math.round(hz * seconds); i++) {
        carry += 1 / hz;
        while (carry + 1e-10 >= FIXED_STEP) { update(FIXED_STEP); carry = Math.max(0, carry - FIXED_STEP); }
      }
      return { angle: targetAngle, patternT, runTime, speed: angVel() };
    },
    advance: (seconds) => { for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) update(FIXED_STEP); },
    restart: () => startGame(),
    reloadMeta: () => META.load(),
    migrateMetaForTest: (raw) => META.replaceWithMigrated(raw),
  };
}
