// Tiny observable store.

export type Phase = 'attract' | 'running' | 'finished'

export interface AppState {
  phase: Phase
  daily: boolean
  seed: string
  level: number // 1-based
  levelName: string
  racerCount: number
  timeMs: number
  speed: number
  boost: number // 0..1 nitro meter
  boostReady: boolean
  boostActive: boolean
  place: number | null // live/finish rank, 1 = leading
  gapMs: number | null // gap to the rival directly ahead/behind
  pbMs: number | null
  lastMs: number | null
  newBest: boolean
  won: boolean
  holding: boolean
  muted: boolean
  reducedMotion: boolean
  paused: boolean
  ready: boolean
}

type Listener = (s: AppState) => void

const state: AppState = {
  phase: 'attract',
  daily: true,
  seed: '',
  level: 1,
  levelName: '',
  racerCount: 2,
  timeMs: 0,
  speed: 0,
  boost: 1,
  boostReady: true,
  boostActive: false,
  place: null,
  gapMs: null,
  pbMs: null,
  lastMs: null,
  newBest: false,
  won: false,
  holding: false,
  muted: false,
  reducedMotion: false,
  paused: false,
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

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
