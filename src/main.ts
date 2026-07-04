import { Application } from 'pixi.js'
import './ui/styles.css'
import { dailySeedString, hashStr, mulberry32, randomSeedString } from './core/rng'
import { fmtDelta, fmtTime, getState, setState } from './core/state'
import { buildTerrain, INTRO_X, Terrain } from './core/terrain'
import { CometSim, DT, makeBot, SimEvent } from './core/sim'
import {
  GhostData,
  GhostPlayer,
  GhostRecorder,
  ghostTimesAt,
  loadGhost,
  loadPB,
  makeSyntheticGhost,
  saveGhost,
  savePB,
} from './core/ghost'
import { Input } from './core/input'
import { Renderer } from './render/renderer'
import { createHud } from './ui/hud'
import {
  playCheckpoint,
  playFinish,
  playLaunch,
  playPerfect,
  playSlam,
  unlockAudio,
  updateAudio,
} from './core/audio'

const params = new URLSearchParams(location.search)
const qaMode = params.get('qa') === '1'
const forceReduce = params.get('reduce') === '1'
const dateOverride = params.get('date') ?? undefined
const seedParam = params.get('seed')
const modeParam = params.get('mode') === 'free' ? 'free' : 'daily'

const reducedMotion = forceReduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches
setState({ reducedMotion })
if (reducedMotion) document.body.classList.add('reduce-motion')

// ---------------------------------------------------------------------------

class Game {
  terrain!: Terrain
  sim!: CometSim
  recorder!: GhostRecorder
  ghostData: GhostData | null = null
  ghost: GhostPlayer | null = null
  ghostCpTimes: (number | null)[] = []
  ghostFinishMs: number | null = null
  private accumulator = 0
  private timeScale = 1
  private timeScaleTarget = 1
  private hitstop = 0
  private slowmoHold = 0
  simSpeed = 1 // QA fast-forward
  autopilot = false
  private bot: ((s: import('./core/sim').SimState) => boolean) | null = null
  private attractTimeout = 0

  constructor(
    private renderer: Renderer,
    private input: Input,
  ) {}

  setSeed(mode: 'daily' | 'free', seed?: string): void {
    const s = mode === 'daily' ? dailySeedString(dateOverride) : (seed ?? randomSeedString())
    setState({ mode, seed: s })
    this.terrain = buildTerrain(s)
    this.renderer.init(this.terrain)
    this.loadGhostFor(s)
    this.reset('attract')
  }

  private loadGhostFor(seed: string): void {
    const pb = loadGhost(seed)
    this.ghostData = pb ?? makeSyntheticGhost(this.terrain, seed)
    this.ghost = new GhostPlayer(this.ghostData)
    const cps = [...this.terrain.checkpoints, this.terrain.length]
    this.ghostCpTimes = ghostTimesAt(this.ghostData, cps)
    this.ghostFinishMs = this.ghostCpTimes[this.ghostCpTimes.length - 1]
    setState({ ghostSource: this.ghostData.source, pbMs: loadPB(seed) })
  }

  reset(phase: 'attract' | 'running'): void {
    this.sim = new CometSim(this.terrain, INTRO_X + 4)
    this.recorder = new GhostRecorder()
    this.accumulator = 0
    this.timeScale = 1
    this.timeScaleTarget = 1
    this.hitstop = 0
    this.slowmoHold = 0
    this.attractTimeout = 0
    this.renderer.clearTrails()
    this.bot = makeBot(this.terrain, mulberry32(hashStr(`attract:${getState().seed}`)), 0.4)
    setState({ phase, timeMs: 0, deltaMs: null, newBest: false })
  }

  begin(): void {
    // seamless takeover from the attract flight if we're still before the line
    if (getState().phase === 'attract') {
      if (this.sim.state.x < -6) {
        setState({ phase: 'running' })
      } else {
        this.reset('running')
      }
    }
  }

  restart(): void {
    this.loadGhostFor(getState().seed) // pick up a fresh PB ghost if one was just set
    this.reset('running')
    hud.hideOverlays()
  }

  /** QA/screenshots: swap the autopilot bot skill (lower = faster). */
  setBotSloppiness(n: number): void {
    this.bot = makeBot(this.terrain, mulberry32(hashStr(`bot-custom:${getState().seed}:${n}`)), n)
  }

