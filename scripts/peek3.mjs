import { chromium } from 'playwright'
import { preview } from 'vite'
const server = await preview({ preview: { port: 4326, strictPort: true } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => { if (m.type()==='error') console.log('ERR:', m.text()) })
await page.goto('http://localhost:4326/?qa=1&date=2026-07-04&level=3', { waitUntil: 'load' })
await page.waitForFunction(() => window.__SUNDIVE__?.ready === true, { timeout: 20000 })
const S = (fn, ...a) => page.evaluate(({ fn, a }) => window.__SUNDIVE__[fn](...a), { fn, a })
await page.waitForTimeout(1400)
await page.screenshot({ path: 'scripts/peek3-start.png' })
console.log('opponents at L3:', await S('opponents'))
await S('begin'); await S('autopilot', true)
// hunt a frame with a rival on screen ahead
for (let i=0;i<80;i++){ await page.waitForTimeout(120); const p=await S('pos'); const t=await S('timeMs'); if (t>4000 && t<9000) break }
await page.screenshot({ path: 'scripts/peek3-race.png' })
await S('fireBoost'); await page.waitForTimeout(100)
await page.screenshot({ path: 'scripts/peek3-boost.png' })
await S('simSpeed', 120)
await page.waitForFunction(() => window.__SUNDIVE__.phase() === 'finished', { timeout: 20000 }).catch(()=>{})
await S('simSpeed',1); await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/peek3-finish.png' })
console.log('final place', await S('place'))
await browser.close(); await server.close(); process.exit(0)
