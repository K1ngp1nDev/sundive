import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ preview: { port: 4321, strictPort: true } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('PE:' + e.message))
await page.goto('http://localhost:4321/?qa=1&date=2026-07-04', { waitUntil: 'load' })
await page.waitForFunction(() => window.__SUNDIVE__?.ready === true, { timeout: 20000 })
const S = (fn, ...a) => page.evaluate(({ fn, a }) => window.__SUNDIVE__[fn](...a), { fn, a })

await page.waitForTimeout(1500)
await page.screenshot({ path: 'scripts/peek-start.png' })

// begin + autopilot to mid-run
await S('begin')
await S('autopilot', true)
await S('simSpeed', 30)
await page.waitForTimeout(1200)
await S('simSpeed', 1)
await page.waitForTimeout(400)
console.log('pos:', (await S('pos')).map((n) => n.toFixed(0)), 'speed:', (await S('speed')).toFixed(1), 'phase:', await S('phase'))
await page.screenshot({ path: 'scripts/peek-mid.png' })

// to finish
await S('simSpeed', 60)
await page.waitForFunction(() => window.__SUNDIVE__.phase() === 'finished', { timeout: 30000 })
await S('simSpeed', 1)
await page.waitForTimeout(600)
await page.screenshot({ path: 'scripts/peek-finish.png' })
console.log('finished:', (await S('state')).lastMs, 'pb:', (await S('state')).pbMs, 'ghostSource:', await S('ghostSource'))

// second run: PB ghost should appear
await S('restart')
await S('autopilot', true)
await page.waitForTimeout(700)
console.log('second run ghostSource:', await S('ghostSource'))
await S('simSpeed', 25)
await page.waitForTimeout(800)
await S('simSpeed', 1)
await page.waitForTimeout(300)
await page.screenshot({ path: 'scripts/peek-ghost.png' })
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none')
await browser.close()
await server.close()
process.exit(0)
