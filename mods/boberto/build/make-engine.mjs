// Wraps the ORIGINAL Boberto engine (boberto.js) into an ES module the hooks
// module can import: the engine's script body becomes the body of
// `bootEngine(env)`, whose parameters stand for the browser globals it reads
// (window, document, localStorage, timers...). Nothing is evaluated from a
// string at run time: the engine is plain source in the generated file.
//
// The copy (never boberto.js itself) is cleaned on the way:
//   1. every comment is dropped: JS comments, and the CSS comments inside the
//      engine's stylesheet template;
//   2. the engine's catalog of third-party characters is removed
//      structurally: CHARACTERS, CHAR_EX_ACCESORIO and CHAR_DEF become empty,
//      then every top-level declaration that only those entries used is
//      deleted, repeatedly, until nothing else becomes unused;
//   3. the migration of storage keys from the engine's original host apps is
//      removed, storage keys lose their host prefix, and the speech-bubble
//      prompt and one body-color preset get neutral names;
//   4. the result must parse and must not match any pattern of a deny-list
//      that is kept outside this repository (the build fails otherwise).
// The base character and its accessories, colors, eyes, glow, poses and
// gestures are drawn by the same code as before.
//
//   node build/make-engine.mjs <path/to/boberto.js> <path/to/deny-list.txt>
//   (or set BOBERTO_JS and BOBERTO_DENY_LIST)
//
// The deny-list holds one case-insensitive regular expression per line;
// blank lines and lines starting with # are ignored.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { stripComments, tokenize } from './js-tokens.mjs'

/** The browser globals the engine reads, passed in by the host (engine-host.ts). */
export const ENGINE_GLOBALS = [
  'window', 'self', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'devicePixelRatio', 'innerWidth', 'innerHeight',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'performance', 'Date',
  'getComputedStyle', 'matchMedia', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'CustomEvent', 'Event', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'console',
]

/** Resolves the two private build inputs from CLI arguments or the environment, or exits. */
export function resolveInputs(positional) {
  const enginePath = positional[0] ?? process.env.BOBERTO_JS
  const denyPath = positional[1] ?? process.env.BOBERTO_DENY_LIST
  const missing = []
  if (!enginePath) missing.push('the engine source (first argument or BOBERTO_JS)')
  if (!denyPath) missing.push('the deny-list (second argument or BOBERTO_DENY_LIST)')
  if (missing.length) {
    console.error(`Missing ${missing.join(' and ')}.\nUsage: node build/make-engine.mjs <boberto.js> <deny-list.txt>`)
    process.exit(2)
  }
  return { enginePath, denyPath }
}

/** Reads a deny-list file into case-insensitive regular expressions. */
export function readDenyList(denyPath) {
  const patterns = readFileSync(denyPath, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => new RegExp(l, 'giu'))
  if (patterns.length === 0) throw new Error(`deny-list ${denyPath} has no patterns`)
  return patterns
}

/** Every match of any deny-list pattern in `text`, as "line N: …context…". */
export function denyHits(text, patterns) {
  const hits = []
  const lines = text.split('\n')
  lines.forEach((line, n) => {
    for (const re of patterns) {
      re.lastIndex = 0
      if (re.test(line)) hits.push(`line ${n + 1}: ${line.trim().slice(0, 120)}`)
    }
  })
  return hits
}

// ---------------------------------------------------------------------------
// Source surgery on the comment-free engine.

/** Replaces exactly one match of `re` in `src`, or throws. */
function replaceOnce(src, re, replacement, what) {
  const all = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []
  if (all.length !== 1) throw new Error(`${what}: expected one match, found ${all.length}`)
  return src.replace(re, replacement)
}

/**
 * A copy of `src` in which strings, templates and regex literals are blanked
 * (newlines kept), so brackets and identifiers can be scanned by index.
 */
function codeMask(src) {
  return tokenize(src)
    .map(t => (t.type === 'code' ? t.text : t.text.replace(/[^\n]/g, ' ')))
    .join('')
}

/** Index just past the statement starting at `start` (masked source). */
function statementEnd(mask, start, isFunction) {
  let depth = 0
  for (let i = start; i < mask.length; i++) {
    const ch = mask[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (isFunction && depth === 0 && ch === '}') return i + 1
    } else if (ch === ';' && depth === 0 && !isFunction) return i + 1
  }
  throw new Error(`unterminated statement at ${start}`)
}

/** Names bound at depth 0 by a `const`/`let` statement's text (masked). */
function declaredNames(text) {
  const names = []
  let depth = 0
  let expectName = true
  const body = text.replace(/^\s*(const|let|var)\s+/, '')
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) expectName = true
    else if (expectName && /[A-Za-z_$]/.test(ch)) {
      const m = body.slice(i).match(/^[\w$]+/)
      names.push(m[0])
      i += m[0].length - 1
      expectName = false
    }
  }
  return names
}

/** Top-level declarations of the engine's IIFE (two-space indent). */
function topLevelDeclarations(src) {
  const mask = codeMask(src)
  const decls = []
  const re = /^ {2}(function\s+([\w$]+)|(?:const|let|var)\s+[\w$])/gm
  let m
  while ((m = re.exec(mask))) {
    const start = m.index
    const isFunction = !!m[2]
    const end = statementEnd(mask, start, isFunction)
    const names = isFunction ? [m[2]] : declaredNames(mask.slice(start, end))
    decls.push({ start, end, names })
    re.lastIndex = end
  }
  return { decls, mask }
}

/**
 * Names of top-level declarations no code refers to. A reference is the
 * identifier anywhere in the code outside its own declaration, or anywhere
 * inside a template literal (whose substitutions are not scanned).
 */
