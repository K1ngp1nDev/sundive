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

// ---- main pass (level 2 = 2 rivals)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const { page, errors } = await open(ctx, `${URL}/?qa=1&date=2026-07-04&level=2`)
  await page.waitForTimeout(600)
  check('app loads', true)

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

  check('level 2 has 2 rivals', (await S(page, 'opponents')) === 2, `opponents=${await S(page, 'opponents')}`)

  // hold/release changes trajectory
  await S(page, 'begin'); await S(page, 'restart')
  await S(page, 'hold', false); await S(page, 'simSpeed', 50)
  await page.waitForFunction(() => window.__SUNDIVE__.tick() >= 240, { timeout: 8000 })
  await S(page, 'simSpeed', 0.0001)
  const freeY = (await S(page, 'pos'))[1]
  await S(page, 'restart')
  await S(page, 'hold', true); await S(page, 'simSpeed', 50)
  await page.waitForFunction(() => window.__SUNDIVE__.tick() >= 240, { timeout: 8000 })
  await S(page, 'simSpeed', 0.0001)
  const heldY = (await S(page, 'pos'))[1]
  await S(page, 'hold', null)
  check('hold/release changes trajectory', Math.abs(freeY - heldY) > 0.5, `Δy=${Math.abs(freeY - heldY).toFixed(1)}`)

  // jump works (Space): rises off the ground
  await S(page, 'restart'); await S(page, 'hold', false); await S(page, 'simSpeed', 1)
  await page.waitForFunction(() => window.__SUNDIVE__.grounded() && window.__SUNDIVE__.timeMs() > 300, { timeout: 8000 })
  const baseY = (await S(page, 'pos'))[1]
  await S(page, 'jump')
  let maxY = baseY
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(40); maxY = Math.max(maxY, (await S(page, 'pos'))[1]) }
  check('jump works (Space)', maxY > baseY + 0.6, `Δy ${(maxY - baseY).toFixed(2)} m`)

  // boost works (nitro): speed spikes
  await S(page, 'restart'); await S(page, 'hold', true)
  await page.waitForTimeout(500)
  const s0 = await S(page, 'speed')
  await S(page, 'fireBoost')
  let sPeak = s0
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(30); sPeak = Math.max(sPeak, await S(page, 'speed')) }
  await S(page, 'hold', null)
  check('boost works (nitro)', sPeak > s0 + 8, `speed ${s0.toFixed(0)}→${sPeak.toFixed(0)}`)

  // opponent can be stunned
  await S(page, 'restart')
  await S(page, 'stunNearest')
  await page.waitForTimeout(60)
  check('opponent can be stunned', await S(page, 'opponentStunned'), '')

  // finish reachable + placement
  await S(page, 'restart'); await S(page, 'autopilot', true); await S(page, 'simSpeed', 200)
  await page.waitForFunction(() => window.__SUNDIVE__.phase() === 'finished', { timeout: 30000 })
  await S(page, 'simSpeed', 1)
  const st = await S(page, 'state')
  check('finish reachable + placement', st.phase === 'finished' && st.place >= 1 && st.lastMs > 8000, `place=${st.place} t=${(st.lastMs / 1000).toFixed(1)}s`)

  // PB saved
  const pb = await page.evaluate(() => localStorage.getItem(`sundive:pb:${window.__SUNDIVE__.seed()}:L${window.__SUNDIVE__.level()}`))
  check('PB saves after finish', st.pbMs !== null && pb !== null, `pb=${st.pbMs?.toFixed(0)}`)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 160) || 'clean')
  await ctx.close()
}

// ---- daily seed stability
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const a = await open(ctx, `${URL}/?qa=1&date=2026-07-04`)
  const sa = await S(a.page, 'seed')
  const b = await open(ctx, `${URL}/?qa=1&date=2026-07-05`)
  const sb = await S(b.page, 'seed')
  check('daily seed stable & date-driven', sa === '2026-07-04' && sb === '2026-07-05', `${sa} / ${sb}`)
  await ctx.close()
}

// ---- reduced motion
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const { page, errors } = await open(ctx, `${URL}/?qa=1&date=2026-07-04&reduce=1`)
  await S(page, 'begin'); await S(page, 'autopilot', true); await S(page, 'simSpeed', 30)
  await page.waitForTimeout(1500)
  check('reduced-motion does not break game', (await S(page, 'tick')) > 500 && errors.length === 0, `ticks=${await S(page, 'tick')}`)
  await ctx.close()
}

// ---- overflow
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
const expected = ['sundive-start.png', 'sundive-race.png', 'sundive-boost.png', 'sundive-launch.png', 'sundive-finish.png', 'sundive-mobile.png']
if (!existsSync(DIR) || readdirSync(DIR).length === 0) {
  check('screenshots present (run `npm run shots`)', false, 'empty')
} else {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'))
  const missing = expected.filter((f) => !files.includes(f))
  check('screenshots present (all 6)', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${files.length} files`)
  let ok = true
  const bad = []
  for (const f of files) { const p = PNG.sync.read(readFileSync(`${DIR}/${f}`)); if (p.width > 4000 || p.height > 4000) { ok = false; bad.push(f) } }
  check('screenshots ≤ 4000×4000', ok, bad.join(', ') || 'all within limits')
}

await browser.close()
await server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\nQA: ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(' · ')); process.exit(1) }
process.exit(0)
