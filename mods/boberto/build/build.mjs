// Build: wraps the Boberto engine (boberto.js) into hooks/engine.generated.mjs,
// which the hooks run at RUN TIME to draw any outfit, pose and gesture; then
// draws through the hooks' own pure modules to report sizes and, with
// --preview, writes an HTML page of what the mod shows.
//
//   node build/build.mjs <path/to/boberto.js> <path/to/deny-list.txt> [--preview out.html]
//
// Both inputs are private (not in this repository); they can also come from
// $BOBERTO_JS and $BOBERTO_DENY_LIST. See make-engine.mjs.

import { statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadHooks } from './load-hooks.mjs'
import { makeEngineModule, resolveInputs } from './make-engine.mjs'

const args = process.argv.slice(2)
const previewAt = args.indexOf('--preview')
const previewPath = previewAt >= 0 ? args[previewAt + 1] : null
const positional = args.filter((a, i) => !a.startsWith('--') && (previewAt < 0 || i !== previewAt + 1))
const { enginePath, denyPath } = resolveInputs(positional)

const MOD = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(MOD, 'hooks', 'engine.generated.mjs')
const CAP = 131072

const { text, removed } = makeEngineModule(enginePath, denyPath)
writeFileSync(OUT, text)
console.log(`removed ${removed.length} declarations used only by the character catalog`)
console.log(`engine module: ${OUT} ${statSync(OUT).size} bytes`)

const art = await loadHooks('art')
const host = await loadHooks('engine-host')
const { LIVE, TOP_GESTURES } = await loadHooks('choreo')
const D = host.DEFAULT_OUTFIT

const report = (label, svg) => {
  console.log(`${label.padEnd(26)} ${String(svg.length).padStart(7)} chars (${((svg.length / CAP) * 100).toFixed(1)}% of cap)`)
  if (svg.length > art.SVG_BUDGET) throw new Error(`${label}: over the ${art.SVG_BUDGET} budget`)
  return svg
}

const live = {}
for (const name of LIVE) live[name] = report(`live ${name} (full)`, art.liveSvg(name, D, 'full'))
for (const name of LIVE) report(`live ${name} (small)`, art.liveSvg(name, D, 'small'))
const gestures = {}
for (const id of TOP_GESTURES) {
  const g = await art.gestureSvg(id, D, 'full')
  if (g === null) throw new Error(`gesture ${id} did not record`)
  const frames = (g.svg.match(/<g visibility=/g) ?? []).length
  gestures[id] = report(`gesture ${id} ${frames}f ${(g.durationMs / 1000).toFixed(1)}s`, g.svg)
}

