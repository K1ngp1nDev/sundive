// Inputs: HOLD to dive (pointer/touch on the stage), Space = jump,
// Shift/Enter = boost, R = restart. UI buttons stop propagation.

export class Input {
  private held = false
  private forced: boolean | null = null // QA override
  onFirstInput: (() => void) | null = null
  onRestart: (() => void) | null = null
  onJump: (() => void) | null = null
  onBoost: (() => void) | null = null
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
      // Space/Enter can activate a focused button — ignore them if the focus is
      // on a control, and never bind Enter to boost (it would re-fire buttons).
      const onButton = document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'BUTTON'
      if (e.code === 'Space') { if (!onButton) { this.jump(); e.preventDefault() } }
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.boost(); e.preventDefault() }
      else if (e.code === 'KeyR') this.onRestart?.()
    })
  }

  private fire(): void {
    if (!this.fired) { this.fired = true; this.onFirstInput?.() }
  }
  jump(): void { this.fire(); this.onJump?.() }
  boost(): void { this.fire(); this.onBoost?.() }

  isHeld(): boolean {
    return this.forced ?? this.held
  }
  force(v: boolean | null): void {
    this.forced = v
  }
}
