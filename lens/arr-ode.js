// ODE: every tweet is a tracer particle carried along by a system of three
// differential equations. The little editor lets you swap terms and drag
// numbers. The view rotates slowly and rescales itself to whatever shape the
// equations make.
import { el } from './util.js'

const PRESETS = {
  Lorenz: ['10 * (y - x)', 'x * (28 - z) - y', 'x * y - 2.67 * z'],
  'Rössler': ['-y - z', 'x + 0.2 * y', '0.2 + z * (x - 5.7)'],
  Thomas: ['sin(y) - 0.2 * x', 'sin(z) - 0.2 * y', 'sin(x) - 0.2 * z'],
  Aizawa: ['(z - 0.7) * x - 3.5 * y', '3.5 * x + (z - 0.7) * y', '0.6 + 0.95 * z - z^3 / 3 - (x^2 + y^2) * (1 + 0.25 * z) + 0.1 * z * x^3'],
  Halvorsen: ['-1.89 * x - 4 * y - 4 * z - y^2', '-1.89 * y - 4 * z - 4 * x - z^2', '-1.89 * z - 4 * x - 4 * y - x^2'],
  Dadras: ['y - 3 * x + 2.7 * y * z', '1.7 * y - x * z + z', '2 * x * y - 9 * z'],
  Chen: ['35 * (y - x)', '-7 * x - x * z + 28 * y', 'x * y - 3 * z'],
}
const FUNCS = ['sin', 'cos', 'tan', 'tanh', 'exp', 'abs', 'sqrt', 'log']
const NUM = /\d*\.?\d+/g

// Turn "x * (28 - z) - y" into a JavaScript expression. Only numbers, x y z t,
// pi, the functions above and + - * / ^ ( ) get through.
function toJs(src) {
  const toks = src.toLowerCase().match(/\d*\.?\d+(?:e[-+]?\d+)?|[a-z]+|\S/g) || []
  let p = 0
  const eat = (t) => { if (toks[p] !== t) throw new Error(`expected ${t}`); p++ }
  const expr = () => { let s = term(); while (toks[p] === '+' || toks[p] === '-') s += toks[p++] + term(); return s }
  const term = () => { let s = unary(); while (toks[p] === '*' || toks[p] === '/') s += toks[p++] + unary(); return s }
  const unary = () => {
    if (toks[p] === '-') { p++; return '(-' + unary() + ')' }
    if (toks[p] === '+') { p++; return unary() }
    const a = atom()
    if (toks[p] === '^') { p++; return `Math.pow(${a},${unary()})` }
    return a
  }
  const atom = () => {
    const t = toks[p++]
    if (t === undefined) throw new Error('unfinished')
    if (/^[\d.]/.test(t)) return t
    if (t === '(') { const s = expr(); eat(')'); return '(' + s + ')' }
    if (t === 'x' || t === 'y' || t === 'z' || t === 't') return t
    if (t === 'pi') return 'Math.PI'
    if (FUNCS.includes(t)) { eat('('); const s = expr(); eat(')'); return `Math.${t}(${s})` }
    throw new Error(`unknown "${t}"`)
  }
  const out = expr()
  if (p < toks.length) throw new Error(`unexpected "${toks[p]}"`)
  return out
}

// A midpoint-rule stepper over every particle at once. Returns the mean speed.
function stepper(srcs) {
  const [ex, ey, ez] = srcs.map(toJs)
  return new Function('S', 'n', 'h', 't', `
    let acc = 0
    for (let i = 0; i < n; i++) {
      const o = i * 3, x0 = S[o], y0 = S[o + 1], z0 = S[o + 2]
      let x = x0, y = y0, z = z0
      const ax = ${ex}, ay = ${ey}, az = ${ez}
      x = x0 + ax * h * 0.5; y = y0 + ay * h * 0.5; z = z0 + az * h * 0.5
      const bx = ${ex}, by = ${ey}, bz = ${ez}
      S[o] = x0 + bx * h; S[o + 1] = y0 + by * h; S[o + 2] = z0 + bz * h
      acc += Math.sqrt(bx * bx + by * by + bz * bz)
    }
    return acc / n`)
}

