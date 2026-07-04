import { fmtTime, getState, ordinal, setState, subscribe } from '../core/state'
import { toggleMute, unlockAudio } from '../core/audio'
import { LEVELS, unlockLevel, unlockedLevels } from '../core/levels'

export interface HudDeps {
  onRestart: () => void
  onLevel: (level: number, daily: boolean) => void
  onPreview: (level: number, daily: boolean) => void
  onNext: () => void
  onJump: () => void
  onBoost: () => void
  onPause: () => void
  setGo: (v: boolean) => void
  setBrake: (v: boolean) => void
  setReverse: (v: boolean) => void
  shareText: () => string
}

// Controls reference, shown in the pause menu and the start-screen help.
const CONTROLS_HTML = `
  <div class="ctrl-grid">
    <span><b>Hold</b> · <b>D</b> · <b>→</b></span><span>dive — accelerate down the slope</span>
    <span><b>W</b> · <b>↑</b> · <b>Space</b></span><span>jump — hop hazards, pounce on rivals</span>
    <span><b>Shift</b></span><span>nitro — a burst of speed</span>
    <span><b>S</b> · <b>↓</b></span><span>brake</span>
    <span><b>A</b> · <b>←</b></span><span>reverse</span>
    <span><b>Esc</b></span><span>pause · <b>R</b> restart · <b>M</b> sound</span>
  </div>`

export interface RacerDot { frac: number; color: number; isPlayer: boolean }
export interface Label { x: number; y: number; text: string; color: number }

export interface Hud {
  toast: (text: string, cls?: string) => void
  banner: (text: string, cls?: string, ms?: number) => void
  showFinish: () => void
  hideOverlays: () => void
  setDemoInput: (visible: boolean, held: boolean) => void
  setCoach: (text: string | null) => void
  setLabels: (labels: Label[]) => void
  setRacerDots: (dots: RacerDot[]) => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}
const hexc = (c: number) => '#' + c.toString(16).padStart(6, '0')

