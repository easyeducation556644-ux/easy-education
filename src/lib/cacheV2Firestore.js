import * as tracked from "./trackedFirestore.js"

export * from "./trackedFirestore.js"

const CACHE_SCHEMA = "v4"
const CACHE_EVENT = "easy-education-cache-updated"

export const CACHE_V2_PUBLIC_COLLECTIONS = new Set([
  "courses",
  "classes",
  "subjects",
  "chapters",
  "settings",
  "categories",
  "teachers",
  "announcements",
  "exams",
  "examQuestions",
])

export const CACHE_V2_USER_COLLECTIONS = new Set([
  "payments",
  "userCourses",
  "watched",
  "userProgress",
  "votes",
  "examResults",
  "examAttempts",
  "cqSubmissions",
])

const CACHE_V2_COLLECTIONS = new Set([
  ...CACHE_V2_PUBLIC_COLLECTIONS,
  ...CACHE_V2_USER_COLLECTIONS,
])

function hashString(value = "") {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
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

function canonicalField(field) {
  try {
    return field?.canonicalString?.() || String(field || "")
  } catch (_) {
    return String(field || "")
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch (_) {
    return String(value)
  }
}

function queryIdentity(ref) {
  try {
    if (ref?.path && !ref?._query) return `doc:${ref.path}`
    const q = ref?._query
    if (!q) return `ref:${ref?.path || collectionName(ref)}`
    return safeJson({
      path: q.path?.canonicalString?.() || "",
      collectionGroup: q.collectionGroup || null,
      filters: (q.filters || []).map((filter) => ({
        field: canonicalField(filter.field),
        op: filter.op || filter.operator || "",
        value: filter.value ?? null,
      })),
      orderBy: (q.explicitOrderBy || []).map((order) => ({
        field: canonicalField(order.field),
        dir: order.dir || order.direction || "",
      })),
      limit: q.limit ?? null,
      limitType: q.limitType || null,
      startAt: q.startAt ? {
        inclusive: Boolean(q.startAt.inclusive),
        position: q.startAt.position || [],
      } : null,
      endAt: q.endAt ? {
        inclusive: Boolean(q.endAt.inclusive),
        position: q.endAt.position || [],
      } : null,
    })
  } catch (_) {
    return `fallback:${collectionName(ref)}:${typeof window !== "undefined" ? window.location.pathname : "server"}`
  }
}

function markerKey(ref, kind) {
  const collection = collectionName(ref) || "unknown"
  return `ee_cache_${CACHE_SCHEMA}:${collection}:${kind}:${hashString(queryIdentity(ref))}`
}

function collectionMarkerKey(collection) {
  return `ee_cache_${CACHE_SCHEMA}_seen:${collection}`
}

function persistentCacheReady() {
  if (typeof window === "undefined") return false
  return window.__EASY_EDUCATION_PERSISTENT_FIRESTORE__ === true
}

function shouldCache(ref) {
  if (typeof window === "undefined") return false
  return CACHE_V2_COLLECTIONS.has(collectionName(ref))
}

function shouldKeepLiveListener(ref) {
  if (ref?.path === "settings/contentSync") return true
  return !shouldCache(ref)
}

function hasMarker(ref, kind) {
  if (typeof localStorage === "undefined" || !persistentCacheReady()) return false
  return localStorage.getItem(markerKey(ref, kind)) === "1"
}

function markCached(ref, kind) {
  if (typeof localStorage === "undefined" || !persistentCacheReady()) return
  try {
    localStorage.setItem(markerKey(ref, kind), "1")
    const collection = collectionName(ref)
    if (collection) localStorage.setItem(collectionMarkerKey(collection), "1")
  } catch (_) {
    // Firestore's IndexedDB cache is still usable if localStorage is unavailable.
  }
}

function clearMarker(ref, kind) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(markerKey(ref, kind))
  } catch (_) {
    // Ignore storage failures.
  }
}

function emitCacheUpdated(ref, action = "changed", extra = {}) {
  if (typeof window === "undefined") return
  const collection = collectionName(ref)
  if (!collection) return
  window.dispatchEvent(new CustomEvent(CACHE_EVENT, {
    detail: {
      collection,
      docId: String(ref?.id || ""),
      action,
      ...extra,
    },
  }))
}

export function hasSeenCacheV2Collection(collection) {
  if (typeof localStorage === "undefined" || !persistentCacheReady()) return false
  return CACHE_V2_COLLECTIONS.has(collection)
    && localStorage.getItem(collectionMarkerKey(collection)) === "1"
}

export function hasAnySeenCacheV2Collection(collections = CACHE_V2_COLLECTIONS) {
  return [...collections].some((collection) => hasSeenCacheV2Collection(collection))
}

export function invalidateCacheV2Collections(collections, reason = "sync-gap") {
  if (typeof localStorage === "undefined") return
  const targets = new Set([...collections].filter((collection) => CACHE_V2_COLLECTIONS.has(collection)))
  try {
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      for (const collection of targets) {
        if (
          key.startsWith(`ee_cache_${CACHE_SCHEMA}:${collection}:`) ||
          key === collectionMarkerKey(collection)
        ) {
          localStorage.removeItem(key)
          break
        }
      }
    }
  } catch (_) {
    // Ignore storage failures; listeners will still reconnect through Firestore.
  }

  if (typeof window !== "undefined") {
    for (const collection of targets) {
      window.dispatchEvent(new CustomEvent(CACHE_EVENT, {
        detail: { collection, docId: "", action: "invalidate", forceServer: true, reason },
      }))
    }
  }
}

