import { hashStr, mulberry32 } from './rng'
import type { Terrain } from './terrain'

// Course props laid over the terrain from the seed: ground hazards to hop, and
// airborne boost motes to catch. Deterministic per (seed, level).

export interface Obstacle {
  x: number
  y: number // terrain height at x
  hit: boolean
}

export interface Bonus {
  x: number
  y: number // above the ground — catch it in flight
  taken: boolean
}

export interface Course {
  obstacles: Obstacle[]
  bonuses: Bonus[]
}

export function buildCourse(terrain: Terrain, seed: string, level: number, obstacleCount: number, bonusCount: number): Course {
  const rnd = mulberry32(hashStr(`course:${seed}:${level}`))
  const L = terrain.length
  const obstacles: Obstacle[] = []
  const bonuses: Bonus[] = []

  // hazards: prefer flat-ish spots (crests/ramps), never in the first 220 m
  let tries = 0
  while (obstacles.length < obstacleCount && tries < obstacleCount * 40) {
    tries++
    const x = 220 + rnd() * (L - 340)
    if (Math.abs(terrain.slopeAt(x)) > 0.35) continue // avoid steep dive faces
    if (obstacles.some((o) => Math.abs(o.x - x) < 130)) continue
    obstacles.push({ x, y: terrain.heightAt(x), hit: false })
  }

  // bonuses: floating above valleys/crests, reachable by a jump or launch arc
  let bt = 0
  while (bonuses.length < bonusCount && bt < bonusCount * 40) {
    bt++
    const x = 160 + rnd() * (L - 260)
    if (bonuses.some((b) => Math.abs(b.x - x) < 120)) continue
    const above = 7 + rnd() * 9
    bonuses.push({ x, y: terrain.heightAt(x) + above, taken: false })
  }
  obstacles.sort((a, b) => a.x - b.x)
  bonuses.sort((a, b) => a.x - b.x)
  return { obstacles, bonuses }
}
