import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Terrain } from '../core/terrain'
import type { Course } from '../core/course'
import type { Biome } from '../core/levels'
import { getState } from '../core/state'
import { radialGlow, skyTexture } from './textures'

// Canyon race renderer: parallax sky/dunes, ridge terrain, N colour-coded comets
// with trails (player is the gold hero), track hazards (vents, rocks, pits,
// trampolines), airborne boost motes, and boost/stun juice. Palette per biome.

const PX_PER_M = 8

interface Palette {
  sky: string[]
  sun: string
  sunCore: number
  bg: number
  dunesFar: number
  dunesNear: number
  terrainFill: number
  terrainDeep: number
  rimWarm: number
  rimBright: number
}

const PALETTES: Record<Biome, Palette> = {
  sunset: { sky: ['#14265c', '#4a3970', '#c65f6a', '#ff8a5c', '#ffd27a'], sun: '#ffe9b8', sunCore: 0xfff3d0, bg: 0x14265c, dunesFar: 0x2b2454, dunesNear: 0x241c49, terrainFill: 0x1d1738, terrainDeep: 0x120f2c, rimWarm: 0xff8a5c, rimBright: 0xffd27a },
  aurora: { sky: ['#04122b', '#0d2d4a', '#12564f', '#1f8f6a', '#8ff0b8'], sun: '#c6fff0', sunCore: 0xdafff2, bg: 0x04122b, dunesFar: 0x102a44, dunesNear: 0x0b2036, terrainFill: 0x0d2739, terrainDeep: 0x081726, rimWarm: 0x2fe0a0, rimBright: 0x9ff0c8 },
  ember: { sky: ['#1a0510', '#3a0d15', '#7a1a12', '#d1451a', '#ffa64c'], sun: '#ffd08a', sunCore: 0xffe0a0, bg: 0x1a0510, dunesFar: 0x2a0d18, dunesNear: 0x1e0812, terrainFill: 0x2a0f14, terrainDeep: 0x18070c, rimWarm: 0xff5a2a, rimBright: 0xffb057 },
  ice: { sky: ['#0a1c3a', '#274a72', '#5a86b0', '#a9cfe6', '#eaf6ff'], sun: '#eaf6ff', sunCore: 0xffffff, bg: 0x0a1c3a, dunesFar: 0x223f5e, dunesNear: 0x18304c, terrainFill: 0x1d3550, terrainDeep: 0x122238, rimWarm: 0x8fd0ff, rimBright: 0xdff2ff },
  void: { sky: ['#05030f', '#160a2e', '#331155', '#7a1f8f', '#e04bd0'], sun: '#e79bff', sunCore: 0xf3c0ff, bg: 0x05030f, dunesFar: 0x1a0f33, dunesNear: 0x120826, terrainFill: 0x180f30, terrainDeep: 0x0c0720, rimWarm: 0xb84bff, rimBright: 0xef9bff },
}

interface Particle { sp: Sprite; vx: number; vy: number; life: number; max: number; drag: number; grav: number }
interface Ring { g: Graphics; x: number; y: number; max: number; color: number; life: number }

export interface RacerRender {
  x: number
  y: number
  speed: number
  holding: boolean
  grounded: boolean
  boosting: boolean
  stunned: boolean
  isPlayer: boolean
  color: number
}

interface RacerView {
  glow: Sprite
  core: Graphics
  trailG: Graphics
  ring: Graphics // stun/boost ring
  trail: number[]
  color: number
  isPlayer: boolean
}

export class Renderer {
  readonly app: Application
  private terrain!: Terrain
  private course: Course | null = null

  private world = new Container()
  private shaker = new Container()
  private sky!: Sprite
  private sun!: Sprite
  private sunCore!: Graphics
  private parallax: { g: Graphics; factor: number }[] = []
  private terrainChunks = new Map<number, Graphics>()
  private terrainLayer = new Container()
  private pitLayer = new Container()
  private markerLayer = new Container()
  private obstacleLayer = new Container()
  private bonusLayer = new Container()
  private pal: Palette = PALETTES.sunset
  private racerLayer = new Container()
  private fxLayer = new Container()
  private shadow = new Graphics()

