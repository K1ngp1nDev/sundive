import { Application } from 'pixi.js'
import './ui/styles.css'
import { dailySeedString, randomSeedString } from './core/rng'
import { fmtTime, getState, setState } from './core/state'
import { buildTerrain, Terrain } from './core/terrain'
import { DT } from './core/sim'
import { loadPB, savePB } from './core/ghost'
import { Input } from './core/input'
import { Renderer, RacerRender } from './render/renderer'
import { createHud } from './ui/hud'
import { levelDef, unlockLevel } from './core/levels'
import { buildCourse, Course } from './core/course'
import { Field, makeField, opponentTick, Racer } from './core/racers'
import {
  playBonus,
  playBoost,
  playCheckpoint,
  playFinish,
  playJump,
  playLaunch,
  playObstacle,
  playPerfect,
  playStunHit,
  unlockAudio,
  updateAudio,
} from './core/audio'

const params = new URLSearchParams(location.search)
const qaMode = params.get('qa') === '1'
const forceReduce = params.get('reduce') === '1'
const dateOverride = params.get('date') ?? undefined
const seedParam = params.get('seed')
const levelParam = Math.max(1, Math.min(5, Number(params.get('level') || '1')))
const dailyParam = params.get('mode') !== 'free'

const reducedMotion = forceReduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches
setState({ reducedMotion })
if (reducedMotion) document.body.classList.add('reduce-motion')

const BOOST_REFILL_PER_S = 0.2 // ~5 s to a full nitro charge
const BONUS_BOOST = 0.6
const STUN_LAND_BOOST = 0.5

class Game {
  terrain!: Terrain
  course!: Course
  field!: Field
  level = 1
  daily = true
  seed = ''
  private accumulator = 0
  private timeScale = 1
  private hitstop = 0
  private slowmoHold = 0
  simSpeed = 1
  autopilot = false
  private taught = ((): boolean => { try { return localStorage.getItem('sundive:taught') === '1' } catch { return false } })()
  private goodLaunches = 0
  private attractTimer = 0
  private bounceCd = 0
  private aheadCount: number | null = null
  private overtakeAt = -999

  constructor(private renderer: Renderer, private input: Input) {}

  private pbKey(): string {
    return `${this.seed}:L${this.level}`
  }

  setLevel(level: number, daily: boolean, seed?: string): void {
    this.level = level
    this.daily = daily
    const def = levelDef(level)
    this.seed = daily ? dailySeedString(dateOverride) : (seed ?? randomSeedString())
    const worldSeed = `${this.seed}:L${level}`
    this.terrain = buildTerrain(worldSeed, { length: def.length, ampScale: def.ampScale })
    this.course = buildCourse(this.terrain, this.seed, level, def.obstacles, def.bonuses)
    this.renderer.init(this.terrain)
    this.renderer.setCourse(this.course)
    this.field = makeField(this.terrain, this.seed, level)
    this.renderer.setRacers(this.field.all.map((r) => ({ color: r.color, isPlayer: r.isPlayer })))
    setState({
      level,
      daily,
      seed: this.seed,
      levelName: def.name,
      racerCount: this.field.all.length,
      pbMs: loadPB(this.pbKey()),
    })
    this.reset('attract')
  }

  reset(phase: 'attract' | 'running'): void {
    this.field = makeField(this.terrain, this.seed, this.level)
    this.renderer.setRacers(this.field.all.map((r) => ({ color: r.color, isPlayer: r.isPlayer })))
    for (const o of this.course.obstacles) o.hit = false
    for (const b of this.course.bonuses) b.taken = false
    this.accumulator = 0
    this.timeScale = 1
    this.hitstop = 0
    this.slowmoHold = 0
    this.attractTimer = 0
    this.aheadCount = null
    this.renderer.clearTrails()
    setState({ phase, timeMs: 0, boost: 1, boostReady: true, place: null, gapMs: null, newBest: false, won: false })
  }

