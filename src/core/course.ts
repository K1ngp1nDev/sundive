import { hashStr, mulberry32 } from './rng'
import type { Terrain } from './terrain'
import type { LevelDef } from './levels'

// Course props laid over the terrain from the seed. Deterministic per (seed, level):
//   - obstacles: small vents (a clip staggers you) and boulders (a hard hit — jump them)
//   - pits: gaps in the ground — clear them airborne or fall in and respawn just before
//   - pads: trampolines — bounce high off them
//   - bonuses: airborne boost motes to catch in flight

export type ObstacleKind = 'vent' | 'rock'

export interface Obstacle {
  x: number
  y: number // terrain height at x
  kind: ObstacleKind
  hit: boolean
}

export interface Pit {
  x0: number
  x1: number
  y: number // surface height (for rendering the chasm mouth)
}

export interface Pad {
  x: number
  y: number // terrain height at x
}

export interface Bonus {
  x: number
  y: number // above the ground — catch it in flight
  taken: boolean
}

export interface Course {
  obstacles: Obstacle[]
  pits: Pit[]
  pads: Pad[]
  bonuses: Bonus[]
}

export function buildCourse(terrain: Terrain, seed: string, level: number, def: LevelDef): Course {
  const rnd = mulberry32(hashStr(`course:${seed}:${level}`))
  const L = terrain.length
  const obstacles: Obstacle[] = []
  const pits: Pit[] = []
  const pads: Pad[] = []
  const bonuses: Bonus[] = []

  // ground features share the same lane, so keep them well apart from each other
  const spots: { x: number; span: number }[] = []
  const free = (x: number, span: number): boolean => !spots.some((s) => Math.abs(s.x - x) < (s.span + span) / 2 + 40)
  const claim = (x: number, span: number): void => { spots.push({ x, span }) }

  const place = (span: number, marginStart: number, slopeMax: number, tries: number): number | null => {
    for (let i = 0; i < tries; i++) {
      const x = marginStart + rnd() * (L - marginStart - 260)
      if (Math.abs(terrain.slopeAt(x)) > slopeMax) continue
      if (!free(x, span)) continue
      claim(x, span)
      return x
    }
    return null
  }

  // pits first (biggest footprint), on flat-ish ground, never near the start/finish
  for (let i = 0; i < def.pits; i++) {
    const w = 15 + rnd() * 8
    const x = place(w, 360, 0.22, 60)
    if (x === null) continue
    pits.push({ x0: x - w / 2, x1: x + w / 2, y: terrain.heightAt(x) })
  }

  // trampolines on flat-ish ground
  for (let i = 0; i < def.pads; i++) {
    const x = place(6, 260, 0.3, 50)
    if (x === null) continue
    pads.push({ x, y: terrain.heightAt(x) })
  }

  // boulders (rocks) — hard hazards to jump, on flat-ish ground
  for (let i = 0; i < def.rocks; i++) {
    const x = place(6, 300, 0.32, 50)
    if (x === null) continue
    obstacles.push({ x, y: terrain.heightAt(x), kind: 'rock', hit: false })
  }

  // small vents — minor clip hazards
  for (let i = 0; i < def.obstacles; i++) {
    const x = place(5, 220, 0.35, 50)
    if (x === null) continue
    obstacles.push({ x, y: terrain.heightAt(x), kind: 'vent', hit: false })
  }

  // bonuses: floating above the canyon, reachable by a jump or launch arc
  let bt = 0
  while (bonuses.length < def.bonuses && bt < def.bonuses * 40) {
    bt++
    const x = 160 + rnd() * (L - 260)
    if (bonuses.some((b) => Math.abs(b.x - x) < 120)) continue
    const above = 8 + rnd() * 10
    bonuses.push({ x, y: terrain.heightAt(x) + above, taken: false })
  }

  obstacles.sort((a, b) => a.x - b.x)
  pits.sort((a, b) => a.x0 - b.x0)
  pads.sort((a, b) => a.x - b.x)
  bonuses.sort((a, b) => a.x - b.x)
  return { obstacles, pits, pads, bonuses }
}
