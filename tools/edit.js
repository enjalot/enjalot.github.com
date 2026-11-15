// In-page editing for the home page. Only tools/dev.py loads this file, so the
// deployed site never has it. Press Edit, click any text in the page and type.
// Changes are written back into index.html a moment after you stop.
//
// What you can edit: the intro, the section headings, and in each position the
// company, role, dates and bullets (Enter adds a bullet). Type [text](url) to
// make a link. Each quoted tweet gets an x to drop it.

// tools/dev.py marks the page it serves. Anywhere else (GitHub Pages) there is
// nothing to save to, so this file does nothing even if it gets loaded.
if (!document.querySelector('meta[name=edit-rev]')) throw new Error('edit.js only runs under tools/dev.py')

const main = document.getElementById('content')
const LINE = '.tagline, .intro p, #content > h2, .job .company, .job .role, .job .dates'
const UI = 'data-edit-ui'
let on = false, timer = 0, undo = []
let rev = document.querySelector('meta[name=edit-rev]')?.content

const css = document.createElement('style')
css.textContent = `
#edit-hud { position: fixed; top: 10px; right: 10px; z-index: 80; display: flex; gap: 6px; align-items: center;
  padding: 5px 6px 5px 10px; border-radius: 999px; background: #111; color: #ddd; font: 12px system-ui, sans-serif;
  box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 4px 16px rgba(0,0,0,.35); }
#edit-hud button { font: inherit; border: 0; border-radius: 999px; padding: 5px 11px; cursor: pointer; background: #333; color: #fff; }
#edit-hud button[aria-pressed=true] { background: #ffb454; color: #111; }
#edit-hud .err { color: #ff8a80; }
.editing [contenteditable] { outline: 1px dashed color-mix(in srgb, var(--link) 45%, transparent); outline-offset: 3px; border-radius: 2px; cursor: text; }
.editing [contenteditable]:focus { outline: 2px solid var(--link); }
.editing .job .role { display: inline-block; min-width: 3em; }
.editing .job .role:empty::before { content: 'role'; opacity: .45; }
.editing .tweet cite a::after { display: none; } /* the card is not a link while editing */
.edit-x { position: absolute; z-index: 2; top: 4px; right: 4px; width: 26px; height: 26px; border-radius: 50%; border: 1px solid currentColor;
  background: #111; color: #fff; font: 16px/1 system-ui, sans-serif; cursor: pointer; opacity: .85; }
.edit-x:hover { opacity: 1; background: #c0392b; color: #fff; border-color: #c0392b; }
`
document.head.append(css)

const hud = document.createElement('div')
hud.id = 'edit-hud'
hud.innerHTML = '<span class="status"></span><button class="undo" hidden>undo</button><button class="toggle" aria-pressed="false">Edit</button>'
document.body.append(hud)
const status = hud.querySelector('.status'), undoBtn = hud.querySelector('.undo'), toggle = hud.querySelector('.toggle')
const say = (text, err) => { status.textContent = text; status.classList.toggle('err', !!err) }

function setOn(v) {
  on = v
  toggle.setAttribute('aria-pressed', on)
  toggle.textContent = on ? 'Editing' : 'Edit'
  document.documentElement.classList.toggle('editing', on)
  try { localStorage.setItem('edit-on', on ? '1' : '') } catch (e) {}
  for (const e of main.querySelectorAll(LINE)) on ? e.setAttribute('contenteditable', 'plaintext-only') : e.removeAttribute('contenteditable')
  for (const e of main.querySelectorAll('.card ul')) on ? e.setAttribute('contenteditable', 'true') : e.removeAttribute('contenteditable')
  for (const e of main.querySelectorAll('.portal')) on ? e.setAttribute('contenteditable', 'false') : e.removeAttribute('contenteditable')
  main.querySelectorAll(`[${UI}]`).forEach((e) => e.remove())
  if (on) for (const t of main.querySelectorAll('.tweet')) {
    const x = document.createElement('button')
    x.className = 'edit-x'; x.setAttribute(UI, ''); x.type = 'button'; x.textContent = '×'
    x.title = 'Drop this tweet'
    t.append(x)
  }
  if (!on) say('')
}