  private markTaught(): void {
    if (this.taught) return
    this.taught = true
    try { localStorage.setItem('sundive:taught', '1') } catch { /* ignore */ }
    hud.setCoach(null)
  }

  get player(): Racer { return this.field.player }

  begin(): void {
    if (getState().phase !== 'attract') return
    if (this.player.sim.state.x < -6) setState({ phase: 'running' })
    else this.reset('running')
  }
  restart(): void { this.reset('running') }
  nextLevel(): void { this.setLevel(Math.min(5, this.level + 1), this.daily); this.begin() }

  playerJump(): void {
    if (getState().phase !== 'running') return
    this.player.sim.requestJump()
    playJump()
  }
  playerBoost(): void {
    const st = getState()
    if (st.phase !== 'running' || !st.boostReady) return
    setState({ boost: 0, boostReady: false })
    this.player.sim.fireBoost()
    this.renderer.pop()
    this.renderer.addTrauma(0.15)
    playBoost()
    this.markTaught()
  }

  setBotSloppiness(): void { /* levels own opponent skill now */ }

  private onPlayerEvents(events: import('./core/sim').SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'perfect':
          this.renderer.burst(ev.x, ev.y, 'perfect', 16)
          this.renderer.addTrauma(0.18)
          this.renderer.flashScreen(0xffd27a, 0.1)
          hud.toast('Perfect launch')
          playPerfect()
          this.markTaught()
          break
        case 'launch':
          if ((ev.intensity ?? 0) > 0.25) { playLaunch(); if (++this.goodLaunches >= 2) this.markTaught() }
          break
        case 'jump':
          this.renderer.burst(ev.x, ev.y, 'dive', 4)
          break
        case 'boost':
          this.renderer.flashScreen(0xffe9b8, 0.12)
          break
        case 'slam': {
          const k = ev.intensity ?? 0.5
          this.renderer.burst(ev.x, ev.y, 'slam', Math.round(8 + k * 14))
          this.renderer.addTrauma(0.25 + k * 0.4)
          this.renderer.flashScreen(0xff5a3c, 0.1 + k * 0.12)
          if (!getState().reducedMotion) this.hitstop = 0.05 + k * 0.05
          playObstacle()
          break
        }
        case 'checkpoint':
          break
        case 'finish':
          this.onFinish()
          break
        case 'start':
          this.aheadCount = null
          hud.banner('Beat them to the finish', 'gold', 2000)
          break
      }
    }
  }

  private interactions(): void {
    const p = this.player.sim.state
    if (p.startTick < 0 || p.finishTick >= 0) return

    // obstacles (all racers, per-racer cooldown)
    for (const r of this.field.all) {
      const s = r.sim.state
      if (s.finishTick >= 0) continue
      const gy = this.terrain.heightAt(s.x)
      const nearGround = s.y - gy < 2.6
      if (!nearGround || s.tick - r.lastHit < 40) continue
      for (const o of this.course.obstacles) {
        if (Math.abs(o.x - s.x) < 2.2) {
          r.lastHit = s.tick
          s.vx *= 0.5
          s.vy *= 0.5
          r.sim.stun(0.35)
          if (r.isPlayer) {
            this.renderer.burst(o.x, o.y + 2, 'slam', 10)
            this.renderer.addTrauma(0.3)
            this.renderer.flashScreen(0xff5a3c, 0.14)
            playObstacle()
            hud.toast('Crash!', 'bad')
          }
          break
        }
      }
    }

    // bonuses (player only)
    for (const b of this.course.bonuses) {
      if (b.taken) continue
      if (Math.hypot(b.x - p.x, b.y - p.y) < 2.8) {
        b.taken = true
        this.renderer.burst(b.x, b.y, 'bonus', 12)
        this.addBoost(BONUS_BOOST)
        playBonus()
      }
    }

    // stun-land: player descending onto a rival from above
    this.bounceCd -= DT
    if (p.vy < -2 && this.bounceCd <= 0) {
      for (const opp of this.field.opponents) {
        const os = opp.sim.state
        if (os.stunT > 0 || os.finishTick >= 0) continue
        if (Math.abs(os.x - p.x) < 2.4 && p.y - os.y > 0 && p.y - os.y < 3.6) {
          opp.sim.stun(2)
          p.vy = 9
          this.bounceCd = 0.5
          this.addBoost(STUN_LAND_BOOST)
          this.renderer.burst(os.x, os.y, 'stun', 16, opp.color)
          this.renderer.addTrauma(0.25)
          playStunHit()
          hud.toast(`Stunned ${opp.name}!`, 'gold')
          break
        }
      }
    }
  }

  private addBoost(n: number): void {
    const st = getState()
    const b = Math.min(1, st.boost + n)
    setState({ boost: b, boostReady: b >= 1 })
  }

  private livePlace(): number {
    const px = this.player.sim.state.x
    let ahead = 0
    for (const opp of this.field.opponents) {
      const os = opp.sim.state
      if (os.finishTick >= 0 || os.x > px) ahead++
    }
    return ahead + 1
  }

  private onFinish(): void {
    const ms = this.player.sim.timeMs()
    // placement = 1 + rivals that already finished before the player
    let ahead = 0
    for (const opp of this.field.opponents) if (opp.sim.state.finishTick >= 0) ahead++
    const place = ahead + 1
    const won = place === 1
    const prevPB = loadPB(this.pbKey())
    const newBest = prevPB === null || ms < prevPB
    if (newBest) savePB(this.pbKey(), ms)
    if (won) unlockLevel(this.level + 1)
    setState({ phase: 'finished', lastMs: ms, pbMs: newBest ? ms : prevPB, newBest, place, won, timeMs: ms })
    if (!getState().reducedMotion) { this.timeScale = 0.22; this.slowmoHold = 0.9 }
    hud.banner(won ? 'You win!' : `${place}${place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} place`, won ? 'gold' : 'ice', 1600)
    this.renderer.flashScreen(won ? 0xffd27a : 0x9fd8e8, 0.16)
    this.renderer.addTrauma(0.2)
    playFinish(won || newBest)
    hud.showFinish()
  }

  frame(rawDt: number): void {
    const st = getState()
    if (this.hitstop > 0) { this.hitstop -= rawDt; this.timeScale = 0.05 }
    else if (this.slowmoHold > 0) this.slowmoHold -= rawDt
    else this.timeScale += (1 - this.timeScale) * Math.min(1, rawDt * 5)

    const simDt = Math.min(rawDt, 0.05) * this.timeScale * this.simSpeed
    this.accumulator += simDt
    let steps = 0
    const maxSteps = this.simSpeed > 1 ? 2000 : 6
    while (this.accumulator >= DT && steps < maxSteps) {
      this.accumulator -= DT
      steps++

      // opponents
      for (const opp of this.field.opponents) {
        const held = opponentTick(opp, this.terrain, this.course, DT)
        opp.sim.step(held)
      }
      // player
      let held: boolean
      if (this.autopilot) held = opponentTick(this.player, this.terrain, this.course, DT)
      else if (st.phase === 'attract') { held = opponentTick(this.player, this.terrain, this.course, DT); this.attractHeld = held }
      else held = this.input.isHeld()
      const events = this.player.sim.step(held)
      if (st.phase !== 'attract') this.onPlayerEvents(events)

      if (st.phase === 'running') {
        this.interactions()
        // boost meter refill
        if (!getState().boostReady) this.addBoost(BOOST_REFILL_PER_S * DT)
      }

      if (st.phase === 'attract') {
        this.attractTimer += DT
        if (this.attractTimer > 13 || this.player.sim.state.x > this.terrain.length * 0.35) { this.reset('attract'); break }
      }
    }

    // HUD state
    if (st.phase === 'running') {
      const place = this.livePlace()
      const nearest = this.nearestGapMs()
      setState({ timeMs: this.player.sim.timeMs(), speed: this.player.sim.speed(), holding: this.input.isHeld(), place, gapMs: nearest })
      // overtake drama
      if (this.aheadCount === null) this.aheadCount = place
      else if (place !== this.aheadCount && st.timeMs - this.overtakeAt > 1400) {
        const gained = place < this.aheadCount
        this.aheadCount = place
        this.overtakeAt = st.timeMs
        hud.banner(gained ? (place === 1 ? 'Took the lead!' : 'Overtake!') : 'Passed — dive!', gained ? 'gold' : 'bad', 1000)
        playCheckpoint(gained)
      }
    } else if (st.phase === 'attract') {
      setState({ speed: this.player.sim.speed() })
    }

    this.renderAll(rawDt)
  }

  private nearestGapMs(): number | null {
    // gap to nearest rival by x, expressed as est. time (dx / speed)
    const p = this.player.sim.state
    let best: number | null = null
    for (const opp of this.field.opponents) {
      const dx = opp.sim.state.x - p.x
      const gap = dx / Math.max(12, this.player.sim.speed())
      if (best === null || Math.abs(gap) < Math.abs(best)) best = gap
    }
    return best === null ? null : best * 1000
  }

  private renderAll(rawDt: number): void {
    const st = getState()
    const states: RacerRender[] = this.field.all.map((r) => {
      const s = r.sim.state
      return {
        x: s.x, y: s.y, speed: r.sim.speed(),
        holding: r.isPlayer ? this.input.isHeld() : false,
        grounded: s.grounded, boosting: r.sim.boosting, stunned: r.sim.stunned,
        isPlayer: r.isPlayer, color: r.color,
      }
    })
    this.renderer.render(states, rawDt)
    updateAudio(this.player.sim.speed(), this.input.isHeld() && st.phase === 'running')

    // course dots
    hud.setRacerDots(
      this.field.all.map((r) => ({
        frac: Math.max(0, Math.min(1, r.sim.state.x / this.terrain.length)),
        color: r.color,
        isPlayer: r.isPlayer,
      })),
    )

    // onboarding
    const p = this.player.sim.state
    if (st.phase === 'attract') {
      hud.setDemoInput(true, this.attractHeld)
      hud.setCoach(null)
      hud.setLabels([])
    } else if (st.phase === 'running' && !this.taught) {
      hud.setDemoInput(true, this.input.isHeld())
      const slope = this.terrain.slopeAt(p.x)
      const heldNow = this.input.isHeld()
      if (p.grounded && slope < -0.04 && !heldNow && this.player.sim.speed() < 55) hud.setCoach('Hold — dive!')
      else if (p.grounded && heldNow && slope > 0.03) hud.setCoach('Release — fly!')
      else hud.setCoach(null)
      hud.setLabels(this.labelList())
    } else if (st.phase === 'running' && this.player.sim.timeMs() < 4500) {
      hud.setDemoInput(false, false)
      hud.setCoach(null)
      hud.setLabels(this.labelList())
    } else {
      hud.setDemoInput(false, false)
      hud.setCoach(null)
      hud.setLabels([])
    }
  }

  private attractHeld = false
  private labelList(): { x: number; y: number; text: string; color: number }[] {
    const out: { x: number; y: number; text: string; color: number }[] = []
    const pp = this.renderer.project(this.player.sim.state.x, this.player.sim.state.y)
    out.push({ x: pp.x, y: pp.y, text: 'YOU', color: 0xffd27a })
    // nearest rival on screen
    let nearest: Racer | null = null
    let nd = Infinity
    for (const opp of this.field.opponents) {
      const d = Math.abs(opp.sim.state.x - this.player.sim.state.x)
      if (d < nd) { nd = d; nearest = opp }
    }
    if (nearest && nd < 60) {
      const gp = this.renderer.project(nearest.sim.state.x, nearest.sim.state.y)
      out.push({ x: gp.x, y: gp.y, text: nearest.name.toUpperCase(), color: nearest.color })
    }
    return out
  }

  shareText(): string {
    const st = getState()
    const t = st.lastMs !== null ? fmtTime(st.lastMs) : '—'
    return `SUNDIVE · Lv${st.level} ${st.levelName} · ${st.place ? st.place + (st.place === 1 ? 'st' : st.place === 2 ? 'nd' : st.place === 3 ? 'rd' : 'th') : ''} · ${t}${st.won ? ' 🏆' : ''}`
  }
}