// Center, size and mean speed of a set of states. Non-finite states are skipped.
function stats(S, n) {
  let cx = 0, cy = 0, cz = 0, m = 0
  for (let i = 0; i < n; i++) {
    const x = S[i * 3], y = S[i * 3 + 1], z = S[i * 3 + 2]
    if (x - x + y - y + z - z !== 0) continue
    cx += x; cy += y; cz += z; m++
  }
  if (!m) return null
  cx /= m; cy /= m; cz /= m
  let r = 0
  for (let i = 0; i < n; i++) {
    const x = S[i * 3] - cx, y = S[i * 3 + 1] - cy, z = S[i * 3 + 2] - cz
    if (x - x + y - y + z - z !== 0) continue
    r += x * x + y * y + z * z
  }
  return { c: [cx, cy, cz], R: Math.sqrt(r / m) }
}

// Run a few test particles to find where the system lives before the tweets go in.
function pilot(f) {
  const m = 48, S = new Float64Array(m * 3)
  for (let i = 0; i < S.length; i++) S[i] = Math.random() * 2 - 1
  let R = 1, v = f(S, m, 0, 0) || 1, st = null
  for (let k = 0; k < 1500; k++) {
    v = f(S, m, (0.01 * R) / Math.max(1e-6, v), 0) || v
    st = stats(S, m)
    if (!st || !(st.R < 1e6)) return { c: [0, 0, 0], R: 1, v: 1 }
    R = Math.max(1e-3, st.R)
  }
  return { c: st.c, R, v }
}