// The page as it should be written to index.html: no editor attributes or
// buttons, and nothing lens.js added to the portal buttons.
function clean() {
  const c = main.cloneNode(true)
  c.querySelectorAll(`[${UI}]`).forEach((e) => e.remove())
  c.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'))
  c.querySelectorAll('video').forEach((e) => { e.removeAttribute('controls'); e.setAttribute('autoplay', '') })
  c.querySelectorAll('.portal').forEach((e) => { e.replaceChildren(); e.removeAttribute('aria-label') })
  c.querySelectorAll('.card ul [style], .card ul font').forEach((e) => e.removeAttribute('style'))
  c.querySelectorAll('.card ul span:not([class]), .card ul font').forEach((e) => e.replaceWith(...e.childNodes))
  c.querySelectorAll('.card ul br, .job br, .intro br, h2 br').forEach((e) => e.remove())
  c.querySelectorAll('.card ul > :not(li)').forEach((e) => { const li = document.createElement('li'); li.append(...e.childNodes); e.replaceWith(li) })
  c.querySelectorAll('.card li').forEach((e) => { if (!e.textContent.trim()) e.remove() })
  c.querySelectorAll('.role').forEach((e) => { e.textContent = e.textContent.trim() })
  // keep data-from / data-to in step with the dates you typed
  c.querySelectorAll('.card').forEach((card) => {
    const d = card.querySelector('.dates')
    const ys = d ? d.textContent.match(/\b(19|20)\d\d\b/g) : null
    if (!ys) return
    card.dataset.from = ys[0]
    if (ys[1]) card.dataset.to = ys[1]
    else if (/present|now/i.test(d.textContent)) card.dataset.to = new Date().getFullYear()
    else card.dataset.to = ys[0]
  })
  return c.innerHTML.replace(/&nbsp;/g, ' ')
}

async function save() {
  clearTimeout(timer); timer = 0
  say('saving')
  try {
    const r = await fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Edit': '1' }, body: JSON.stringify({ main: clean(), rev }) })
    const j = await r.json()
    if (!j.ok) throw new Error(j.error)
    rev = j.rev
    say('saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  } catch (e) { say('not saved: ' + e.message, true) }
}
const touch = () => { clearTimeout(timer); say('editing'); timer = setTimeout(save, 900) }

// [text](url) typed in a bullet becomes a link when you leave it
function linkify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits = []
  for (let n; (n = walker.nextNode());) if (!n.parentElement.closest('a') && /\[[^\]]+\]\([^)\s]+\)/.test(n.data)) hits.push(n)
  for (const n of hits) {
    const frag = document.createDocumentFragment()
    let rest = n.data, m
    while ((m = rest.match(/\[([^\]]+)\]\(([^)\s]+)\)/))) {
      frag.append(rest.slice(0, m.index))
      const a = document.createElement('a'); a.href = m[2]; a.textContent = m[1]
      frag.append(a)
      rest = rest.slice(m.index + m[0].length)
    }
    frag.append(rest)
    n.replaceWith(frag)
  }
  return hits.length
}

toggle.addEventListener('click', () => setOn(!on))
undoBtn.addEventListener('click', () => {
  const u = undo.pop()
  if (u) { u.parent.insertBefore(u.node, u.next && u.next.parentNode === u.parent ? u.next : null); touch() }
  undoBtn.hidden = !undo.length
})
main.addEventListener('input', () => { if (on) touch() })
main.addEventListener('focusout', (e) => { if (on && e.target.closest && e.target.closest('.card ul') && linkify(e.target.closest('.card ul'))) touch() })
main.addEventListener('paste', (e) => {
  if (!on) return
  e.preventDefault()
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '))
})
main.addEventListener('keydown', (e) => {
  if (on && e.key === 'Enter' && e.target.closest('[contenteditable="plaintext-only"]')) { e.preventDefault(); e.target.blur() }
})
main.addEventListener('click', (e) => {
  if (!on) return
  const x = e.target.closest('.edit-x')
  if (x) {
    const t = x.closest('.tweet')
    undo.push({ node: t, parent: t.parentNode, next: t.nextSibling })
    t.remove()
    undoBtn.hidden = false
    touch()
    return
  }
  // links inside editable text place the cursor; hold Cmd or Ctrl to follow them
  if (e.target.closest('a') && e.target.closest('[contenteditable]') && !e.metaKey && !e.ctrlKey) e.preventDefault()
})
addEventListener('beforeunload', () => { if (timer) save() })

let saved = ''
try { saved = localStorage.getItem('edit-on') } catch (e) {}
setOn(!!saved)