export function clearAllCacheV2Markers() {
  invalidateCacheV2Collections(CACHE_V2_COLLECTIONS, "cache-reset")
}

async function primeDocFromServer(ref) {
  const snapshot = await tracked.getDocFromServer(ref)
  markCached(ref, "doc")
  return snapshot
}

async function primeQueryFromServer(ref) {
  const snapshot = await tracked.getDocsFromServer(ref)
  markCached(ref, "query")
  return snapshot
}

export async function getDoc(ref) {
  if (!shouldCache(ref) || !persistentCacheReady()) return tracked.getDoc(ref)

  if (hasMarker(ref, "doc")) {
    try {
      return await tracked.getDocFromCache(ref)
    } catch (_) {
      clearMarker(ref, "doc")
    }
  }

  try {
    return await primeDocFromServer(ref)
  } catch (serverError) {
    try {
      return await tracked.getDocFromCache(ref)
    } catch (_) {
      throw serverError
    }
  }
}

export async function getDocs(ref) {
  if (!shouldCache(ref) || !persistentCacheReady()) return tracked.getDocs(ref)

  if (hasMarker(ref, "query")) {
    try {
      return await tracked.getDocsFromCache(ref)
    } catch (_) {
      clearMarker(ref, "query")
    }
  }

  try {
    return await primeQueryFromServer(ref)
  } catch (serverError) {
    try {
      return await tracked.getDocsFromCache(ref)
    } catch (_) {
      throw serverError
    }
  }
}

export async function getDocFromServer(ref) {
  if (!shouldCache(ref)) return tracked.getDocFromServer(ref)
  return primeDocFromServer(ref)
}

export async function getDocsFromServer(ref) {
  if (!shouldCache(ref)) return tracked.getDocsFromServer(ref)
  return primeQueryFromServer(ref)
}

function observerForArgs(args) {
  let index = 0
  if (args[index] && typeof args[index] === "object" && typeof args[index].next !== "function") index += 1
  const observer = args[index]
  if (observer && typeof observer === "object" && typeof observer.next === "function") {
    return {
      next: observer.next.bind(observer),
      error: typeof observer.error === "function" ? observer.error.bind(observer) : null,
    }
  }
  return {
    next: typeof args[index] === "function" ? args[index] : null,
    error: typeof args[index + 1] === "function" ? args[index + 1] : null,
  }
}

async function readCachedListenerSnapshot(ref, forceServer = false) {
  const isDocument = Boolean(ref?.path && !ref?._query)
  if (forceServer) return isDocument ? getDocFromServer(ref) : getDocsFromServer(ref)
  if (isDocument) {
    if (!hasMarker(ref, "doc")) return getDoc(ref)
    return tracked.getDocFromCache(ref)
  }
  if (!hasMarker(ref, "query")) return getDocs(ref)
  return tracked.getDocsFromCache(ref)
}

export function onSnapshot(ref, ...args) {
  if (shouldKeepLiveListener(ref) || !persistentCacheReady()) {
    return tracked.onSnapshot(ref, ...args)
  }

  const observer = observerForArgs(args)
  let active = true
  let work = Promise.resolve()

  const deliver = (forceServer = false) => {
    work = work.then(async () => {
      if (!active) return
      try {
        const snapshot = await readCachedListenerSnapshot(ref, forceServer)
        if (active) observer.next?.(snapshot)
      } catch (error) {
        if (active) observer.error?.(error)
      }
    })
  }

  deliver(false)
  const collection = collectionName(ref)
  const directDocId = ref?.path && !ref?._query ? String(ref.id || "") : ""
  const onCacheUpdated = (event) => {
    if (event?.detail?.collection !== collection) return
    if (directDocId && event?.detail?.docId && event.detail.docId !== directDocId) return
    deliver(Boolean(event?.detail?.forceServer))
  }
  window.addEventListener(CACHE_EVENT, onCacheUpdated)

  return () => {
    active = false
    window.removeEventListener(CACHE_EVENT, onCacheUpdated)
  }
}

export async function addDoc(collectionRef, data) {
  const result = await tracked.addDoc(collectionRef, data)
  emitCacheUpdated(result, "changed", { local: true })
  return result
}

export async function setDoc(ref, data, options) {
  const result = options === undefined
    ? await tracked.setDoc(ref, data)
    : await tracked.setDoc(ref, data, options)
  markCached(ref, "doc")
  emitCacheUpdated(ref, "changed", { local: true })
  return result
}

export async function updateDoc(ref, ...args) {
  const result = await tracked.updateDoc(ref, ...args)
  markCached(ref, "doc")
  emitCacheUpdated(ref, "changed", { local: true })
  return result
}

export async function deleteDoc(ref) {
  const result = await tracked.deleteDoc(ref)
  markCached(ref, "doc")
  emitCacheUpdated(ref, "deleted", { local: true })
  return result
}

export function writeBatch(db) {
  return tracked.writeBatch(db)
}

export async function runTransaction(db, updateFunction, options) {
  return tracked.runTransaction(db, updateFunction, options)
}

export async function syncChangedDocument(collectionPath, documentId) {
  if (!CACHE_V2_COLLECTIONS.has(collectionPath)) {
    throw new Error(`Unsupported Cache V2 collection: ${collectionPath}`)
  }
  const ref = tracked.doc(tracked.getFirestore(), collectionPath, documentId)
  return primeDocFromServer(ref)
}

export const __cacheV2 = {
  schema: CACHE_SCHEMA,
  collections: CACHE_V2_COLLECTIONS,
  publicCollections: CACHE_V2_PUBLIC_COLLECTIONS,
  userCollections: CACHE_V2_USER_COLLECTIONS,
  queryIdentity,
}
