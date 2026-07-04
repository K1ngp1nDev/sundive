import { CometSim, makeBot } from './sim'
import type { Terrain } from './terrain'
import { INTRO_X } from './terrain'
import { hashStr, mulberry32 } from './rng'
import type { Course } from './course'
import { levelDef, RIVAL_COLORS, RIVAL_NAMES } from './levels'

export interface Racer {
  sim: CometSim
  color: number
  name: string
  isPlayer: boolean
  place: number | null
  bot: ((s: import('./sim').SimState) => boolean) | null
  boostCd: number
  jumpedAt: number
  lastHit: number // tick of last obstacle hit (per-racer cooldown)
  lastObstacleX: number // x of the last obstacle hit — an obstacle can only hit a racer once
  finishOrder: number // 0 = unfinished; else 1-based finish rank
}

export interface Field {
  player: Racer
  opponents: Racer[]
  all: Racer[]
}

export function makeField(terrain: Terrain, seed: string, level: number): Field {
  const def = levelDef(level)
  const rnd = mulberry32(hashStr(`field:${seed}:${level}`))
  const player: Racer = {
    sim: new CometSim(terrain, INTRO_X + 4),
    color: 0xffd27a,
    name: 'You',
    isPlayer: true,
    place: null,
    // only used in attract / QA autopilot; live play uses real input
    bot: makeBot(terrain, mulberry32(hashStr(`botplayer:${seed}:${level}`)), 0.5),
    boostCd: 0,
    jumpedAt: -999,
    lastHit: -999,
    lastObstacleX: -Infinity,
    finishOrder: 0,
  }
  const opponents: Racer[] = []
  for (let i = 0; i < def.opponents; i++) {
    const slop = def.oppSloppy[0] + rnd() * (def.oppSloppy[1] - def.oppSloppy[0])
    // slight stagger so rivals don't perfectly overlap at the gate
    const sim = new CometSim(terrain, INTRO_X + 4 - i * 3)
    opponents.push({
      sim,
      color: RIVAL_COLORS[i % RIVAL_COLORS.length],
      name: RIVAL_NAMES[i % RIVAL_NAMES.length],
      isPlayer: false,
      place: null,
      bot: makeBot(terrain, mulberry32(hashStr(`bot:${seed}:${level}:${i}`)), slop),
      boostCd: 1 + rnd() * 3,
      jumpedAt: -999,
      lastHit: -999,
      lastObstacleX: -Infinity,
      finishOrder: 0,
    })
  }
  return { player, opponents, all: [player, ...opponents] }
}

/** Opponent per-tick brain: dive policy + occasional nitro + hop over hazards. */
export function opponentTick(r: Racer, terrain: Terrain, course: Course, dt: number): boolean {
  const s = r.sim.state
  const held = r.bot ? r.bot(s) : false

  // nitro on a sustained descent, on a cooldown
  r.boostCd -= dt
  if (r.boostCd <= 0 && !r.sim.boosting && !r.sim.stunned && s.startTick >= 0 && s.finishTick < 0) {
    if (terrain.slopeAt(s.x + 6) < -0.12 && s.grounded) {
      r.sim.fireBoost()
      r.boostCd = 3.5 + Math.random() * 2.5
    }
  }

  // hop over an imminent hazard
  if (s.grounded && s.tick - r.jumpedAt > 30) {
    const lead = Math.max(6, r.sim.speed() * 0.22)
    for (const o of course.obstacles) {
      if (o.x > s.x + 1 && o.x < s.x + lead) {
        r.sim.requestJump()
        r.jumpedAt = s.tick
        break
      }
    }
  }
  return held
}
