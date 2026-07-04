import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Terrain } from '../core/terrain'
import { getState } from '../core/state'
import { radialGlow, skyTexture } from './textures'

// The whole look: sunset canyon, gold ridge light, and the comet trail as the
// hero element. World container is y-flipped (world y-up -> screen y-down).

const PX_PER_M = 7

interface Particle {
  sp: Sprite
  vx: number
  vy: number
  life: number
  max: number
  drag: number
  grav: number
}

interface Ring {
  g: Graphics
  x: number
  y: number
  r: number
  max: number
  color: number
  life: number
}

export class Renderer {
  readonly app: Application
  private terrain!: Terrain

  private world = new Container()
  private shaker = new Container()
  private sky!: Sprite
  private sun!: Sprite
  private sunCore!: Graphics
  private parallax: { g: Graphics; factor: number }[] = []
  private terrainChunks = new Map<number, Graphics>()
  private terrainLayer = new Container()
  private markerLayer = new Container()
  private fxLayer = new Container()

  private trailG = new Graphics()
  private ghostTrailG = new Graphics()
  private cometGlow!: Sprite
  private cometCore!: Graphics
  private ghostGlow!: Sprite
  private ghostCore!: Graphics

  private particles: Particle[] = []
  private rings: Ring[] = []
  private glowTexWarm!: Texture
  private glowTexGold!: Texture
  private glowTexGhost!: Texture

  private speedLines: Graphics = new Graphics()
  private flash: Graphics = new Graphics()

  private trail: number[] = [] // x,y triplets? x,y,speed
  private ghostTrail: number[] = []
  private camX = 0
  private camY = 0
  private zoom = 1
  private trauma = 0

  constructor(app: Application) {
    this.app = app
  }

