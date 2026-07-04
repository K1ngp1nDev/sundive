import { fmtDelta, fmtTime, getState, setState, subscribe } from '../core/state'
import { toggleMute, unlockAudio } from '../core/audio'

export interface HudDeps {
  onRestart: () => void
  onMode: (mode: 'daily' | 'free') => void
  shareText: () => string
}

export interface Hud {
  toast: (text: string, cls?: string) => void
  showFinish: () => void
  hideOverlays: () => void
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
  const corner = el('div', 'panel hud-corner')
  const btns = el('div', 'hud-btns')
  const restartBtn = el('button', 'icon-btn', '↺')
  restartBtn.title = 'Restart (R)'
  const soundBtn = el('button', 'icon-btn', '♪')
  soundBtn.title = 'Sound (M)'
  btns.append(restartBtn, soundBtn)
  const speed = el('div', 'panel hud-speed', `<b>0</b> m/s`)
  hud.append(time, corner, btns, speed)
  root.appendChild(hud)

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
    <div class="kicker">One button · race the ghost</div>
    <div class="title">SUNDIVE</div>
    <div class="sub"><b>Hold</b> to dive &nbsp;·&nbsp; <b>release</b> to soar</div>
    <div class="mode-row">
      <button class="big-btn" data-a="go">Ride</button>
      <button class="ghost-btn" data-a="daily">Daily</button>
      <button class="ghost-btn" data-a="free">Free run</button>
    </div>
    <div class="hint-line">press and hold anywhere — the comet is already falling</div>`
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
    const deltaCls = vsGhost !== null && vsGhost <= 0 ? 'ahead' : 'behind'
    finCard.innerHTML = `
      <div class="kicker">${s.mode === 'daily' ? `Daily · ${s.seed}` : `Canyon · ${s.seed}`}</div>
      <div class="fin-time">${s.lastMs !== null ? fmtTime(s.lastMs) : '—'}</div>
      ${vsGhost !== null ? `<div class="fin-delta ${deltaCls}">${fmtDelta(vsGhost)} vs ${s.ghostSource === 'pb' ? 'your best' : 'the ghost'}</div>` : ''}
      ${s.newBest ? '<div class="newbest">New best</div>' : s.pbMs !== null ? `<div class="fin-best">best ${fmtTime(s.pbMs)}</div>` : ''}
      <div class="mode-row">
        <button class="big-btn" data-a="retry">Ride again</button>
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
    showFinish: () => {
      renderFinish()
      setState({ ...getState() })
    },
    hideOverlays: () => {
      start.classList.add('hidden')
      fin.classList.add('hidden')
    },
  }
}
