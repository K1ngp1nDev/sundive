// Procedural WebAudio: wind that rises with speed, dive rumble, launch plucks,
// slam thud, finish arpeggio. No assets; everything guarded so a blocked
// AudioContext can never break the game.

import { getState, setState, subscribe } from './state'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let windGain: GainNode | null = null
let windFilter: BiquadFilterNode | null = null
let rumbleGain: GainNode | null = null
let started = false

function ensure(): boolean {
  if (started) return !!ctx
  started = true
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = getState().muted ? 0 : 0.5
    master.connect(ctx.destination)

    // wind: looped noise -> bandpass, gain/freq driven by speed
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 300
    windFilter.Q.value = 0.6
    windGain = ctx.createGain()
    windGain.gain.value = 0
    src.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(master)
    src.start()

    // dive rumble: low osc, gated by hold
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 46
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 120
    rumbleGain = ctx.createGain()
    rumbleGain.gain.value = 0
    osc.connect(lp)
    lp.connect(rumbleGain)
    rumbleGain.connect(master)
    osc.start()

    subscribe((s) => {
      if (master && ctx) master.gain.setTargetAtTime(s.muted ? 0 : 0.5, ctx.currentTime, 0.05)
    })
    return true
  } catch {
    ctx = null
    return false
  }
}

export function unlockAudio(): void {
  try {
    if (!ensure()) return
    ctx?.resume().catch(() => undefined)
  } catch {
    /* no-op */
  }
}

export function toggleMute(): void {
  setState({ muted: !getState().muted })
}

/** Continuous layer — call every frame. */
export function updateAudio(speed: number, holding: boolean): void {
  if (!ctx || !windGain || !windFilter || !rumbleGain) return
  const t = ctx.currentTime
  const k = Math.min(1, speed / 90)
  windGain.gain.setTargetAtTime(k * k * 0.34, t, 0.09)
  windFilter.frequency.setTargetAtTime(220 + k * 1400, t, 0.12)
  rumbleGain.gain.setTargetAtTime(holding ? 0.1 + k * 0.1 : 0, t, 0.06)
}

function env(at: number, peak: number, dur: number): GainNode | null {
  if (!ctx || !master) return null
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(peak, at + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  g.connect(master)
  return g
}

function pluck(freq: number, peak = 0.16, dur = 0.3, type: OscillatorType = 'triangle'): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = env(t, peak, dur)
    if (!g) return
    o.connect(g)
    o.start(t)
    o.stop(t + dur + 0.05)
  } catch {
    /* no-op */
  }
}

export function playLaunch(): void {
  pluck(520, 0.1, 0.18)
}

export function playPerfect(): void {
  pluck(660, 0.16, 0.3)
  setTimeout(() => pluck(990, 0.14, 0.4), 70)
}

export function playSlam(intensity: number): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const dur = 0.3
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 160 + intensity * 220
    const g = env(t, 0.22 + intensity * 0.2, dur)
    if (!g) return
    src.connect(lp)
    lp.connect(g)
    src.start(t)
  } catch {
    /* no-op */
  }
}

export function playCheckpoint(ahead: boolean): void {
  pluck(ahead ? 880 : 392, 0.09, 0.16, 'sine')
}

export function playJump(): void {
  pluck(300, 0.1, 0.12, 'sine')
  setTimeout(() => pluck(500, 0.08, 0.12, 'sine'), 40)
}

export function playBoost(): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(180, t)
    o.frequency.exponentialRampToValueAtTime(700, t + 0.35)
    const g = env(t, 0.16, 0.4)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 800
    if (g) { o.connect(bp); bp.connect(g); o.start(t); o.stop(t + 0.45) }
  } catch {
    /* no-op */
  }
}

export function playBonus(): void {
  pluck(784, 0.12, 0.18, 'sine')
  setTimeout(() => pluck(1175, 0.1, 0.22, 'sine'), 55)
}

export function playObstacle(): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.2)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 500
    const g = env(t, 0.2, 0.2)
    if (g) { src.connect(lp); lp.connect(g); src.start(t) }
  } catch {
    /* no-op */
  }
}

export function playStunHit(): void {
  pluck(220, 0.16, 0.28, 'square')
}

export function playPad(): void {
  // trampoline boing — quick upward pitch
  pluck(300, 0.14, 0.12, 'sine')
  setTimeout(() => pluck(720, 0.12, 0.16, 'sine'), 45)
  setTimeout(() => pluck(1080, 0.08, 0.14, 'sine'), 90)
}

export function playFall(): void {
  // descending whoosh into the pit
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(620, t)
    o.frequency.exponentialRampToValueAtTime(90, t + 0.3)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1200
    const g = env(t, 0.14, 0.34)
    if (g) { o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.36) }
  } catch {
    /* no-op */
  }
}

export function playRespawn(): void {
  // resurrection — bright ascending pop
  pluck(480, 0.12, 0.14, 'triangle')
  setTimeout(() => pluck(880, 0.12, 0.2, 'sine'), 60)
}

export function playFinish(newBest: boolean): void {
  const notes = newBest ? [523, 659, 784, 1047] : [523, 659, 784]
  notes.forEach((f, i) => setTimeout(() => pluck(f, 0.14, 0.5, 'sine'), i * 110))
}
