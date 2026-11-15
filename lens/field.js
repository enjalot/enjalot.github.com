// The particle field: every tweet since 2008 as one WebGL point, fixed behind
// the page. An arrangement (arrange.js) decides where the points go. Scrolling
// lights the years of the job in view, the tweets quoted between jobs get a
// faint line to their own dot, and the section at the end of the page lets you
// read any dot.
import { program, yearRgb, yearCss, el } from './util.js'
import { makeF, advance, load } from './arrange.js'

const ALL = [2007, 2028]
const DIM = [0.42, 0.44, 0.6]
const SIZE = [2.6, 0.3] // point diameter: base, plus this much per unit of likes

let baseP, tweetsP
export function base() {
  baseP ||= fetch(new URL('./data/map.json', import.meta.url)).then((r) => r.json()).then((d) => {
    const P = d.points, n = P.x.length
    const b = { n, ux: new Float32Array(n), uy: new Float32Array(n), year: new Float32Array(n), like: new Float32Array(n), col: new Float32Array(n * 3), days: P.d, clusters: d.clusters }
    for (let i = 0; i < n; i++) {
      b.ux[i] = P.x[i] / 1023; b.uy[i] = P.y[i] / 1023; b.like[i] = P.l[i]
      b.year[i] = 2008 + P.d[i] / 365.25
      const c = yearRgb(b.year[i])
      for (let j = 0; j < 3; j++) b.col[i * 3 + j] = (c[j] + (255 - c[j]) * 0.2) / 255 // lifted a little for the dark page
    }
    return b
  })
  return baseP
}
const tweets = () => (tweetsP ||= fetch(new URL('./data/tweets.json', import.meta.url)).then((r) => r.json()))
const dateOf = (days) => new Date(Date.UTC(2008, 0, 1 + days)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const VS = `
attribute vec2 a_pos; attribute vec3 a_col; attribute vec2 a_meta; // likes, year
uniform vec2 u_view, u_years, u_size; uniform float u_dpr; uniform mediump float u_focus; uniform vec3 u_dim;
varying vec4 v_col;
void main() {
  vec2 p = a_pos / u_view * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  float lit = smoothstep(u_years.x - 1.2, u_years.x, a_meta.y) * (1.0 - smoothstep(u_years.y, u_years.y + 1.2, a_meta.y));
  gl_PointSize = mix(u_size.x * 0.62, u_size.x + a_meta.x * u_size.y, lit) * u_dpr * mix(2.4, 1.0, u_focus);
  v_col = mix(vec4(u_dim, 0.42), vec4(a_col, 0.88), lit);
}`
const FS = `
precision mediump float;
varying vec4 v_col; uniform float u_focus; // 0 = soft and faint (top of the page), 1 = crisp
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, mix(0.0, 0.32, u_focus), d) * v_col.a * mix(0.3, 1.0, u_focus);
  gl_FragColor = vec4(v_col.rgb * a, a);
}`
const QVS = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
const QFS = 'precision mediump float; uniform float u_a; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, u_a); }'

export async function createField(stage, { reduced }) {
  const b = await base()
  const canvas = el('canvas'), labels = el('div', { class: 'field-labels' })
  stage.append(canvas, labels)
  const over = el('canvas', { id: 'lens-over', 'aria-hidden': 'true' })
  const tip = el('div', { class: 'field-tip' })
  stage.append(over) // under the page, so cards cover the lines and anchor dots
  document.body.append(tip)
  const og = over.getContext('2d')
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true })
  if (!gl) return { set() {}, pause() {}, resume() {} }

  const prog = program(gl, VS, FS), quad = program(gl, QVS, QFS)
  const U = (n) => gl.getUniformLocation(prog, n)
  gl.enable(gl.BLEND)
  let w = 1, h = 1, dpr = 1
  const F = makeF(b, 1, 1, { reduced })

  const stat = new Float32Array(F.n * 5)
  for (let i = 0; i < F.n; i++) stat.set([F.col[i * 3], F.col[i * 3 + 1], F.col[i * 3 + 2], F.like[i], F.year[i]], i * 5)
  const statBuf = gl.createBuffer(), posBuf = gl.createBuffer(), quadBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, statBuf); gl.bufferData(gl.ARRAY_BUFFER, stat, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, F.pos, gl.DYNAMIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const LOC = { pos: gl.getAttribLocation(prog, 'a_pos'), col: gl.getAttribLocation(prog, 'a_col'), meta: gl.getAttribLocation(prog, 'a_meta'), q: gl.getAttribLocation(quad, 'a_pos') }

  let unit = true // the starting scatter is in a 1x1 box until the first real measure
  let A = null, token = 0, fresh = true, paused = false, raf = 0, last = 0
  let yrs = ALL.slice(), yT = ALL.slice(), lastScroll = scrollY
  let hover = -1, pinned = -1, labelEls = [], focus = 0, focusT = 0
  const cards = [...document.querySelectorAll('[data-from]')]
  const pane = document.querySelector('.explore-pane'), caption = document.querySelector('.explore-caption')

  function measure() {
    if (!stage.clientWidth || !stage.clientHeight) return // hidden (plain page): keep the last real size
    dpr = Math.min(2, devicePixelRatio || 1)
    w = Math.max(1, stage.clientWidth); h = Math.max(1, stage.clientHeight)
    for (const c of [canvas, over]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    }
    if (F.w !== w || F.h !== h) {
      if (unit) for (let i = 0; i < F.n; i++) { F.pos[i * 2] *= w; F.pos[i * 2 + 1] *= h } // the scatter was made in a unit box
      unit = false
      F.w = w; F.h = h; F.dirty = true; fresh = true
      if (A && A.resize) A.resize(F)
    }
  }

  // Which years to light, from where the page is scrolled. Inside a job it is
  // that job's years; in the gap between two jobs it slides from one to the other.
  function readScroll() {
    const H = innerHeight, mid = H * 0.45
    // one stop per job, at the middle of its card; the years slide from one job's to the next between them
    const stops = cards.map((c) => { const r = c.getBoundingClientRect(); return [(r.top + r.bottom) / 2, [+c.dataset.from, +c.dataset.to + 1]] })
    const pr = pane ? pane.getBoundingClientRect() : null
    if (pr) stops.push([Math.max(pr.top - H * 0.2, stops.length ? stops[stops.length - 1][0] + 1 : 0), ALL])
    let range = stops.length ? stops[0][1] : ALL
    for (let i = 1; i < stops.length; i++) {
      const [y0, a] = stops[i - 1], [y1, c] = stops[i]
      if (mid < y0) break
      let t = Math.max(0, Math.min(1, ((mid - y0) / Math.max(1, y1 - y0) - 0.1) / 0.8))
      t = t * t * t * (t * (t * 6 - 15) + 10)
      range = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
    }
    // at the very top every year is lit; the first scroll narrows it to the job in view
    const top = Math.max(0, Math.min(1, scrollY / (H * 0.4)))
    range = [ALL[0] + (range[0] - ALL[0]) * top, ALL[1] + (range[1] - ALL[1]) * top]
    yT = range
    // top of the page: the dots sit small, soft and faint; they sharpen as the first job comes up
    focusT = Math.max(0, Math.min(1, scrollY / (H * 0.6)))
    if (Math.abs(focusT - F.intro) > 0.002) { F.intro = focusT; F.dirty = true }
    const e = pr ? Math.max(0, Math.min(1, (H * 0.8 - pr.top) / (H * 0.5))) : 0
    if (Math.abs(e - F.explore) > 0.002) { F.explore = e; F.dirty = true }
    document.documentElement.classList.toggle('exploring', e > 0.6)
    if (e > 0) tweets()
    if (e < 0.3 && (pinned >= 0 || hover >= 0)) { pinned = hover = -1; showTip() }
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (A && A.trail && !fresh) {
      gl.useProgram(quad)
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1f(gl.getUniformLocation(quad, 'u_a'), A.trail)
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
      gl.enableVertexAttribArray(LOC.q); gl.vertexAttribPointer(LOC.q, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    } else {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    }
    fresh = false
    gl.useProgram(prog)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, F.pos)
    gl.enableVertexAttribArray(LOC.pos); gl.vertexAttribPointer(LOC.pos, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, statBuf)
    gl.enableVertexAttribArray(LOC.col); gl.vertexAttribPointer(LOC.col, 3, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(LOC.meta); gl.vertexAttribPointer(LOC.meta, 2, gl.FLOAT, false, 20, 12)
    const size = (A && A.size) || SIZE
    gl.uniform2f(U('u_view'), w, h); gl.uniform2f(U('u_years'), yrs[0], yrs[1]); gl.uniform2f(U('u_size'), size[0], size[1])
    gl.uniform1f(U('u_focus'), focus); gl.uniform1f(U('u_dpr'), dpr); gl.uniform3f(U('u_dim'), DIM[0], DIM[1], DIM[2])
    gl.drawArrays(gl.POINTS, 0, F.n)
  }

  // Above the page: a faint line from each quoted tweet to its dot, and a ring
  // on the dot being read in the map at the end.
  function drawOver() {
    og.setTransform(dpr, 0, 0, dpr, 0, 0)
    og.clearRect(0, 0, w, h)
    const mark = (i, a, r) => {
      const x = F.pos[i * 2], y = F.pos[i * 2 + 1]
      og.beginPath(); og.arc(x, y, r, 0, 6.283)
      og.fillStyle = yearCss(F.year[i], a); og.fill()
      og.lineWidth = 1.5; og.strokeStyle = `rgba(255,255,255,${0.9 * a})`; og.stroke()
    }
    for (const q of document.querySelectorAll('.tweet[data-i]')) {
      const r = q.getBoundingClientRect()
      if (r.bottom < 0 || r.top > h) continue
      const i = +q.dataset.i
      if (!(i >= 0 && i < F.n)) continue
      const a = Math.max(0, Math.min(1, 1.5 - Math.abs((r.top + r.bottom) / 2 - h / 2) / (h * 0.36)))
      if (a <= 0) continue
      const x = F.pos[i * 2], y = F.pos[i * 2 + 1]
      const sx = Math.max(r.left, Math.min(r.right, x)), sy = Math.max(r.top, Math.min(r.bottom, y))
      if (sx !== x || sy !== y) {
        og.beginPath(); og.moveTo(sx, sy); og.lineTo(x, y)
        og.lineWidth = 1; og.strokeStyle = `rgba(255,255,255,${0.3 * a})`; og.stroke()
      }
      mark(i, a, 4)
    }
    const cur = pinned >= 0 ? pinned : hover
    if (cur >= 0) { mark(cur, 1, 6); placeTip(cur) }
  }

  function placeLabels() {
    if (!A || !A.labels) return
    const L = A.labels(F)
    labels.classList.toggle('far', F.intro < 0.7) // too small to label at the top of the page
    labelEls.forEach((s, i) => {
      const l = L[i]
      const edge = F.explore < 0.5 && (l.x < 70 || l.x > w - 70)
      s.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)`
      s.style.display = edge ? 'none' : ''
      if (l.yr) s.classList.toggle('dim', l.yr + 1 <= yrs[0] || l.yr >= yrs[1])
    })
  }
  function makeLabels() {
    labels.replaceChildren()
    labels.classList.remove('on')
    labelEls = A && A.labels ? A.labels(F).map((l) => { const s = el('span', l.yr ? { class: 'yr' } : {}); s.textContent = l.text; labels.append(s); return s }) : []
  }

  function frame(now) {
    raf = 0
    if (paused || document.hidden) return
    const dt = now - last > 120 ? 1 / 60 : Math.max(0.001, (now - last) / 1000)
    last = now
    const sv = scrollY - lastScroll
    lastScroll = scrollY
    F.scrollV += (sv - F.scrollV) * 0.3
    if (F.pointer && now - F.pointer.at > 120) F.pointer = null
    const k = 1 - Math.exp(-dt * 4)
    const yMove = Math.abs(yT[0] - yrs[0]) + Math.abs(yT[1] - yrs[1]) > 0.01 || Math.abs(focusT - focus) > 0.004
    focus = focusT
    yrs[0] += (yT[0] - yrs[0]) * k; yrs[1] += (yT[1] - yrs[1]) * k
    const wasDirty = F.dirty
    const moving = A ? advance(F, A, dt) : false
    if (wasDirty || yMove) placeLabels()
    if (A && A.labels && F.tt > 1.6) labels.classList.add('on')
    draw(); drawOver()
    if (moving || yMove || Math.abs(F.scrollV) > 0.5) request()
    else if (A && A.labels && F.tt <= 1.6) request()
  }
  const request = () => { if (!raf && !paused) raf = requestAnimationFrame(frame) }

  async function set(name) {
    const t = ++token
    const make = await load[name]()
    if (t !== token) return
    if (A && A.dispose) A.dispose()
    measure()
    F.tt = 0; F.dirty = true; F.settled = false; fresh = true
    if (A) for (let i = 0; i < F.n; i++) F.delay[i] = Math.random() * 0.35
    A = make(F)
    if (caption && A.caption) caption.textContent = A.caption
    makeLabels()
    if (F.reduced && !A.layout) for (let i = 0; i < 300; i++) A.step(F, 1 / 60) // a still frame of the moving arrangements
    readScroll()
    yrs = yT.slice(); focus = focusT
    request()
    if (F.reduced && !A.layout) { A = { ...A, layout() {}, step: null, trail: 0 }; F.tgt.set(F.pos) }
  }

  // ---- reading a dot in the map at the end of the page ---------------------
  function nearest(x, y) {
    let best = -1, bd = 24 * 24
    for (let i = 0; i < F.n; i++) {
      const dx = F.pos[i * 2] - x, dy = F.pos[i * 2 + 1] - y, d = dx * dx + dy * dy
      if (d < bd) { bd = d; best = i }
    }
    return best
  }
  let tipFor = -1
  function showTip() {
    const i = pinned >= 0 ? pinned : hover
    tip.classList.toggle('on', i >= 0)
    tip.classList.toggle('pinned', pinned >= 0)
    if (i < 0 || i === tipFor) { if (i < 0) tipFor = -1; return }
    tipFor = i
    tip.textContent = 'loading'
    tweets().then((T) => {
      if (tipFor !== i) return
      const a = el('a', { href: 'https://twitter.com/enjalot/status/' + T.id[i], target: '_blank', rel: 'noopener' })
      a.textContent = dateOf(b.days[i])
      const head = el('b'); head.append(a, ` · ${T.likes[i]} like${T.likes[i] === 1 ? '' : 's'}`)
      const parts = [head, document.createTextNode(T.text[i])]
      if (T.m && T.m[i]) parts.splice(1, 0, el('img', { src: new URL(`./data/thumbs/${T.id[i]}.webp`, import.meta.url).href, alt: '' }))
      tip.replaceChildren(...parts)
    })
  }
  function placeTip(i) {
    const x = F.pos[i * 2], y = F.pos[i * 2 + 1], tw = Math.min(300, w - 20)
    tip.style.left = Math.max(10, Math.min(w - tw - 10, x - tw / 2)) + 'px'
    if (y > h * 0.55) { tip.style.top = 'auto'; tip.style.bottom = h - y + 14 + 'px' } else { tip.style.bottom = 'auto'; tip.style.top = y + 14 + 'px' }
  }
  const inPane = (e) => pane && e.target instanceof Element && e.target.closest('.explore-pane')
  const onMove = (e) => {
    F.pointer = { x: e.clientX, y: e.clientY, vx: Math.max(-30, Math.min(30, e.movementX || 0)), vy: Math.max(-30, Math.min(30, e.movementY || 0)), at: performance.now() }
    if (paused) return
    if (e.pointerType === 'mouse' && pinned < 0) {
      const i = inPane(e) ? nearest(e.clientX, e.clientY) : -1
      if (i !== hover) { hover = i; showTip(); request() }
    }
    if (A && !A.layout) request()
  }
  const onDown = (e) => {
    if (paused || (e.target instanceof Element && e.target.closest('.field-tip'))) return
    const i = inPane(e) ? nearest(e.clientX, e.clientY) : -1
    if (i !== pinned) { pinned = i; hover = -1; showTip(); request() }
  }
  const onScroll = () => { readScroll(); request() }
  const onResize = () => { measure(); readScroll(); request() }
  addEventListener('pointermove', onMove)
  addEventListener('pointerdown', onDown)
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', request)

  const legend = document.querySelector('.explore-legend i')
  if (legend) legend.style.background = `linear-gradient(90deg, ${[2008, 2011, 2014, 2017, 2020, 2023, 2026].map((y) => yearCss(y)).join(',')})`

  return {
    set,
    pause() { paused = true; cancelAnimationFrame(raf); raf = 0; pinned = hover = -1; showTip(); if (A && A.dispose) { A.dispose(); A = null } },
    resume() { paused = false; measure(); readScroll(); request() },
  }
}

// A small live copy of an arrangement for the hover preview, drawn with canvas 2D.
export function preview(name, host, { reduced }) {
  let dead = false, raf = 0, A = null
  const size = host.clientWidth || 208, dpr = Math.min(2, devicePixelRatio || 1)
  const c = el('canvas')
  c.width = c.height = size * dpr
  c.style.cssText = 'width:100%;height:100%;display:block'
  host.append(c)
  const g = c.getContext('2d')
  Promise.all([base(), load[name]()]).then(([b, make]) => {
    if (dead) return
    const F = makeF(b, size, size, { every: 9, mini: true, reduced })
    for (let i = 0; i < F.n * 2; i++) F.pos[i] = size / 2 + (F.pos[i] - size / 2) * 0.6
    A = make(F)
    const css = Array.from({ length: F.n }, (_, i) => yearCss(F.year[i]))
    let last = performance.now()
    const tick = (now) => {
      raf = 0
      if (dead) return
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now
      const moving = advance(F, A, dt)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = A.trail ? 'rgba(9,11,24,0.16)' : 'rgb(9,11,24)'
      g.fillRect(0, 0, size, size)
      for (let i = 0; i < F.n; i++) { g.fillStyle = css[i]; g.fillRect(F.pos[i * 2] - 1.1, F.pos[i * 2 + 1] - 1.1, 2.2, 2.2) }
      if (moving && !reduced) raf = requestAnimationFrame(tick)
    }
    if (reduced && !A.layout) for (let i = 0; i < 300; i++) A.step(F, 1 / 60)
    raf = requestAnimationFrame(tick)
  })
  return () => { dead = true; cancelAnimationFrame(raf); if (A && A.dispose) A.dispose(); c.remove() }
}
