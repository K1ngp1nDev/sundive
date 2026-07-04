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
export const RIVAL_COLORS = [0x6fe3c2, 0xff7ea8, 0xb794f6, 0x7fc4ff, 0xffb454]
export const RIVAL_NAMES = ['Jade', 'Rose', 'Violet', 'Azure', 'Amber']

export const LEVELS: LevelDef[] = [
  { n: 1, name: 'First Light', opponents: 1, oppSloppy: [0.8, 0.9], ampScale: 0.85, length: 1700, obstacles: 3, bonuses: 4 },
  { n: 2, name: 'Long Shadows', opponents: 2, oppSloppy: [0.6, 0.85], ampScale: 1.0, length: 2000, obstacles: 5, bonuses: 5 },
  { n: 3, name: 'Deep Canyon', opponents: 3, oppSloppy: [0.45, 0.8], ampScale: 1.15, length: 2300, obstacles: 7, bonuses: 6 },
  { n: 4, name: 'Solar Wind', opponents: 4, oppSloppy: [0.3, 0.7], ampScale: 1.3, length: 2600, obstacles: 9, bonuses: 7 },
  { n: 5, name: 'Perihelion', opponents: 5, oppSloppy: [0.18, 0.6], ampScale: 1.45, length: 2900, obstacles: 11, bonuses: 8 },
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
