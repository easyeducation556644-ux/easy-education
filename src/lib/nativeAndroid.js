const pending = new Map()
let sequence = 0
let listenerInstalled = false

export function hasNativeDownloader() {
  return typeof window !== "undefined" && Boolean(window.EasyEducationNative?.postMessage)
}

function ensureListener() {
  if (!hasNativeDownloader() || listenerInstalled) return
  listenerInstalled = true
  window.EasyEducationNative.onmessage = (event) => {
    const payload = JSON.parse(event.data || "{}")
    const request = pending.get(payload.requestId)
    if (!request) return
    pending.delete(payload.requestId)
    if (payload.ok) request.resolve(payload)
    else request.reject(new Error(payload.error || "Native request failed"))
  }
}

export function nativeRequest(action, payload = {}) {
  ensureListener()
  if (!hasNativeDownloader()) return Promise.reject(new Error("Native Android bridge is unavailable"))
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${sequence += 1}`
    pending.set(requestId, { resolve, reject })
    window.EasyEducationNative.postMessage(JSON.stringify({ requestId, action, ...payload }))
    setTimeout(() => {
      if (!pending.has(requestId)) return
      pending.delete(requestId)
      reject(new Error("Native Android app did not respond"))
    }, action === "googleSignIn" ? 120000 : 10000)
  })
}
