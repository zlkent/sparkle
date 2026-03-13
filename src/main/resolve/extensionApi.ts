import http from 'http'
import crypto from 'crypto'
import express from 'express'
import { getAppConfig, patchAppConfig } from '../config'
import { findAvailablePort } from './server'
import { getConnectionCacheTimestamp, matchConnectionByHost } from '../core/connectionCache'

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
  const match = /^Bearer\\s+(.+)$/.exec(value)
  return match?.[1]?.trim() ?? ''
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
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

function getCallerOrigin(req: express.Request): string | undefined {
  const origin = req.headers.origin
  if (typeof origin === 'string') return origin

  const referer = req.headers.referer
  if (typeof referer !== 'string') return undefined
  try {
    return new URL(referer).origin
  } catch {
    return undefined
  }
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[] | undefined): boolean {
  const allowlist = allowedOrigins?.filter((o) => typeof o === 'string' && o.length > 0) ?? []
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

  const desiredPort = configAfter.extensionApiPort ?? 14123
  const port = await findAvailablePort(desiredPort)
  if (port !== desiredPort) {
    await patchAppConfig({ extensionApiPort: port })
  }

  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    const origin = getCallerOrigin(req)
    const allowedOrigins = configAfter.extensionApiAllowedOrigins

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      res.status(403).end()
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
      res.status(401).end()
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
