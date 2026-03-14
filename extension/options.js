const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:14123',
  token: '',
  prefetch: true,
  badge: true,
  staleMs: 5000
}

function $(id) {
  return document.getElementById(id)
}

function setStatus(text) {
  $('status').textContent = text || ''
}

function normalizeBaseUrl(s) {
  const t = String(s || '').trim()
  if (!t) return DEFAULTS.baseUrl
  return t.replace(/\/+$/, '')
}

function sanitizeToken(s) {
  const t = String(s || '').trim()
  return t.replace(/^Bearer\s+/i, '').trim()
}

function renderToggle(el, on) {
  el.classList.toggle('on', !!on)
}

function getToggleValue(el) {
  return el.classList.contains('on')
}

function setOriginText() {
  const origin = `chrome-extension://${chrome.runtime.id}`
  $('extId').textContent = chrome.runtime.id
  $('originText').textContent = origin
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    setStatus('已复制。')
  } catch (e) {
    setStatus(`复制失败：${e}`)
  }
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    $('baseUrl').value = items.baseUrl || ''
    $('token').value = items.token || ''
    $('staleMs').value = String(items.staleMs ?? DEFAULTS.staleMs)
    renderToggle($('prefetchToggle'), items.prefetch)
    renderToggle($('badgeToggle'), items.badge)
    setStatus('')
  })
}

function save() {
  const baseUrl = normalizeBaseUrl($('baseUrl').value)
  const token = sanitizeToken($('token').value)
  const staleMsRaw = parseInt($('staleMs').value)
  const staleMs = Number.isFinite(staleMsRaw) && staleMsRaw >= 0 ? staleMsRaw : DEFAULTS.staleMs

  const prefetch = getToggleValue($('prefetchToggle'))
  const badge = getToggleValue($('badgeToggle'))

  chrome.storage.sync.set({ baseUrl, token, prefetch, badge, staleMs }, () => {
    setStatus('已保存。')
  })
}

function reset() {
  chrome.storage.sync.set(DEFAULTS, () => {
    load()
    setStatus('已重置。')
  })
}

async function testConnection() {
  setStatus('测试中…')
  const baseUrl = normalizeBaseUrl($('baseUrl').value)
  const token = sanitizeToken($('token').value)
  if (!token) {
    setStatus('缺少 Token。')
    return
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabUrl = tabs && tabs[0] && tabs[0].url ? tabs[0].url : 'https://example.com/'
  const url = `${baseUrl}/ext/v1/connection?url=${encodeURIComponent(tabUrl)}`

  let res
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    setStatus('无法连接 Sparkle（离线）。')
    return
  }

  if (res.status === 401) {
    setStatus('401：Token 无效。')
    return
  }
  if (!res.ok) {
    setStatus(`请求失败：HTTP ${res.status}`)
    return
  }

  const data = await res.json().catch(() => null)
  if (!data) {
    setStatus('返回不是有效 JSON。')
    return
  }
  if (data.matched === false) {
    setStatus('已连接：当前暂无连接样本（未命中）。')
    return
  }
  setStatus(`已连接：${data.isProxied ? 'PROXY' : 'DIRECT'} · ${data.host || ''}`)
}

$('save').addEventListener('click', save)
$('reset').addEventListener('click', reset)
$('test').addEventListener('click', () => testConnection())
$('copyOrigin').addEventListener('click', () => copy(`chrome-extension://${chrome.runtime.id}`))

$('prefetchToggle').addEventListener('click', () => {
  renderToggle($('prefetchToggle'), !getToggleValue($('prefetchToggle')))
})
$('badgeToggle').addEventListener('click', () => {
  renderToggle($('badgeToggle'), !getToggleValue($('badgeToggle')))
})

setOriginText()
load()