// ---------------------------------------------------------------------------

const app = new Application()
const stageEl = document.getElementById('stage')!
let hud: ReturnType<typeof createHud>

const boot = async (): Promise<void> => {
  await app.init({
    width: Math.max(2, stageEl.clientWidth),
    height: Math.max(2, stageEl.clientHeight),
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    background: '#14265c',
    preference: 'webgl',
  })
  stageEl.appendChild(app.canvas)

  const renderer = new Renderer(app)
  const input = new Input(stageEl)
  const game = new Game(renderer, input)

  hud = createHud({
    onRestart: () => game.restart(),
    onLevel: (lvl, daily) => { game.setLevel(lvl, daily); game.begin() },
    onNext: () => game.nextLevel(),
    onJump: () => game.playerJump(),
    onBoost: () => game.playerBoost(),
    shareText: () => game.shareText(),
  })

  input.onFirstInput = () => { unlockAudio(); game.begin() }
  input.onRestart = () => game.restart()
  input.onJump = () => { game.begin(); game.playerJump() }
  input.onBoost = () => { game.begin(); game.playerBoost() }

  game.setLevel(levelParam, dailyParam, seedParam ?? undefined)

  app.ticker.add((t) => game.frame(t.deltaMS / 1000))
  window.addEventListener('resize', () => {
    app.renderer.resize(Math.max(2, stageEl.clientWidth), Math.max(2, stageEl.clientHeight))
    renderer.resize()
  })

  document.getElementById('veil')?.classList.add('gone')
  setState({ ready: true })

  const api = {
    version: '2.0.0',
    get ready() { return getState().ready },
    state: () => ({ ...getState() }),
    pos: () => [game.player.sim.state.x, game.player.sim.state.y] as const,
    vel: () => [game.player.sim.state.vx, game.player.sim.state.vy] as const,
    speed: () => game.player.sim.speed(),
    timeMs: () => game.player.sim.timeMs(),
    seed: () => getState().seed,
    phase: () => getState().phase,
    level: () => getState().level,
    place: () => getState().place,
    boost: () => getState().boost,
    grounded: () => game.player.sim.state.grounded,
    hold: (v: boolean | null) => input.force(v),
    jump: () => game.playerJump(),
    fireBoost: () => { setState({ boost: 1, boostReady: true }); game.playerBoost() },
    begin: () => game.begin(),
    restart: () => game.restart(),
    setLevel: (lvl: number, daily = true, seed?: string) => game.setLevel(lvl, daily, seed),
    nextLevel: () => game.nextLevel(),
    autopilot: (on: boolean) => (game.autopilot = on),
    simSpeed: (n: number) => (game.simSpeed = Math.max(0.0001, Math.min(qaMode ? 400 : 1, n))),
    tick: () => game.player.sim.state.tick,
    opponents: () => game.field.opponents.length,
    stunNearest: () => {
      const o = game.field.opponents[0]
      if (o) o.sim.stun(2)
      return !!o
    },
    opponentStunned: () => game.field.opponents.some((o) => o.sim.stunned),
  }
  ;(window as unknown as { __SUNDIVE__: typeof api }).__SUNDIVE__ = api
}

void boot()
