import * as tracked from "./trackedFirestore.js"

export * from "./trackedFirestore.js"

const SAFE_CACHE_FIRST_COLLECTIONS = new Set([
  "courses",
  "classes",
  "subjects",
  "chapters",
])
const WARM_TTL_MS = 24 * 60 * 60 * 1000

function isNativeApp() {
  return typeof window !== "undefined" && Boolean(window.EasyEducationNative?.postMessage)
}

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

function warmKey(ref, kind) {
  return `ee_native_firestore_warm:${kind}:${collectionName(ref)}:${routeKey()}`
}

function isWarm(ref, kind) {
  if (typeof localStorage === "undefined") return false
  const value = Number(localStorage.getItem(warmKey(ref, kind)) || 0)
  return value > 0 && Date.now() - value < WARM_TTL_MS
}

function markWarm(ref, kind) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(warmKey(ref, kind), String(Date.now()))
}

function shouldUseCacheFirst(ref) {
  return isNativeApp() && SAFE_CACHE_FIRST_COLLECTIONS.has(collectionName(ref))
}

async function refreshDoc(ref) {
  try {
    const snapshot = await tracked.getDocFromServer(ref)
    markWarm(ref, "doc")
    return snapshot
  } catch (_) {
    return null
  }
}

async function refreshDocs(ref) {
  try {
    const snapshot = await tracked.getDocsFromServer(ref)
    markWarm(ref, "query")
    return snapshot
  } catch (_) {
    return null
  }
}

export async function getDoc(ref) {
  if (shouldUseCacheFirst(ref) && isWarm(ref, "doc")) {
    try {
      const cached = await tracked.getDocFromCache(ref)
      if (cached.exists()) {
        refreshDoc(ref)
        return cached
      }
    } catch (_) {
      // Cache miss: fall back to normal tracked read.
    }
  }

  const snapshot = await tracked.getDoc(ref)
  if (shouldUseCacheFirst(ref) && snapshot.exists()) markWarm(ref, "doc")
  return snapshot
}

export async function getDocs(ref) {
  if (shouldUseCacheFirst(ref) && isWarm(ref, "query")) {
    try {
      const cached = await tracked.getDocsFromCache(ref)
      refreshDocs(ref)
      return cached
    } catch (_) {
      // Cache miss: fall back to normal tracked read.
    }
  }

  const snapshot = await tracked.getDocs(ref)
  if (shouldUseCacheFirst(ref)) markWarm(ref, "query")
  return snapshot
}
