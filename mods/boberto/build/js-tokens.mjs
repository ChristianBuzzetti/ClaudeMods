// A small JavaScript scanner, just enough for the engine source: it finds
// comments, string / template / regex literals and the code between them, so
// the build can drop comments and rewrite code without touching literals by
// accident. No dependencies.
//
// The only real ambiguity in JavaScript scanning is `/`: a regex literal or a
// division. It is a regex when the previous significant token cannot end an
// expression (an operator, an opening bracket, a comma, a keyword like
// `return`), which covers hand-written code like the engine's.

const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
])

const isIdent = ch => /[\p{L}\p{N}_$]/u.test(ch)

/**
 * Splits `src` into tokens: { type: 'code' | 'comment' | 'string' | 'template' | 'regex', text }.
 * Template literals with `${...}` come back as one 'template' token whose
 * text includes the substitutions verbatim (they are not rewritten).
 * Concatenating every token's text gives back `src` exactly.
 */
export function tokenize(src) {
  const tokens = []
  let i = 0
  let code = ''
  let lastSig = '' // last significant code character or word, for the regex rule

  const flush = () => {
    if (code) tokens.push({ type: 'code', text: code })
    code = ''
  }
  const push = (type, start) => {
    flush()
    tokens.push({ type, text: src.slice(start, i) })
  }

  const skipString = quote => {
    i++
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') i++
      else if (src[i] === '\n') throw new Error(`unterminated string at ${i}`)
      i++
    }
    if (i >= src.length) throw new Error('unterminated string')
    i++
  }

  // Skips a template literal starting at the backquote, including nested
  // `${ ... }` expressions (which may hold strings, templates and braces).
  const skipTemplate = () => {
    i++
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') { i++; return }
      if (ch === '$' && src[i + 1] === '{') {
        i += 2
        let depth = 1
        while (i < src.length && depth > 0) {
          const c = src[i]
          if (c === '{') { depth++; i++ }
          else if (c === '}') { depth--; i++ }
          else if (c === "'" || c === '"') skipString(c)
          else if (c === '`') skipTemplate()
          else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++ }
          else if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2 }
          else i++
        }
        continue
      }
      i++
    }
    throw new Error('unterminated template')
  }

  const skipRegex = () => {
    i++
    let inClass = false
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\') { i += 2; continue }
      if (ch === '\n') throw new Error(`unterminated regex at ${i}`)
      if (inClass) { if (ch === ']') inClass = false }
      else if (ch === '[') inClass = true
      else if (ch === '/') { i++; break }
      i++
    }
    while (i < src.length && isIdent(src[i])) i++ // flags
  }

  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    const start = i
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      push('comment', start)
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) throw new Error('unterminated comment')
      i = end + 2
      push('comment', start)
    } else if (ch === "'" || ch === '"') {
      skipString(ch)
      push('string', start)
      lastSig = 'a'
    } else if (ch === '`') {
      skipTemplate()
      push('template', start)
      lastSig = 'a'
    } else if (ch === '/') {
      const regex = lastSig === '' || (!isIdent(lastSig[0]) && !')]}'.includes(lastSig)) || REGEX_AFTER_WORD.has(lastSig)
      if (regex) {
        skipRegex()
        push('regex', start)
        lastSig = 'a'
      } else {
        code += ch
        i++
        lastSig = '/'
      }
    } else if (isIdent(ch)) {
      while (i < src.length && isIdent(src[i])) i++
      const word = src.slice(start, i)
      code += word
      lastSig = word
    } else {
      code += ch
      i++
      if (!/\s/.test(ch)) lastSig = ch
    }
  }
  flush()
  return tokens
}

/**
 * Drops every comment from `src`. A line left empty by a removed comment is
 * removed with it; a comment between two tokens on one line leaves a space.
 */
export function stripComments(src) {
  let out = ''
  let dropNewline = false
  for (const tok of tokenize(src)) {
    if (tok.type !== 'comment') {
      let text = tok.text
      if (dropNewline && tok.type === 'code') {
        text = text.replace(/^[ \t]*\r?\n/, '')
        dropNewline = false
      } else if (dropNewline) {
        dropNewline = false
      }
      out += text
      continue
    }
    const trimmed = out.replace(/[ \t]+$/, '')
    const lineEmpty = trimmed === '' || trimmed.endsWith('\n')
    if (lineEmpty) {
      out = trimmed
      dropNewline = true
    } else if (tok.text.startsWith('/*') && tok.text.includes('\n')) {
      out = trimmed + '\n'
    } else if (tok.text.startsWith('/*')) {
      out = trimmed + ' '
    } else {
      out = trimmed
    }
  }
  return out
}