  private bonusSprites: { sp: Sprite; core: Graphics }[] = []
  private views: RacerView[] = []

  private particles: Particle[] = []
  private rings: Ring[] = []
  private glowTexWarm!: Texture
  private glowTexGold!: Texture

  private speedLines = new Graphics()
  private flash = new Graphics()

  private camX = 0
  private camY = 0
  private zoom = 1
  private zoomPop = 0
  private trauma = 0
  private t = 0

  constructor(app: Application) {
    this.app = app
  }

  private viewportZoomFactor(w: number, h: number): number {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
    if (h <= 520) return 0.66
    if (coarse && h > w) return 0.7
    if (coarse && w > h) return 0.66
    if (w <= 760) return 0.78
    return 1
  }

  init(terrain: Terrain, biome: Biome = 'sunset'): void {
    this.terrain = terrain
    this.pal = PALETTES[biome] ?? PALETTES.sunset
    const pal = this.pal
    const stage = this.app.stage
    stage.removeChildren()
    this.parallax = []
    this.terrainChunks.clear()
    this.terrainLayer.removeChildren()
    this.pitLayer.removeChildren()
    this.markerLayer.removeChildren()
    this.obstacleLayer.removeChildren()
    this.bonusLayer.removeChildren()
    this.racerLayer.removeChildren()
    this.fxLayer.removeChildren()
    this.views = []
    this.bonusSprites = []
    this.particles = []
    this.rings = []

    const w = this.app.screen.width
    const h = this.app.screen.height
    this.app.renderer.background.color = pal.bg

    this.sky = new Sprite(skyTexture(w, h, pal.sky))
    this.sky.width = w
    this.sky.height = h
    stage.addChild(this.sky)

    this.glowTexGold = radialGlow('#ffd27a')
    this.glowTexWarm = radialGlow('#ff8a5c')
    this.sun = new Sprite(radialGlow(pal.sun, 256))
    this.sun.anchor.set(0.5)
    this.sun.blendMode = 'add'
    stage.addChild(this.sun)
    this.sunCore = new Graphics().circle(0, 0, 46).fill({ color: pal.sunCore })
    stage.addChild(this.sunCore)

    for (const [i, factor] of [0.06, 0.14].entries()) {
      const g = new Graphics()
      this.drawDunes(g, w, h, factor, i === 0 ? pal.dunesFar : pal.dunesNear, i === 0 ? 0.9 : 0.95, i === 0 ? 0.62 : 0.72)
      stage.addChild(g)
      this.parallax.push({ g, factor })
    }

    stage.addChild(this.shaker)
    this.shaker.addChild(this.world)
    this.world.addChild(this.terrainLayer)
    this.world.addChild(this.pitLayer)
    this.world.addChild(this.markerLayer)
    this.world.addChild(this.obstacleLayer)
    this.world.addChild(this.shadow)
    this.world.addChild(this.bonusLayer)
    this.world.addChild(this.racerLayer)
    this.world.addChild(this.fxLayer)

    this.drawMarkers()

    stage.addChild(this.speedLines)
    stage.addChild(this.flash)
  }

