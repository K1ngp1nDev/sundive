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

  // the Race button actually starts a run
  await page.click('.big-btn', { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(200)
  check('Race button starts the run', (await S(page, 'phase')) === 'running', `phase=${await S(page, 'phase')}`)

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

  // obstacles never trap: a slow, non-jumping comet must clear every obstacle
  await S(page, 'restart'); await S(page, 'autopilot', false); await S(page, 'hold', false); await S(page, 'simSpeed', 40)
  let trapped = false, lastX = -999, plateau = 0, lastTk = 0
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(60)
    if ((await S(page, 'phase')) === 'finished') break
    const x = (await S(page, 'pos'))[0], tk = await S(page, 'tick')
    if (Math.abs(x - lastX) < 3 && tk - lastTk > 200) { plateau += tk - lastTk; if (plateau > 500) { trapped = true; break } }
    else plateau = 0
    lastX = x; lastTk = tk
  }
  await S(page, 'hold', null); await S(page, 'simSpeed', 1)
  check('obstacles never trap (slow comet clears all)', !trapped && (await S(page, 'phase')) === 'finished', trapped ? `stuck near x=${Math.round(lastX)}` : 'reached finish')

  // a hop rises clear of the hazard gate (apex clearance > the 1.9m collision gate)
  await S(page, 'restart'); await S(page, 'autopilot', false); await S(page, 'hold', false); await S(page, 'simSpeed', 1)
  await page.waitForFunction(() => window.__SUNDIVE__.grounded() && window.__SUNDIVE__.timeMs() > 300, { timeout: 8000 })
  await S(page, 'jump')
  let apex = 0
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(35); apex = Math.max(apex, await S(page, 'clr')) }
  await S(page, 'hold', null)
  check('jump clears the hazard gate (apex > 1.9m)', apex > 2.4, `apex clearance ${apex.toFixed(2)}m vs 1.9m gate`)

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

// ---- track features: pits never trap (bots + slow player), trampolines bounce
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const { page, errors } = await open(ctx, `${URL}/?qa=1&date=2026-07-04&level=6`)
  // bots must finish a level that has pits (nobody trapped in a hole)
  await S(page, 'restart'); await S(page, 'autopilot', true); await S(page, 'simSpeed', 250)
  let botFin = false
  try { await page.waitForFunction(() => window.__SUNDIVE__.phase() === 'finished', { timeout: 45000 }); botFin = true } catch { /* timed out */ }
  await S(page, 'simSpeed', 1); await S(page, 'autopilot', false)
  check('pit level finishes on autopilot (no trap)', botFin, `place=${await S(page, 'place')}`)

  // slow, non-jumping player falls into a pit and respawns (teleports back), never stuck
  await S(page, 'restart'); await S(page, 'autopilot', false); await S(page, 'hold', false); await S(page, 'simSpeed', 20)
  let respawned = false, maxX = -999
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(30)
    if ((await S(page, 'phase')) === 'finished') break
    const x = (await S(page, 'pos'))[0]
    if (x < maxX - 10) { respawned = true; break }
    maxX = Math.max(maxX, x)
  }
  await S(page, 'hold', null); await S(page, 'simSpeed', 1)
  check('pit respawn works (fall -> resurrect earlier)', respawned, respawned ? 'respawned' : 'no respawn')

  // trampoline: cross a pad and the comet launches high
  const pads = await S(page, 'pads')
  if (pads.length) {
    const pad = pads[0]
    await S(page, 'restart'); await S(page, 'autopilot', false); await S(page, 'hold', false); await S(page, 'simSpeed', 5)
    let apex = 0, reached = false
    for (let i = 0; i < 500; i++) {
      await page.waitForTimeout(20)
      if ((await S(page, 'phase')) === 'finished') break
      const x = (await S(page, 'pos'))[0]
      if (x > pad - 30 && x < pad + 40) apex = Math.max(apex, await S(page, 'clr'))
      if (x > pad + 40) { reached = true; break }
    }
    await S(page, 'hold', null); await S(page, 'simSpeed', 1)
    check('trampoline bounces the comet', reached && apex > 6, `apex ${apex.toFixed(1)}m`)
  }
  check('no console errors (features level)', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean')
  await ctx.close()
}

// ---- controls: brake / reverse / pause (hybrid WASD scheme)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const { page } = await open(ctx, `${URL}/?qa=1&date=2026-07-04&level=3`)
  await S(page, 'begin'); await S(page, 'restart'); await S(page, 'simSpeed', 8)
  await page.waitForTimeout(250)
  const cruise = (await S(page, 'vel'))[0]
  await page.keyboard.down('KeyS'); await page.waitForTimeout(450); const braked = (await S(page, 'vel'))[0]; await page.keyboard.up('KeyS')
  check('brake (S) stops the comet', cruise > 10 && braked < cruise * 0.4, `${cruise.toFixed(0)} -> ${braked.toFixed(0)}`)
  await page.keyboard.down('KeyA'); await page.waitForTimeout(500); const rev = (await S(page, 'vel'))[0]; await page.keyboard.up('KeyA')
  check('reverse (A) drives backward', rev < -5, `vx ${rev.toFixed(0)}`)
  await S(page, 'simSpeed', 1); await page.waitForTimeout(100)
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  const p1 = (await S(page, 'state')).paused, tk1 = await S(page, 'tick')
  await page.waitForTimeout(300); const tk2 = await S(page, 'tick')
  await page.keyboard.press('Escape'); await page.waitForTimeout(60); const resumed = !(await S(page, 'state')).paused
  check('pause (Esc) freezes + resumes', p1 && tk1 === tk2 && resumed, `paused=${p1} frozen=${tk1 === tk2} resumed=${resumed}`)
  await ctx.close()
}

// ---- level-select stays clickable after a race (hidden finish card must not eat clicks)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const { page } = await open(ctx, `${URL}/?qa=1&date=2026-07-04`)
  await page.evaluate(() => localStorage.setItem('sundive:unlocked', '3'))
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.__SUNDIVE__?.ready === true, { timeout: 20000 })
  // race level 3 to the finish, then return to the level menu
  await S(page, 'setLevel', 3, true); await S(page, 'begin'); await S(page, 'autopilot', true); await S(page, 'simSpeed', 300)
  await page.waitForFunction(() => window.__SUNDIVE__.phase() === 'finished', { timeout: 40000 })
  await S(page, 'simSpeed', 1); await S(page, 'autopilot', false)
  await page.click('.overlay:not(.hidden) [data-a="menu"]'); await page.waitForTimeout(150)
  // click the centre level button (Lv3) — pre-fix the invisible finish card swallowed this
  let clickErr = ''
  try { await page.click('.lvl-btn[data-lvl="3"]', { timeout: 4000 }) } catch (e) { clickErr = String(e).slice(0, 80) }
  await page.waitForTimeout(120)
  const name = await page.$eval('.level-name', (e) => e.textContent)
  check('level select clickable after a race (Lv3)', !clickErr && /Lv 3/.test(name), clickErr || name)
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
