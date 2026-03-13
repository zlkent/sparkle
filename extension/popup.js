const SYNC_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:14123',
  token: '',
  staleMs: 5000
}

function setBadge(text, colorClass) {
  const el = document.getElementById('status')
  const dot = el.querySelector('.dot')
  dot.className = `dot ${colorClass}`
  el.childNodes[1].nodeValue = ` ${text}`
}

function setText(id, text, muted = false) {
  const el = document.getElementById(id)
  el.textContent = text
  el.classList.toggle('muted', muted)
}

function setError(text) {
  const el = document.getElementById('error')
  el.textContent = text || ''
}

function setHint(text) {
  const el = document.getElementById('hint')
  if (!text) {
    el.style.display = 'none'
    el.textContent = ''
    return
  }
  el.style.display = 'block'
  el.textContent = text
}

function formatTime(ms) {
  try {
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString()
  } catch {
    return '—'
  }
}

function isStale(timestamp, staleMs) {
  if (!timestamp) return false
  const t = Number(timestamp)
  if (!Number.isFinite(t)) return false
  return Date.now() - t > staleMs
}

function renderChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return 'DIRECT'
  const chips = chain
    .map((x) => `<span class="chip" title="${escapeHtml(String(x))}">${escapeHtml(String(x))}</span>`)
    .join('')
  return `<div class="chips">${chips}</div>`
}

function escapeHtml(s) {
  return s.replace(/[&<>\"']/g, (c) => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}

async function getSettings() {
  return await chrome.storage.sync.get(SYNC_DEFAULTS)
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs && tabs[0] ? tabs[0] : null
  return tab && tab.id ? tab : null
}

async function getCached(tabId) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getCached', tabId })
    return res && res.ok ? res.cache : null
  } catch {
    return null
  }
}

async function refresh(tabId, url, reason) {
  const res = await chrome.runtime.sendMessage({ type: 'refresh', tabId, url, reason })
  return res && res.ok ? res.cache : null
}

function renderFromCache(cache, settings, { optimistic = false } = {}) {
  setError('')
  setHint('')

  if (!cache) {
    setBadge(optimistic ? '刷新中…' : '加载中…', 'gray')
    setText('host', '—', true)
    setText('chain', '—', true)
    setText('rule', '—', true)
    setText('ts', '—', true)
    return
  }

  const state = cache.state
  const updatedAt = cache.updatedAt || Date.now()
  const stale = cache.data && isStale(cache.data.timestamp, settings.staleMs)

  setText('ts', formatTime(cache.data?.timestamp || updatedAt), false)
  setText('host', cache.data?.host || new URL(cache.url || 'http://x').hostname || '—', !cache.data?.host)

  const chainEl = document.getElementById('chain')
  if (state === 'ok' && cache.data && cache.data.matched) {
    chainEl.classList.toggle('muted', false)
    chainEl.innerHTML = renderChain(cache.data.chain)
  } else {
    chainEl.classList.toggle('muted', true)
    chainEl.textContent = '—'
  }

  const ruleText =
    state === 'ok' && cache.data && cache.data.matched && cache.data.rule
      ? `${cache.data.rule}${cache.data.rulePayload ? ` (${cache.data.rulePayload})` : ''}`
      : '—'
  setText('rule', ruleText, ruleText === '—')

  if (state === 'no_token') {
    setBadge('缺少 Token', 'yellow')
    setError('请先在“设置”里填写 Token。')
    return
  }
  if (state === 'unsupported') {
    setBadge('不支持', 'yellow')
    setError('当前页面不是 http(s) URL。')
    return
  }
  if (state === 'offline') {
    setBadge('离线', 'red')
    setError('无法连接 Sparkle。请确认 Sparkle 运行且已启用扩展 API。')
    return
  }
  if (state === 'unauthorized') {
    setBadge('未授权', 'red')
    setError('Token 无效（401）。')
    return
  }
  if (state === 'error') {
    setBadge('错误', 'red')
    setError(cache.httpStatus ? `HTTP ${cache.httpStatus}` : '请求失败。')
    return
  }
  if (state === 'ok' && cache.data) {
    if (!cache.data.matched) {
      setBadge('未命中', 'yellow')
      setHint('当前暂无连接样本（页面空闲或时间差）。')
      return
    }
    setBadge(cache.data.isProxied ? 'PROXY' : 'DIRECT', cache.data.isProxied ? 'green' : 'gray')
    if (stale) {
      setHint('提示：数据可能已过期（连接变化很快）。点击“刷新”可更新。')
    }
    return
  }

  setBadge('加载中…', 'gray')
}

async function main() {
  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault()
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage()
  })

  const settings = await getSettings()
  const tab = await getActiveTab()
  if (!tab) {
    setBadge('无标签页', 'yellow')
    setError('无法读取当前标签页。')
    return
  }

  const tabId = tab.id
  const tabUrl = tab.url || ''

  const cached = await getCached(tabId)
  renderFromCache(cached, settings, { optimistic: false })

  const doRefresh = async () => {
    setBadge('刷新中…', 'gray')
    const next = await refresh(tabId, tabUrl, 'popup')
    renderFromCache(next, settings, { optimistic: true })
  }

  document.getElementById('refresh').addEventListener('click', doRefresh)

  // Always try refresh once on open (service worker will reuse network cache if any).
  await doRefresh()
}

main()
