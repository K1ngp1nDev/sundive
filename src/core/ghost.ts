import { CometSim, makeBot, SimState, TICK_RATE } from './sim'
import type { Terrain } from './terrain'
import { INTRO_X } from './terrain'
import { hashStr, mulberry32 } from './rng'

// Ghosts are position streams sampled every SAMPLE ticks, replayed by lerp.
// Position playback (not input playback) makes ghosts immune to any physics
// drift between builds. Stored in localStorage per seed as base64 Float32.

const SAMPLE = 4 // ticks between samples (30 Hz)

export interface GhostData {
  seed: string
  timeMs: number
  startTick: number
  samples: Float32Array // x0,y0,x1,y1,...
  source: 'synthetic' | 'pb'
}

export class GhostRecorder {
  private samples: number[] = []
  record(s: SimState): void {
    if (s.tick % SAMPLE === 0) this.samples.push(s.x, s.y)
  }
  finish(seed: string, timeMs: number, startTick: number, last?: SimState): GhostData {
    // append the current position so the stream provably crosses the finish line
    if (last) this.samples.push(last.x, last.y)
    return { seed, timeMs, startTick, samples: new Float32Array(this.samples), source: 'pb' }
  }
}

export class GhostPlayer {
  constructor(readonly data: GhostData) {}
  /** Ghost position at a given live tick (aligned by start-line crossing). */
  at(liveTick: number, liveStartTick: number): { x: number; y: number } | null {
    // align both timelines at their start-line crossings
    const ghostTick = liveTick - liveStartTick + this.data.startTick
    if (ghostTick < 0) return null
    const idx = ghostTick / SAMPLE
    const i0 = Math.floor(idx)
    const n = this.data.samples.length / 2
    if (i0 >= n - 1) {
      return { x: this.data.samples[(n - 1) * 2], y: this.data.samples[(n - 1) * 2 + 1] }
    }
    const t = idx - i0
    const x = this.data.samples[i0 * 2] * (1 - t) + this.data.samples[(i0 + 1) * 2] * t
    const y = this.data.samples[i0 * 2 + 1] * (1 - t) + this.data.samples[(i0 + 1) * 2 + 1] * t
    return { x, y }
  }
}

/** Race times (ms from the ghost's start-line crossing) at given x positions. */
export function ghostTimesAt(g: GhostData, xs: number[]): (number | null)[] {
  const n = g.samples.length / 2
  return xs.map((target) => {
    for (let i = 1; i < n; i++) {
      const x0 = g.samples[(i - 1) * 2]
      const x1 = g.samples[i * 2]
      if (x0 < target && x1 >= target) {
        const f = (target - x0) / Math.max(1e-6, x1 - x0)
        const tick = (i - 1 + f) * SAMPLE
        return ((tick - g.startTick) / TICK_RATE) * 1000
      }
    }
    return null
  })
}

// ---------------------------------------------------------------- storage

const keyPB = (seed: string) => `sundive:pb:${seed}`
const keyGhost = (seed: string) => `sundive:ghost:${seed}`

export function loadPB(seed: string): number | null {
  try {
    const v = localStorage.getItem(keyPB(seed))
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function savePB(seed: string, timeMs: number): void {
  try {
    localStorage.setItem(keyPB(seed), String(timeMs))
  } catch {
    /* storage unavailable — run still works */
  }
}

export function saveGhost(g: GhostData): void {
  try {
    const bytes = new Uint8Array(g.samples.buffer.slice(0))
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const payload = JSON.stringify({
      t: g.timeMs,
      st: g.startTick,
      d: btoa(bin),
    })
    localStorage.setItem(keyGhost(g.seed), payload)
  } catch {
    /* ignore */
  }
}

export function loadGhost(seed: string): GhostData | null {
  try {
    const raw = localStorage.getItem(keyGhost(seed))
    if (!raw) return null
    const p = JSON.parse(raw) as { t: number; st: number; d: string }
    const bin = atob(p.d)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { seed, timeMs: p.t, startTick: p.st, samples: new Float32Array(bytes.buffer), source: 'pb' }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- synthetic

/**
 * Simulate a "confident novice" bot over this terrain to produce the first-run
 * rival ghost. Deterministic per seed. Runs in a few ms (headless ticks).
 */
export function makeSyntheticGhost(terrain: Terrain, seed: string): GhostData {
  const rnd = mulberry32(hashStr(`bot:${seed}`))
  const sim = new CometSim(terrain, INTRO_X + 4)
  const bot = makeBot(terrain, rnd, 0.75) // sloppiness: beatable but honest
  const rec: number[] = []
  const maxTicks = TICK_RATE * 180
  // keep sampling ~40 m past the finish so the stream provably crosses the line
  while (sim.state.tick < maxTicks && sim.state.x < terrain.length + 40) {
    const held = bot(sim.state)
    if (sim.state.tick % SAMPLE === 0) rec.push(sim.state.x, sim.state.y)
    sim.step(held)
  }
  return {
    seed,
    timeMs: sim.timeMs(),
    startTick: sim.state.startTick,
    samples: new Float32Array(rec),
    source: 'synthetic',
  }
}
