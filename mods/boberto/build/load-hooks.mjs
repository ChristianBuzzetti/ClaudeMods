// Loads the hooks' pure modules (engine-host.ts, choreo.ts, art.ts, assemble.ts
// and the .mjs they import) in Node: their types are stripped into a temp
// folder, extensionless relative imports pointed at the stripped copies.

import { mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOOKS = fileURLToPath(new URL('../hooks', import.meta.url))

export async function loadHooks(name) {
  const tmp = mkdtempSync(join(tmpdir(), 'boberto-'))
  for (const file of readdirSync(HOOKS)) {
    if (file.endsWith('.mjs')) copyFileSync(join(HOOKS, file), join(tmp, file))
    else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      const js = stripTypeScriptTypes(readFileSync(join(HOOKS, file), 'utf8')).replace(
        /(from\s+['"])(\.\/[^'".]+)(['"])/g,
        '$1$2.mjs$3',
      )
      writeFileSync(join(tmp, file.replace(/\.ts$/, '.mjs')), js)
    }
  }
  return import(pathToFileURL(join(tmp, `${name}.mjs`)).href)
}
