const PREFIX = "ee_view_snapshot_v1:"
const CACHE_SCHEMA = 2
const MAX_AGE_MS = 2 * 60 * 1000

export function readViewSnapshot(key) {
  if (typeof localStorage === "undefined") return null
  const storageKey = `${PREFIX}${key}`
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw)

    // Snapshots written by the old permanent-cache system had no timestamp and
    // could remain stale forever. Treat them as expired after this deployment.
    if (parsed?.__cacheSchema !== CACHE_SCHEMA || !Number.isFinite(parsed?.__cachedAt)) {
      localStorage.removeItem(storageKey)
      return null
    }

    if (Date.now() - parsed.__cachedAt > MAX_AGE_MS) {
      localStorage.removeItem(storageKey)
      return null
    }

    const { __cacheSchema, __cachedAt, ...value } = parsed
    return value
  } catch (_) {
    localStorage.removeItem(storageKey)
    return null
  }
}

export function writeViewSnapshot(key, value) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({
      ...value,
      __cacheSchema: CACHE_SCHEMA,
      __cachedAt: Date.now(),
    }))
  } catch (error) {
    console.warn("Unable to persist instant view snapshot:", key, error)
  }
}

export function removeViewSnapshot(key) {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(`${PREFIX}${key}`)
}