if (previewPath) {
  const img = (svg, h, title = '') =>
    `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" height="${h}" width="${Math.round(h * art.aspectOf(svg))}" alt="${title}" title="${title}">`
  const fig = (body, caption) => `<figure>${body}<figcaption>${caption}</figcaption></figure>`

  const outfits = [
    ['default (bat wings)', D],
    ['crown, emerald, cyan eyes, violet glow', { hat: 'corona', skin: 'esmeralda', eye: '#7df9ff', glow: '#8b7cf6' }],
    ['wizard hat, blue', { hat: 'mago', skin: 'azul', eye: 'auto', glow: 'none' }],
    ['astronaut, pink, amber glow', { hat: 'astronauta', skin: 'rosa', eye: '#ffffff', glow: '#fbbf24' }],
    ['headphones, violet, red eyes', { hat: 'auriculares', skin: 'violeta', eye: '#ff5630', glow: 'none' }],
    ['no accessory, amber', { hat: 'limpio', skin: 'ambar', eye: 'auto', glow: '#38bdf8' }],
  ]
  const panes = outfits.map(([caption, o]) => fig(img(art.liveSvg('idle', o, 'full'), 190), caption)).join('\n')
  const liveCards = LIVE.map(name => fig(img(live[name], 150), name)).join('\n')
  const gestureCards = TOP_GESTURES.map(id => fig(img(gestures[id], 150), `${id} · ${gestures[id].length.toLocaleString('en')} chars`)).join('\n')
  const crowned = { hat: 'corona', skin: 'esmeralda', eye: '#7df9ff', glow: '#8b7cf6' }
  const g2 = await art.gestureSvg('guitarra', crowned, 'full')
  const g3 = await art.gestureSvg('skate', outfits[3][1], 'full')

  const t0 = Date.UTC(2026, 9, 2, 12)
  const s = 1000
  const entries = [
    { phase: 'done', count: 1, at: t0 - 400 * s, lastAt: t0 - 400 * s },
    { phase: 'thinking', count: 1, at: t0 - 300 * s, lastAt: t0 - 300 * s },
    { phase: 'reading', count: 4, at: t0 - 290 * s, lastAt: t0 - 260 * s },
    { phase: 'searching', count: 2, at: t0 - 250 * s, lastAt: t0 - 240 * s },
    { phase: 'delegating', detail: 'Explore', count: 1, at: t0 - 230 * s, lastAt: t0 - 230 * s },
    { phase: 'browsing', count: 3, at: t0 - 140 * s, lastAt: t0 - 120 * s },
    { phase: 'editing', count: 5, at: t0 - 100 * s, lastAt: t0 - 60 * s },
    { phase: 'running', count: 2, at: t0 - 50 * s, lastAt: t0 - 20 * s, isError: true },
    { phase: 'asking', count: 1, at: t0 - 12 * s, lastAt: t0 - 12 * s },
  ]
  const H = art.BAND_HEIGHT
  const band = (width, isWorking, name) => {
    const mini = art.miniPillSvg(art.liveSvg(name, D, 'small'), isWorking)
    const line = art.timelineSvg(entries, t0, width, isWorking)
    return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(mini)}" width="${art.MINI_WIDTH}" height="${H}">` +
      `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(line)}" width="${width}" height="${H}">`
  }
  const done = [...entries, { phase: 'done', count: 1, at: t0, lastAt: t0 }]
  const reaction = (name, text) =>
    `<div class="msg"><p>${text}</p>${img(art.liveSvg(name, D, 'small'), 72, name)}</div>`

  writeFileSync(
    previewPath,
    `<!doctype html><meta charset="utf-8"><title>Boberto mod preview</title>
<style>body{background:#121117;color:#d4d4d8;font:13px system-ui,sans-serif;margin:24px}
h2{font-size:14px;margin:28px 0 10px;color:#fafafa}main{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;padding:10px;background:#1b1a22;border:1px solid #2c2b36;border-radius:10px;text-align:center}
figcaption{margin-top:6px;color:#a1a1aa;font-size:12px}
.band{display:flex;gap:8px;align-items:center;padding:8px;background:#1b1a22;border-radius:10px;margin:6px 0;overflow:hidden}
.band img{flex:none}.msg{background:#1b1a22;border-radius:10px;padding:10px 14px;max-width:560px;margin:8px 0}.msg p{margin:0 0 6px}
.label{color:#a1a1aa;font-size:12px}</style>
<h1 style="font-size:16px">Boberto: drawn at run time by the engine (boberto.js) in the hooks environment</h1>
<h2>Pane (190 px) at several customizations</h2><main>${panes}
${fig(img(g2.svg, 190), 'guitarra in crown / emerald / violet glow')}${fig(img(g3.svg, 190), 'skate in astronaut / pink / amber glow')}</main>
<h2>Live states</h2><main>${liveCards}</main>
<h2>Idle gestures (recorded from the engine's g_* choreographies)</h2><main>${gestureCards}</main>
<h2>End-of-turn reactions (desktop: under the turn's last assistant row, 72 px, looping)</h2>
${reaction('celebrate', 'All done: the fix is in place and the tests pass.')}${reaction('dizzy', 'API error: overloaded.')}${reaction('calm', 'Interrupted by user.')}
<div class="msg"><p class="label">terminal TurnDuration row:</p><code>Baked for 42s &nbsp; <span style="color:#22c55e">\\(^o^)/</span> <span style="opacity:.6">Boberto cheers</span></code></div>
<h2>AbovePrompt band, real pixel size (${art.MINI_WIDTH}x${H} + ${art.TIMELINE_WIDTH.wide}x${H})</h2>
<div class="band" id="wide">${band(art.TIMELINE_WIDTH.wide, true, 'working')}</div>
<div class="band">${band(art.TIMELINE_WIDTH.wide, false, 'idle').replace(encodeURIComponent(art.timelineSvg(entries, t0, art.TIMELINE_WIDTH.wide, false)), encodeURIComponent(art.timelineSvg(done, t0, art.TIMELINE_WIDTH.wide, false)))}</div>
<h2>Narrow slot (bodyColumns &lt; 110: ${art.TIMELINE_WIDTH.narrow} px timeline), real pixel size, in a 480 px box</h2>
<div class="band" style="width:480px" id="narrow">${band(art.TIMELINE_WIDTH.narrow, true, 'searching')}</div>
<h2>Empty timeline</h2><div class="band">${`<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(art.miniPillSvg(art.liveSvg('sleep', D, 'small'), false))}" width="${art.MINI_WIDTH}" height="${H}">`}<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(art.timelineSvg([], t0, art.TIMELINE_WIDTH.wide, false))}" width="${art.TIMELINE_WIDTH.wide}" height="${H}"></div>`,
  )
  console.log(`wrote ${previewPath}`)
}