export function createHud(deps: HudDeps): Hud {
  const root = document.getElementById('ui')!
  const isTouch = window.matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

  const hud = el('div', 'hud')

  const time = el('div', 'panel hud-time', `<div class="t">0:00.00</div><div class="d"></div>`)
  const timeT = time.querySelector('.t') as HTMLElement
  const timeD = time.querySelector('.d') as HTMLElement

  const strip = el('div', 'panel course')
  strip.innerHTML = `<div class="course-line"></div><div class="course-flag">🏁</div><div class="course-dots"></div>`
  const dotsWrap = strip.querySelector('.course-dots') as HTMLElement

  const corner = el('div', 'panel hud-corner')
  const btns = el('div', 'hud-btns')
  const restartBtn = el('button', 'icon-btn', '↺')
  const soundBtn = el('button', 'icon-btn', '♪')
  const pauseBtn = el('button', 'icon-btn', '⏸')
  btns.append(restartBtn, soundBtn, pauseBtn)

  // nitro meter (click/tap to fire)
  const nitro = el('button', 'nitro no-hold', `<span class="nitro-fill"></span><span class="nitro-lbl">NITRO</span>`)
  const nitroFill = nitro.querySelector('.nitro-fill') as HTMLElement
  const nitroLbl = nitro.querySelector('.nitro-lbl') as HTMLElement

  const speed = el('div', 'panel hud-speed', `<b>0</b> m/s`)
  hud.append(time, strip, corner, btns, nitro, speed)
  root.appendChild(hud)

  // demo input bubble
  const demo = el('div', 'demo-input hidden', `<span class="ring"></span><span class="lbl">HOLD</span>`)
  const demoLbl = demo.querySelector('.lbl') as HTMLElement
  root.appendChild(demo)

  const coach = el('div', 'coach hidden')
  root.appendChild(coach)

  const banner = el('div', 'race-banner')
  root.appendChild(banner)
  let bannerTimer: number | null = null

  const toastWrap = el('div', 'toast-wrap')
  root.appendChild(toastWrap)

  // comet labels pool
  const labelPool: HTMLElement[] = []
  const labelWrap = el('div', 'labels')
  root.appendChild(labelWrap)

  // touch controls: a d-pad on the left (WASD), NITRO on the right
  let touchControls: HTMLElement | null = null
  let tcBoost: HTMLElement | null = null
  let rotateTip: HTMLElement | null = null
  let rotateTipManual = false
  let rotateTipDismissed = false
  if (isTouch) {
    const tc = el('div', 'touch-controls')
    tc.innerHTML = `
      <div class="dpad">
        <button class="tbtn jump no-hold" type="button" data-k="jump" aria-label="Jump">▲</button>
        <button class="tbtn rev no-hold" type="button" data-k="rev" aria-label="Reverse">◀</button>
        <button class="tbtn go no-hold" type="button" data-k="go" aria-label="Dive">▶</button>
        <button class="tbtn brake no-hold" type="button" data-k="brake" aria-label="Brake">▼</button>
      </div>
      <button class="tbtn boost big no-hold" type="button" aria-label="Nitro boost">
        <span class="boost-main">NITRO</span>
        <span class="boost-sub">READY</span>
      </button>`
    root.appendChild(tc)
    touchControls = tc
    const tap = (sel: string, fn: () => void) => {
      const b = tc.querySelector(sel) as HTMLElement
      let pid: number | null = null
      const off = (e?: Event) => {
        if (pid !== null && e && (e as PointerEvent).pointerId !== pid) return
        pid = null
        b.classList.remove('down')
        b.setAttribute('aria-pressed', 'false')
      }
      b.setAttribute('aria-pressed', 'false')
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        pid = (e as PointerEvent).pointerId
        try { b.setPointerCapture(pid) } catch { /* ignore */ }
        b.classList.add('down')
        b.setAttribute('aria-pressed', 'true')
        window.setTimeout(() => off(), 180)
        fn()
      })
      b.addEventListener('pointerup', off)
      b.addEventListener('pointercancel', off)
      b.addEventListener('lostpointercapture', off)
    }
    // Each hold pad captures its own pointer, so multi-touch (e.g. hold GO + tap
    // JUMP) works — a pad only releases when its own finger lifts, not on any tap.
    const hold = (sel: string, set: (v: boolean) => void) => {
      const b = tc.querySelector(sel) as HTMLElement
      let pid: number | null = null
      b.setAttribute('aria-pressed', 'false')
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); pid = (e as PointerEvent).pointerId
        try { b.setPointerCapture(pid) } catch { /* ignore */ }
        b.classList.add('down'); b.setAttribute('aria-pressed', 'true'); set(true)
      })
      const off = (e: Event) => {
        if (pid !== null && (e as PointerEvent).pointerId !== pid) return
        pid = null; b.classList.remove('down'); b.setAttribute('aria-pressed', 'false'); set(false)
      }
      b.addEventListener('pointerup', off)
      b.addEventListener('pointercancel', off)
      b.addEventListener('lostpointercapture', off)
    }
    tap('.jump', () => deps.onJump())
    tap('.boost', () => deps.onBoost())
    tcBoost = tc.querySelector('.boost') as HTMLElement
    hold('.go', deps.setGo)
    hold('.brake', deps.setBrake)
    hold('.rev', deps.setReverse)
    // safety net: losing focus clears any stuck pad
    window.addEventListener('blur', () => {
      deps.setGo(false); deps.setBrake(false); deps.setReverse(false)
      tc.querySelectorAll('.down').forEach((e) => {
        e.classList.remove('down')
        e.setAttribute('aria-pressed', 'false')
      })
    })

    rotateTip = el(
      'div',
      'rotate-tip hidden',
      `<span>Best in landscape</span><button class="no-hold" type="button">Rotate</button>`,
    )
    root.appendChild(rotateTip)
    const rotateBtn = rotateTip.querySelector('button')
    let rotateBusy = false
    const handleRotate = async (e: Event) => {
      e.preventDefault()
      if (rotateBusy) return
      rotateBusy = true
      const msg = rotateTip?.querySelector('span')
      const btn = rotateTip?.querySelector('button')
      if (rotateTipManual) {
        rotateTipDismissed = true
        rotateTip?.classList.add('hidden')
        rotateBusy = false
        return
      }
      const manualFallback = (): void => {
        rotateTipManual = true
        rotateTip?.classList.add('manual')
        if (msg) msg.textContent = 'Turn phone sideways for wide controls'
        if (btn) btn.textContent = 'OK'
      }
      try {
        // iOS Safari and in-app browsers generally do not allow web pages to
        // rotate the screen programmatically. A deterministic instruction is
        // better UX than a button that silently fails or hangs.
        manualFallback()
      } catch {
        manualFallback()
      } finally {
        rotateBusy = false
      }
    }
    rotateBtn?.addEventListener('pointerdown', handleRotate)
    rotateBtn?.addEventListener('click', (e) => e.preventDefault())
    rotateBtn?.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') void handleRotate(e)
    })
  }

  // ---- start overlay
  const start = el('div', 'overlay')
  const startCard = el('div', 'panel card')
  start.appendChild(startCard)
  root.appendChild(start)

  let selDaily = true
  let selLevel = 1
  let pendingUnlockLevel: number | null = null
  const renderStart = (): void => {
    const unlocked = unlockedLevels()
    selLevel = Math.max(1, Math.min(selLevel, LEVELS.length))
    startCard.innerHTML = `
      <div class="kicker">One-button comet racing</div>
      <div class="title">SUNDIVE</div>
      <div class="sub goal-line">Outrace the rivals to the finish.</div>
      <div class="sub"><b>Hold</b>/<b>D</b> dive · <b>W</b>/<b>Space</b> jump · <b>Shift</b> nitro</div>
      <div class="level-row">${LEVELS.map((l) => {
        const locked = l.n > unlocked
        return `<button class="lvl-btn ${l.n === selLevel ? 'on' : ''} ${locked ? 'locked' : ''}" type="button" data-lvl="${l.n}" aria-label="${locked ? `Level ${l.n} locked. Demo preview available.` : `Level ${l.n}`}">${locked ? '🔒' : l.n}</button>`
      }).join('')}</div>
      <div class="level-name">Lv ${selLevel} · ${LEVELS[selLevel - 1].name} · ${LEVELS[selLevel - 1].opponents} rival${LEVELS[selLevel - 1].opponents > 1 ? 's' : ''}</div>
      <div class="mode-row">
        <button class="big-btn" data-a="go">${selLevel > unlocked ? 'Unlock to race' : 'Race'}</button>
        <button class="ghost-btn ${selDaily ? 'on' : ''}" data-a="daily">Daily</button>
        <button class="ghost-btn ${!selDaily ? 'on' : ''}" data-a="free">Free</button>
        <button class="ghost-btn" data-a="help">Controls</button>
      </div>
      <div class="hint-line">hold anywhere to dive — the comet is already falling</div>`
  }
  renderStart()

  // ---- pause overlay
  const pause = el('div', 'overlay hidden')
  const pauseCard = el('div', 'panel card')
  pause.appendChild(pauseCard)
  root.appendChild(pause)
  pauseCard.innerHTML = `
    <div class="kicker">Paused</div>
    <div class="title small">SUNDIVE</div>
    ${CONTROLS_HTML}
    <div class="mode-row">
      <button class="big-btn" data-a="resume">Resume</button>
      <button class="ghost-btn" data-a="retry">Restart</button>
      <button class="ghost-btn" data-a="menu">Levels</button>
    </div>`

  // ---- controls help overlay (from the start screen)
  const help = el('div', 'overlay hidden')
  const helpCard = el('div', 'panel card')
  help.appendChild(helpCard)
  root.appendChild(help)
  helpCard.innerHTML = `
    <div class="kicker">Controls</div>
    <div class="title small">How to play</div>
    <div class="sub goal-line">The comet auto-runs down the canyon — steer it, and beat the rivals.</div>
    ${CONTROLS_HTML}
    <div class="mode-row"><button class="big-btn" data-a="closehelp">Got it</button></div>`

  // ---- demo unlock confirmation
  const unlock = el('div', 'overlay hidden')
  const unlockCard = el('div', 'panel card unlock-card')
  unlock.appendChild(unlockCard)
  root.appendChild(unlock)
  const renderUnlock = (): void => {
    const lvl = pendingUnlockLevel ?? 1
    const def = LEVELS[lvl - 1]
    unlockCard.innerHTML = `
      <div class="kicker">Portfolio demo</div>
      <div class="title small">Unlock level ${lvl}?</div>
      <div class="sub goal-line">Normally this opens after winning earlier races. For this demo, you can unlock it now and inspect the different biome, rivals, hazards, and pacing.</div>
      <div class="level-name">Lv ${lvl} · ${def.name} · ${def.opponents} rivals · ${def.biome}</div>
      <div class="mode-row">
        <button class="big-btn" data-a="unlock">Open level</button>
        <button class="ghost-btn" data-a="cancelunlock">Not now</button>
      </div>`
  }

  // ---- finish overlay
  const fin = el('div', 'overlay hidden')
  const finCard = el('div', 'panel card')
  fin.appendChild(finCard)
  root.appendChild(fin)

  const renderFinish = (): void => {
    const s = getState()
    const won = s.won
    const last = s.level >= LEVELS.length
    const verdict = won ? 'You win!' : s.place ? `${ordinal(s.place)} of ${s.racerCount}` : 'Finish'
    const retryHint = isTouch ? (won && !last ? 'Tap Next level or Replay' : 'Tap Try again to retry') : 'R — instant retry'
    finCard.innerHTML = `
      <div class="kicker">Lv ${s.level} · ${s.levelName}</div>
      <div class="fin-verdict ${won ? 'ahead' : 'behind'}">${verdict}</div>
      <div class="fin-time">${s.lastMs !== null ? fmtTime(s.lastMs) : '—'}</div>
      ${s.newBest ? '<div class="newbest">New best time</div>' : s.pbMs !== null ? `<div class="fin-best">best ${fmtTime(s.pbMs)}</div>` : ''}
      <div class="mode-row">
        ${won && !last ? '<button class="big-btn" data-a="next">Next level →</button>' : `<button class="big-btn ${won ? '' : 'pulse'}" data-a="retry">${won ? 'Race again' : 'Try again'}</button>`}
        ${won && !last ? '<button class="ghost-btn" data-a="retry">Replay</button>' : ''}
        <button class="ghost-btn" data-a="share">Share</button>
        <button class="ghost-btn" data-a="menu">Levels</button>
      </div>
      <div class="share-note"></div>
      <div class="hint-line">${retryHint}</div>`
  }

  // ---- wiring
  const act = (a: string, card: HTMLElement): void => {
    unlockAudio()
    if (a === 'go') {
      if (selLevel > unlockedLevels()) {
        pendingUnlockLevel = selLevel
        renderUnlock()
        unlock.classList.remove('hidden')
      } else deps.onLevel(selLevel, selDaily)
    }
    else if (a === 'retry') deps.onRestart()
    else if (a === 'next') deps.onNext()
    else if (a === 'daily') { selDaily = true; deps.onPreview(selLevel, selDaily); renderStart() }
    else if (a === 'free') { selDaily = false; deps.onPreview(selLevel, selDaily); renderStart() }
    else if (a === 'menu') setState({ phase: 'attract', paused: false })
    else if (a === 'resume') deps.onPause()
    else if (a === 'help') help.classList.remove('hidden')
    else if (a === 'closehelp') help.classList.add('hidden')
    else if (a === 'unlock') {
      if (pendingUnlockLevel !== null) {
        unlockLevel(pendingUnlockLevel)
        selLevel = pendingUnlockLevel
        pendingUnlockLevel = null
        unlock.classList.add('hidden')
        renderStart()
      }
    }
    else if (a === 'cancelunlock') { pendingUnlockLevel = null; unlock.classList.add('hidden') }
    else if (a === 'share') {
      const text = deps.shareText()
      const note = card.querySelector('.share-note') as HTMLElement | null
      navigator.clipboard?.writeText(text).then(() => note && (note.textContent = 'copied ✓')).catch(() => note && (note.textContent = text))
    }
  }
  startCard.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const lvl = t.closest('.lvl-btn') as HTMLElement | null
    if (lvl) {
      const level = Number(lvl.dataset.lvl)
      if (lvl.classList.contains('locked')) {
        selLevel = level
        deps.onPreview(selLevel, selDaily)
        renderStart()
        pendingUnlockLevel = level
        renderUnlock()
        unlock.classList.remove('hidden')
      } else {
        selLevel = level
        deps.onPreview(selLevel, selDaily)
        renderStart()
      }
      return
    }
    const a = t.closest('button')?.dataset.a
    if (a) act(a, startCard)
  })
  finCard.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('button')?.dataset.a; if (a) act(a, finCard) })
  pauseCard.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('button')?.dataset.a; if (a) act(a, pauseCard) })
  helpCard.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('button')?.dataset.a; if (a) act(a, helpCard) })
  unlockCard.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('button')?.dataset.a; if (a) act(a, unlockCard) })
  restartBtn.addEventListener('click', () => deps.onRestart())
  soundBtn.addEventListener('click', () => { unlockAudio(); toggleMute() })
  pauseBtn.addEventListener('click', () => deps.onPause())
  nitro.addEventListener('click', () => deps.onBoost())
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') { unlockAudio(); toggleMute() } })
  // Drop focus off any HUD button after use, so Space/Enter (jump/boost during a
  // run) can't re-activate a still-focused button (e.g. "Next level" on repeat).
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (b) b.blur()
  })

  // ---- reactive
  let lastPhase = ''
  const syncOrientationTip = (s = getState()): void => {
    const portrait = window.innerHeight > window.innerWidth
    if (!portrait) {
      rotateTipDismissed = false
      rotateTipManual = false
      rotateTip?.classList.remove('manual')
      const msg = rotateTip?.querySelector('span')
      const btn = rotateTip?.querySelector('button')
      if (msg) msg.textContent = 'Best in landscape'
      if (btn) btn.textContent = 'Rotate'
    }
    const shouldShow = !!rotateTip && !rotateTipDismissed && s.phase === 'running' && !s.paused && portrait && window.innerWidth <= 760
    rotateTip?.classList.toggle('hidden', !shouldShow)
  }
  window.addEventListener('resize', () => syncOrientationTip())
  subscribe((s) => {
    timeT.textContent = fmtTime(s.timeMs)
    if (s.phase === 'running' && s.place) {
      timeD.textContent = `${ordinal(s.place)} of ${s.racerCount}`
      timeD.className = `d ${s.place === 1 ? 'ahead' : 'behind'}`
    } else { timeD.textContent = ''; timeD.className = 'd' }
    corner.innerHTML = `LV ${s.level} · <b>${s.levelName}</b><br/>${s.daily ? 'daily ' : ''}<b>${s.seed}</b>${s.pbMs !== null ? ` · best <b>${fmtTime(s.pbMs)}</b>` : ''}`
    ;(speed.querySelector('b') as HTMLElement).textContent = String(Math.round(s.speed))
    soundBtn.classList.toggle('active', !s.muted)
    const boostPct = Math.round(s.boost * 100)
    nitroFill.style.width = `${boostPct}%`
    nitro.classList.toggle('ready', s.boostReady)
    nitro.classList.toggle('active', s.boostActive)
    nitro.classList.toggle('charging', !s.boostReady && !s.boostActive)
    nitroLbl.textContent = s.boostActive ? 'BURN' : s.boostReady ? 'NITRO READY' : `${boostPct}%`
    tcBoost?.classList.toggle('ready', s.boostReady)
    tcBoost?.classList.toggle('active', s.boostActive)
    tcBoost?.classList.toggle('charging', !s.boostReady && !s.boostActive)
    tcBoost?.style.setProperty('--nitro-pct', `${boostPct}%`)
    const boostMain = tcBoost?.querySelector('.boost-main') as HTMLElement | null
    const boostSub = tcBoost?.querySelector('.boost-sub') as HTMLElement | null
    if (boostMain) boostMain.textContent = s.boostActive ? 'BURN' : 'NITRO'
    if (boostSub) boostSub.textContent = s.boostActive ? 'ACTIVE' : s.boostReady ? 'READY' : `${boostPct}%`

    const hudVisible = s.phase === 'running' && !s.paused
    hud.classList.toggle('show', hudVisible)
    touchControls?.classList.toggle('hidden', !hudVisible)
    syncOrientationTip(s)
    pause.classList.toggle('hidden', !s.paused)
    pauseBtn.style.display = s.phase === 'running' ? '' : 'none'
    // render overlays only on phase transition (state changes every frame while running)
    if (s.phase !== lastPhase) {
      if (s.phase === 'attract') renderStart()
      if (s.phase === 'finished') renderFinish()
      start.classList.toggle('hidden', s.phase !== 'attract')
      fin.classList.toggle('hidden', s.phase !== 'finished')
      unlock.classList.add('hidden')
      // clear any lingering button focus when a run starts (keys are gameplay now)
      if (s.phase === 'running' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
      lastPhase = s.phase
    }
  })

  return {
    toast: (text, cls = '') => {
      const t = el('div', `toast ${cls}`, text)
      toastWrap.appendChild(t)
      while (toastWrap.children.length > 2) toastWrap.firstChild?.remove()
      setTimeout(() => t.remove(), 950)
    },
    banner: (text, cls = '', ms = 2000) => {
      banner.textContent = text
      banner.className = `race-banner show ${cls}`
      if (bannerTimer !== null) clearTimeout(bannerTimer)
      bannerTimer = window.setTimeout(() => banner.classList.remove('show'), ms)
    },
    showFinish: () => { renderFinish() },
    hideOverlays: () => { start.classList.add('hidden'); fin.classList.add('hidden') },
    setDemoInput: (visible, held) => {
      demo.classList.toggle('hidden', !visible)
      demo.classList.toggle('held', held)
      demoLbl.textContent = held ? 'HOLD — dive' : 'RELEASE — fly'
    },
    setCoach: (text) => {
      if (text) { if (coach.textContent !== text) coach.textContent = text; coach.classList.remove('hidden') }
      else coach.classList.add('hidden')
    },
    setLabels: (labels) => {
      while (labelPool.length < labels.length) { const l = el('div', 'comet-label'); labelWrap.appendChild(l); labelPool.push(l) }
      for (let i = 0; i < labelPool.length; i++) {
        const l = labelPool[i]
        if (i < labels.length) {
          const lb = labels[i]
          l.textContent = lb.text
          l.style.color = '#12100a'
          l.style.background = hexc(lb.color)
          l.style.transform = `translate(${Math.round(lb.x - 20)}px, ${Math.round(lb.y - 46)}px)`
          l.classList.remove('hidden')
        } else l.classList.add('hidden')
      }
    },
    setRacerDots: (dots) => {
      while (dotsWrap.children.length < dots.length) dotsWrap.appendChild(el('span', 'course-dot'))
      const els = dotsWrap.children
      for (let i = 0; i < els.length; i++) {
        const d = els[i] as HTMLElement
        if (i < dots.length) {
          const rd = dots[i]
          d.style.display = 'block'
          d.style.left = `${(rd.frac * 100).toFixed(2)}%`
          d.style.background = hexc(rd.color)
          d.style.boxShadow = `0 0 ${rd.isPlayer ? 9 : 5}px ${hexc(rd.color)}`
          d.style.zIndex = rd.isPlayer ? '3' : '2'
          d.style.width = d.style.height = rd.isPlayer ? '10px' : '8px'
        } else d.style.display = 'none'
      }
    },
  }
}
