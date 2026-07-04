// Captures the 6 documentation screenshots. Run `npm run build` first.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { preview } from 'vite'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const server = await preview({ preview: { port: 4323, strictPort: true } })
const browser = await chromium.launch()
const URL = 'http://localhost:4323'

async function open(ctx, url) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__SUNDIVE__?.ready === true, { timeout: 20000 })
  return page
}
const S = (page, fn, ...a) => page.evaluate(({ fn, a }) => window.__SUNDIVE__[fn](...a), { fn, a })
async function hunt(page, pred, budget = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) { if (await page.evaluate(pred)) return true; await page.waitForTimeout(120) }
  console.log('WARN: moment not found')
  return false
}

const desk = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
// unlock all levels before boot so the 10-level select renders alive
await desk.addInitScript(() => { try { localStorage.setItem('sundive:unlocked', '10') } catch { /* ignore */ } })
// start / level select — Aurora biome
const page = await open(desk, `${URL}/?qa=1&date=2026-07-04&level=3`)
await S(page, 'setLevel', 3, true)
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/sundive-start.png` })
console.log('shot sundive-start')

// helper: load a level and race a few seconds in
async function raceInto(level, pred) {
  await S(page, 'setLevel', level, true)
  await S(page, 'begin'); await S(page, 'autopilot', true); await S(page, 'simSpeed', 2)
  await hunt(page, pred)
  await S(page, 'simSpeed', 1); await page.waitForTimeout(60)
}

// race — Ember biome (rocks, pits, trampolines on the track)
await raceInto(6, () => window.__SUNDIVE__.timeMs() > 5000 && window.__SUNDIVE__.timeMs() < 11000)
await page.screenshot({ path: `${OUT}/sundive-race.png` })
console.log('shot sundive-race')

// boost — fire nitro on the ember descent
await S(page, 'fireBoost'); await page.waitForTimeout(90)
await page.screenshot({ path: `${OUT}/sundive-boost.png` })
console.log('shot sundive-boost')

// launch — airborne over an Ice canyon
await raceInto(8, () => { const v = window.__SUNDIVE__.vel(); return !window.__SUNDIVE__.grounded() && v[1] > 8 && window.__SUNDIVE__.speed() > 40 })
await page.screenshot({ path: `${OUT}/sundive-launch.png` })
console.log('shot sundive-launch')

// finish — Void biome
await S(page, 'setLevel', 10, true); await S(page, 'begin'); await S(page, 'autopilot', true); await S(page, 'simSpeed', 150)
await hunt(page, () => window.__SUNDIVE__.phase() === 'finished')
await S(page, 'simSpeed', 1); await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/sundive-finish.png` })
console.log('shot sundive-finish')
await desk.close()

// mobile — Aurora biome
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const mp = await open(mob, `${URL}/?qa=1&date=2026-07-04&level=4`)
await S(mp, 'begin'); await S(mp, 'autopilot', true); await S(mp, 'simSpeed', 2)
await hunt(mp, () => window.__SUNDIVE__.speed() > 45)
await S(mp, 'simSpeed', 1)
await mp.screenshot({ path: `${OUT}/sundive-mobile.png` })
console.log('shot sundive-mobile')
await mob.close()

await browser.close()
await server.close()
console.log('screenshots done')
process.exit(0)
