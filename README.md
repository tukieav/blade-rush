# Blade Rush

Neon knife-throw arcade game for CrazyGames. Tap to throw energy blades into a
spinning wooden target — never hit a blade that's already stuck!

**Play:** https://tukieav.github.io/blade-rush/

## Features
- One-tap timing gameplay (mouse / touch / Space)
- Combos, crystals, screen shake, particles — all procedural (no asset files)
- Irregular rotation patterns on higher levels, boss targets every 5 levels
- CrazyGames SDK v3: midgame + rewarded ads, happytime, mute settings, cloud best score
- Bundle ~16 KB

## Dev
```bash
npm install
npm run dev      # esbuild watch + dev server
npm run build    # minified bundle -> dist/
node tests/e2e.mjs   # Playwright e2e (serve dist/ on :8483 first)
```

## Structure
- `src/main.js` — game (own angular kinematics, Canvas 2D)
- `src/sdk.js` — CrazyGames SDK v3 wrapper with no-op fallbacks
- `src/audio.js` — WebAudio procedural sounds
- `marketing/` — cover generator + submission kit
