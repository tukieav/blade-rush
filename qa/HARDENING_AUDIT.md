# Blade Rush hardening audit

Audited 2026-08-21 against the CrazyGames gameplay and quality requirements,
`HARDENING_COMMON.md`, and the `blade-rush` portfolio-map entry. Baseline build
and existing browser flows passed (`npm run build`, `npm run test`, and
`npm run test:desktop`). The existing desktop smoke exercised the menu, first
level, level-clear/progression, failure/continue/restart, Armory, Boss Gallery,
and Missions at 1280x720, 1920x1080, and 390x844. It did not cover the full
required viewport matrix, lifecycle, or refresh-rate determinism.

## Core loop, session, and depth

One click starts a run. The player launches a blade into a rotating target,
avoids embedded blades, collects rim crystals, builds a combo, and clears a
target to advance. Every fifth target is a boss; shards, skins, missions,
boss collection, daily streak, and best score provide persistence. The first
minute has lively impact/break feedback, but the rotation rules and collision
silhouette give little actionable anticipation once irregular patterns begin.

## Prioritized issues

1. **FAIL — simulation is not refresh-rate deterministic.** Rotation advances
   `patternT` inside `angVel(dt)` and integrates once per rAF, while throws,
   particles, and difficulty use the variable rAF delta (`src/main.js:97-103`,
   `src/main.js:354-411`, `src/main.js:1550-1556`). No 60/144/165Hz gate
   exists, so patterns diverge with rAF subdivision.
2. **FAIL — no lifecycle pause/resume.** The sole loop always queues another
   rAF and there are no `visibilitychange`, `blur`, or `focus` handlers
   (`src/main.js:1550-1556`). Ads only mute audio; they do not pause simulation
   (`src/main.js:271-302`, `src/sdk.js:51-61`). A player can return to a lost
   timing window.
3. **FAIL — collision uses a broad angular gap, not blade-core geometry.**
   Every embedded blade blocks `BLADE_GAP` at its center (`src/main.js:10`,
   `src/main.js:145-150`), which can reject a visually clear edge/rim shot and
   has no adjacent-blade boundary test.
4. **FAIL — no beginner target-pattern telegraph.** Levels 1–4 only have a
   generic text hint (`src/main.js:126`, `src/main.js:1009-1016`); direction,
   speed trend, and a short safe sector are never rendered.
5. **FAIL — irregular patterns are opaque and delayed.** They begin at level
   6 after 45 seconds of run time and combine sine waves without an announced
   reversal/acceleration or safe-window pattern (`src/main.js:75`,
   `src/main.js:96-103`). Bosses add visual aura but no cadence telegraph
   (`src/main.js:944-967`).
6. **PARTIAL — effects are time-filtered but unbounded at insertion.**
   Particles, confetti, trails, floats, toasts, and breaking pieces are pushed
   freely (`src/main.js:282-343`, `src/main.js:196-237`) and only later age out
   (`src/main.js:354-411`). There is no 30-level/restart soak or array/listener
   bound assertion.
7. **FAIL — required viewport proof is incomplete.** The shipped desktop gate
   has only 1280x720, 1920x1080, and 390x844 (`tools/e2e-desktop.cjs:7-11`),
   omitting seven mandatory DPR=1 sizes and checks for control overlap/clipping.
8. **PARTIAL — restart is needlessly ad-coupled.** `PLAY AGAIN` awaits a
   midgame request before `startGame()` (`src/main.js:305-312`); it is locally
   fast but can delay restart and has no explicit under-one-second assertion.
9. **PARTIAL — persistence fallback is tolerant but schema-unsafe.** Parse
   errors reset to defaults, but old/invalid field types (for example a string
   `owned`) are used directly and can throw at `.includes` (`src/meta.js:66-79`).
   There is no malformed/old-save migration test.
10. **PARTIAL — taxonomy and submission claims are stale.** Tags include
    invented portal labels such as `knife`, `throw`, `timing`, `neon`, and
    `reflex`; the exact verified map tags are different (`marketing/SUBMISSION.md:11`,
    `.hardening/portfolio-map.json`). The submission says "All ages" rather
    than the required PEGI12 position and references a `.webm` that is not the
    current MP4 deliverable (`marketing/SUBMISSION.md:57-67`).

## Likely quit causes

| Moment | Risk | Evidence |
| --- | --- | --- |
| First 10 seconds | The generic instruction does not show where the rotating target will be safe; perceived unfair collision can end the first attempt. | `src/main.js:145-150`, `src/main.js:1009-1016` |
| First 60 seconds | Newly introduced speed changes lack anticipation, turning timing into memorization. | `src/main.js:96-103` |
| Five minutes | Repeated visual bursts have no insertion caps or soak proof, and returning from tab/ad can advance the game unexpectedly. | `src/main.js:282-343`, `src/main.js:1550-1556` |

## Graphics and game-feel findings

The neon arena, materials, boss textures, impact sparks, and target break are
strong. The most valuable missing feedback is *predictive*: a rotating
direction/speed indicator, a short beginner safe-sector glow, and clear boss
pattern-change pulses. Existing full-screen white flash is short but should
respect reduced motion (`src/main.js:1469-1472`).

## Requirement matrix (baseline)

| Requirement | Status | Baseline evidence |
| --- | --- | --- |
| One-click useful gameplay | PASS | PLAY invokes `startGame`; baseline e2e passed. |
| All 10 DPR=1 viewports + mobile sanity | FAIL | Only 3 viewport cases exist. |
| 60/144/165Hz deterministic simulation | FAIL | Variable-step rAF; no gate. |
| Lifecycle / ad pause and single resume | FAIL | No visibility/focus handling. |
| Safe migrated persistence | PARTIAL | Parse fallback only; no schema migration test. |
| 120s soak, bounds, listener/timer health | FAIL | No soak gate or explicit caps. |
| Keyboard/mouse/touch and 44px mobile controls | PARTIAL | Paths exist; only 390x844 control check exists. |
| SDK/audio boundary correctness | PARTIAL | SDK init timeout/mute/happytime exist; ad pause and lifecycle do not. |
| First-minute visual/game-feel polish | PARTIAL | Strong impact visuals; no predictive pattern telegraph. |
| Reduced motion / no rapid flashing | PARTIAL | No reduced-motion handling. |
| Accurate category/tags/submission truth | FAIL | Submission tags/age/media claims are stale. |

## Taxonomy correction required

Use only the `blade-rush` entry: primary **Arcade** (`/c/arcade`), secondary
**Casual**, and tags **Casual, One Button, Skill, Mobile, 2D, Destroy** with
their exact map paths. Its short description and full description supersede
the current stale tag list and unsupported wording.
