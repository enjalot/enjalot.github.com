// Lens loader. The page reads fine without this file. With it, my tweets sit
// behind the page as a field of dots, and each lens is a different way to
// arrange the same dots. The bar at the bottom switches lenses, and the round
// .portal buttons in the text preview a lens on hover and switch to it on click.
//
// To add a lens: add an entry here, a factory in arrange.js (see `load`), and
// <button class="portal" data-lens="name"></button> somewhere in the page.

const LENSES = {
  hilbert: {
    label: 'Hilbert',
    blurb: 'The same tweets in time order on a Hilbert curve',
    glyph: '<path d="M2 2H6V6H2V14H6V10H10V14H14V6H10V2H14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>',
  },
  umap: {
    label: 'Map',
    blurb: 'My tweets, embedded and mapped',
    glyph: '<circle cx="4" cy="5" r="1.4"/><circle cx="7" cy="3.5" r="1"/><circle cx="6" cy="7" r="1.2"/><circle cx="11" cy="10" r="1.5"/><circle cx="12.5" cy="12.5" r="1"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="12" cy="4" r=".9"/><circle cx="3.5" cy="12" r=".9"/>',
  },
  fluid: {
    label: 'Fluid',
    blurb: 'The same tweets as particles in a fluid',
    glyph: '<path d="M8 1.5C5.5 5 3.5 7.5 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7.5 10.5 5 8 1.5Z"/>',
  },
  ode: {
    label: 'ODE',
    blurb: 'The same tweets as tracers in a differential equation',
    glyph: '<path d="M8 8C6 4.5 2 5 2 8s4 3.500 6 0 6-3.500 6 0-4 3.500-6 0Z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  },
}
const ORDER = ['plain', ...Object.keys(LENSES)]
const root = document.documentElement
root.classList.add('js')
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const svg = (name) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">${LENSES[name].glyph}</svg>`

const stage = document.createElement('div')
stage.id = 'lens-stage'
stage.setAttribute('aria-hidden', 'true')
document.body.prepend(stage)

let fieldP = null
const field = () => (fieldP ||= import('./field.js').then((m) => m.createField(stage, { reduced })))

// ---- switching -------------------------------------------------------------
let current = null

async function enter(name, origin) {
  if (name === current) return
  hidePop()
  const wasPlain = current === 'plain', first = current === null
  current = name
  renderBar()
  history.replaceState(null, '', name === 'hilbert' ? location.pathname + location.search : '#lens=' + name)
  const apply = () => {
    // the page is a different height with and without the tweets, so keep
    // whatever you were reading at the same place on screen
    const anchor = [...document.querySelectorAll('#content > h2, #content > .card, .intro')].find((e) => e.getBoundingClientRect().bottom > 60)
    const y0 = anchor && anchor.getBoundingClientRect().top
    if (name === 'plain') delete root.dataset.lens; else root.dataset.lens = name
    if (anchor && scrollY > 0) scrollBy(0, anchor.getBoundingClientRect().top - y0)
  }
  // going to or from the plain page opens like a portal from wherever you clicked
  if ((name === 'plain' || wasPlain) && !first && document.startViewTransition && !reduced) {
    const r = origin && origin.getBoundingClientRect()
    root.style.setProperty('--px', (r ? r.left + r.width / 2 : innerWidth / 2) + 'px')
    root.style.setProperty('--py', (r ? r.top + r.height / 2 : innerHeight) + 'px')
    // wait for the switch itself: the field must not measure the stage while it is still hidden
    await document.startViewTransition(apply).updateCallbackDone
  } else apply()
  if (current !== name) return
  if (name === 'plain') { if (fieldP) (await fieldP).pause(); return }
  const f = await field()
  if (current !== name) return
  f.resume()
  f.set(name)
}

// ---- the bar ---------------------------------------------------------------
const bar = document.createElement('nav')
bar.id = 'lens-bar'
bar.setAttribute('aria-label', 'Lenses')
document.body.append(bar)
function renderBar() {
  bar.innerHTML =
    `<button data-lens="plain" class="plain" aria-pressed="${current === 'plain'}" title="The page without the dots (Esc)">plain</button>` +
    Object.keys(LENSES).map((n) => `<button data-lens="${n}" aria-pressed="${n === current}" title="${LENSES[n].blurb}">${svg(n)}<span>${LENSES[n].label}</span></button>`).join('') +
    '<a href="index.md" target="_blank" rel="noopener" title="This page as markdown, for agents">markdown</a>'
}
bar.addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (b) enter(b.dataset.lens, b)
})
// quoted tweets with a looping clip: no autoplay if you asked for less motion
if (reduced) document.querySelectorAll('.tweet video').forEach((v) => { v.removeAttribute('autoplay'); v.pause(); v.controls = true
})
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Escape') enter('plain')
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (step) enter(ORDER[(ORDER.indexOf(current) + step + ORDER.length) % ORDER.length])
})

// ---- hover preview ---------------------------------------------------------
const pop = document.createElement('div')
pop.className = 'portal-pop'
pop.innerHTML = '<div class="portal-pop-stage"></div><div class="portal-pop-label"></div>'
document.body.append(pop)
let popTimer = 0, popCleanup = null, popFor = null

async function showPop(btn) {
  const name = btn.dataset.lens
  popFor = btn
  const mod = await import('./field.js')
  if (popFor !== btn) return
  hidePop(true)
  const r = btn.getBoundingClientRect()
  const size = 208
  const x = Math.max(8, Math.min(innerWidth - size - 8, r.left + r.width / 2 - size / 2))
  const above = r.top > size + 70
  pop.style.left = x + 'px'
  pop.style.top = (above ? r.top - size - 58 : r.bottom + 10) + 'px'
  pop.style.setProperty('--ox', r.left + r.width / 2 - x + 'px')
  pop.style.setProperty('--oy', above ? size + 58 + 'px' : '-10px')
  pop.lastChild.innerHTML = `<b>${LENSES[name].label}</b> ${LENSES[name].blurb}. Click to switch.`
  pop.classList.add('on')
  popCleanup = mod.preview(name, pop.firstChild, { reduced })
}
function hidePop(keep) {
  clearTimeout(popTimer)
  if (!keep) popFor = null
  pop.classList.remove('on')
  if (popCleanup) { popCleanup(); popCleanup = null }
}

for (const btn of document.querySelectorAll('.portal')) {
  const name = btn.dataset.lens
  if (!LENSES[name]) continue
  btn.innerHTML = svg(name)
  btn.setAttribute('aria-label', `Arrange the dots behind this page as: ${LENSES[name].label}`)
  btn.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return
    clearTimeout(popTimer)
    popTimer = setTimeout(() => showPop(btn), 140)
  })
  btn.addEventListener('pointerleave', () => hidePop())
  btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) showPop(btn) })
  btn.addEventListener('blur', () => hidePop())
  btn.addEventListener('click', () => enter(name, btn))
}

const fromHash = () => {
  const m = location.hash.match(/lens=([\w-]+)/)
  const name = m ? m[1] : 'hilbert'
  enter(LENSES[name] || name === 'plain' ? name : 'hilbert')
}
addEventListener('hashchange', fromHash)
fromHash()
