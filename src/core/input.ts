// Hybrid controls. The comet auto-cruises down the canyon; these drive it:
//   GO / dive:  hold mouse / touch, or D / → / Enter, or the touch GO pad
//   jump:       W / ↑ / Space, or the touch JUMP pad
//   brake:      S / ↓, or the touch BRAKE pad
//   reverse:    A / ←, or the touch REVERSE pad
//   nitro:      Shift, or the touch NITRO pad
//   pause:      Escape
//   restart:    R
// UI buttons (.no-hold / button / a) never trigger the hold-to-dive on the stage.

export class Input {
  private pointerHeld = false
  private touchGo = false
  private touchBrake = false
  private touchReverse = false
  private goKeys = new Set<string>()
  private brakeKeys = new Set<string>()
  private reverseKeys = new Set<string>()
  private forced: boolean | null = null // QA override for the go/dive input

  onFirstInput: (() => void) | null = null
  onRestart: (() => void) | null = null
  onJump: (() => void) | null = null
  onBoost: (() => void) | null = null
  onPause: (() => void) | null = null
  private fired = false

  constructor(stage: HTMLElement) {
    const down = (e: Event) => {
      if ((e.target as HTMLElement).closest?.('button, a, .no-hold')) return
      this.pointerHeld = true
      this.fire()
      e.preventDefault()
    }
    const up = () => (this.pointerHeld = false)
    // Losing focus never delivers keyup, so flush ALL held state or a key released
    // while alt-tabbed would stay stuck 'on'.
    const clearAll = () => {
      this.pointerHeld = false
      this.goKeys.clear(); this.brakeKeys.clear(); this.reverseKeys.clear()
      this.touchGo = this.touchBrake = this.touchReverse = false
    }

    stage.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', clearAll)
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll() })

    window.addEventListener('keydown', (e) => {
      const c = e.code
      const onButton = document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'BUTTON'
      // GO / dive (hold)
      if (c === 'KeyD' || c === 'ArrowRight' || c === 'Enter') {
        if (c === 'Enter' && onButton) return // let a focused button take Enter
        this.goKeys.add(c); this.fire(); e.preventDefault()
      } else if (c === 'KeyW' || c === 'ArrowUp' || c === 'Space') {
        if (c === 'Space' && onButton) return // don't hijack a focused button
        if (!e.repeat) this.jump()
        e.preventDefault()
      } else if (c === 'KeyS' || c === 'ArrowDown') {
        this.brakeKeys.add(c); this.fire(); e.preventDefault()
      } else if (c === 'KeyA' || c === 'ArrowLeft') {
        this.reverseKeys.add(c); this.fire(); e.preventDefault()
      } else if (c === 'ShiftLeft' || c === 'ShiftRight') {
        if (!e.repeat) this.boost()
        e.preventDefault()
      } else if (c === 'Escape') {
        this.onPause?.(); e.preventDefault()
      } else if (c === 'KeyR') {
        this.onRestart?.()
      }
    })
    window.addEventListener('keyup', (e) => {
      const c = e.code
      this.goKeys.delete(c)
      this.brakeKeys.delete(c)
      this.reverseKeys.delete(c)
    })
  }

  private fire(): void {
    if (!this.fired) { this.fired = true; this.onFirstInput?.() }
  }
  jump(): void { this.fire(); this.onJump?.() }
  boost(): void { this.fire(); this.onBoost?.() }

  // touch pads (held)
  setTouchGo(v: boolean): void { this.touchGo = v; if (v) this.fire() }
  setTouchBrake(v: boolean): void { this.touchBrake = v; if (v) this.fire() }
  setTouchReverse(v: boolean): void { this.touchReverse = v; if (v) this.fire() }

  isHeld(): boolean {
    return this.forced ?? (this.pointerHeld || this.touchGo || this.goKeys.size > 0)
  }
  braking(): boolean {
    return this.brakeKeys.size > 0 || this.touchBrake
  }
  reversing(): boolean {
    return this.reverseKeys.size > 0 || this.touchReverse
  }
  force(v: boolean | null): void {
    this.forced = v
  }
}
