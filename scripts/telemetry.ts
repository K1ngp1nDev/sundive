// Headless physics telemetry — the feel-tuning loop.
// Run: npx esbuild scripts/telemetry.ts --bundle --format=esm --outfile=/tmp/sundive-tel.mjs && node /tmp/sundive-tel.mjs
import { buildTerrain, INTRO_X } from '../src/core/terrain'
import { CometSim, makeBot, TICK_RATE } from '../src/core/sim'
import { hashStr, mulberry32 } from '../src/core/rng'

function runBot(seed: string, sloppiness: number) {
  const terrain = buildTerrain(seed)
  const sim = new CometSim(terrain, INTRO_X + 4)
  const bot = makeBot(terrain, mulberry32(hashStr(`bot:${seed}:${sloppiness}`)), sloppiness)
  const speeds: number[] = []
  const maxTicks = TICK_RATE * 240
  while (!sim.state.finished && sim.state.tick < maxTicks) {
    sim.step(bot(sim.state))
    if (sim.state.tick % 60 === 0) speeds.push(sim.speed())
  }
  const q = (f: number) => speeds[Math.floor(f * (speeds.length - 1))]?.toFixed(1)
  return {
    finished: sim.state.finished,
    timeS: (sim.timeMs() / 1000).toFixed(2),
    top: sim.telemetry.topSpeed.toFixed(1),
    sp25: q(0.25),
    sp50: q(0.5),
    sp75: q(0.75),
    launches: sim.telemetry.launches,
    perfects: sim.telemetry.perfects,
    slams: sim.telemetry.slams,
  }
}

for (const seed of ['2026-07-04', '2026-07-05', 'alpha', 'bravo', 'chill']) {
  for (const slop of [0.75, 0.25]) {
    const r = runBot(seed, slop)
    console.log(
      `${seed.padEnd(11)} slop=${slop} fin=${r.finished ? 'Y' : 'N'} t=${String(r.timeS).padStart(7)}s top=${r.top} sp[25/50/75]=${r.sp25}/${r.sp50}/${r.sp75} L=${r.launches} P=${r.perfects} S=${r.slams}`,
    )
  }
}
