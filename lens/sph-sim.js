// A small particle fluid: double density relaxation (Clavet et al. 2005), a
// position-based relative of SPH that stays stable at one step per frame.
// Lengths are in pixels, h is the interaction radius, time is in frames.
export function createSim(n, W, H, h) {
  const x = new Float32Array(n), y = new Float32Array(n)
  const ox = new Float32Array(n), oy = new Float32Array(n)
  const vx = new Float32Array(n), vy = new Float32Array(n)
  let cols = 1, rows = 1, head = new Int32Array(1)
  const next = new Int32Array(n)
  const nb = new Int32Array(64), nq = new Float32Array(64)
  const K = 0.05 * h, KN = 0.3 * h, RHO0 = 1.8, G = 0.012 * h, VMAX = 0.55 * h, DMAX = 0.12 * h
  const sim = { x, y, vx, vy, n, W, H, h, resize, step }

  function resize(w, hh) {
    sim.W = W = w; sim.H = H = hh
    cols = Math.ceil(W / h) + 2; rows = Math.ceil((H * 2.5) / h) + 2
    head = new Int32Array(cols * rows)
  }
  resize(W, H)
  const cellOf = (px, py) => {
    const cx = Math.max(0, Math.min(cols - 1, Math.floor(px / h) + 1))
    const cy = Math.max(0, Math.min(rows - 1, Math.floor((py + H * 1.5) / h) + 1))
    return cy * cols + cx
  }

  // pointer: {x, y, vx, vy, r} or null. kick: extra acceleration this frame (ax, ay).
  function step(pointer, ax = 0, ay = 0) {
    for (let i = 0; i < n; i++) {
      vx[i] += ax; vy[i] += G + ay
      if (pointer) {
        const dx = x[i] - pointer.x, dy = y[i] - pointer.y, d2 = dx * dx + dy * dy
        if (d2 < pointer.r * pointer.r && d2 > 1e-6) {
          const d = Math.sqrt(d2), f = 1 - d / pointer.r
          vx[i] += (dx / d) * f * 0.12 * h + pointer.vx * f * 0.35
          vy[i] += (dy / d) * f * 0.12 * h + pointer.vy * f * 0.35
        }
      }
      const sp = Math.hypot(vx[i], vy[i])
      if (sp > VMAX) { vx[i] *= VMAX / sp; vy[i] *= VMAX / sp }
      ox[i] = x[i]; oy[i] = y[i]
      x[i] += vx[i]; y[i] += vy[i]
    }
    head.fill(-1)
    for (let i = 0; i < n; i++) { const c = cellOf(x[i], y[i]); next[i] = head[c]; head[c] = i }
    for (let i = 0; i < n; i++) {
      const cx = Math.max(0, Math.min(cols - 1, Math.floor(x[i] / h) + 1))
      const cy = Math.max(0, Math.min(rows - 1, Math.floor((y[i] + H * 1.5) / h) + 1))
      let m = 0, rho = 0, rhoN = 0
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= rows) continue
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= cols) continue
          for (let j = head[gy * cols + gx]; j >= 0; j = next[j]) {
            if (j === i) continue
            const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy
            if (d2 >= h * h || m >= 64) continue
            const q = Math.sqrt(d2) / h, a = 1 - q
            rho += a * a; rhoN += a * a * a
            nb[m] = j; nq[m++] = q
          }
        }
      }
      const P = K * (rho - RHO0), PN = KN * rhoN
      let sx = 0, sy = 0
      for (let k = 0; k < m; k++) {
        const j = nb[k], q = nq[k], a = 1 - q
        const D = Math.min(DMAX, (P * a + PN * a * a) * 0.5)
        let dx = x[j] - x[i], dy = y[j] - y[i]
        const d = q * h
        if (d < 1e-4) { dx = Math.random() - 0.5; dy = Math.random() - 0.5 } else { dx /= d; dy /= d }
        x[j] += dx * D; y[j] += dy * D
        sx -= dx * D; sy -= dy * D
      }
      x[i] += sx; y[i] += sy
    }
    const pad = h * 0.3
    for (let i = 0; i < n; i++) {
      if (x[i] < pad) x[i] = pad + Math.random() * 0.01
      else if (x[i] > W - pad) x[i] = W - pad - Math.random() * 0.01
      if (y[i] > H - pad) y[i] = H - pad - Math.random() * 0.01
      else if (y[i] < -H * 1.4) y[i] = -H * 1.4
      vx[i] = (x[i] - ox[i]) * 0.997; vy[i] = (y[i] - oy[i]) * 0.997
    }
  }
  return sim
}
