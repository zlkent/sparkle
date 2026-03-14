import http from 'http'
import crypto from 'crypto'
import express from 'express'
import { writeFile } from 'fs/promises'
import { getAppConfig, patchAppConfig } from '../config'
import { findAvailablePort } from './server'
import { getConnectionCacheTimestamp, matchConnectionByHost } from '../core/connectionCache'
import { logPath } from '../utils/dirs'

export let extensionApiPort: number | undefined
let extensionApiServer: http.Server | undefined

export async function restartExtensionApiServer(): Promise<void> {
  await startExtensionApiServer()
}

export async function resetExtensionApiToken(): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url')
  await patchAppConfig({ extensionApiToken: token })
  await startExtensionApiServer()
  return token
}

function parseBearerToken(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = /^Bearer\s+(.+)$/.exec(value)
  return match?.[1]?.trim() ?? ''
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

function sha256Prefix(value: string): string {
  if (!value) return ''
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}

async function logAuthFailure(meta: {
  origin?: string
  expectedLen: number
  providedLen: number
  expectedSha: string
  providedSha: string
}): Promise<void> {
  try {
    const line =
      `[ExtApi]: 401 auth failed ` +
      `origin=${meta.origin || '-'} ` +
      `expectedLen=${meta.expectedLen} providedLen=${meta.providedLen} ` +
      `expectedSha=${meta.expectedSha || '-'} providedSha=${meta.providedSha || '-'}\n`
    await writeFile(logPath(), line, { flag: 'a' })
  } catch {
    // ignore
  }
}

function extractHostname(urlOrHost: string): string {
  const trimmed = urlOrHost.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).hostname
  } catch {
    // allow host-only input like "example.com" or "example.com:443"
    try {
      return new URL(`http://${trimmed}`).hostname
    } catch {
      return ''
    }
  }
}

function shouldReflectCors(origin: string | undefined): boolean {
  return !!origin && origin.startsWith('chrome-extension://')
}

function normalizeOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.origin !== 'null') return url.origin
    if (url.protocol && url.host) return `${url.protocol}//${url.host}`
    return trimmed.replace(/\/+$/, '') || undefined
  } catch {
    return trimmed.replace(/\/+$/, '') || undefined
  }
}

function getCallerOrigin(req: express.Request): string | undefined {
  const origin = normalizeOrigin(req.headers.origin)
  if (origin) return origin

  const referer = req.headers.referer
  if (typeof referer === 'string') {
    const refererOrigin = normalizeOrigin(referer)
    if (refererOrigin) return refererOrigin
  }

  return normalizeOrigin(req.headers['x-sparkle-extension-origin'])
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[] | undefined): boolean {
  const allowlist = allowedOrigins?.map((o) => normalizeOrigin(o)).filter((o) => !!o) ?? []
  if (allowlist.length === 0) return true
  if (!origin) return false
  return allowlist.includes(origin)
}

export async function startExtensionApiServer(): Promise<void> {
  await stopExtensionApiServer()

  const config = await getAppConfig()
  const enabled = !!config.extensionApiEnabled
  if (!enabled) return

  const token = (config.extensionApiToken || '').trim()
  if (!token) {
    await patchAppConfig({ extensionApiToken: crypto.randomBytes(32).toString('base64url') })
  }

  const configAfter = await getAppConfig(true)
  const expectedToken = (configAfter.extensionApiToken || '').trim()
  if (!expectedToken) return
  try {
    await writeFile(
      logPath(),
      `[ExtApi]: start port=${configAfter.extensionApiPort ?? 14123} tokenLen=${expectedToken.length} tokenSha=${sha256Prefix(expectedToken)}\n`,
      { flag: 'a' }
    )
  } catch {
    // ignore
  }

  const desiredPort = configAfter.extensionApiPort ?? 14123
  const port = await findAvailablePort(desiredPort)
  if (port !== desiredPort) {
    await patchAppConfig({ extensionApiPort: port })
  }

  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.setHeader('X-Sparkle-Ext-Api', '1')

    const origin = getCallerOrigin(req)
    const allowedOrigins = configAfter.extensionApiAllowedOrigins

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    if (shouldReflectCors(origin) && isAllowedOrigin(origin, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin as string)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    const provided = parseBearerToken(req.headers.authorization)
    if (!safeEqual(provided, expectedToken)) {
      void logAuthFailure({
        origin: typeof origin === 'string' ? origin : undefined,
        expectedLen: expectedToken.length,
        providedLen: provided.length,
        expectedSha: sha256Prefix(expectedToken),
        providedSha: sha256Prefix(provided)
      })
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    next()
  })

  app.get('/ext/v1/connection', async (req, res) => {
    const raw = req.query.url
    const urlOrHost = typeof raw === 'string' ? raw : ''
    const host = extractHostname(urlOrHost)
    if (!host) {
      res.status(400).json({ error: 'invalid url' })
      return
    }

    const timestamp = getConnectionCacheTimestamp()
    const conn = await matchConnectionByHost(host)

    if (!conn) {
      res.json({
        matched: false,
        host,
        isProxied: false,
        chain: [],
        timestamp
      })
      return
    }

    const chain = Array.isArray(conn.chains) ? conn.chains : []
    const isProxied = chain.length > 0 && chain[0]?.toUpperCase() !== 'DIRECT'

    res.json({
      matched: true,
      host,
      isProxied,
      chain,
      rule: conn.rule,
      rulePayload: conn.rulePayload,
      connectionId: conn.id,
      timestamp
    })
  })

  extensionApiServer = await new Promise<http.Server>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server))
    server.on('error', reject)
  })

  extensionApiPort = port
}

export async function stopExtensionApiServer(): Promise<void> {
  if (!extensionApiServer) return
  const server = extensionApiServer
  extensionApiServer = undefined
  extensionApiPort = undefined

  await new Promise<void>((resolve) => server.close(() => resolve()))
}
