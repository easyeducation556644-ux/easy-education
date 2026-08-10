import * as tracked from "./trackedFirestore.js"

export * from "./trackedFirestore.js"

const SAFE_CACHE_FIRST_COLLECTIONS = new Set([
  "courses",
  "classes",
  "subjects",
  "chapters",
  "settings",
])

// Public course structure does not need a server read on every route visit.
// For 15 minutes after a successful server read, serve Firestore's persistent
// local cache directly. After that window, the next visit refreshes from server.
const CACHE_FRESH_MS = 15 * 60 * 1000

function collectionName(ref) {
  try {
    if (ref?.path) return String(ref.path).split("/").filter(Boolean)[0] || ""
    const queryPath = ref?._query?.path?.canonicalString?.()
    if (queryPath) return String(queryPath).split("/").filter(Boolean)[0] || ""
  } catch (_) {
    // Fall through.
  }
  return ""
}

function routeKey() {
  if (typeof window === "undefined") return "server"
  return `${window.location.pathname}${window.location.search}`
}

function freshKey(ref, kind) {
  return `ee_firestore_fresh:${kind}:${collectionName(ref)}:${routeKey()}`
}

function isFresh(ref, kind) {
  if (typeof localStorage === "undefined") return false
  const value = Number(localStorage.getItem(freshKey(ref, kind)) || 0)
  return value > 0 && Date.now() - value < CACHE_FRESH_MS
}

function markFresh(ref, kind) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(freshKey(ref, kind), String(Date.now()))
}

function shouldUseCacheFirst(ref) {
  return SAFE_CACHE_FIRST_COLLECTIONS.has(collectionName(ref))
}

export async function getDoc(ref) {
  if (shouldUseCacheFirst(ref) && isFresh(ref, "doc")) {
    try {
      const cached = await tracked.getDocFromCache(ref)
      if (cached.exists()) return cached
    } catch (_) {
      // Cache miss: fall through to server-backed read.
    }
  }

  const snapshot = await tracked.getDoc(ref)
  if (shouldUseCacheFirst(ref) && snapshot.exists()) markFresh(ref, "doc")
  return snapshot
}

export async function getDocs(ref) {
  if (shouldUseCacheFirst(ref) && isFresh(ref, "query")) {
    try {
      const cached = await tracked.getDocsFromCache(ref)
      if (!cached.empty) return cached
    } catch (_) {
      // Cache miss: fall through to server-backed read.
    }
  }

  const snapshot = await tracked.getDocs(ref)
  if (shouldUseCacheFirst(ref)) markFresh(ref, "query")
  return snapshot
}
