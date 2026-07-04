# SUNDIVE — one-button comet racing

**Live demo:** https://sundive.k1ngp1n.com

Race a comet down a canyon of light against a field of rivals. The comet
auto-runs — **hold** (or **D**) to dive and build speed, **release** at a crest
to soar, **jump** hazards and pounce on opponents, **fire nitro** to blast past.
Ten levels across five biomes, up to seven rivals, and a track of vents,
boulders, trampolines and pits. Instant restart, per-level daily seeds,
best-time tracking.

![Race](docs/screenshots/sundive-race.png)

## Controls

The comet always cruises forward; the controls steer and drive it. Keyboard,
mouse/touch, and an on-screen d-pad (mobile) all work.

| Input | Action |
|---|---|
| **Hold** mouse/touch · **D** · **→** | dive — grip the slope, build speed (release at a crest to soar) |
| **W** · **↑** · **Space** | jump — clear a hazard, or land on a rival to stun it |
| **Shift** | nitro — a burst of speed (recharges ~5 s) |
| **S** · **↓** | brake |
| **A** · **←** | reverse |
| **Esc** | pause + menu · **R** restart · **M** sound |

On touch: a d-pad on the left (▲ jump · ◀ reverse · ▶ dive · ▼ brake) and a
NITRO button on the right.

## The race

- **Rivals.** Each level fields more colour-coded comets (Jade, Rose, Violet,
  Azure, Amber, Lime, Nova), driven by live bots that dive, nitro and hop
  hazards. Placement (`1st of 7`) updates live; beat everyone to **win the level
  and unlock the next**.
- **Nitro.** A meter fills over ~5 s (faster when you grab motes or stun rivals).
  Fire it for a hard shove on top of your cruising speed.
- **Vents & boulders.** Small **vents** are a light clip; **boulders** are a hard
  hit that bleeds speed and staggers you. Jump to clear either.
- **Trampolines.** Cross a pad and you bounce sky-high — great for reaching motes
  or dropping onto a rival.
- **Pits.** Gaps in the ground. Clear them airborne (jump or soar) or you plunge
  in and **respawn just before the mouth** — the clock keeps running.
- **Stun-land.** Come down *on top of* a rival to **stun them for 2 s**, bounce
  off, and refill nitro.
- **Boost motes & perfect launches.** Catch floating orbs mid-flight for nitro; a
  committed dive released at a clean crest angle gives a speed bonus.

## Levels & biomes

Ten levels across five biomes, each steeper and busier than the last:

| # | Name | Biome | Rivals |
|---|---|---|---|
| 1 | First Light | Sunset | 1 |
| 2 | Long Shadows | Sunset | 2 |
| 3 | Aurora Run | Aurora | 3 |
| 4 | Polar Night | Aurora | 4 |
| 5 | Emberfall | Ember | 5 |
| 6 | Magma Line | Ember | 6 |
| 7 | Glacier | Ice | 7 |
| 8 | Whiteout | Ice | 7 |
| 9 | Nebula | Void | 7 |
| 10 | Event Horizon | Void | 7 |

Level 1's rival is deliberately beatable while you learn; higher levels add
rivals, hazards, and faster, sharper bots. Progress unlocks in `localStorage`.

<table>
  <tr>
    <td><img src="docs/screenshots/sundive-start.png" alt="Start / level select" /></td>
    <td><img src="docs/screenshots/sundive-boost.png" alt="Nitro boost" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/sundive-launch.png" alt="Launch off a crest" /></td>
    <td><img src="docs/screenshots/sundive-finish.png" alt="Finish — you win" /></td>
  </tr>
</table>

## Under the hood

- **Deterministic fixed-timestep physics** (120 Hz): ballistic integration +
  project-and-slide collision. Dive, carve, launch, slam, jump, nitro, stun,
  brake/reverse, trampolines and pit respawns are all in one tuning table. A
  headless telemetry harness (bot runs over many seeds, per level) keeps the run
  curve at ~40 s → ~100 s across the ten levels.
- **Seeded everything** (`mulberry32`): terrain, rival skill, and the placement of
  vents, boulders, pits, pads and motes flow from `seed:Ln`. Daily seed = the UTC
  date, so everyone races the same canyon; free-run rolls a fresh one.
- **Live bot rivals** read the terrain exactly like you (dive lookahead + nitro on
  long descents + hop over hazards and pits) — no scripted paths. Pits and
  trampolines live in the sim, so bots fall, respawn and bounce too.
- **Five biomes** (Sunset, Aurora, Ember, Ice, Void) drive the sky gradient, sun,
  parallax dunes, terrain fill + ridge light, and page background per level.
- **The look**: additive comet trails (the player is the gold hero), ground shadow
  for altitude, boost speed-lines, screenshake / hitstop / slow-mo finish, fully
  procedural WebAudio (wind, nitro, jump, stun, bonus, trampoline, fall, respawn).
- Static bundle, no backend, no assets. First-run coach teaches the verb in the
  first seconds, then never nags again.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
npm run preview    # serve the build on http://localhost:4320
```

Physics tuning telemetry:

```bash
npx esbuild scripts/telemetry.ts --bundle --format=esm --outfile=/tmp/st.mjs && node /tmp/st.mjs
```

## QA & screenshots

```bash
npm run build
npm run shots      # regenerates docs/screenshots/*.png (6 shots, across biomes)
npm run qa         # Playwright: 29 checks
```

QA verifies: loads without console errors, canvas non-blank, level N fields N
rivals, the Race button starts a run, hold/release changes the trajectory, jump
lifts off and clears the hazard gate, nitro spikes speed, an opponent can be
stunned, obstacles never trap, pits finish on autopilot + respawn the player,
trampolines bounce, brake/reverse/pause work, the finish is reachable with a
placement, PB persists, the level select is clickable after a race, the daily
seed is date-driven, reduced motion doesn't break the sim, no horizontal overflow
at 360/390/768/1440, and screenshots are ≤ 4000×4000.

Query params: `?level=1..10`, `?mode=free`, `?seed=abc`, `?date=YYYY-MM-DD`,
`?qa=1`, `?reduce=1`.

## Deploy (static)

```bash
docker build -t sundive .
docker run -d --name sundive -p 3900:80 sundive
```

```caddy
sundive.k1ngp1n.com { reverse_proxy 127.0.0.1:3900 }
```

---

Part of the [k1ngp1n.com](https://k1ngp1n.com) demo collection. No backend, no
accounts, no assets — every pixel and sound is procedural.
