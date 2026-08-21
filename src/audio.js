// Blade Rush — procedural audio via WebAudio (no audio files)
let ctx = null;
let masterGain = null;
let muted = false;
let paused = false;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (!paused && ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 0.5;
}

// Lifecycle pause is deliberately separate from user/portal mute: returning
// from an ad/tab restores the player's chosen mute setting rather than sound.
export function setPaused(value) {
  paused = value;
  if (!ctx) return;
  if (value && ctx.state === 'running') ctx.suspend();
  if (!value && ctx.state === 'suspended') ctx.resume();
}

export function unlockAudio() { ensureCtx(); }

function tone(freq, dur, type, vol, delay = 0, drop = 0.5) {
  if (muted || paused || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * drop), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise(dur, vol, delay = 0, hp = 1200) {
  if (muted || paused || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start(t0);
}

// Blade thrown — quick whoosh
export function throwSound() {
  ensureCtx();
  noise(0.12, 0.18, 0, 600);
  tone(320, 0.1, 'sine', 0.1, 0, 1.6);
}

// Blade sticks into target — thunk, pitch rises with combo
export function hitSound(combo) {
  ensureCtx();
  const base = 180 + Math.min(combo, 10) * 28;
  tone(base, 0.12, 'square', 0.22, 0, 0.4);
  tone(base * 2, 0.08, 'triangle', 0.14, 0.01);
  noise(0.06, 0.2, 0, 2500);
}

// Crystal shattered — sparkly arpeggio
export function crystalSound() {
  ensureCtx();
  [880, 1174, 1568].forEach((f, i) => tone(f, 0.18, 'triangle', 0.2, i * 0.04));
  noise(0.1, 0.12, 0, 4000);
}

// Blade hits another blade — metallic clang (game over)
export function clangSound() {
  ensureCtx();
  tone(1450, 0.3, 'square', 0.18, 0, 0.85);
  tone(1080, 0.35, 'sawtooth', 0.12, 0.01, 0.8);
  noise(0.2, 0.25, 0, 3000);
}

// Target breaks apart — big satisfying crunch + rising chime
export function breakSound() {
  ensureCtx();
  noise(0.35, 0.3, 0, 800);
  tone(120, 0.25, 'square', 0.2, 0, 0.3);
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.22, 0.08 + i * 0.06));
}

// Boss defeated — fanfare
export function bossSound() {
  ensureCtx();
  [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, 'triangle', 0.24, i * 0.09));
  noise(0.4, 0.2, 0.1, 500);
}

export function gameOverSound() {
  ensureCtx();
  [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.14, i * 0.15));
}

export function uiSound() {
  ensureCtx();
  tone(660, 0.08, 'sine', 0.15, 0, 1.2);
}

// Level cleared (non-boss) — short rising fanfare
export function levelUpSound() {
  ensureCtx();
  [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.2, i * 0.07));
}

// Shards gained — soft coin blip
export function shardSound() {
  ensureCtx();
  tone(988, 0.1, 'sine', 0.16, 0, 1.4);
  tone(1319, 0.12, 'sine', 0.12, 0.05, 1.3);
}

// Blade purchased/equipped — power-up sweep
export function buySound() {
  ensureCtx();
  [392, 523, 659, 880].forEach((f, i) => tone(f, 0.2, 'triangle', 0.2, i * 0.05));
  noise(0.12, 0.1, 0.1, 3000);
}

// Mission complete — triumphant chime
export function missionSound() {
  ensureCtx();
  [659, 880, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.22, i * 0.08));
}
