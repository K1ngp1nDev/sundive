// Level progression: more rivals, steeper canyon, denser hazards each level.

export interface LevelDef {
  n: number // 1-based
  name: string
  opponents: number
  oppSloppy: [number, number] // skill range (higher = worse); level 1 rivals are beatable
  ampScale: number // terrain steepness
  length: number // finish distance (m)
  obstacles: number // hazard vents to hop
  bonuses: number // airborne boost motes
}

// Distinct comet colours for rivals (player is always gold #ffd27a).
export const RIVAL_COLORS = [0x6fe3c2, 0xff7ea8, 0xb794f6, 0x7fc4ff, 0xffb454, 0x9ee34f, 0xe07bff]
export const RIVAL_NAMES = ['Jade', 'Rose', 'Violet', 'Azure', 'Amber', 'Lime', 'Nova']

// 10 levels: more rivals (up to 7), steeper canyons, denser hazards, sharper bots.
// Lengths tuned (with the telemetry harness) to ~40s -> ~80s runs at the higher base speed.
export const LEVELS: LevelDef[] = [
  { n: 1, name: 'First Light', opponents: 1, oppSloppy: [0.85, 0.95], ampScale: 0.85, length: 2400, obstacles: 3, bonuses: 4 },
  { n: 2, name: 'Long Shadows', opponents: 2, oppSloppy: [0.68, 0.9], ampScale: 0.92, length: 2650, obstacles: 4, bonuses: 5 },
  { n: 3, name: 'Deep Canyon', opponents: 3, oppSloppy: [0.55, 0.85], ampScale: 1.0, length: 2900, obstacles: 6, bonuses: 6 },
  { n: 4, name: 'Solar Wind', opponents: 4, oppSloppy: [0.45, 0.78], ampScale: 1.08, length: 3150, obstacles: 7, bonuses: 7 },
  { n: 5, name: 'Perihelion', opponents: 5, oppSloppy: [0.36, 0.7], ampScale: 1.16, length: 3400, obstacles: 9, bonuses: 8 },
  { n: 6, name: 'Corona', opponents: 6, oppSloppy: [0.3, 0.62], ampScale: 1.24, length: 3650, obstacles: 10, bonuses: 9 },
  { n: 7, name: 'Sunspot', opponents: 7, oppSloppy: [0.24, 0.55], ampScale: 1.32, length: 3900, obstacles: 12, bonuses: 10 },
  { n: 8, name: 'Solar Flare', opponents: 7, oppSloppy: [0.19, 0.48], ampScale: 1.4, length: 4150, obstacles: 13, bonuses: 11 },
  { n: 9, name: 'Chromosphere', opponents: 7, oppSloppy: [0.14, 0.42], ampScale: 1.5, length: 4400, obstacles: 15, bonuses: 12 },
  { n: 10, name: 'Event Horizon', opponents: 7, oppSloppy: [0.09, 0.35], ampScale: 1.6, length: 4700, obstacles: 16, bonuses: 13 },
]

/** 1-based level number. */
export function levelDef(level: number): LevelDef {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))]
}

const KEY = 'sundive:unlocked'

export function unlockedLevels(): number {
  try {
    return Math.max(1, Number(localStorage.getItem(KEY) || '1'))
  } catch {
    return 1
  }
}

export function unlockLevel(n: number): void {
  try {
    if (n > unlockedLevels()) localStorage.setItem(KEY, String(Math.min(LEVELS.length, n)))
  } catch {
    /* ignore */
  }
}
