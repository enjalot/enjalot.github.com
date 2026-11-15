// Small helpers shared by the lenses.

// Hilbert curve: distance along the curve -> cell, for a 2^order grid.
export function d2xy(order, d) {
  let x = 0, y = 0, t = d
  for (let s = 1; s < 1 << order; s *= 2) {
    const rx = 1 & (t / 2), ry = 1 & (t ^ rx)
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y }
      const tmp = x; x = y; y = tmp
    }
    x += s * rx; y += s * ry
    t = Math.floor(t / 4)
  }
  return [x, y]
}
// One color per year (2003 to 2026), a trimmed plasma ramp.
const STOPS = [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 42]]
export function yearRgb(year) {
  const t = Math.max(0, Math.min(0.9999, (year - 2006) / (2027 - 2006))) * (STOPS.length - 1)
  const i = Math.floor(t), f = t - i, a = STOPS[i], b = STOPS[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
export const yearCss = (year, alpha = 1) => {
  const [r, g, b] = yearRgb(year)
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
}

export function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  const p = gl.createProgram()
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  return p
}

export function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  if (html) e.innerHTML = html
  return e
}
