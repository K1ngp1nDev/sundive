import { Texture } from 'pixi.js'

// Canvas-baked textures: radial glows and the sunset sky gradient.

export function radialGlow(color: string, size = 128): Texture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, color)
  g.addColorStop(0.35, colorWithAlpha(color, 0.55))
  g.addColorStop(1, colorWithAlpha(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return Texture.from(c)
}

function colorWithAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

/** Sunset sky: deep blue -> coral -> gold horizon. */
export function skyTexture(w: number, h: number): Texture {
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.floor(w / 4))
  c.height = Math.max(2, Math.floor(h / 4))
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, c.height)
  g.addColorStop(0, '#14265c')
  g.addColorStop(0.42, '#4a3970')
  g.addColorStop(0.68, '#c65f6a')
  g.addColorStop(0.86, '#ff8a5c')
  g.addColorStop(1, '#ffd27a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  return Texture.from(c)
}
