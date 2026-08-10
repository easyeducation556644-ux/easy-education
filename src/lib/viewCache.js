const PREFIX = "ee_view_cache:"

export function readViewCache(key, maxAgeMs = Infinity) {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Number.isFinite(parsed.savedAt)) return null
    return {
      data: parsed.data,
      age: Date.now() - parsed.savedAt,
      fresh: Date.now() - parsed.savedAt < maxAgeMs,
    }
  } catch {
    return null
  }
}

export function writeViewCache(key, data) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ savedAt: Date.now(), data }))
  } catch {
    // Storage can be unavailable/full; the live view still works.
  }
}

export function removeViewCache(key) {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(`${PREFIX}${key}`)
}