  setCourse(course: Course): void {
    this.course = course
    this.obstacleLayer.removeChildren()
    this.pitLayer.removeChildren()
    this.bonusLayer.removeChildren()
    this.bonusSprites = []
    const t = this.terrain

    // pits — dark chasms cut into the ground, hot mouth edges
    for (const p of course.pits) {
      const g = new Graphics()
      const depth = 48
      const step = 1.5
      g.moveTo(p.x0, t.heightAt(p.x0) + 0.6)
      for (let x = p.x0; x <= p.x1; x += step) g.lineTo(x, t.heightAt(x) + 0.6)
      g.lineTo(p.x1, t.heightAt(p.x1) + 0.6)
      g.lineTo(p.x1, t.heightAt(p.x1) - depth)
      g.lineTo(p.x0, t.heightAt(p.x0) - depth)
      g.closePath()
      g.fill({ color: 0x04030b })
      // glowing mouth edges
      g.moveTo(p.x0, t.heightAt(p.x0) + 0.8).lineTo(p.x0, t.heightAt(p.x0) - depth * 0.5).stroke({ width: 0.7, color: this.pal.rimBright, alpha: 0.8 })
      g.moveTo(p.x1, t.heightAt(p.x1) + 0.8).lineTo(p.x1, t.heightAt(p.x1) - depth * 0.5).stroke({ width: 0.7, color: this.pal.rimBright, alpha: 0.8 })
      this.pitLayer.addChild(g)
    }

    // trampolines — springy pads that bounce you high
    for (const p of course.pads) {
      const g = new Graphics()
      g.roundRect(p.x - 2.4, p.y - 0.2, 4.8, 1.1, 0.4).fill({ color: 0x1c6b4c })
      g.moveTo(p.x - 2.1, p.y + 0.9).quadraticCurveTo(p.x, p.y + 2.8, p.x + 2.1, p.y + 0.9).stroke({ width: 0.8, color: 0x8affc0, alpha: 0.95 })
      for (const dx of [-1, 0, 1]) g.moveTo(p.x + dx, p.y + 2.0).lineTo(p.x + dx - 0.6, p.y + 3.0).moveTo(p.x + dx, p.y + 2.0).lineTo(p.x + dx + 0.6, p.y + 3.0).stroke({ width: 0.5, color: 0x8affc0, alpha: 0.7 })
      const glow = new Sprite(radialGlow('#8affc0'))
      glow.anchor.set(0.5); glow.blendMode = 'add'; glow.width = glow.height = 8; glow.position.set(p.x, p.y + 1.6); glow.alpha = 0.55
      this.obstacleLayer.addChild(g)
      this.obstacleLayer.addChild(glow)
    }

    // obstacles — small vents (hot) and boulders (grey, taller, jump them)
    for (const o of course.obstacles) {
      const g = new Graphics()
      if (o.kind === 'rock') {
        g.moveTo(o.x - 2.2, o.y)
        g.lineTo(o.x - 1.7, o.y + 2.6)
        g.lineTo(o.x - 0.3, o.y + 3.3)
        g.lineTo(o.x + 1.4, o.y + 2.8)
        g.lineTo(o.x + 2.2, o.y + 1.0)
        g.lineTo(o.x + 1.8, o.y)
        g.closePath()
        g.fill({ color: 0x565163 })
        g.stroke({ width: 0.5, color: 0x8b85a0, alpha: 0.85 })
        g.circle(o.x - 0.5, o.y + 1.9, 0.55).fill({ color: 0x9c96af, alpha: 0.55 })
      } else {
        g.moveTo(o.x - 1.7, o.y)
        g.lineTo(o.x, o.y + 2.4)
        g.lineTo(o.x + 1.7, o.y)
        g.closePath()
        g.fill({ color: 0x2a1420 })
        g.moveTo(o.x - 1.7, o.y).lineTo(o.x, o.y + 2.4).lineTo(o.x + 1.7, o.y).stroke({ width: 0.7, color: 0xff5a48, alpha: 0.95 })
        const glow = new Sprite(this.glowTexWarm)
        glow.anchor.set(0.5); glow.blendMode = 'add'; glow.width = glow.height = 5.5; glow.position.set(o.x, o.y + 1.5); glow.alpha = 0.5
        this.obstacleLayer.addChild(glow)
      }
      this.obstacleLayer.addChild(g)
    }

    // boost motes — floating gold orbs
    for (const b of course.bonuses) {
      const sp = new Sprite(this.glowTexGold)
      sp.anchor.set(0.5)
      sp.blendMode = 'add'
      sp.width = sp.height = 9
      sp.position.set(b.x, b.y)
      const core = new Graphics().circle(0, 0, 1.4).fill({ color: 0xfff6ea })
      core.position.set(b.x, b.y)
      this.bonusLayer.addChild(sp)
      this.bonusLayer.addChild(core)
      this.bonusSprites.push({ sp, core })
    }
  }

