// Headless physics telemetry — the feel-tuning loop.
// Run: npx esbuild scripts/telemetry.ts --bundle --format=esm --outfile=/tmp/sundive-tel.mjs && node /tmp/sundive-tel.mjs
import { buildTerrain, INTRO_X } from '../src/core/terrain'
import { CometSim, makeBot, TICK_RATE } from '../src/core/sim'
import { hashStr, mulberry32 } from '../src/core/rng'
import { LEVELS } from '../src/core/levels'

function runBot(seed: string, sloppiness: number, opts: { length?: number; ampScale?: number }) {
  const terrain = buildTerrain(seed, opts)
  const sim = new CometSim(terrain, INTRO_X + 4)
  const bot = makeBot(terrain, mulberry32(hashStr(`bot:${seed}:${sloppiness}`)), sloppiness)
  const speeds: number[] = []
  const maxTicks = TICK_RATE * 300
  while (!sim.state.finished && sim.state.tick < maxTicks) {
    sim.step(bot(sim.state))
    if (sim.state.tick % 60 === 0) speeds.push(sim.speed())
  }
  const sorted = [...speeds].sort((a, b) => a - b)
  const q = (f: number) => sorted[Math.floor(f * (sorted.length - 1))] ?? 0
  const avg = speeds.reduce((a, b) => a + b, 0) / (speeds.length || 1)
  return {
    finished: sim.state.finished,
    timeS: sim.timeMs() / 1000,
    top: sim.telemetry.topSpeed,
    min: sorted[0] ?? 0,
    p10: q(0.1),
    avg,
    launches: sim.telemetry.launches,
    perfects: sim.telemetry.perfects,
    slams: sim.telemetry.slams,
  }
}

// Per-level pacing curve — average a few seeds at the level's own steepness/length/skill.
const SEEDS = ['2026-07-04', '2026-07-05', 'alpha', 'bravo', 'chill']
console.log('lvl name           t(avg)  t(rng)      min   p10   avg   top   slams')
for (const L of LEVELS) {
  const slop = (L.oppSloppy[0] + L.oppSloppy[1]) / 2
  const runs = SEEDS.map((s) => runBot(s, slop, { length: L.length, ampScale: L.ampScale }))
  const fin = runs.filter((r) => r.finished).length
  const ts = runs.map((r) => r.timeS)
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  console.log(
    `${String(L.n).padStart(2)}  ${L.name.padEnd(13)} ${mean(ts).toFixed(1).padStart(5)}s  ${Math.min(...ts).toFixed(0)}-${Math.max(...ts).toFixed(0)}s  ` +
      `${mean(runs.map((r) => r.min)).toFixed(0).padStart(4)}  ${mean(runs.map((r) => r.p10)).toFixed(0).padStart(4)}  ` +
      `${mean(runs.map((r) => r.avg)).toFixed(0).padStart(4)}  ${mean(runs.map((r) => r.top)).toFixed(0).padStart(4)}  ` +
      `${mean(runs.map((r) => r.slams)).toFixed(1).padStart(4)}  fin=${fin}/${SEEDS.length}`,
  )
}
