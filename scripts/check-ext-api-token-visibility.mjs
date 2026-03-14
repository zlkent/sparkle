import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const path = resolve(scriptDir, '../src/renderer/src/components/settings/advanced-settings.tsx')

const source = readFileSync(path, 'utf8')
const marker = 'title="扩展 API Token"'
const start = source.indexOf(marker)

if (start < 0) {
  console.error('FAIL: Ext API token setting block not found')
  process.exit(1)
}

const block = source.slice(start, start + 1200)

if (block.includes('type="password"')) {
  console.error('FAIL: Ext API token is still rendered as password')
  process.exit(1)
}

if (!block.includes('extensionApiToken')) {
  console.error('FAIL: Ext API token binding not found')
  process.exit(1)
}

console.log('PASS: Ext API token is rendered in plain text')
