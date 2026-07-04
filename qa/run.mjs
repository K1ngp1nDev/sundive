// SUNDIVE QA — run `npm run build` first (serves the production build).
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import { preview } from 'vite'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const server = await preview({ preview: { port: 4322, strictPort: true } })
const browser = await chromium.launch()
const URL = 'http://localhost:4322'

async function open(ctx, url) {
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PE:' + e.message))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__SUNDIVE__?.ready === true, { timeout: 20000 })
  return { page, errors }
}
const S = (page, fn, ...a) => page.evaluate(({ fn, a }) => window.__SUNDIVE__[fn](...a), { fn, a })

// ---- main pass
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const { page, errors } = await open(ctx, `${URL}/?qa=1&date=2026-07-04`)
  await page.waitForTimeout(600)
  check('app loads', true)

  // canvas non-blank
  const buf = await page.locator('#stage canvas').screenshot()
  const png = PNG.sync.read(buf)
  let sum = 0, sumSq = 0
  const n = png.width * png.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const l = 0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2]
    sum += l; sumSq += l * l
  }
  const variance = sumSq / n - (sum / n) ** 2
  check('canvas non-blank (pixel variance)', variance > 40, `variance=${variance.toFixed(0)}`)

  // hold/release changes trajectory (deterministic compare over the same ticks)
  await S(page, 'begin')
  await S(page, 'restart')
  await S(page, 'hold', false)
  await S(page, 'simSpeed', 50)
  await page.waitForFunction(() => window.__SUNDIVE__.tick() >= 240, { timeout: 8000 })
  await S(page, 'simSpeed', 0.0001)
  const freePos = await S(page, 'pos')
  const freeVel = await S(page, 'vel')
  await S(page, 'restart')
  await S(page, 'hold', true)
  await S(page, 'simSpeed', 50)
  await page.waitForFunction(() => window.__SUNDIVE__.tick() >= 240, { timeout: 8000 })
  await S(page, 'simSpeed', 0.0001)
  const heldPos = await S(page, 'pos')
  const heldVel = await S(page, 'vel')
  await S(page, 'hold', null)
  const dy = Math.abs(freePos[1] - heldPos[1])
  const dv = Math.abs(Math.hypot(...freeVel) - Math.hypot(...heldVel))
  check('hold/release changes velocity & trajectory', dy > 0.5 || dv > 1, `Δy=${dy.toFixed(1)} Δ|v|=${dv.toFixed(1)}`)

  // finish reachable deterministically (autopilot + fast-forward)
  await S(page, 'restart')
  await S(page, 'autopilot', true)
  await S(page, 'simSpeed', 200)
  await page.waitForFunction(() => window.__SUNDIVE__.phase() === 'finished', { timeout: 30000 })
  await S(page, 'simSpeed', 1)
  const st1 = await S(page, 'state')
  check('finish reachable in deterministic test mode', st1.phase === 'finished' && st1.lastMs > 10000, `t=${(st1.lastMs / 1000).toFixed(1)}s`)

  // PB saved
  const pbStored = await page.evaluate(() => localStorage.getItem(`sundive:pb:${window.__SUNDIVE__.seed()}`))
  check('PB saves after finish', st1.pbMs !== null && pbStored !== null, `pb=${st1.pbMs?.toFixed(0)}ms`)

  // ghost appears (as PB) on second run
  await S(page, 'restart')
  await page.waitForTimeout(300)
  const src = await S(page, 'ghostSource')
  check('ghost appears on second run', src === 'pb', `source=${src}`)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 160) || 'clean')
  await ctx.close()
}

// ---- daily seed stability
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const a = await open(ctx, `${URL}/?qa=1&date=2026-07-04`)
  const seedA = await S(a.page, 'seed')
  const b = await open(ctx, `${URL}/?qa=1&date=2026-07-04`)
  const seedB = await S(b.page, 'seed')
  const c = await open(ctx, `${URL}/?qa=1&date=2026-07-05`)
  const seedC = await S(c.page, 'seed')
  check('daily seed stable for same date', seedA === seedB && seedA !== seedC, `${seedA} / ${seedC}`)
  await ctx.close()
}

// ---- reduced motion does not break the game
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const { page, errors } = await open(ctx, `${URL}/?qa=1&date=2026-07-04&reduce=1`)
  await S(page, 'begin')
  await S(page, 'autopilot', true)
  await S(page, 'simSpeed', 30)
  await page.waitForTimeout(1500)
  const tick = await S(page, 'tick')
  const reduced = (await S(page, 'state')).reducedMotion
  check('reduced-motion does not break game', tick > 500 && reduced === true && errors.length === 0, `ticks=${tick}`)
  await ctx.close()
}

// ---- overflow at 4 widths
for (const width of [360, 390, 768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 500, isMobile: width < 500 })
  const { page } = await open(ctx, `${URL}/?qa=1&date=2026-07-04`)
  await page.waitForTimeout(400)
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  check(`no horizontal overflow @ ${width}px`, o.doc <= 0 && o.body <= 0, JSON.stringify(o))
  await ctx.close()
}

// ---- screenshots
const DIR = 'docs/screenshots'
const expected = ['sundive-start.png', 'sundive-speed.png', 'sundive-ghost-race.png', 'sundive-launch.png', 'sundive-finish.png', 'sundive-mobile.png']
if (!existsSync(DIR) || readdirSync(DIR).length === 0) {
  check('screenshots present (run `npm run shots`)', false, 'docs/screenshots is empty')
} else {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'))
  const missing = expected.filter((f) => !files.includes(f))
  check('screenshots present (all 6)', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${files.length} files`)
  let ok = true
  const bad = []
  for (const f of files) {
    const p = PNG.sync.read(readFileSync(`${DIR}/${f}`))
    if (p.width > 4000 || p.height > 4000) { ok = false; bad.push(`${f}:${p.width}x${p.height}`) }
  }
  check('screenshots ≤ 4000×4000', ok, bad.join(', ') || 'all within limits')
}

await browser.close()
await server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\nQA: ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(' · ')); process.exit(1) }
process.exit(0)