export default function ode(F) {
  let srcs = PRESETS.Lorenz.slice(), f = stepper(srcs), speed = 1
  const S = new Float32Array(F.n * 3)
  let { c, R, v } = pilot(f)
  let theta = 0.6, t = 0
  const k = () => (Math.min(F.w, F.h) * 0.2) / R
  const cyPx = () => F.h * (F.mini ? 0.5 : 0.47)

  // start each tracer under its current screen position, at a random depth
  {
    const s = k(), co = Math.cos(theta), si = Math.sin(theta)
    for (let i = 0; i < F.n; i++) {
      const u = (F.pos[i * 2] - F.w / 2) / s, w = (cyPx() - F.pos[i * 2 + 1]) / s, d = (Math.random() - 0.5) * R
      S[i * 3] = c[0] + u * co - d * si; S[i * 3 + 1] = c[1] + u * si + d * co; S[i * 3 + 2] = c[2] + w
    }
  }

  function step(F, dt) {
    theta += dt * 0.1
    const h = (speed * 0.006 * R) / Math.max(1e-6, v)
    let vm = 0
    for (let s = 0; s < 2; s++) { vm = f(S, F.n, h, t); t += h }
    if (vm > 0 && vm < Infinity) v += (vm - v) * 0.1
    const st = stats(S, F.n)
    if (st && st.R > 1e-6 && st.R < 1e9) {
      const a = 1 - Math.exp(-dt * 1.2)
      for (let j = 0; j < 3; j++) c[j] += (st.c[j] - c[j]) * a
      R += (st.R - R) * a
    }
    const s = k(), co = Math.cos(theta), si = Math.sin(theta), far = 49 * R * R, cy = cyPx()
    for (let i = 0; i < F.n; i++) {
      let x = S[i * 3] - c[0], y = S[i * 3 + 1] - c[1], z = S[i * 3 + 2] - c[2]
      if (!(x * x + y * y + z * z < far)) {
        // flew off or blew up: rejoin next to another tracer, or near the center
        const j = Math.floor(Math.random() * F.n) * 3
        const ok = Math.abs(S[j] - c[0]) + Math.abs(S[j + 1] - c[1]) + Math.abs(S[j + 2] - c[2]) < 4 * R
        const spread = R * (ok ? 0.03 : 0.6), rnd = () => (Math.random() + Math.random() + Math.random() - 1.5) * spread
        x = (ok ? S[j] - c[0] : 0) + rnd()
        y = (ok ? S[j + 1] - c[1] : 0) + rnd()
        z = (ok ? S[j + 2] - c[2] : 0) + rnd()
        S[i * 3] = x + c[0]; S[i * 3 + 1] = y + c[1]; S[i * 3 + 2] = z + c[2]
      }
      F.pos[i * 2] = F.w / 2 + (x * co + y * si) * s
      F.pos[i * 2 + 1] = cy - z * s
    }
  }

  // ---- the formula editor --------------------------------------------------
  let panel = null
  if (!F.mini) {
    let editing = false
    panel = el('div', { class: 'ode-panel' + (F.w < 600 ? ' min' : '') })
    panel.innerHTML = `<div class="ode-head">
        <select aria-label="System">${Object.keys(PRESETS).map((n) => `<option>${n}</option>`).join('')}<option>custom</option></select>
        <button class="ode-edit" type="button">edit</button>
        <button class="ode-min" type="button" aria-label="Show or hide the equations">&#9662;</button>
      </div>
      <div class="ode-eqs"></div>
      <div class="ode-foot"><span>speed <span class="scrub" data-speed>1</span></span><span class="ode-err"></span></div>`
    document.body.append(panel)
    const sel = panel.querySelector('select'), eqs = panel.querySelector('.ode-eqs'), err = panel.querySelector('.ode-err')
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

    const render = () => {
      eqs.innerHTML = srcs.map((s, i) => {
        let n = 0
        const rhs = editing
          ? `<input data-eq="${i}" value="${esc(s)}" spellcheck="false" autocapitalize="off" autocomplete="off">`
          : esc(s).replace(NUM, (m) => `<span class="scrub" data-eq="${i}" data-n="${n++}">${m}</span>`)
        return `<div class="ode-eq"><i>d${'xyz'[i]}/dt =</i><span class="ode-rhs">${rhs}</span></div>`
      }).join('')
      panel.querySelector('.ode-edit').textContent = editing ? 'done' : 'edit'
    }
    // move: carry the tracers over to where the new system lives, keeping
    // each one at the same place on screen, so they flow into the new shape
    const apply = (next, move) => {
      try {
        const g = stepper(next)
        g(new Float64Array(3), 1, 0.01, 0) // throws now if the expression is broken
        f = g; srcs = next; err.textContent = ''
        const p = pilot(f); v = p.v
        if (move) {
          const q = p.R / R
          for (let i = 0; i < F.n; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] = p.c[j] + (S[i * 3 + j] - c[j]) * q
          c = p.c; R = p.R
        }
        const name = Object.keys(PRESETS).find((n) => PRESETS[n].join('|') === srcs.join('|'))
        sel.value = name || 'custom'
        return true
      } catch (e) { err.textContent = e.message; return false }
    }
    render()

    sel.addEventListener('change', () => { if (PRESETS[sel.value] && apply(PRESETS[sel.value].slice(), true)) render() })
    panel.querySelector('.ode-edit').addEventListener('click', () => { editing = !editing; panel.classList.remove('min'); render() })
    panel.querySelector('.ode-min').addEventListener('click', () => panel.classList.toggle('min'))
    eqs.addEventListener('change', (e) => {
      if (!e.target.matches('input')) return
      const next = srcs.slice(); next[+e.target.dataset.eq] = e.target.value.trim() || '0'
      apply(next)
    })
    // drag a number left or right to change it
    panel.addEventListener('pointerdown', (e) => {
      const sp = e.target.closest('.scrub')
      if (!sp) return
      e.preventDefault()
      sp.setPointerCapture(e.pointerId); sp.classList.add('on')
      const v0 = parseFloat(sp.textContent), x0 = e.clientX
      const unit = v0 === 0 ? 0.1 : Math.pow(10, Math.floor(Math.log10(Math.abs(v0))) - 1)
      const digits = Math.max(0, -Math.floor(Math.log10(unit)))
      const move = (ev) => {
        const val = Math.max(0, v0 + Math.round((ev.clientX - x0) / 4) * unit)
        const text = String(+val.toFixed(digits))
        if (text === sp.textContent) return
        sp.textContent = text
        if ('speed' in sp.dataset) { speed = val; return }
        const i = +sp.dataset.eq, nth = +sp.dataset.n
        let n = 0
        const next = srcs.slice(); next[i] = srcs[i].replace(NUM, (m) => (n++ === nth ? text : m))
        apply(next)
      }
      const up = () => { sp.classList.remove('on'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up) }
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up)
    })
  }

  return {
    trail: 0.1,
    size: [1.8, 0.07],
    caption: 'The same tweets as tracer particles in a system of differential equations. Each one follows the three formulas in the panel at the bottom left. Pick another system, drag any number, or press edit and rewrite a term. Color is the year.',
    step,
    dispose() { if (panel) panel.remove() },
  }
}
