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

/** Poll a predicate every 150 ms with a generous budget; logs on timeout. */
async function huntMoment(page, name, predicate, budgetMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < budgetMs) {
    const hit = await page.evaluate(predicate)
    if (hit) return true
    await page.waitForTimeout(150)
  }
  console.log(`WARN: moment "${name}" not found in ${budgetMs}ms — capturing as-is`)
  return false
}

const desk = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await open(desk, `${URL}/?qa=1&date=2026-07-04`)

// start (attract + overlay)
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}/sundive-start.png` })
console.log('shot sundive-start')

// build a PB first so later shots race the PB ghost
await S(page, 'begin')
await S(page, 'autopilot', true)
await S(page, 'simSpeed', 150)
await huntMoment(page, 'finish', () => window.__SUNDIVE__.phase() === 'finished')
await S(page, 'simSpeed', 1)
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/sundive-finish.png` })
console.log('shot sundive-finish')

// second run vs PB ghost — faster bot so the ghost visibly trails behind
await S(page, 'restart')
await S(page, 'botSloppiness', 0.12)
await S(page, 'autopilot', true)
await S(page, 'simSpeed', 2)
await huntMoment(page, 'speed', () => window.__SUNDIVE__.speed() > 55 && window.__SUNDIVE__.grounded())
await S(page, 'simSpeed', 1)
await page.waitForTimeout(60)
await page.screenshot({ path: `${OUT}/sundive-speed.png` })
console.log('shot sundive-speed')

// launch: airborne, rising
await S(page, 'simSpeed', 2)
await huntMoment(page, 'launch', () => {
  const v = window.__SUNDIVE__.vel()
  return !window.__SUNDIVE__.grounded() && v[1] > 5 && window.__SUNDIVE__.speed() > 35
})
await S(page, 'simSpeed', 1)
await page.screenshot({ path: `${OUT}/sundive-launch.png` })
console.log('shot sundive-launch')

// ghost race: fresh run with a slightly different pace — ghost visibly alongside
await S(page, 'restart')
await S(page, 'botSloppiness', 0.5)
await S(page, 'autopilot', true)
await huntMoment(page, 'ghost-race', () => window.__SUNDIVE__.timeMs() > 5500)
await page.screenshot({ path: `${OUT}/sundive-ghost-race.png` })
console.log('shot sundive-ghost-race')
await desk.close()

// mobile
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const mp = await open(mob, `${URL}/?qa=1&date=2026-07-04`)
await S(mp, 'begin')
await S(mp, 'autopilot', true)
await S(mp, 'simSpeed', 2)
await huntMoment(mp, 'mobile-speed', () => window.__SUNDIVE__.speed() > 40)
await S(mp, 'simSpeed', 1)
await mp.screenshot({ path: `${OUT}/sundive-mobile.png` })
console.log('shot sundive-mobile')
await mob.close()

await browser.close()
await server.close()
console.log('screenshots done')
process.exit(0)
