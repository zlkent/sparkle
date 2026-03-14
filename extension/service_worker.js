const SYNC_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:14123',
  token: '',
  prefetch: true,
  badge: true,
  staleMs: 5000
}

const LOCAL_KEY_PREFIX = 'tab:'
const DEBOUNCE_MS = 400

const debounceTimers = new Map()
let currentSettings = { ...SYNC_DEFAULTS }

function sanitizeToken(s) {
  const t = String(s || '').trim()
  return t.replace(/^Bearer\\s+/i, '').trim()
}

function normalizeBaseUrl(baseUrl) {
  const s = String(baseUrl || '').trim()
  if (!s) return SYNC_DEFAULTS.baseUrl
  return s.replace(/\/+$/, '')
}

function safeUrlForQuery(tabUrl) {
  const url = String(tabUrl || '').trim()
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return ''
}

function buildApiUrl(baseUrl, tabUrl) {
  const clean = normalizeBaseUrl(baseUrl)
  return `${clean}/ext/v1/connection?url=${encodeURIComponent(tabUrl)}`
}

async function getSyncSettings() {
  return await chrome.storage.sync.get(SYNC_DEFAULTS)
}

async function setTabCache(tabId, value) {
  const key = `${LOCAL_KEY_PREFIX}${tabId}`
  await chrome.storage.local.set({ [key]: value })
}

async function getTabCache(tabId) {
  const key = `${LOCAL_KEY_PREFIX}${tabId}`
  const res = await chrome.storage.local.get(key)
  return res[key] || null
}

async function clearTabCache(tabId) {
  const key = `${LOCAL_KEY_PREFIX}${tabId}`
  await chrome.storage.local.remove(key)
}

async function setBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text })
    if (color) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color })
    }
  } catch {
    // ignore
  }
}

function classifyToBadge(cache) {
  // Text is max 4 chars.
  if (!cache) return { text: '', color: null }
  if (cache.state === 'no_token') return { text: 'TOK', color: '#fbbf24' }
  if (cache.state === 'unsupported') return { text: '', color: null }
  if (cache.state === 'offline') return { text: 'OFF', color: '#fb7185' }
  if (cache.state === 'unauthorized') return { text: '401', color: '#fb7185' }
  if (cache.state === 'error') return { text: 'ERR', color: '#fb7185' }
  if (cache.state === 'ok' && cache.data) {
    if (cache.data.matched === false) return { text: '?', color: '#fbbf24' }
    return cache.data.isProxied ? { text: 'P', color: '#34d399' } : { text: 'D', color: '#94a3b8' }
  }
  return { text: '', color: null }
}

async function updateBadgeIfEnabled(tabId, cache) {
  if (!currentSettings.badge) {
    await setBadge(tabId, '', null)
    return
  }
  const badge = classifyToBadge(cache)
  await setBadge(tabId, badge.text, badge.color)
}

async function fetchConnectionForTab(tabId, tabUrl, reason = 'unknown') {
  const url = safeUrlForQuery(tabUrl)
  if (!url) {
    const cache = { tabId, url: String(tabUrl || ''), reason, state: 'unsupported', updatedAt: Date.now() }
    await setTabCache(tabId, cache)
    await updateBadgeIfEnabled(tabId, cache)
    return cache
  }

  const token = sanitizeToken(currentSettings.token)
  if (!token) {
    const cache = { tabId, url, reason, state: 'no_token', updatedAt: Date.now() }
    await setTabCache(tabId, cache)
    await updateBadgeIfEnabled(tabId, cache)
    return cache
  }

  const endpoint = buildApiUrl(currentSettings.baseUrl, url)
  let res
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch {
    const cache = { tabId, url, reason, state: 'offline', updatedAt: Date.now() }
    await setTabCache(tabId, cache)
    await updateBadgeIfEnabled(tabId, cache)
    return cache
  }

  if (res.status === 401) {
    const cache = { tabId, url, reason, state: 'unauthorized', updatedAt: Date.now(), httpStatus: 401 }
    await setTabCache(tabId, cache)
    await updateBadgeIfEnabled(tabId, cache)
    return cache
  }

  if (!res.ok) {
    const cache = { tabId, url, reason, state: 'error', updatedAt: Date.now(), httpStatus: res.status }
    await setTabCache(tabId, cache)
    await updateBadgeIfEnabled(tabId, cache)
    return cache
  }

  const data = await res.json().catch(() => null)
  if (!data) {
    const cache = { tabId, url, reason, state: 'error', updatedAt: Date.now(), httpStatus: res.status }
    await setTabCache(tabId, cache)
    await updateBadgeIfEnabled(tabId, cache)
    return cache
  }

  const cache = { tabId, url, reason, state: 'ok', updatedAt: Date.now(), data }
  await setTabCache(tabId, cache)
  await updateBadgeIfEnabled(tabId, cache)
  return cache
}

function debounceFetch(tabId, tabUrl, reason) {
  const existing = debounceTimers.get(tabId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    debounceTimers.delete(tabId)
    fetchConnectionForTab(tabId, tabUrl, reason)
  }, DEBOUNCE_MS)
  debounceTimers.set(tabId, timer)
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabCache(tabId)
  const existing = debounceTimers.get(tabId)
  if (existing) {
    clearTimeout(existing)
    debounceTimers.delete(tabId)
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!currentSettings.prefetch) return
  // Only trigger on final navigation completion or URL change.
  if (changeInfo.url || changeInfo.status === 'complete') {
    debounceFetch(tabId, tab.url, changeInfo.url ? 'url-change' : 'load-complete')
  }
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!currentSettings.prefetch) return
  try {
    const tab = await chrome.tabs.get(tabId)
    debounceFetch(tabId, tab.url, 'activated')
  } catch {
    // ignore
  }
})

async function handleMessage(msg, sendResponse) {
  const type = msg && msg.type
  if (type === 'getCached') {
    const cache = await getTabCache(msg.tabId)
    sendResponse({ ok: true, cache })
    return
  }
  if (type === 'refresh') {
    const cache = await fetchConnectionForTab(msg.tabId, msg.url, msg.reason || 'manual')
    sendResponse({ ok: true, cache })
    return
  }
  if (type === 'clearBadge') {
    await setBadge(msg.tabId, '', null)
    sendResponse({ ok: true })
    return
  }
  sendResponse({ ok: false, error: 'unknown message' })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void handleMessage(msg, sendResponse)
  return true
})

async function initSettings() {
  try {
    const s = await getSyncSettings()
    currentSettings = { ...s, token: sanitizeToken(s.token) }
  } catch {
    currentSettings = { ...SYNC_DEFAULTS }
  }
}

void initSettings()

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return
  const next = { ...currentSettings }
  for (const [k, v] of Object.entries(changes)) {
    next[k] = v.newValue
  }
  const merged = { ...SYNC_DEFAULTS, ...next }
  currentSettings = { ...merged, token: sanitizeToken(merged.token) }
})
