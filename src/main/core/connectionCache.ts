import dns from 'dns/promises'
import net from 'net'

type ConnectionDetail = ControllerConnectionDetail

const MAX_CLOSED = 500
const DNS_TTL_MS = 60_000
const DNS_TIMEOUT_MS = 200

let lastUpdatedAt = 0
let activeById = new Map<string, ConnectionDetail>()
let closedById = new Map<string, ConnectionDetail>()
let activeSorted: ConnectionDetail[] = []
let closedSorted: ConnectionDetail[] = []

type DnsCacheItem =
  | { kind: 'ready'; ips: string[]; expiresAt: number }
  | { kind: 'pending'; promise: Promise<string[]> }

const dnsCache = new Map<string, DnsCacheItem>()

function parseStartMs(conn: ConnectionDetail): number {
  const ms = Date.parse(conn.start)
  return Number.isFinite(ms) ? ms : 0
}

function sortByStartDesc(a: ConnectionDetail, b: ConnectionDetail): number {
  return parseStartMs(b) - parseStartMs(a)
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

function parseRemoteDestinationHost(remoteDestination: string | undefined): string {
  if (!remoteDestination) return ''
  // Usually "host:port"
  const idx = remoteDestination.lastIndexOf(':')
  if (idx === -1) return remoteDestination
  return remoteDestination.slice(0, idx)
}

async function resolveIps(host: string): Promise<string[]> {
  const key = normalizeHost(host)
  const cached = dnsCache.get(key)
  if (cached?.kind === 'ready' && cached.expiresAt > Date.now()) {
    return cached.ips
  }
  if (cached?.kind === 'pending') {
    return cached.promise
  }

  const promise = (async (): Promise<string[]> => {
    try {
      const timer = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('dns-timeout')), DNS_TIMEOUT_MS)
      })
      const res = (await Promise.race([
        dns.lookup(key, { all: true, verbatim: true }),
        timer
      ])) as Array<{ address: string }>
      const ips = Array.from(new Set(res.map((r) => r.address))).filter((ip) => net.isIP(ip))
      dnsCache.set(key, { kind: 'ready', ips, expiresAt: Date.now() + DNS_TTL_MS })
      return ips
    } catch {
      dnsCache.set(key, { kind: 'ready', ips: [], expiresAt: Date.now() + DNS_TTL_MS })
      return []
    }
  })()

  dnsCache.set(key, { kind: 'pending', promise })
  return promise
}

function pickMostRecent(conns: ConnectionDetail[]): ConnectionDetail | undefined {
  if (conns.length === 0) return undefined
  if (conns.length === 1) return conns[0]
  return conns.reduce((best, cur) => (parseStartMs(cur) > parseStartMs(best) ? cur : best), conns[0])
}

function filterByHost(conns: ConnectionDetail[], host: string): ConnectionDetail[] {
  const h = normalizeHost(host)
  return conns.filter((c) => normalizeHost(c.metadata.host || '') === h)
}

function filterBySniffHost(conns: ConnectionDetail[], host: string): ConnectionDetail[] {
  const h = normalizeHost(host)
  return conns.filter((c) => normalizeHost(c.metadata.sniffHost || '') === h)
}

function filterByIp(conns: ConnectionDetail[], ips: string[]): ConnectionDetail[] {
  if (ips.length === 0) return []
  const ipSet = new Set(ips)
  return conns.filter((c) => {
    const destIp = c.metadata.destinationIP
    if (destIp && ipSet.has(destIp)) return true
    const remoteHost = parseRemoteDestinationHost(c.metadata.remoteDestination)
    return remoteHost && ipSet.has(remoteHost)
  })
}

function rebuildSorted(): void {
  activeSorted = Array.from(activeById.values()).sort(sortByStartDesc)
  closedSorted = Array.from(closedById.values()).sort(sortByStartDesc).slice(0, MAX_CLOSED)
  if (closedSorted.length < closedById.size) {
    const keep = new Set(closedSorted.map((c) => c.id))
    for (const id of closedById.keys()) {
      if (!keep.has(id)) closedById.delete(id)
    }
  }
}

export function updateConnectionCache(info: ControllerConnections): void {
  lastUpdatedAt = Date.now()
  const connections = info.connections ?? []
  const nextActiveById = new Map<string, ConnectionDetail>()

  for (const conn of connections) {
    nextActiveById.set(conn.id, { ...conn, isActive: true })
  }

  for (const [id, prev] of activeById.entries()) {
    if (!nextActiveById.has(id)) {
      closedById.set(id, { ...prev, isActive: false })
    }
  }

  activeById = nextActiveById
  rebuildSorted()
}

export function getConnectionCacheTimestamp(): number {
  return lastUpdatedAt || Date.now()
}

export function getActiveConnections(): ConnectionDetail[] {
  return activeSorted
}

export function getClosedConnections(): ConnectionDetail[] {
  return closedSorted
}

export async function matchConnectionByHost(host: string): Promise<ConnectionDetail | undefined> {
  const candidatesLists: ConnectionDetail[][] = [activeSorted, closedSorted]

  for (const conns of candidatesLists) {
    const exact = pickMostRecent(filterByHost(conns, host))
    if (exact) return exact
  }

  for (const conns of candidatesLists) {
    const sniff = pickMostRecent(filterBySniffHost(conns, host))
    if (sniff) return sniff
  }

  const normalized = normalizeHost(host)
  const isIp = net.isIP(normalized) !== 0
  const ips = isIp ? [normalized] : await resolveIps(normalized)

  for (const conns of candidatesLists) {
    const byIp = pickMostRecent(filterByIp(conns, ips))
    if (byIp) return byIp
  }

  return undefined
}