  init(terrain: Terrain): void {
    this.terrain = terrain
    const stage = this.app.stage
    stage.removeChildren()
    this.terrainChunks.clear()
    this.terrainLayer.removeChildren()
    this.markerLayer.removeChildren()

    const w = this.app.screen.width
    const h = this.app.screen.height

    this.sky = new Sprite(skyTexture(w, h))
    this.sky.width = w
    this.sky.height = h
    stage.addChild(this.sky)

    // sun low over the horizon
    this.glowTexGold = radialGlow('#ffd27a')
    this.glowTexWarm = radialGlow('#ff8a5c')
    this.glowTexGhost = radialGlow('#9fd8e8')
    this.sun = new Sprite(radialGlow('#ffe9b8', 256))
    this.sun.anchor.set(0.5)
    this.sun.blendMode = 'add'
    stage.addChild(this.sun)
    this.sunCore = new Graphics().circle(0, 0, 46).fill({ color: 0xfff3d0 })
    stage.addChild(this.sunCore)

    // parallax dune silhouettes (screen-space, offset by camera)
    for (const [factor, color, alpha, base] of [
      [0.06, 0x2b2454, 0.9, 0.62],
      [0.14, 0x241c49, 0.95, 0.72],
    ] as const) {
      const g = new Graphics()
      this.drawDunes(g, w, h, factor, color, alpha, base)
      stage.addChild(g)
      this.parallax.push({ g, factor })
    }

    stage.addChild(this.shaker)
    this.shaker.addChild(this.world)
    this.world.addChild(this.terrainLayer)
    this.world.addChild(this.markerLayer)

    // ghost under player
    this.ghostGlow = new Sprite(this.glowTexGhost)
    this.ghostGlow.anchor.set(0.5)
    this.ghostGlow.blendMode = 'add'
    this.ghostGlow.alpha = 0.5
    this.ghostCore = new Graphics().circle(0, 0, 2.2).fill({ color: 0xcdeef7 })
    this.world.addChild(this.ghostTrailG)
    this.world.addChild(this.ghostGlow)
    this.world.addChild(this.ghostCore)

    this.cometGlow = new Sprite(this.glowTexGold)
    this.cometGlow.anchor.set(0.5)
    this.cometGlow.blendMode = 'add'
    this.world.addChild(this.trailG)
    this.world.addChild(this.fxLayer)
    this.world.addChild(this.cometGlow)
    this.cometCore = new Graphics().circle(0, 0, 2.6).fill({ color: 0xffffff })
    this.world.addChild(this.cometCore)

    // finish + checkpoint pillars
    this.drawMarkers()

    // screen-space fx
    stage.addChild(this.speedLines)
    stage.addChild(this.flash)

    this.trail.length = 0
    this.ghostTrail.length = 0
    this.particles = []
    this.rings = []
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
      // tapered light pillar: bright at the ground, fading upward
      const steps = 6
      for (let i = 0; i < steps; i++) {
        const k = i / steps
        g.rect(x - width / 2, h0 + height * k, width, height / steps).fill({ color, alpha: alpha * (1 - k) })
      }
      g.rect(x - width / 6, h0, width / 3, height * 0.7).fill({ color: 0xffffff, alpha: alpha * 0.9 })
      g.blendMode = 'add'
      this.markerLayer.addChild(g)
    }
    for (const c of t.checkpoints) mk(c, 0xffd27a, 0.16, 2.2, 34)
    mk(t.length, 0xffd27a, 0.3, 5, 60)
    mk(0, 0x9fd8e8, 0.18, 2.2, 34)
  }

  /** Terrain drawn in 160 m chunks, filled to a deep-blue base. */
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
      // fill body
      g.moveTo(x0, bottom)
      for (let x = x0; x <= x0 + CHUNK + step; x += step) g.lineTo(x, this.terrain.heightAt(x))
      g.lineTo(x0 + CHUNK + step, bottom)
      g.closePath()
      g.fill({ color: 0x1d1738 })
      // depth shade overlay (second darker fill lower down)
      g.moveTo(x0, bottom)
      for (let x = x0; x <= x0 + CHUNK + step; x += step) g.lineTo(x, this.terrain.heightAt(x) - 14)
      g.lineTo(x0 + CHUNK + step, bottom)
      g.closePath()
      g.fill({ color: 0x120f2c, alpha: 0.85 })
      // gold ridge rim + soft coral under-glow
      const rim = (dy: number, width: number, color: number, alpha: number) => {
        let first = true
        for (let x = x0; x <= x0 + CHUNK + step; x += step) {
          const y = this.terrain.heightAt(x) + dy
          if (first) {
            g.moveTo(x, y)
            first = false
          } else g.lineTo(x, y)
        }
        g.stroke({ width, color, alpha, cap: 'round', join: 'round' })
      }
      rim(-0.4, 2.6, 0xff8a5c, 0.28)
      rim(0, 1.1, 0xffd27a, 0.95)
      this.terrainLayer.addChild(g)
      this.terrainChunks.set(ci, g)
    }
    // drop far chunks
    for (const [ci, g] of this.terrainChunks) {
      if (ci < from - 4 || ci > to + 4) {
        g.destroy()
        this.terrainChunks.delete(ci)
      }
    }
  }

  addTrauma(n: number): void {
    if (getState().reducedMotion) return
    this.trauma = Math.min(1, this.trauma + n)
  }

  flashScreen(color: number, alpha: number): void {
    const w = this.app.screen.width
    const h = this.app.screen.height
    this.flash.clear()
    this.flash.rect(0, 0, w, h).fill({ color, alpha })
  }

  burst(x: number, y: number, kind: 'land' | 'perfect' | 'slam' | 'dive', count = 10): void {
    const reduced = getState().reducedMotion
    const n = reduced ? Math.ceil(count / 2) : count
    const tex = kind === 'slam' ? this.glowTexWarm : this.glowTexGold
    for (let i = 0; i < n; i++) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.blendMode = 'add'
      const size = kind === 'dive' ? 1.4 : 2.6
      sp.width = size + Math.random() * size
      sp.height = sp.width
      sp.position.set(x, y)
      const a = Math.random() * Math.PI
      const pow = kind === 'slam' ? 26 : kind === 'perfect' ? 18 : 10
      this.fxLayer.addChild(sp)
      this.particles.push({
        sp,
        vx: Math.cos(a) * pow * (Math.random() - 0.3),
        vy: Math.abs(Math.sin(a)) * pow * (0.4 + Math.random() * 0.6),
        life: 0,
        max: 0.5 + Math.random() * 0.45,
        drag: 2.2,
        grav: kind === 'dive' ? 8 : 26,
      })
    }
    if (kind === 'perfect' || kind === 'slam') {
      const g = new Graphics()
      g.blendMode = 'add'
      this.fxLayer.addChild(g)
      this.rings.push({ g, x, y, r: 2, max: kind === 'perfect' ? 26 : 18, color: kind === 'perfect' ? 0xffd27a : 0xff8a5c, life: 0 })
    }
  }

  /** Called every rAF with interpolated player/ghost world positions. */
  render(
    px: number,
    py: number,
    speed: number,
    holding: boolean,
    grounded: boolean,
    ghost: { x: number; y: number } | null,
    dt: number,
  ): void {
    const w = this.app.screen.width
    const h = this.app.screen.height

    // resizeTo can apply after init — keep the backdrop in sync with the canvas
    if (Math.abs(this.sky.width - w) > 1 || Math.abs(this.sky.height - h) > 1) this.resize()

    // camera: comet sits ~34% from the left, zoom out with speed
    const targetZoom = 1.08 - Math.min(0.46, Math.max(0, (speed - 14) / 105))
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 3.2)
    const scale = PX_PER_M * this.zoom * Math.min(1, w / 900 + 0.35)

    const lookAhead = Math.min(60, speed * 0.55)
    const tx = px + lookAhead
    const ty = py + 8
    this.camX += (tx - this.camX) * Math.min(1, dt * 5)
    this.camY += (ty - this.camY) * Math.min(1, dt * 4)

    this.world.scale.set(scale, -scale)
    this.world.position.set(w * 0.34 - this.camX * scale, h * 0.52 + this.camY * scale)

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.7)
    const s2 = this.trauma * this.trauma
    this.shaker.position.set((Math.random() * 2 - 1) * s2 * 16, (Math.random() * 2 - 1) * s2 * 16)

    // sun + parallax follow camera softly
    this.sun.position.set(w * 0.72 - this.camX * 0.02, h * 0.34 + this.camY * 0.04)
    this.sun.width = this.sun.height = Math.max(w, h) * 0.5
    this.sunCore.position.copyFrom(this.sun.position)
    for (const p of this.parallax) {
      p.g.position.x = -this.camX * p.factor * PX_PER_M * 0.1
      p.g.position.y = this.camY * p.factor * PX_PER_M * 0.06
    }

    this.ensureChunks(this.camX, w / scale)

    // player comet + trail
    this.cometGlow.position.set(px, py)
    const glowSize = (3.2 + speed * 0.06) * (holding ? 1.25 : 1)
    this.cometGlow.width = this.cometGlow.height = glowSize * 2
    this.cometCore.position.set(px, py)

    this.trail.push(px, py, speed)
    const maxPts = 110
    if (this.trail.length > maxPts * 3) this.trail.splice(0, this.trail.length - maxPts * 3)
    this.drawTrail(this.trailG, this.trail, speed, true)

    // dive sparks
    if (holding && grounded && speed > 24 && !getState().reducedMotion && Math.random() < 0.45) {
      this.burst(px, py + 0.4, 'dive', 1)
    }

    // ghost
    if (ghost) {
      this.ghostGlow.visible = this.ghostCore.visible = true
      this.ghostGlow.position.set(ghost.x, ghost.y)
      this.ghostGlow.width = this.ghostGlow.height = 7
      this.ghostCore.position.set(ghost.x, ghost.y)
      this.ghostTrail.push(ghost.x, ghost.y, 30)
      if (this.ghostTrail.length > 70 * 3) this.ghostTrail.splice(0, this.ghostTrail.length - 70 * 3)
      this.drawTrail(this.ghostTrailG, this.ghostTrail, 30, false)
    } else {
      this.ghostGlow.visible = this.ghostCore.visible = false
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      const k = p.life / p.max
      if (k >= 1) {
        p.sp.destroy()
        this.particles.splice(i, 1)
        continue
      }
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
      if (k >= 1) {
        r.g.destroy()
        this.rings.splice(i, 1)
        continue
      }
      r.g.clear()
      r.g.circle(r.x, r.y, 2 + r.max * k).stroke({ width: 1.6 * (1 - k) + 0.4, color: r.color, alpha: 0.9 * (1 - k) })
    }

    // speed lines (screen space)
    this.speedLines.clear()
    const slk = Math.max(0, (speed - 46) / 55)
    if (slk > 0 && !getState().reducedMotion) {
      for (let i = 0; i < 10; i++) {
        const y = ((i * 977) % h) + ((performance.now() * 0.05 * (1 + i * 0.13)) % 40)
        const len = 40 + slk * 130 + i * 7
        const x = w - (((performance.now() * (0.6 + slk) * (0.5 + i * 0.09)) + i * 331) % (w + len))
        this.speedLines.rect(x, y % h, len, 1.2).fill({ color: 0xfff6ea, alpha: 0.14 * slk })
      }
    }

    // flash decay
    if (this.flash.alpha > 0.01) this.flash.alpha *= Math.max(0, 1 - dt * 7)
    else this.flash.clear(), (this.flash.alpha = 1)
  }

  private drawTrail(g: Graphics, pts: number[], speed: number, warm: boolean): void {
    g.clear()
    const n = pts.length / 3
    if (n < 2) return
    g.blendMode = 'add'
    const baseW = warm ? Math.min(3.4, 1 + speed * 0.03) : 0.9

    // soft underlayer: one continuous path per contiguous span (no braiding)
    if (warm) {
      let open = false
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3]
        const y = pts[i * 3 + 1]
        if (i > 0 && Math.abs(x - pts[(i - 1) * 3]) > 30) {
          if (open) g.stroke({ width: baseW * 2.8, color: 0xff8a5c, alpha: 0.12, cap: 'round', join: 'round' })
          open = false
        }
        if (!open) {
          g.moveTo(x, y)
          open = true
        } else g.lineTo(x, y)
      }
      if (open) g.stroke({ width: baseW * 2.8, color: 0xff8a5c, alpha: 0.12, cap: 'round', join: 'round' })
    }

    // bright core, segment-faded toward the head
    for (let i = 1; i < n; i++) {
      const k = i / n // 0 old -> 1 new
      const x0 = pts[(i - 1) * 3]
      const y0 = pts[(i - 1) * 3 + 1]
      const x1 = pts[i * 3]
      const y1 = pts[i * 3 + 1]
      if (Math.abs(x1 - x0) > 30) continue // restart gap
      const wgt = baseW * (0.15 + 0.85 * k)
      if (warm) {
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke({ width: wgt, color: k > 0.85 ? 0xfff6ea : 0xffd27a, alpha: 0.65 * k, cap: 'round' })
      } else {
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke({ width: wgt, color: 0x9fd8e8, alpha: 0.3 * k, cap: 'round' })
      }
    }
  }

  clearTrails(): void {
    this.trail.length = 0
    this.ghostTrail.length = 0
    this.trailG.clear()
    this.ghostTrailG.clear()
  }

  resize(): void {
    const w = this.app.screen.width
    const h = this.app.screen.height
    if (this.sky) {
      this.sky.texture = skyTexture(w, h)
      this.sky.width = w
      this.sky.height = h
    }
    for (const [i, p] of this.parallax.entries()) {
      this.drawDunes(p.g, w, h, p.factor, i === 0 ? 0x2b2454 : 0x241c49, 0.9, i === 0 ? 0.62 : 0.72)
    }
  }
}
