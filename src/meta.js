// Blade Rush — meta-progression: shards currency, blade skins, missions,
// boss collection, daily streak. Persisted via CrazyGames data module + localStorage.
import * as SDK from './sdk.js';

// ---------- blade skins (procedural: colors / shape / trail; some with perks) ----------
export const BLADES = [
  { id: 'neon',    name: 'NEON EDGE',     cost: 0,   shape: 'standard', edge: ['#e8ffff', '#7df9ff', '#2b8fd4'], glow: '#7df9ff', gem: '#ff5df1' },
  { id: 'crimson', name: 'CRIMSON FANG',  cost: 40,  shape: 'jagged',   edge: ['#ffe0e0', '#ff5d6c', '#a3122b'], glow: '#ff5d6c', gem: '#ffe14d' },
  { id: 'volt',    name: 'VOLT SPIKE',    cost: 60,  shape: 'jagged',   edge: ['#fffbe0', '#ffe14d', '#c79a00'], glow: '#ffe14d', gem: '#7df9ff' },
  { id: 'emerald', name: 'EMERALD KRIS',  cost: 90,  shape: 'curved',   edge: ['#eaffea', '#7dff8a', '#1d9e4b'], glow: '#7dff8a', gem: '#ffffff' },
  { id: 'violet',  name: 'VIOLET REAPER', cost: 120, shape: 'wide',     edge: ['#f3e0ff', '#c66bff', '#6a1fb8'], glow: '#c66bff', gem: '#7dff8a' },
  { id: 'frost',   name: 'FROST SHARD',   cost: 150, shape: 'wide',     edge: ['#ffffff', '#bfeaff', '#4fa8e0'], glow: '#ffffff', gem: '#2fa4d8' },
  { id: 'solar',   name: 'SOLAR FLARE',   cost: 190, shape: 'curved',   edge: ['#fff4d6', '#ffab3d', '#d84b12'], glow: '#ffab3d', gem: '#ff5df1' },
  { id: 'void',    name: 'VOID KATANA',   cost: 240, shape: 'slim',     edge: ['#ffffff', '#8a93b8', '#141c2c'], glow: '#aab6ff', gem: '#ff5df1' },
  { id: 'obsidian',name: 'OBSIDIAN FANG', cost: 280, shape: 'jagged',   edge: ['#d8c8ff', '#5a4a8a', '#17102e'], glow: '#9a7dff', gem: '#ffe14d' },
  { id: 'rose',    name: 'ROSE QUARTZ',   cost: 340, shape: 'slim',     edge: ['#fff0f8', '#ff9dd6', '#d13d92'], glow: '#ff9dd6', gem: '#7df9ff', perk: 'crystal' },
  { id: 'gold',    name: 'GOLD CLEAVER',  cost: 420, shape: 'wide',     edge: ['#fffbe8', '#ffd94d', '#b8860b'], glow: '#ffd94d', gem: '#ff5d6c', perk: 'level' },
  { id: 'prism',   name: 'PRISM BLADE',   cost: 550, shape: 'standard', edge: ['#ffffff', '#7df9ff', '#ff5df1'], glow: 'prism',   gem: '#ffffff', perk: 'crystal' },
];
export const PERK_TEXT = { crystal: '+1 shard / crystal', level: '+2 shards / level' };

// ---------- boss roster (variants cycle every 5 levels) ----------
export const BOSSES = [
  { id: 0, name: 'IRONCLAD',  rim: '#ff5df1', metal: ['#5a6a80', '#38455a', '#222c3d'] },
  { id: 1, name: 'MAGMA CORE',rim: '#ffab3d', metal: ['#8a4a3a', '#5a2c22', '#2e1410'] },
  { id: 2, name: 'VENOMWHEEL',rim: '#7dff8a', metal: ['#4a7a55', '#2c4a34', '#14261a'] },
  { id: 3, name: 'STORMDISC', rim: '#ffe14d', metal: ['#6a6a8a', '#42425e', '#242438'] },
  { id: 4, name: 'ABYSS MAW', rim: '#c66bff', metal: ['#4a3a6a', '#2e2246', '#160e26'] },
  { id: 5, name: 'FROSTBITE', rim: '#bfeaff', metal: ['#4a6a80', '#2c455a', '#14242e'] },
  { id: 6, name: 'BLOODRUNE', rim: '#ff5d6c', metal: ['#7a3a4a', '#4a222c', '#260e14'] },
  { id: 7, name: 'SUNFORGE',  rim: '#ffd94d', metal: ['#8a7a3a', '#5a4e22', '#2e260e'] },
];
export function bossForLevel(lv) { return BOSSES[(Math.floor(lv / 5) - 1) % BOSSES.length]; }

// ---------- missions ----------
export const MISSIONS = [
  { id: 'blades10',   desc: 'Stick 10 blades',           stat: 'throws',      target: 10,  reward: 15 },
  { id: 'blades100',  desc: 'Stick 100 blades',          stat: 'throws',      target: 100, reward: 50 },
  { id: 'blades500',  desc: 'Stick 500 blades',          stat: 'throws',      target: 500, reward: 150 },
  { id: 'crystal25',  desc: 'Shatter 25 crystals',       stat: 'crystals',    target: 25,  reward: 40 },
  { id: 'crystal150', desc: 'Shatter 150 crystals',      stat: 'crystals',    target: 150, reward: 120 },
  { id: 'boss1',      desc: 'Defeat your first boss',    stat: 'bosses',      target: 1,   reward: 30 },
  { id: 'boss10',     desc: 'Defeat 10 bosses',          stat: 'bosses',      target: 10,  reward: 100 },
  { id: 'bossrun3',   desc: '3 bosses in a single run',  stat: 'bestBossRun', target: 3,   reward: 150 },
  { id: 'level12',    desc: 'Reach level 12',            stat: 'bestLevel',   target: 12,  reward: 80 },
  { id: 'combo8',     desc: 'Hit a x8 combo',            stat: 'bestCombo',   target: 8,   reward: 60 },
  { id: 'runs10',     desc: 'Play 10 runs',              stat: 'runs',        target: 10,  reward: 50 },
];

