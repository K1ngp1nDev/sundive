import { hashStr, mulberry32 } from './rng'

// A descending canyon: alternating crests and valleys with growing amplitude,
// cosine-eased between control points (smooth zero-slope extremes = clean
// launch ramps). Presampled to a 1 m grid so physics lookups are O(1) and
// bit-identical for a given seed.

export const INTRO_X = -160 // comet spawns here, rolling start
export const RUN_LENGTH = 2100 // default start line (x=0) to finish line
export const RUNOUT = 420 // flat braking zone after the finish

export interface TerrainOpts {
  length?: number // finish distance
  ampScale?: number // valley depth multiplier (difficulty)
}

export interface Terrain {
  seed: string
  length: number
  totalLength: number
  checkpoints: number[]
  heightAt(x: number): number
  slopeAt(x: number): number
  minH: number
  maxH: number
}

export function buildTerrain(seedStr: string, opts: TerrainOpts = {}): Terrain {
  const RUN = opts.length ?? RUN_LENGTH
  const ampScale = opts.ampScale ?? 1
  const rnd = mulberry32(hashStr(`terrain:${seedStr}`))

  // control points (x, h), starting high on the intro ramp
  const pts: [number, number][] = []
  pts.push([INTRO_X, 64])
  pts.push([INTRO_X + 70, 40])
  let h = 10
  pts.push([-14, h]) // first crest just before the start line

  let x = -14
  let crest = h
  while (x < RUN + RUNOUT) {
    const progress = Math.min(1, Math.max(0, x / RUN))
    const amp = (14 + rnd() * 11) * (1 + progress * 0.8) * ampScale // deep, readable valleys
    const downDx = 36 + rnd() * 42 // dive slope
    const upDx = 46 + rnd() * 52 // launch ramp
    const netDrop = 7 + rnd() * 12 // canyon keeps descending

    const valley = crest - amp
    x += downDx
    pts.push([x, valley])
    crest = crest - netDrop
    x += upDx
    pts.push([x, crest])

    if (x > RUN) {
      // runout: gentle rise then flat to bleed speed
      pts.push([x + 90, crest + 14])
      pts.push([x + 240, crest + 20])
      pts.push([x + 1200, crest + 22])
      break
    }
  }

  // cosine interpolation between control points, presampled at 1 m
  const x0 = INTRO_X
  const x1 = pts[pts.length - 1][0]
  const n = Math.ceil(x1 - x0) + 2
  const heights = new Float32Array(n)
  let seg = 0
  let minH = Infinity
  let maxH = -Infinity
  for (let i = 0; i < n; i++) {
    const xx = x0 + i
    while (seg < pts.length - 2 && xx > pts[seg + 1][0]) seg++
    const [ax, ay] = pts[seg]
    const [bx, by] = pts[seg + 1]
    const t = Math.min(1, Math.max(0, (xx - ax) / Math.max(1e-6, bx - ax)))
    const k = (1 - Math.cos(t * Math.PI)) / 2
    const hh = ay + (by - ay) * k
    heights[i] = hh
    if (hh < minH) minH = hh
    if (hh > maxH) maxH = hh
  }

  const heightAt = (xx: number): number => {
    const f = xx - x0
    if (f <= 0) return heights[0]
    if (f >= n - 2) return heights[n - 2]
    const i = Math.floor(f)
    const t = f - i
    return heights[i] * (1 - t) + heights[i + 1] * t
  }
  const slopeAt = (xx: number): number => (heightAt(xx + 0.5) - heightAt(xx - 0.5)) / 1

  return {
    seed: seedStr,
    length: RUN,
    totalLength: x1,
    checkpoints: [RUN * 0.25, RUN * 0.5, RUN * 0.75],
    heightAt,
    slopeAt,
    minH,
    maxH,
  }
}
