import type { Terrain } from './terrain'

// Deterministic fixed-timestep comet simulation.
//
// The whole model is ballistic integration + project-and-slide collision:
//   - gravity always pulls down; HOLDING adds a big extra downward pull (dive)
//   - when the ballistic path meets the terrain, velocity is projected onto the
//     slope tangent (repeated projection = natural downhill acceleration)
//   - released over a crest, the ballistic path leaves the ground = launch
// Everything the game feels — dives, launches, slams, carves — emerges from
// those three rules plus tuning constants below.

export const TICK_RATE = 120
export const DT = 1 / TICK_RATE

// tuning — the game feel lives here
const G = 34 // base gravity, m/s^2
const DIVE = 78 // extra gravity while holding
const CARVE = 26 // extra tangential accel while holding on a descent (speed compounds here)
const SOFT_CAP = 88 // m/s — drag eats the excess above this
const CAP_DRAG = 1.6
const MIN_VX = 10 // gentle forward push so you never stall
const ROLL_DRAG = 0.0028
const SLAM_VN = 17 // normal-impact speed that counts as a slam
const SLAM_MAX_LOSS = 0.35
const PERFECT_BOOST = 1.06
// a perfect launch = a committed dive, then a clean 14–35° takeoff off the crest
const PERFECT_MIN_HELD = 12 // ticks of dive before the release
const PERFECT_RELEASE_WINDOW = 150 // released within ~1.2 s before takeoff
const PERFECT_ANGLE_MIN = 0.24 // vy/speed at takeoff
const PERFECT_ANGLE_MAX = 0.6
// arcade mechanics
const JUMP_IMPULSE = 13 // Space — a hop off the ground
const BOOST_ACCEL = 62 // Enter/Shift — nitro shove
const BOOST_CAP = 120 // raised soft cap while boosting
const BOOST_TIME = 1.15 // seconds of thrust per charge
const STUN_DRAG = 0.955 // per-tick velocity decay while stunned

export type SimEventType =
  | 'launch'
  | 'perfect'
  | 'slam'
  | 'land'
  | 'start'
  | 'checkpoint'
  | 'finish'
  | 'jump'
  | 'boost'
export interface SimEvent {
  type: SimEventType
  x: number
  y: number
  intensity?: number
  checkpointIndex?: number
}

export interface SimState {
  x: number
  y: number
  vx: number
  vy: number
  grounded: boolean
  tick: number
  startTick: number // fractional tick when the start line was crossed
  finishTick: number // fractional tick at the finish line (-1 until crossed)
  finished: boolean
  boostT: number // seconds of boost thrust remaining
  stunT: number // seconds of stun remaining
}

export interface Telemetry {
  topSpeed: number
  slams: number
  launches: number
  perfects: number
}

export class CometSim {
  readonly state: SimState
  readonly events: SimEvent[] = []
  readonly telemetry: Telemetry = { topSpeed: 0, slams: 0, launches: 0, perfects: 0 }
  private terrain: Terrain
  private heldTicks = 0
  private releasedAt = -999
  private heldBeforeRelease = 0
  private wasGrounded = false
  private nextCheckpoint = 0
  private jumpBuffer = 0
  private wasBoosting = false

  constructor(terrain: Terrain, spawnX: number) {
    this.terrain = terrain
    this.state = {
      x: spawnX,
      y: terrain.heightAt(spawnX) + 0.5,
      vx: 16,
      vy: 0,
      grounded: false,
      tick: 0,
      startTick: -1,
      finishTick: -1,
      finished: false,
      boostT: 0,
      stunT: 0,
    }
  }

  /** Queue a hop; consumed next time the comet is grounded (short input buffer). */
  requestJump(): void {
    this.jumpBuffer = 10
  }

  /** Fire nitro thrust for BOOST_TIME seconds (ignored while stunned). */
  fireBoost(): void {
    if (this.state.stunT <= 0) this.state.boostT = BOOST_TIME
  }

  stun(seconds: number): void {
    this.state.stunT = Math.max(this.state.stunT, seconds)
    this.state.boostT = 0
  }

