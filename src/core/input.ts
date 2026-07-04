// One input: HOLD. Pointer anywhere on the stage, touch, Space, or mouse.
// UI buttons stop propagation so they never count as a dive.

export class Input {
  private held = false
  private forced: boolean | null = null // QA override
  onFirstInput: (() => void) | null = null
  onRestart: (() => void) | null = null
  private fired = false

  constructor(stage: HTMLElement) {
    const down = (e: Event) => {
      if ((e.target as HTMLElement).closest?.('button, a, .no-hold')) return
      this.held = true
      this.fire()
      e.preventDefault()
    }
    const up = () => (this.held = false)

    stage.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', up)

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      if (e.code === 'Space') {
        this.held = true
        this.fire()
        e.preventDefault()
      }
      if (e.code === 'KeyR') this.onRestart?.()
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.held = false
    })
  }

  private fire(): void {
    if (!this.fired) {
      this.fired = true
      this.onFirstInput?.()
    }
  }

  isHeld(): boolean {
    return this.forced ?? this.held
  }

  force(v: boolean | null): void {
    this.forced = v
  }
}
