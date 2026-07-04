// Tiny observable store.

export type Phase = 'attract' | 'running' | 'finished'
export type Mode = 'daily' | 'free'

export interface AppState {
  phase: Phase
  mode: Mode
  seed: string
  timeMs: number // current run time (from start line)
  speed: number // m/s
  deltaMs: number | null // vs ghost at latest checkpoint (negative = ahead)
  ghostSource: 'synthetic' | 'pb' | 'none'
  pbMs: number | null
  lastMs: number | null
  newBest: boolean
  holding: boolean
  progress: number // 0..1 along the course
  ghostProgress: number
  muted: boolean
  reducedMotion: boolean
  ready: boolean
}

type Listener = (s: AppState) => void

const state: AppState = {
  phase: 'attract',
  mode: 'daily',
  seed: '',
  timeMs: 0,
  speed: 0,
  deltaMs: null,
  ghostSource: 'none',
  pbMs: null,
  lastMs: null,
  newBest: false,
  holding: false,
  progress: 0,
  ghostProgress: 0,
  muted: false,
  reducedMotion: false,
  ready: false,
}

const listeners = new Set<Listener>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState>): void {
  let changed = false
  for (const k of Object.keys(patch) as (keyof AppState)[]) {
    if (state[k] !== patch[k]) {
      ;(state as unknown as Record<string, unknown>)[k] = patch[k]
      changed = true
    }
  }
  if (changed) for (const l of listeners) l(state)
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function fmtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function fmtDelta(ms: number): string {
  const sign = ms <= 0 ? '−' : '+'
  const t = Math.abs(Math.round(ms))
  const s = Math.floor(t / 1000)
  const cs = Math.floor((t % 1000) / 10)
  return `${sign}${s}.${String(cs).padStart(2, '0')}`
}
