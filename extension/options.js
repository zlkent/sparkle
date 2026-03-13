function setStatus(text) {
  document.getElementById('status').textContent = text || ''
}

function load() {
  chrome.storage.sync.get({ baseUrl: 'http://127.0.0.1:14123', token: '' }, (items) => {
    document.getElementById('baseUrl').value = items.baseUrl || ''
    document.getElementById('token').value = items.token || ''
    setStatus('')
  })
}

function save() {
  const baseUrl = document.getElementById('baseUrl').value.trim() || 'http://127.0.0.1:14123'
  const token = document.getElementById('token').value.trim()
  chrome.storage.sync.set({ baseUrl, token }, () => {
    setStatus('Saved.')
  })
}

function reset() {
  chrome.storage.sync.set({ baseUrl: 'http://127.0.0.1:14123', token: '' }, () => {
    load()
    setStatus('Reset.')
  })
}

document.getElementById('save').addEventListener('click', save)
document.getElementById('reset').addEventListener('click', reset)

load()

