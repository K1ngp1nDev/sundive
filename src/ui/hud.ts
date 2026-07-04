import { fmtDelta, fmtTime, getState, setState, subscribe } from '../core/state'
import { toggleMute, unlockAudio } from '../core/audio'

export interface HudDeps {
  onRestart: () => void
  onMode: (mode: 'daily' | 'free') => void
  shareText: () => string
}

export interface Hud {
  toast: (text: string, cls?: string) => void
  banner: (text: string, cls?: string, ms?: number) => void
  showFinish: () => void
  hideOverlays: () => void
  /** Big pulsing input demo — mirrors the (bot or player) hold state. */
  setDemoInput: (visible: boolean, held: boolean) => void
  /** First-run coach line ("HOLD — dive!"); null hides. */
  setCoach: (text: string | null) => void
  /** Comet labels in screen px; null hides. */
  setLabels: (you: { x: number; y: number } | null, ghost: { x: number; y: number } | null) => void
  setGhostTime: (ms: number | null) => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

export function createHud(deps: HudDeps): Hud {
  const root = document.getElementById('ui')!

  // --- in-game HUD
  const hud = el('div', 'hud')
  const time = el('div', 'panel hud-time', `<div class="t">0:00.00</div><div class="d"></div>`)
  const timeT = time.querySelector('.t') as HTMLElement
  const timeD = time.querySelector('.d') as HTMLElement

  // course progress strip: you + ghost racing toward the finish flag
  const strip = el('div', 'panel course')
  strip.innerHTML = `
    <div class="course-line"></div>
    <div class="course-dot ghost" title="ghost"></div>
    <div class="course-dot you" title="you"></div>
    <div class="course-flag">🏁</div>`
  const dotYou = strip.querySelector('.you') as HTMLElement
  const dotGhost = strip.querySelector('.ghost') as HTMLElement
  const corner = el('div', 'panel hud-corner')
  const btns = el('div', 'hud-btns')
  const restartBtn = el('button', 'icon-btn', '↺')
  restartBtn.title = 'Restart (R)'
  const soundBtn = el('button', 'icon-btn', '♪')
  soundBtn.title = 'Sound (M)'
  btns.append(restartBtn, soundBtn)
  const speed = el('div', 'panel hud-speed', `<b>0</b> m/s`)
  hud.append(time, strip, corner, btns, speed)
  root.appendChild(hud)

  // demo input bubble (attract + first run): shows HOLD/RELEASE cause->effect
  const demo = el('div', 'demo-input hidden')
  demo.innerHTML = `<span class="ring"></span><span class="lbl">HOLD</span>`
  const demoLbl = demo.querySelector('.lbl') as HTMLElement
  root.appendChild(demo)

  // coach line (first run)
  const coach = el('div', 'coach hidden')
  root.appendChild(coach)

  // big race banner (goal at start, overtakes, verdicts)
  const banner = el('div', 'race-banner')
  root.appendChild(banner)
  let bannerTimer: number | null = null

  // comet labels
  const labYou = el('div', 'comet-label you-label hidden', 'YOU')
  const labGhost = el('div', 'comet-label ghost-label hidden', 'GHOST')
  root.appendChild(labYou)
  root.appendChild(labGhost)

  // --- toasts
  const toastWrap = el('div', 'toast-wrap')
  root.appendChild(toastWrap)

  // --- bottom hint
  const hint = el('div', 'panel bottom-hint', '<b>Hold</b> to dive · release to soar')
  root.appendChild(hint)

  // --- start overlay
  const start = el('div', 'overlay')
  const startCard = el('div', 'panel card')
  startCard.innerHTML = `
    <div class="kicker">One button · one race</div>
    <div class="title">SUNDIVE</div>
    <div class="sub goal-line">Race the ghost to the finish line.</div>
    <div class="sub"><b>Hold</b> to dive down slopes &nbsp;·&nbsp; <b>release</b> at a crest to fly</div>
    <div class="sub ghost-time-line"></div>
    <div class="mode-row">
      <button class="big-btn" data-a="go">Ride</button>
      <button class="ghost-btn" data-a="daily">Daily</button>
      <button class="ghost-btn" data-a="free">Free run</button>
    </div>
    <div class="hint-line">press and hold anywhere — the comet is already falling</div>`
  const ghostTimeLine = startCard.querySelector('.ghost-time-line') as HTMLElement
  start.appendChild(startCard)
  root.appendChild(start)

  // --- finish overlay
  const fin = el('div', 'overlay hidden')
  const finCard = el('div', 'panel card')
  fin.appendChild(finCard)
  root.appendChild(fin)

  const renderFinish = (): void => {
    const s = getState()
    const vsGhost = s.deltaMs
    const won = vsGhost !== null && vsGhost <= 0
    const rival = s.ghostSource === 'pb' ? 'your best self' : 'the ghost'
    const verdict =
      vsGhost === null
        ? 'Finish'
        : won
          ? `You beat ${rival}`
          : `${s.ghostSource === 'pb' ? 'Your best self won' : 'The ghost won'}`
    const deltaCls = won ? 'ahead' : 'behind'
    finCard.innerHTML = `
      <div class="kicker">${s.mode === 'daily' ? `Daily · ${s.seed}` : `Canyon · ${s.seed}`}</div>
      <div class="fin-verdict ${deltaCls}">${verdict}</div>
      <div class="fin-time">${s.lastMs !== null ? fmtTime(s.lastMs) : '—'}</div>
      ${vsGhost !== null ? `<div class="fin-delta ${deltaCls}">${fmtDelta(vsGhost)} vs ${s.ghostSource === 'pb' ? 'your best' : 'the ghost'}</div>` : ''}
      ${s.newBest ? '<div class="newbest">New best — your ghost just got faster</div>' : s.pbMs !== null ? `<div class="fin-best">best ${fmtTime(s.pbMs)}</div>` : ''}
      <div class="mode-row">
        <button class="big-btn ${won ? '' : 'pulse'}" data-a="retry">${won ? 'Ride again' : 'One more try'}</button>
        <button class="ghost-btn" data-a="share">Share</button>
        <button class="ghost-btn" data-a="${getState().mode === 'daily' ? 'free' : 'daily'}">${getState().mode === 'daily' ? 'Free run' : 'Daily'}</button>
      </div>
      <div class="share-note"></div>
      <div class="hint-line">R — instant retry</div>`
  }

  // --- wiring
  const onAction = (a: string, card: HTMLElement) => {
    unlockAudio()
    if (a === 'go' || a === 'retry') deps.onRestart()
    else if (a === 'daily') deps.onMode('daily')
    else if (a === 'free') deps.onMode('free')
    else if (a === 'share') {
      const text = deps.shareText()
      const note = card.querySelector('.share-note') as HTMLElement | null
      navigator.clipboard
        ?.writeText(text)
        .then(() => note && (note.textContent = 'copied to clipboard ✓'))
        .catch(() => note && (note.textContent = text))
    }
  }
  startCard.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a
    if (a) onAction(a, startCard)
  })
  finCard.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a
    if (a) onAction(a, finCard)
  })
  restartBtn.addEventListener('click', () => deps.onRestart())
  soundBtn.addEventListener('click', () => {
    unlockAudio()
    toggleMute()
  })
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      unlockAudio()
      toggleMute()
    }
  })

  // --- reactive
  let hintTimer: number | null = null
  subscribe((s) => {
    timeT.textContent = fmtTime(s.timeMs)
    if (s.deltaMs !== null) {
      timeD.textContent = `${fmtDelta(s.deltaMs)} ${s.ghostSource === 'pb' ? 'vs best' : 'vs ghost'}`
      timeD.className = `d ${s.deltaMs <= 0 ? 'ahead' : 'behind'}`
    } else {
      timeD.textContent = s.ghostSource === 'none' ? '' : s.ghostSource === 'pb' ? 'racing your best' : 'racing the ghost'
      timeD.className = 'd'
    }
    corner.innerHTML = `${s.mode === 'daily' ? 'DAILY' : 'FREE'} · <b>${s.seed}</b>${s.pbMs !== null ? `<br/>best <b>${fmtTime(s.pbMs)}</b>` : ''}`
    ;(speed.querySelector('b') as HTMLElement).textContent = String(Math.round(s.speed))
    soundBtn.classList.toggle('active', !s.muted)
    dotYou.style.left = `${(s.progress * 100).toFixed(2)}%`
    dotGhost.style.left = `${(s.ghostProgress * 100).toFixed(2)}%`

    hud.classList.toggle('show', s.phase !== 'attract')
    start.classList.toggle('hidden', s.phase !== 'attract')
    fin.classList.toggle('hidden', s.phase !== 'finished')

    if (s.phase === 'running' && hintTimer === null) {
      hintTimer = window.setTimeout(() => hint.classList.add('hidden'), 3500)
    }
    if (s.phase === 'attract') {
      hint.classList.remove('hidden')
      if (hintTimer !== null) {
        clearTimeout(hintTimer)
        hintTimer = null
      }
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
    showFinish: () => {
      renderFinish()
      setState({ ...getState() })
    },
    hideOverlays: () => {
      start.classList.add('hidden')
      fin.classList.add('hidden')
    },
    setDemoInput: (visible, held) => {
      demo.classList.toggle('hidden', !visible)
      demo.classList.toggle('held', held)
      demoLbl.textContent = held ? 'HOLD — dive' : 'RELEASE — fly'
    },
    setCoach: (text) => {
      if (text) {
        if (coach.textContent !== text) coach.textContent = text
        coach.classList.remove('hidden')
      } else coach.classList.add('hidden')
    },
    setLabels: (you, ghost) => {
      if (you) {
        labYou.classList.remove('hidden')
        labYou.style.transform = `translate(${Math.round(you.x - 20)}px, ${Math.round(you.y - 44)}px)`
      } else labYou.classList.add('hidden')
      if (ghost) {
        labGhost.classList.remove('hidden')
        labGhost.style.transform = `translate(${Math.round(ghost.x - 28)}px, ${Math.round(ghost.y - 44)}px)`
      } else labGhost.classList.add('hidden')
    },
    setGhostTime: (ms) => {
      ghostTimeLine.innerHTML = ms !== null ? `today's ghost finishes in <b>${fmtTime(ms)}</b> — beat it` : ''
    },
  }
}