// ---------- persistent state ----------
const KEY = 'bladerush.meta';
const SAVE_VERSION = 3;
export let M = defaultMeta();

function defaultMeta() {
  return {
    version: SAVE_VERSION,
    shards: 0,
    owned: ['neon'],
    equipped: 'neon',
    bossesSeen: [],          // boss ids defeated at least once
    missionsDone: [],        // mission ids claimed
    stats: { throws: 0, crystals: 0, bosses: 0, bestLevel: 1, bestCombo: 0, runs: 0, bestBossRun: 0 },
    streak: { last: '', count: 0 },
    onboardingSeen: false,   // first level's visual control cue was actioned
  };
}

export function load() {
  let raw = null;
  try { raw = SDK.loadData(KEY); } catch (e) {}
  if (raw) {
    M = migrateRaw(raw);
    save(); // transparently migrate old but valid saves to the current schema
  }
  return M;
}

// Kept exported for browser regression tests and future import migrations.
export function migrateRaw(raw) {
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid save shape');
    const next = Object.assign(defaultMeta(), p);
    next.version = SAVE_VERSION;
    next.stats = Object.assign(defaultMeta().stats, p.stats && typeof p.stats === 'object' ? p.stats : {});
    next.streak = Object.assign(defaultMeta().streak, p.streak && typeof p.streak === 'object' ? p.streak : {});
    next.owned = Array.isArray(p.owned) ? p.owned.filter(id => BLADES.some(b => b.id === id)) : ['neon'];
    next.bossesSeen = Array.isArray(p.bossesSeen) ? p.bossesSeen.filter(Number.isInteger) : [];
    next.missionsDone = Array.isArray(p.missionsDone) ? p.missionsDone.filter(id => MISSIONS.some(m => m.id === id)) : [];
    next.shards = Number.isFinite(Number(p.shards)) ? Math.max(0, Number(p.shards)) : 0;
    for (const key of Object.keys(next.stats)) next.stats[key] = Number.isFinite(Number(next.stats[key])) ? Math.max(0, Number(next.stats[key])) : 0;
    next.streak.last = typeof next.streak.last === 'string' ? next.streak.last : '';
    next.streak.count = Number.isFinite(Number(next.streak.count)) ? Math.max(0, Number(next.streak.count)) : 0;
    next.onboardingSeen = p.onboardingSeen === true;
    if (!next.owned.includes('neon')) next.owned.push('neon');
    if (typeof next.equipped !== 'string' || !next.owned.includes(next.equipped)) next.equipped = 'neon';
    return next;
  } catch (e) { return defaultMeta(); }
}

export function replaceWithMigrated(raw) { M = migrateRaw(raw); return M; }

export function save() {
  try { SDK.saveData(KEY, JSON.stringify(M)); } catch (e) {}
}

// ---------- daily streak (returns reward info once per day, else null) ----------
export function checkDaily() {
  const today = new Date().toISOString().slice(0, 10);
  if (M.streak.last === today) return null;
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  M.streak.count = (M.streak.last === yest) ? M.streak.count + 1 : 1;
  M.streak.last = today;
  const reward = Math.min(10 + (M.streak.count - 1) * 5, 40);
  M.shards += reward;
  save();
  return { day: M.streak.count, reward };
}

// ---------- economy ----------
export function equippedBlade() { return BLADES.find(b => b.id === M.equipped) || BLADES[0]; }
export function perk() { return equippedBlade().perk || null; }

export function addShards(n) { M.shards += n; save(); }

export function buyBlade(id) {
  const b = BLADES.find(x => x.id === id);
  if (!b || M.owned.includes(id) || M.shards < b.cost) return false;
  M.shards -= b.cost;
  M.owned.push(id);
  M.equipped = id;
  save();
  return true;
}
export function equipBlade(id) {
  if (!M.owned.includes(id)) return false;
  M.equipped = id; save(); return true;
}

// ---------- stats & missions; returns newly completed missions ----------
export function bump(stat, n = 1, absolute = false) {
  if (absolute) { if (n <= M.stats[stat]) return []; M.stats[stat] = n; }
  else M.stats[stat] += n;
  const done = [];
  for (const m of MISSIONS) {
    if (M.missionsDone.includes(m.id)) continue;
    if ((M.stats[m.stat] || 0) >= m.target) {
      M.missionsDone.push(m.id);
      M.shards += m.reward;
      done.push(m);
    }
  }
  save();
  return done;
}

export function recordBossKill(bossId) {
  if (!M.bossesSeen.includes(bossId)) { M.bossesSeen.push(bossId); }
  return bump('bosses', 1);
}

export function missionProgress(m) {
  return Math.min(M.stats[m.stat] || 0, m.target);
}

export function completeOnboarding() {
  if (M.onboardingSeen) return;
  M.onboardingSeen = true;
  save();
}
