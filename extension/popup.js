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

function formatTime(ms) {
  try {
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString()
  } catch {
    return '—'
  }
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { baseUrl: 'http://127.0.0.1:14123', token: '' },
      (items) => resolve(items)
    )
  })
}

function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url ? tabs[0].url : ''
      resolve(url)
    })
  })
}

async function main() {
  setError('')
  setBadge('Loading…', 'gray')

  const [settings, tabUrl] = await Promise.all([getSettings(), getActiveTabUrl()])
  if (!tabUrl) {
    setBadge('No tab', 'yellow')
    setError('Cannot read current tab URL.')
    return
  }

  if (!settings.token) {
    setBadge('No token', 'yellow')
    setError('Set token in Options.')
    return
  }

  const url = `${settings.baseUrl.replace(/\\/$/, '')}/ext/v1/connection?url=${encodeURIComponent(
    tabUrl
  )}`

  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${settings.token}` }
    })
  } catch (e) {
    setBadge('Offline', 'red')
    setError('Sparkle not reachable. Is it running and Extension API enabled?')
    return
  }

  if (res.status === 401) {
    setBadge('Unauthorized', 'red')
    setError('Token invalid (401).')
    return
  }

  if (!res.ok) {
    setBadge('Error', 'red')
    setError(`HTTP ${res.status}`)
    return
  }

  const data = await res.json().catch(() => null)
  if (!data) {
    setBadge('Error', 'red')
    setError('Invalid JSON response.')
    return
  }

  setText('host', data.host || '—', !data.host)
  setText('ts', formatTime(data.timestamp), false)

  if (!data.matched) {
    setBadge('No match', 'yellow')
    setText('chain', '—', true)
    setText('rule', '—', true)
    return
  }

  const chain = Array.isArray(data.chain) ? data.chain : []
  setText('chain', chain.length ? chain.join(' > ') : 'DIRECT', chain.length === 0)

  const rule = data.rule ? `${data.rule}${data.rulePayload ? ` (${data.rulePayload})` : ''}` : '—'
  setText('rule', rule, rule === '—')

  if (data.isProxied) {
    setBadge('PROXY', 'green')
  } else {
    setBadge('DIRECT', 'gray')
  }
}

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault()
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage()
})

main()

