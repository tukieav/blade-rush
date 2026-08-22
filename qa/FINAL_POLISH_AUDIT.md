# Final Polish audit — Blade Rush

Audited 2026-08-22 against the current hardened build. I ran the first-run,
death/retry, progression, Armory and Boss Gallery flows at 907x510, 1920x1080
and 390x844, then an accelerated mixed-play sequence for 300 simulated
seconds. Existing build, desktop and hardening gates were green from this
worktree; the initial 120-second soak was also green. The three findings below
are the only reproduced remaining defects.

1. **Rotation warning remains "incoming" after a reversal has started.**
   Reproduction: enter level 5, advance its cycle past `patternT=3.4`, then
   observe the boss while it rotates in the opposite direction. The arc changes
   to the new direction but the label still says `REVERSAL INCOMING`
   (`qa/final-polish-audit/boss-reversal-stale-label.png`). This gives a false
   timing instruction precisely during a high-speed boss window, undermining
   fair pacing. Root cause: `patternState()` marks the reversal active at
   `src/main.js:110-112`, while `drawPatternTelegraph()` maps every reverse
   state to the incoming-only copy at `src/main.js:1001`. Evidence state:
   `level=5`, `patternT=4.0`, reverse direction active.

2. **Mission-complete toast covers the top of the live target.**
   Reproduction: set throws to 9, land one level-1 blade, and inspect the
   first completion frame at 907x510. The 62px card is placed at logical
   `y=150`, inside the level-1 target's `y=128..472` decision area
   (`qa/final-polish-audit/mission-toast-overlap.png`). The player loses sight
   of the rim/safe-sector just as the reward appears. Root cause:
   `drawToasts()` starts the stack at `src/main.js:1178`, whereas the target
   and its telegraph occupy that same region via `src/main.js:1011-1019`.
   Evidence state: `MISSION COMPLETE — Stick 10 blades`, level 1, score 10.

3. **The mobile x2 reward action misses the 44px target requirement.**
   Reproduction: at 390x844, clear a target, force a game-over with shards,
   and measure the x2 button: `60 * 0.7222 = 43.33 CSS px`
   (`qa/final-polish-audit/mobile-x2-under-44.png`). It is the only post-death
   reward action and is harder to acquire on touch. Root cause: `BTN.x2` is
   only 60 logical pixels at `src/main.js:1224`; the mobile scale comes from
   `src/main.js:1629`. Evidence state: `gameover`, `runShards=3`,
   `stageScale=0.722222`.