  get boosting(): boolean {
    return this.state.boostT > 0
  }
  get stunned(): boolean {
    return this.state.stunT > 0
  }

  /** Advance one fixed tick. `held` is the single input. Returns events fired this tick. */
  step(held: boolean): SimEvent[] {
    this.events.length = 0
    const s = this.state
    const t = this.terrain

    if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - DT)
    if (s.stunT > 0) s.stunT = Math.max(0, s.stunT - DT)
    const stunned = s.stunT > 0
    const boosting = s.boostT > 0
    if (boosting && !this.wasBoosting) this.events.push({ type: 'boost', x: s.x, y: s.y })
    this.wasBoosting = boosting
    if (this.jumpBuffer > 0) this.jumpBuffer--
    held = held && !stunned // no diving while stunned

    if (held) {
      if (this.heldTicks === 0) this.heldBeforeRelease = 0
      this.heldTicks++
    } else {
      if (this.heldTicks > 0) {
        this.releasedAt = s.tick
        this.heldBeforeRelease = this.heldTicks
      }
      this.heldTicks = 0
    }

    const accel = G + (held ? DIVE : 0)
    s.vy -= accel * DT

    // nitro: shove forward + along the current heading
    if (boosting) {
      const sp = Math.hypot(s.vx, s.vy) || 1
      s.vx += (s.vx / sp) * BOOST_ACCEL * DT + BOOST_ACCEL * 0.45 * DT
      s.vy += (s.vy / sp) * BOOST_ACCEL * DT
    }

    const prevX = s.x
    s.x += s.vx * DT
    s.y += s.vy * DT

    const h = t.heightAt(s.x)
    let groundedNow = false
    if (s.y <= h) {
      // --- contact: project velocity onto the slope tangent
      const slope = t.slopeAt(s.x)
      const invLen = 1 / Math.sqrt(1 + slope * slope)
      const tx = invLen
      const ty = slope * invLen
      const nx = -ty
      const ny = tx
      const vt = s.vx * tx + s.vy * ty
      const vn = s.vx * nx + s.vy * ny

      if (vn < -SLAM_VN && Math.abs(vn) > 0.55 * Math.max(Math.abs(vt), 1) && !this.wasGrounded) {
        const loss = Math.min(SLAM_MAX_LOSS, (Math.abs(vn) - SLAM_VN) / 95)
        const newVt = vt * (1 - loss)
        s.vx = newVt * tx
        s.vy = newVt * ty
        this.telemetry.slams++
        this.events.push({ type: 'slam', x: s.x, y: h, intensity: Math.min(1, loss / SLAM_MAX_LOSS) })
      } else {
        s.vx = vt * tx
        s.vy = vt * ty
        if (!this.wasGrounded) this.events.push({ type: 'land', x: s.x, y: h, intensity: Math.min(1, Math.abs(vn) / SLAM_VN) })
      }
      s.y = h
      groundedNow = true

      // carve: holding through a descent digs the comet in and compounds speed
      if (held && slope < -0.02) {
        const dig = Math.min(1, -slope * 2.2)
        s.vx += tx * CARVE * dig * DT
        s.vy += ty * CARVE * dig * DT
      }

      // rolling drag + never-stall push
      const sp = Math.hypot(s.vx, s.vy)
      if (sp > 0.01) {
        const drag = 1 - ROLL_DRAG
        s.vx *= drag
        s.vy *= drag
      }
      if (stunned) {
        s.vx *= STUN_DRAG
        s.vy *= STUN_DRAG
      } else if (s.vx < MIN_VX && s.x < t.length) {
        s.vx += (MIN_VX - s.vx) * DT * 4
      }
    } else if (this.wasGrounded && !held) {
      // --- takeoff
      this.telemetry.launches++
      const sinceRelease = s.tick - this.releasedAt
      const takeoffSpeed = Math.hypot(s.vx, s.vy)
      const angle = takeoffSpeed > 1 ? s.vy / takeoffSpeed : 0
      if (
        angle >= PERFECT_ANGLE_MIN &&
        angle <= PERFECT_ANGLE_MAX &&
        takeoffSpeed > 24 &&
        sinceRelease >= 0 &&
        sinceRelease <= PERFECT_RELEASE_WINDOW &&
        this.heldBeforeRelease >= PERFECT_MIN_HELD
      ) {
        s.vx *= PERFECT_BOOST
        s.vy *= PERFECT_BOOST
        this.telemetry.perfects++
        this.events.push({ type: 'perfect', x: s.x, y: s.y, intensity: 1 })
      } else {
        this.events.push({ type: 'launch', x: s.x, y: s.y, intensity: Math.min(1, s.vy / 20) })
      }
    }