  private onEvents(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'perfect':
          this.renderer.burst(ev.x, ev.y, 'perfect', 16)
          this.renderer.addTrauma(0.18)
          this.renderer.flashScreen(0xffd27a, 0.1)
          hud.toast('Perfect launch')
          playPerfect()
          break
        case 'launch':
          if ((ev.intensity ?? 0) > 0.25) playLaunch()
          break
        case 'slam': {
          const k = ev.intensity ?? 0.5
          this.renderer.burst(ev.x, ev.y, 'slam', Math.round(8 + k * 14))
          this.renderer.addTrauma(0.25 + k * 0.4)
          this.renderer.flashScreen(0xff5a3c, 0.1 + k * 0.12)
          if (!getState().reducedMotion) this.hitstop = 0.06 + k * 0.05
          hud.toast('Slam', 'slam')
          playSlam(k)
          break
        }
        case 'land':
          if ((ev.intensity ?? 0) > 0.35) this.renderer.burst(ev.x, ev.y, 'land', 5)
          break
        case 'checkpoint': {
          const i = ev.checkpointIndex ?? 0
          const ghostMs = this.ghostCpTimes[i]
          if (ghostMs !== null && ghostMs !== undefined) {
            const delta = this.sim.timeMs() - ghostMs
            setState({ deltaMs: delta })
            playCheckpoint(delta <= 0)
            hud.toast(fmtDelta(delta), delta <= 0 ? '' : 'slam')
          }
          break
        }
        case 'finish':
          this.onFinish()
          break
        case 'start':
          break
      }
    }
  }

  private onFinish(): void {
    const ms = this.sim.timeMs()
    const seed = getState().seed
    const prevPB = loadPB(seed)
    const newBest = prevPB === null || ms < prevPB
    if (newBest) {
      savePB(seed, ms)
      saveGhost(this.recorder.finish(seed, ms, this.sim.state.startTick, this.sim.state))
    }
    const vsGhost = this.ghostFinishMs !== null ? ms - this.ghostFinishMs : null
    setState({
      phase: 'finished',
      lastMs: ms,
      pbMs: newBest ? ms : prevPB,
      newBest,
      deltaMs: vsGhost,
      timeMs: ms,
    })
    if (!getState().reducedMotion) {
      this.timeScale = 0.22
      this.slowmoHold = 0.9
    }
    this.renderer.flashScreen(0xffd27a, 0.16)
    this.renderer.addTrauma(0.2)
    playFinish(newBest)
    hud.showFinish()
  }

  /** rAF driver: fixed-timestep sim + interpolation-free render (120 Hz sim is smooth enough). */
  frame(rawDt: number): void {
    const st = getState()
    // time scaling: hitstop -> slow-mo -> normal
    if (this.hitstop > 0) {
      this.hitstop -= rawDt
      this.timeScale = 0.05
    } else if (this.slowmoHold > 0) {
      this.slowmoHold -= rawDt
    } else {
      this.timeScaleTarget = 1
      this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, rawDt * 5)
    }

    const simDt = Math.min(rawDt, 0.05) * this.timeScale * this.simSpeed
    this.accumulator += simDt
    let steps = 0
    const maxSteps = this.simSpeed > 1 ? 2000 : 6
    while (this.accumulator >= DT && steps < maxSteps) {
      this.accumulator -= DT
      steps++
      let held: boolean
      if (this.autopilot && this.bot) held = this.bot(this.sim.state)
      else if (st.phase === 'attract') held = this.bot ? this.bot(this.sim.state) : false
      else held = this.input.isHeld()

      this.recorder.record(this.sim.state)
      const events = this.sim.step(held)
      if (st.phase !== 'attract') this.onEvents(events)

      // attract loop: reset before the run gets deep
      if (st.phase === 'attract') {
        this.attractTimeout += DT
        if (this.attractTimeout > 14 || this.sim.state.x > this.terrain.length * 0.3) {
          this.reset('attract')
          break
        }
      }
    }

    // live HUD state
    if (st.phase === 'running') {
      setState({ timeMs: this.sim.timeMs(), speed: this.sim.speed(), holding: this.input.isHeld() })
    } else if (st.phase === 'attract') {
      setState({ speed: this.sim.speed() })
    }

    const s = this.sim.state
    const ghostPos =
      this.ghost && st.phase !== 'attract' && s.startTick >= 0
        ? this.ghost.at(s.tick, s.startTick)
        : null
    this.renderer.render(s.x, s.y, this.sim.speed(), this.input.isHeld(), s.grounded, ghostPos, rawDt)
    updateAudio(this.sim.speed(), this.input.isHeld() && st.phase === 'running')
  }

  shareText(): string {
    const st = getState()
    const t = st.lastMs !== null ? fmtTime(st.lastMs) : '—'
    const mode = st.mode === 'daily' ? `Daily ${st.seed}` : `Canyon ${st.seed}`
    const vs = st.deltaMs !== null ? ` (${fmtDelta(st.deltaMs)} vs ghost)` : ''
    return `SUNDIVE · ${mode} · ${t}${vs} — hold to dive, release to soar`
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
    onMode: (mode) => game.setSeed(mode),
    shareText: () => game.shareText(),
  })

  input.onFirstInput = () => {
    unlockAudio()
    game.begin()
  }
  input.onRestart = () => game.restart()

  game.setSeed(modeParam, seedParam ?? undefined)

  app.ticker.add((t) => {
    game.frame(t.deltaMS / 1000)
  })
  window.addEventListener('resize', () => {
    app.renderer.resize(Math.max(2, stageEl.clientWidth), Math.max(2, stageEl.clientHeight))
    renderer.resize()
  })

  document.getElementById('veil')?.classList.add('gone')
  setState({ ready: true })

  // ---- QA / debug API
  const api = {
    version: '1.0.0',
    get ready() {
      return getState().ready
    },
    state: () => ({ ...getState() }),
    pos: () => [game.sim.state.x, game.sim.state.y] as const,
    vel: () => [game.sim.state.vx, game.sim.state.vy] as const,
    speed: () => game.sim.speed(),
    timeMs: () => game.sim.timeMs(),
    seed: () => getState().seed,
    phase: () => getState().phase,
    ghostSource: () => getState().ghostSource,
    hold: (v: boolean | null) => input.force(v),
    begin: () => game.begin(),
    restart: () => game.restart(),
    setMode: (m: 'daily' | 'free', seed?: string) => game.setSeed(m, seed),
    autopilot: (on: boolean) => (game.autopilot = on),
    botSloppiness: (n: number) => game.setBotSloppiness(n),
    grounded: () => game.sim.state.grounded,
    simSpeed: (n: number) => (game.simSpeed = Math.max(0.1, Math.min(qaMode ? 400 : 1, n))),
    tick: () => game.sim.state.tick,
  }
  ;(window as unknown as { __SUNDIVE__: typeof api }).__SUNDIVE__ = api
  void qaMode
}

void boot()
