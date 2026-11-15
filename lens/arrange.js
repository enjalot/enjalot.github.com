// Arrangements: different ways to place the same tweets. A field F holds the
// points (pos, in CSS pixels). A static arrangement gives every point a target
// and the points ease toward it; a dynamic one (fluid, ODE) moves them itself.
import { d2xy } from './util.js'

const lerp = (a, b, t) => a + (b - a) * t

// b: the full dataset. every: keep one point in `every` (used by hover previews).
export function makeF(b, w, h, opts = {}) {
  const every = opts.every || 1, n = Math.ceil(b.n / every)
  const F = {
    n, w, h, mini: !!opts.mini, reduced: !!opts.reduced, explore: 0, intro: 1, tt: 0, dirty: true,
    pos: new Float32Array(n * 2), tgt: new Float32Array(n * 2), delay: new Float32Array(n),
    ux: new Float32Array(n), uy: new Float32Array(n), year: new Float32Array(n),
    frac: new Float32Array(n), like: new Float32Array(n), col: new Float32Array(n * 3),
    clusters: b.clusters, pointer: null, scrollV: 0,
  }
  for (let i = 0; i < n; i++) {
    const j = i * every
    F.ux[i] = b.ux[j]; F.uy[i] = b.uy[j]; F.year[i] = b.year[j]; F.like[i] = b.like[j]
    F.frac[i] = j / (b.n - 1) // position in time order, 0 to 1
    F.col.set(b.col.subarray(j * 3, j * 3 + 3), i * 3)
    const a = Math.random() * 6.283, r = (0.2 + Math.random() * 0.5) * Math.max(w, h)
    F.pos[i * 2] = w / 2 + Math.cos(a) * r; F.pos[i * 2 + 1] = h / 2 + Math.sin(a) * r
    F.delay[i] = Math.random() * 0.7
  }
  return F
}

// One frame. Returns true while anything is still moving.
export function advance(F, A, dt) {
  F.tt += dt
  if (!A.layout) { A.step(F, dt); return true }
  if (F.dirty) {
    A.layout(F, F.tgt); F.dirty = false
    // once the dots have arrived, a change of scale from scrolling follows the scroll exactly
    if (F.settled) { F.pos.set(F.tgt); return false }
  }
  const { pos, tgt, delay } = F, k = F.reduced ? 1 : 1 - Math.exp(-dt * 6)
  let moving = false
  for (let i = 0; i < F.n; i++) {
    if (!F.reduced && F.tt < delay[i]) { moving = true; continue }
    const dx = tgt[i * 2] - pos[i * 2], dy = tgt[i * 2 + 1] - pos[i * 2 + 1]
    pos[i * 2] += dx * k; pos[i * 2 + 1] += dy * k
    if (dx * dx + dy * dy > 0.1) moving = true
  }
  if (!moving) F.settled = true
  return moving
}

// The square both static layouts use. It overflows the short side of the
// screen as a backdrop and shrinks to fit when you reach the map at the end.
function square(F) {
  const lo = Math.min(F.w, F.h), hi = Math.max(F.w, F.h)
  // small and far away at the top of the page, regular size once you scroll into the jobs
  const t = F.intro
  const backdrop = lerp(lo * 0.42, Math.min(hi, lo * 1.2) * 0.94, t)
  const s = F.mini ? lo * 0.68 : lerp(backdrop, Math.min(F.w, F.h - 130) * 0.94, F.explore)
  return { s, x: F.w / 2 - s / 2, y: F.h / 2 - s / 2 - (F.mini ? 0 : 20 * F.explore) }
}

// UMAP: the map Latent Scope makes.
function umap() {
  return {
    caption: 'Every dot is one of my tweets since 2008. Each tweet was embedded with a small language model (jina v5 nano), projected to two dimensions with UMAP and clustered, which is what Latent Scope does to any pile of text. Tweets about similar things sit near each other. Color is the year.',
    layout(F, out) {
      const q = square(F)
      for (let i = 0; i < F.n; i++) { out[i * 2] = q.x + F.ux[i] * q.s; out[i * 2 + 1] = q.y + (1 - F.uy[i]) * q.s }
    },
    labels(F) {
      const q = square(F)
      return [...F.clusters].sort((a, b) => b.n - a.n).slice(0, F.w < 600 ? 8 : 21)
        .map((c) => ({ x: q.x + c.x * q.s, y: q.y + (1 - c.y) * q.s, text: c.label }))
    },
  }
}

// Hilbert: the same tweets in time order along a space-filling curve.
function hilbert(F) {
  const order = F.mini ? 4 : 6, N = 1 << order, C = N * N
  const hx = new Float32Array(F.n), hy = new Float32Array(F.n)
  for (let i = 0; i < F.n; i++) {
    const d = F.frac[i] * (C - 1), d0 = Math.min(C - 2, Math.floor(d)), f = d - d0
    const a = d2xy(order, d0), b = d2xy(order, d0 + 1)
    hx[i] = (a[0] + (b[0] - a[0]) * f + 0.5) / N; hy[i] = (a[1] + (b[1] - a[1]) * f + 0.5) / N
  }
  return {
    caption: 'The same tweets in the order I wrote them, laid along a Hilbert curve. The curve folds one long line into a square so that tweets close in time stay close on the page. It is the layout we used for the genome map. Color is the year.',
    layout(F, out) {
      const q = square(F)
      for (let i = 0; i < F.n; i++) { out[i * 2] = q.x + hx[i] * q.s; out[i * 2 + 1] = q.y + hy[i] * q.s }
    },
    labels(F) {
      const q = square(F), out = []
      let yr = 0
      for (let i = 0; i < F.n; i++) {
        const y = Math.floor(F.year[i])
        if (y > yr) { yr = y; out.push({ x: q.x + hx[i] * q.s, y: q.y + hy[i] * q.s, text: String(y), yr: y }) }
      }
      return out
    },
  }
}

export const load = {
  umap: async () => umap,
  hilbert: async () => hilbert,
  fluid: () => import('./arr-fluid.js').then((m) => m.default),
  ode: () => import('./arr-ode.js').then((m) => m.default),
}