    // hop off the ground (buffered a few ticks so an early press still fires)
    if (this.jumpBuffer > 0 && groundedNow && !stunned) {
      s.vy = Math.max(0, s.vy) + JUMP_IMPULSE
      s.y += 0.05
      groundedNow = false
      this.jumpBuffer = 0
      this.events.push({ type: 'jump', x: s.x, y: s.y })
    }

    // soft speed cap (raised while boosting)
    const cap = boosting ? BOOST_CAP : SOFT_CAP
    const speed = Math.hypot(s.vx, s.vy)
    if (speed > cap) {
      const k = 1 - Math.min(0.9, ((speed - cap) / cap) * CAP_DRAG * DT * 60) * DT * 8
      s.vx *= k
      s.vy *= k
    }
    if (speed > this.telemetry.topSpeed) this.telemetry.topSpeed = speed

    // post-finish auto-brake in the runout
    if (s.finishTick >= 0 && groundedNow) {
      s.vx *= 1 - DT * 1.4
      s.vy *= 1 - DT * 1.4
    }

    // line crossings (interpolated for fair timing)
    if (s.startTick < 0 && prevX < 0 && s.x >= 0) {
      const f = (0 - prevX) / (s.x - prevX)
      s.startTick = s.tick + f
      this.events.push({ type: 'start', x: 0, y: s.y })
    }
    if (this.nextCheckpoint < t.checkpoints.length && s.x >= t.checkpoints[this.nextCheckpoint]) {
      this.events.push({ type: 'checkpoint', x: s.x, y: s.y, checkpointIndex: this.nextCheckpoint })
      this.nextCheckpoint++
    }
    if (s.finishTick < 0 && prevX < t.length && s.x >= t.length) {
      const f = (t.length - prevX) / (s.x - prevX)
      s.finishTick = s.tick + f
      s.finished = true
      this.events.push({ type: 'finish', x: t.length, y: s.y })
    }

    s.grounded = groundedNow
    this.wasGrounded = groundedNow
    s.tick++
    return this.events
  }

  /** Race time in ms (start line -> now/finish), tick-exact. */
  timeMs(): number {
    const s = this.state
    if (s.startTick < 0) return 0
    const end = s.finishTick >= 0 ? s.finishTick : s.tick
    return ((end - s.startTick) / TICK_RATE) * 1000
  }

  speed(): number {
    return Math.hypot(this.state.vx, this.state.vy)
  }
}

/**
 * Bot input policy — used for the synthetic first-run ghost and QA autopilot.
 * Reads the world exactly like a player: hold through descents and valleys,
 * release just before the crest. `sloppiness` adds human-like reaction delay.
 */
export function makeBot(terrain: Terrain, rnd: () => number, sloppiness: number) {
  let decision = false
  let delay = 0
  let sinceDecision = 999
  return (s: SimState): boolean => {
    sinceDecision++
    const every = 3 + Math.floor(sloppiness * 7)
    if (sinceDecision >= every) {
      sinceDecision = 0
      const lookahead = Math.max(5, s.vx * 0.1)
      const slopeAhead = terrain.slopeAt(s.x + lookahead)
      let want: boolean
      if (!s.grounded) {
        // in the air: once falling, dive down onto the next descent
        want = s.vy < 1 && slopeAhead < 0.02
      } else {
        // on the ground: grip through descent + valley, release just before the crest
        want = slopeAhead < -0.03
      }
      if (want !== decision) {
        delay = Math.floor(rnd() * sloppiness * 12)
        decision = want
      }
    }
    if (delay > 0) {
      delay--
      return !decision // still reacting: previous action
    }
    return decision
  }
}