  setRacers(defs: { color: number; isPlayer: boolean }[]): void {
    this.racerLayer.removeChildren()
    this.views = []
    // opponents first (below), player last (on top)
    const ordered = [...defs].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer))
    for (const d of ordered) {
      const trailG = new Graphics()
      const glow = new Sprite(radialGlow(hex(d.color)))
      glow.anchor.set(0.5)
      glow.blendMode = 'add'
      const core = new Graphics().circle(0, 0, d.isPlayer ? 3.1 : 2.4).fill({ color: 0xffffff })
      const ring = new Graphics()
      this.racerLayer.addChild(trailG)
      this.racerLayer.addChild(ring)
      this.racerLayer.addChild(glow)
      this.racerLayer.addChild(core)
      this.views.push({ glow, core, trailG, ring, trail: [], color: d.color, isPlayer: d.isPlayer })
    }
  }

  private viewFor(isPlayer: boolean, color: number): RacerView | undefined {
    return this.views.find((v) => v.isPlayer === isPlayer && v.color === color) ?? this.views.find((v) => v.color === color)
  }

  private drawDunes(g: Graphics, w: number, h: number, factor: number, color: number, alpha: number, base: number): void {
    g.clear()
    const y0 = h * base
    g.moveTo(-w, h * 2)
    g.lineTo(-w, y0)
    const seg = 90 - factor * 300
    for (let x = -w; x <= w * 2; x += seg) {
      const k = Math.sin(x * 0.013 * (1 + factor * 3)) * 26 + Math.sin(x * 0.031 + 2) * 12
      g.lineTo(x, y0 + k)
    }
    g.lineTo(w * 2, h * 2)
    g.closePath()
    g.fill({ color, alpha })
  }

  private drawMarkers(): void {
    const t = this.terrain
    const mk = (x: number, color: number, alpha: number, width: number, height: number) => {
      const h0 = t.heightAt(x)
      const g = new Graphics()
      const steps = 6
      for (let i = 0; i < steps; i++) {
        const k = i / steps
        g.rect(x - width / 2, h0 + height * k, width, height / steps).fill({ color, alpha: alpha * (1 - k) })
      }
      g.rect(x - width / 6, h0, width / 3, height * 0.7).fill({ color: 0xffffff, alpha: alpha * 0.9 })
      g.blendMode = 'add'
      this.markerLayer.addChild(g)
    }
    for (const c of t.checkpoints) mk(c, 0xffd27a, 0.14, 2.2, 30)
    mk(t.length, 0xffd27a, 0.32, 5, 64)
    mk(0, 0x9fd8e8, 0.18, 2.2, 34)
  }

  private ensureChunks(centerX: number, viewW: number): void {
    const CHUNK = 160
    const from = Math.floor((centerX - viewW) / CHUNK) - 1
    const to = Math.floor((centerX + viewW * 1.6) / CHUNK) + 1
    for (let ci = from; ci <= to; ci++) {
      if (this.terrainChunks.has(ci)) continue
      const g = new Graphics()
      const x0 = ci * CHUNK
      const bottom = this.terrain.minH - 90
      const step = 2
      g.moveTo(x0, bottom)
      for (let x = x0; x <= x0 + CHUNK + step; x += step) g.lineTo(x, this.terrain.heightAt(x))
      g.lineTo(x0 + CHUNK + step, bottom)
      g.closePath()
      g.fill({ color: this.pal.terrainFill })
      g.moveTo(x0, bottom)
      for (let x = x0; x <= x0 + CHUNK + step; x += step) g.lineTo(x, this.terrain.heightAt(x) - 14)
      g.lineTo(x0 + CHUNK + step, bottom)
      g.closePath()
      g.fill({ color: this.pal.terrainDeep, alpha: 0.85 })
      const rim = (dy: number, width: number, color: number, alpha: number) => {
        let first = true
        for (let x = x0; x <= x0 + CHUNK + step; x += step) {
          const y = this.terrain.heightAt(x) + dy
          if (first) { g.moveTo(x, y); first = false } else g.lineTo(x, y)
        }
        g.stroke({ width, color, alpha, cap: 'round', join: 'round' })
      }
      rim(-0.4, 2.6, this.pal.rimWarm, 0.28)
      rim(0, 1.1, this.pal.rimBright, 0.95)
      this.terrainLayer.addChild(g)
      this.terrainChunks.set(ci, g)
    }
    for (const [ci, g] of this.terrainChunks) {
      if (ci < from - 4 || ci > to + 4) { g.destroy(); this.terrainChunks.delete(ci) }
    }
  }

  addTrauma(n: number): void {
    if (getState().reducedMotion) return
    this.trauma = Math.min(1, this.trauma + n)
  }
  pop(): void {
    if (getState().reducedMotion) return
    this.zoomPop = 1
  }
  flashScreen(color: number, alpha: number): void {
    const w = this.app.screen.width
    const h = this.app.screen.height
    this.flash.clear()
    this.flash.rect(0, 0, w, h).fill({ color, alpha })
  }

  burst(x: number, y: number, kind: 'land' | 'perfect' | 'slam' | 'dive' | 'boost' | 'bonus' | 'stun', count = 10, color = 0xffd27a): void {
    const reduced = getState().reducedMotion
    const n = reduced ? Math.ceil(count / 2) : count
    const tex = kind === 'slam' || kind === 'boost' ? this.glowTexWarm : this.glowTexGold
    for (let i = 0; i < n; i++) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.blendMode = 'add'
      sp.tint = color
      const size = kind === 'dive' ? 1.4 : 2.6
      sp.width = size + Math.random() * size
      sp.height = sp.width
      sp.position.set(x, y)
      const a = Math.random() * Math.PI
      const pow = kind === 'slam' || kind === 'boost' ? 26 : kind === 'perfect' ? 18 : 10
      this.fxLayer.addChild(sp)
      this.particles.push({
        sp,
        vx: Math.cos(a) * pow * (Math.random() - 0.3),
        vy: Math.abs(Math.sin(a)) * pow * (0.4 + Math.random() * 0.6),
        life: 0,
        max: 0.5 + Math.random() * 0.45,
        drag: 2.2,
        grav: kind === 'dive' || kind === 'boost' ? 6 : 26,
      })
    }
    if (kind === 'perfect' || kind === 'slam' || kind === 'bonus' || kind === 'stun') {
      const g = new Graphics()
      g.blendMode = 'add'
      this.fxLayer.addChild(g)
      this.rings.push({ g, x, y, max: kind === 'perfect' ? 26 : kind === 'stun' ? 20 : 16, color, life: 0 })
    }
  }

  render(states: RacerRender[], dt: number): void {
    this.t += dt
    const w = this.app.screen.width
    const h = this.app.screen.height
    if (Math.abs(this.sky.width - w) > 1 || Math.abs(this.sky.height - h) > 1) this.resize()

    const player = states.find((s) => s.isPlayer) ?? states[0]

    // camera on the player
    const targetZoom = (1.12 - Math.min(0.34, Math.max(0, (player.speed - 14) / 130))) * this.viewportZoomFactor(w, h) * (this.zoomPop > 0 ? 1 + this.zoomPop * 0.06 : 1)
    this.zoomPop = Math.max(0, this.zoomPop - dt * 3)
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 3.2)
    const scale = PX_PER_M * this.zoom * Math.min(1, w / 900 + 0.35)
    const lookAhead = Math.min(48, player.speed * 0.45)
    this.camX += (player.x + lookAhead - this.camX) * Math.min(1, dt * 5)
    this.camY += (player.y + 8 - this.camY) * Math.min(1, dt * 4)
    this.world.scale.set(scale, -scale)
    this.world.position.set(w * 0.34 - this.camX * scale, (h <= 520 ? h * 0.58 : h * 0.52) + this.camY * scale)

    this.trauma = Math.max(0, this.trauma - dt * 1.7)
    const s2 = this.trauma * this.trauma
    this.shaker.position.set((Math.random() * 2 - 1) * s2 * 16, (Math.random() * 2 - 1) * s2 * 16)

    this.sun.position.set(w * 0.72 - this.camX * 0.02, h * 0.34 + this.camY * 0.04)
    this.sun.width = this.sun.height = Math.max(w, h) * 0.5
    this.sunCore.position.copyFrom(this.sun.position)
    for (const p of this.parallax) {
      p.g.position.x = -this.camX * p.factor * PX_PER_M * 0.1
      p.g.position.y = this.camY * p.factor * PX_PER_M * 0.06
    }

    this.ensureChunks(this.camX, w / scale)

    // bonus pulse + taken visibility
    if (this.course) {
      for (let i = 0; i < this.bonusSprites.length; i++) {
        const b = this.course.bonuses[i]
        const v = this.bonusSprites[i]
        const on = !b.taken
        v.sp.visible = v.core.visible = on
        if (on && !getState().reducedMotion) {
          const p = 1 + Math.sin(this.t * 4 + i) * 0.18
          v.sp.width = v.sp.height = 9 * p
        }
      }
    }

    // racers
    this.shadow.clear()
    for (const st of states) {
      const v = this.viewFor(st.isPlayer, st.color)
      if (!v) continue
      v.glow.position.set(st.x, st.y)
      const base = st.isPlayer ? 3.2 : 2.4
      const glowSize = (base + st.speed * 0.06) * (st.boosting ? 1.6 : st.holding ? 1.2 : 1)
      v.glow.width = v.glow.height = glowSize * 2
      v.glow.alpha = st.stunned ? 0.4 : 1
      v.core.position.set(st.x, st.y)
      v.core.alpha = st.stunned ? 0.5 : 1

      // stun / boost ring
      v.ring.clear()
      if (st.stunned) {
        v.ring.circle(st.x, st.y + 0.2, 3 + Math.sin(this.t * 12) * 0.4).stroke({ width: 0.5, color: 0xff5a48, alpha: 0.8 })
      } else if (st.boosting) {
        v.ring.circle(st.x, st.y, 4).stroke({ width: 0.6, color: st.color, alpha: 0.6 })
      }

      // trail
      v.trail.push(st.x, st.y, st.speed)
      const maxPts = st.isPlayer ? 120 : 60
      if (v.trail.length > maxPts * 3) v.trail.splice(0, v.trail.length - maxPts * 3)
      this.drawTrail(v.trailG, v.trail, st.speed, st.isPlayer, st.color, st.boosting)

      // player: ground shadow altitude cue + dive/boost sparks
      if (st.isPlayer) {
        if (!st.grounded) {
          const gy = this.terrain.heightAt(st.x)
          const alt = Math.max(0, st.y - gy)
          if (alt > 1.2) {
            const k = Math.min(1, alt / 30)
            this.shadow.ellipse(st.x, gy + 0.25, 2.6 + k * 2.2, 0.7 + k * 0.4).fill({ color: 0x0a0820, alpha: 0.4 * (1 - k * 0.5) })
          }
        }
        if (st.boosting && !getState().reducedMotion && Math.random() < 0.7) this.burst(st.x, st.y, 'boost', 1, st.color)
        else if (st.holding && st.grounded && st.speed > 24 && !getState().reducedMotion && Math.random() < 0.4) this.burst(st.x, st.y + 0.4, 'dive', 1)
      }
    }

    // particles + rings
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      const k = p.life / p.max
      if (k >= 1) { p.sp.destroy(); this.particles.splice(i, 1); continue }
      p.vx -= p.vx * p.drag * dt
      p.vy -= p.grav * dt
      p.sp.position.x += p.vx * dt
      p.sp.position.y += p.vy * dt
      p.sp.alpha = 1 - k
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life += dt
      const k = r.life / 0.5
      if (k >= 1) { r.g.destroy(); this.rings.splice(i, 1); continue }
      r.g.clear()
      r.g.circle(r.x, r.y, 2 + r.max * k).stroke({ width: 1.6 * (1 - k) + 0.4, color: r.color, alpha: 0.9 * (1 - k) })
    }

    // speed lines (stronger during boost)
    this.speedLines.clear()
    const slk = Math.max(0, (player.speed - 46) / 55) + (player.boosting ? 0.6 : 0)
    if (slk > 0 && !getState().reducedMotion) {
      for (let i = 0; i < 12; i++) {
        const y = ((i * 977) % h) + ((performance.now() * 0.05 * (1 + i * 0.13)) % 40)
        const len = 40 + slk * 150 + i * 7
        const x = w - (((performance.now() * (0.6 + slk) * (0.5 + i * 0.09)) + i * 331) % (w + len))
        this.speedLines.rect(x, y % h, len, 1.2).fill({ color: player.boosting ? 0xffe9b8 : 0xfff6ea, alpha: 0.14 * slk })
      }
    }

    if (this.flash.alpha > 0.01) this.flash.alpha *= Math.max(0, 1 - dt * 7)
    else { this.flash.clear(); this.flash.alpha = 1 }
  }

  private drawTrail(g: Graphics, pts: number[], speed: number, hero: boolean, color: number, boosting: boolean): void {
    g.clear()
    const n = pts.length / 3
    if (n < 2) return
    g.blendMode = 'add'
    const baseW = hero ? Math.min(3.6, 1 + speed * 0.03) * (boosting ? 1.5 : 1) : 0.8
    if (hero) {
      let open = false
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3]
        const y = pts[i * 3 + 1]
        if (i > 0 && Math.abs(x - pts[(i - 1) * 3]) > 30) {
          if (open) g.stroke({ width: baseW * 2.8, color: boosting ? 0xffe9b8 : 0xff8a5c, alpha: 0.12, cap: 'round', join: 'round' })
          open = false
        }
        if (!open) { g.moveTo(x, y); open = true } else g.lineTo(x, y)
      }
      if (open) g.stroke({ width: baseW * 2.8, color: boosting ? 0xffe9b8 : 0xff8a5c, alpha: 0.12, cap: 'round', join: 'round' })
    }
    for (let i = 1; i < n; i++) {
      const k = i / n
      const x0 = pts[(i - 1) * 3]
      const y0 = pts[(i - 1) * 3 + 1]
      const x1 = pts[i * 3]
      const y1 = pts[i * 3 + 1]
      if (Math.abs(x1 - x0) > 30) continue
      const wgt = baseW * (0.15 + 0.85 * k)
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      if (hero) g.stroke({ width: wgt, color: k > 0.85 ? 0xfff6ea : color, alpha: 0.65 * k, cap: 'round' })
      else g.stroke({ width: wgt, color, alpha: 0.28 * k, cap: 'round' })
    }
  }

  project(x: number, y: number): { x: number; y: number } {
    return { x: this.world.position.x + x * this.world.scale.x, y: this.world.position.y + y * this.world.scale.y }
  }

  clearTrails(): void {
    for (const v of this.views) { v.trail.length = 0; v.trailG.clear(); v.ring.clear() }
  }

  resize(): void {
    const w = this.app.screen.width
    const h = this.app.screen.height
    if (this.sky) { this.sky.texture = skyTexture(w, h); this.sky.width = w; this.sky.height = h }
    for (const [i, p] of this.parallax.entries()) {
      this.drawDunes(p.g, w, h, p.factor, i === 0 ? 0x2b2454 : 0x241c49, 0.9, i === 0 ? 0.62 : 0.72)
    }
  }
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}
