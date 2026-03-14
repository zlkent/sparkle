import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(scriptDir, '../src/main/resolve/extensionApi.ts')
const source = readFileSync(sourcePath, 'utf8')

const match = source.match(/function parseBearerToken\(value: unknown\): string \{[\s\S]*?\n\}/)

if (!match) {
  console.error('FAIL: parseBearerToken function not found')
  process.exit(1)
}

const compiled = ts.transpileModule(
  `${match[0]}\nmodule.exports = { parseBearerToken }\n`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }
).outputText

const moduleShim = { exports: {} }
const exportsShim = moduleShim.exports

new Function('module', 'exports', compiled)(moduleShim, exportsShim)

const { parseBearerToken } = moduleShim.exports
const token = 'HHAzPYwIXcv1qKPwQiBEsSE_f1rBVr8a37--x-5HXk4'
const actual = parseBearerToken(`Bearer ${token}`)

if (actual !== token) {
  console.error(`FAIL: expected parsed token to equal input token, got "${actual}"`)
  process.exit(1)
}

console.log('PASS: parseBearerToken accepts standard Bearer headers')
