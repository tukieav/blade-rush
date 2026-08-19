# Blade Rush — CrazyGames Submission Kit

Wszystko poniżej wklejasz w formularz na https://developer.crazygames.com/

## Game name
Blade Rush

## Category
Arcade (secondary: Casual)

## Tags
knife, throw, timing, one-tap, arcade, neon, combo, reflex, boss, one-hand

## Short description (max ~140 chars)
Throw energy blades into the spinning target — but never hit another blade! Neon arcade action with combos, crystals and boss levels.

## Full description
Blade Rush is a lightning-fast timing arcade game. A wooden target spins above
you — tap to hurl a glowing energy blade straight into it. Sounds easy? Every
blade you land keeps spinning with the target, and hitting one of your own
blades ends the run with a metallic CLANG!

FEATURES
- One-tap gameplay: pure timing, pure reflex
- Blades stick and spin with the target — the board fills up fast
- Smash crystals on the rim for big bonus points
- Combo multiplier for rapid consecutive hits
- Break the whole target apart when you land every blade
- Unpredictable rotation on higher levels: speed-ups, stops, direction flips
- Epic BOSS targets every 5 levels — bigger, tougher, shinier
- Second chance: watch an ad to continue right where you failed
- Your best score is saved across devices

HOW TO PLAY
1. Watch the target spin
2. Click / tap (or press Space) to throw a blade
3. Land ALL blades without hitting the ones already stuck
4. Smash crystals for bonus points and keep your combo alive
5. Clear the target to advance — beat the boss every 5th level!

How far can you rush?

## Controls text
Click / tap / Space — throw blade.

## SDK integration notes (QA reviewer info)
- HTML5 SDK v3, manual init before game start
- gameplayStart/gameplayStop on play / game over / ad breaks
- loadingStart/loadingStop around boot
- Midgame ad on "Play Again" after game over
- Rewarded ad "Continue" (resume level from death point, once per run)
- happytime() on boss defeats
- game.settings.muteAudio respected + settings change listener
- Best score via data module with localStorage fallback
- No external requests, all assets procedural, bundle ~16 KB
- Touch + mouse + keyboard; portrait-friendly, works on low-end devices
- Live demo: https://tukieav.github.io/blade-rush/

## Files to upload
- Build zip: blade-rush.zip (repo root po `npm run build` + `cd dist && zip -r ../blade-rush.zip .`)
- Cover 16:9 (1920x1080): marketing/cover-16x9.png
- Cover 1:1 (1080x1080): marketing/cover-1x1.png
- Screenshots: marketing/screenshot-menu.png, marketing/screenshot-gameplay.png

## Age rating / audience
All ages; designed for 10–16. No violence, no blood (energy blades into a wooden
disc), no text chat, no user content.