function unusedDeclarations(src) {
  const { decls, mask } = topLevelDeclarations(src)
  const templates = tokenize(src).filter(t => t.type === 'template').map(t => t.text).join('\n')
  const words = new Map()
  for (const m of mask.matchAll(/[\w$]+/g)) words.set(m[0], (words.get(m[0]) ?? 0) + 1)
  const unused = []
  for (const d of decls) {
    const inside = new Map()
    for (const m of mask.slice(d.start, d.end).matchAll(/[\w$]+/g)) inside.set(m[0], (inside.get(m[0]) ?? 0) + 1)
    const used = d.names.some(n => (words.get(n) ?? 0) > (inside.get(n) ?? 0) || new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(templates))
    if (!used) unused.push(d)
  }
  return unused
}

/** Deletes declarations that became unused, until none does; returns [src, removed names]. */
function removeNewlyUnused(src, alreadyUnused) {
  const removed = []
  for (;;) {
    const fresh = unusedDeclarations(src).filter(d => !d.names.every(n => alreadyUnused.has(n)))
    if (fresh.length === 0) return [src, removed]
    for (const d of [...fresh].sort((a, b) => b.start - a.start)) {
      let end = d.end
      while (src[end] === ' ' || src[end] === '\t') end++
      if (src[end] === '\r') end++
      if (src[end] === '\n') end++
      src = src.slice(0, d.start) + src.slice(end)
      removed.push(...d.names)
    }
  }
}

/** The cleaned engine body (see the header). Returns { body, removed }. */
export function cleanEngine(source) {
  let src = stripComments(source)

  // CSS comments inside template literals (the engine's stylesheet).
  src = tokenize(src)
    .map(t => (t.type === 'template' ? t.text.replace(/[ \t]*\/\*[\s\S]*?\*\/[ \t]*(\r?\n)?/g, '') : t.text))
    .join('')

  const alreadyUnused = new Set(unusedDeclarations(src).flatMap(d => d.names))

  src = replaceOnce(src, /const CHARACTERS = \[[\s\S]*?\n {2}\];/, 'const CHARACTERS = [];', 'CHARACTERS')
  src = replaceOnce(src, /const CHAR_EX_ACCESORIO = \[[^\]]*\];/, 'const CHAR_EX_ACCESORIO = [];', 'CHAR_EX_ACCESORIO')
  {
    const at = src.indexOf('\n  const CHAR_DEF = {')
    if (at < 0 || src.indexOf('\n  const CHAR_DEF = {', at + 1) >= 0) throw new Error('CHAR_DEF: expected one declaration')
    const start = at + 1
    const end = statementEnd(codeMask(src), start, false)
    src = src.slice(0, start) + 'const CHAR_DEF = {};' + src.slice(end)
  }
  {
    const at = src.indexOf('  (function migrateLegacyKeys() {')
    if (at < 0) throw new Error('migrateLegacyKeys: not found')
    let end = statementEnd(codeMask(src), at, false)
    if (src[end] === '\n') end++
    src = src.slice(0, at) + src.slice(end)
  }

  const [pruned, removed] = removeNewlyUnused(src, alreadyUnused)
  src = pruned

  // Storage keys: drop the host prefix before `boberto_` / `mascota_`.
  src = src.replace(/(['"])[a-z]+_((?:boberto|mascota)_[a-z0-9_]*)\1/g, '$1$2$1')
  // Speech-bubble prompt.
  src = replaceOnce(src, /(promptSpan\.textContent = )'[^']*';/, "$1'> ';", 'bubble prompt')
  // The blue body-color preset gets a neutral id and name.
  src = replaceOnce(
    src,
    /\{ id: '[a-z]+', +name: '[^']*', color: '#2684ff' \}/,
    "{ id: 'azul', name: 'Azul', color: '#2684ff' }",
    'blue skin preset',
  )
  // Collapse runs of blank lines left behind.
  src = src.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
  return { body: src, removed }
}

export function makeEngineModule(enginePath, denyPath) {
  const source = readFileSync(enginePath, 'utf8')
  const { body, removed } = cleanEngine(source)
  if (/\bimport\s*\(|\bexport\s/.test(body.slice(0, 2000))) throw new Error('unexpected module syntax at the top of the engine')
  const text =
    '// GENERATED by build/make-engine.mjs from the Boberto engine (boberto.js). Do not edit.\n' +
    '// The engine source without comments and without its third-party character\n' +
    '// catalog, wrapped in a function whose parameters stand for the browser\n' +
    '// globals it reads.\n' +
    '/* eslint-disable */\n' +
    `export function bootEngine({ ${ENGINE_GLOBALS.join(', ')} }) {\n` +
    body +
    '\nreturn window.BOBERTO\n}\n'
  new vm.Script(text.replace(/^export /m, ''), { filename: 'engine.generated.mjs' }) // parse check
  const hits = denyHits(text, readDenyList(denyPath))
  if (hits.length) throw new Error(`generated engine matches the deny-list (${hits.length}):\n  ${hits.slice(0, 40).join('\n  ')}`)
  if (/(?<!\w)[A-Za-z]:[\\/][\w .-]+[\\/]|\/(?:home|Users)\/[\w.-]+/.test(text)) throw new Error('generated engine embeds a local path')
  return { text, removed }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { enginePath, denyPath } = resolveInputs(process.argv.slice(2))
  const out = join(fileURLToPath(new URL('..', import.meta.url)), 'hooks', 'engine.generated.mjs')
  const { text, removed } = makeEngineModule(enginePath, denyPath)
  writeFileSync(out, text)
  console.log(`removed ${removed.length} declarations; wrote ${out} (${text.length} chars)`)
}
