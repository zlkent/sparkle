import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(scriptDir, '../src/main/resolve/extensionApi.ts')
const source = readFileSync(sourcePath, 'utf8')

function extractFunction(name) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`, 'm')
  const match = source.match(pattern)
  if (!match) {
    console.error(`FAIL: ${name} function not found`)
    process.exit(1)
  }
  return match[0]
}

const compiled = ts.transpileModule(
  [
    extractFunction('shouldReflectCors'),
    extractFunction('normalizeOrigin'),
    extractFunction('getCallerOrigin'),
    extractFunction('isAllowedOrigin'),
    'module.exports = { getCallerOrigin, isAllowedOrigin, shouldReflectCors }'
  ].join('\n\n'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }
).outputText

const moduleShim = { exports: {} }
new Function('module', 'exports', compiled)(moduleShim, moduleShim.exports)

const { getCallerOrigin, isAllowedOrigin } = moduleShim.exports
const req = {
  headers: {
    'x-sparkle-extension-origin': ' chrome-extension://abc123/ '
  }
}

const origin = getCallerOrigin(req)
if (origin !== 'chrome-extension://abc123') {
  console.error(`FAIL: expected fallback origin to be normalized, got "${origin}"`)
  process.exit(1)
}

if (!isAllowedOrigin(origin, ['chrome-extension://abc123'])) {
  console.error('FAIL: expected normalized fallback origin to pass allowlist')
  process.exit(1)
}

console.log('PASS: extension origin fallback is accepted and normalized')
