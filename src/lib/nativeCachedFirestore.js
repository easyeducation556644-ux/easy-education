import * as tracked from "./trackedFirestore.js"

export * from "./trackedFirestore.js"

const PERMANENT_CACHE_COLLECTIONS = new Set([
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
  "payments",
  "userCourses",
  "watched",
  "userProgress",
  "votes",
  "examResults",
  "examAttempts",
  "cqSubmissions",
])
const CACHE_SCHEMA = "v3"

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

function shouldUsePermanentCache(ref) {
  return PERMANENT_CACHE_COLLECTIONS.has(collectionName(ref))
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

    const identity = {
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
    }
    return safeJson(identity)
  } catch (_) {
    return `fallback:${collectionName(ref)}:${typeof window !== "undefined" ? window.location.pathname : "server"}`
  }
}

function cacheMarker(ref, kind) {
  return `ee_permanent_cache:${CACHE_SCHEMA}:${kind}:${hashString(queryIdentity(ref))}`
}

function collectionMarker(collection) {
  return `ee_permanent_collection:${CACHE_SCHEMA}:${collection}`
}

function hasMarker(ref, kind) {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(cacheMarker(ref, kind)) === "1"
}

function markCached(ref, kind) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(cacheMarker(ref, kind), "1")
  const collection = collectionName(ref)
  if (collection) localStorage.setItem(collectionMarker(collection), "1")
}

function clearMarker(ref, kind) {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(cacheMarker(ref, kind))
}

export function hasSeenPermanentCollection(collection) {
  if (typeof localStorage === "undefined") return false
  return PERMANENT_CACHE_COLLECTIONS.has(collection)
    && localStorage.getItem(collectionMarker(collection)) === "1"
}

export async function getDoc(ref) {
  if (!shouldUsePermanentCache(ref)) return tracked.getDoc(ref)

  // A document can already be present because a parent query cached it. Reuse that
  // exact document even if this specific getDoc call has never run before.
  try {
    const cached = await tracked.getDocFromCache(ref)
    if (cached.exists() || hasMarker(ref, "doc")) {
      markCached(ref, "doc")
      return cached
    }
  } catch (_) {
    if (hasMarker(ref, "doc")) clearMarker(ref, "doc")
  }

  const snapshot = await tracked.getDoc(ref)
  if (!snapshot?.metadata?.fromCache) markCached(ref, "doc")
  return snapshot
}

export async function getDocs(ref) {
  if (!shouldUsePermanentCache(ref)) return tracked.getDocs(ref)

  // Queries need their own permanent marker. Firestore may have a few matching docs
  // from another query, but that does not prove this exact query was fully loaded.
  if (hasMarker(ref, "query")) {
    try {
      return await tracked.getDocsFromCache(ref)
    } catch (_) {
      clearMarker(ref, "query")
    }
  }

  const snapshot = await tracked.getDocs(ref)
  if (!snapshot?.metadata?.fromCache) markCached(ref, "query")
  return snapshot
}

// This is the only automatic refresh path for permanent-cache collections.
// It reads one changed document, not the parent query/collection. Firestore then
// updates its persistent IndexedDB cache so future route reads remain cache-only.
export async function syncChangedDocument(collectionPath, documentId) {
  if (!PERMANENT_CACHE_COLLECTIONS.has(collectionPath)) {
    throw new Error(`Unsupported permanent-cache collection: ${collectionPath}`)
  }
  const ref = tracked.doc(tracked.getFirestore(), collectionPath, documentId)
  const snapshot = await tracked.getDocFromServer(ref)
  markCached(ref, "doc")
  return snapshot
}

export const __permanentCache = {
  collections: PERMANENT_CACHE_COLLECTIONS,
  hasSeenPermanentCollection,
  queryIdentity,
}
