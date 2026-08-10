import * as tracked from "./trackedFirestore.js"
import { getAuth } from "firebase/auth"

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
const CACHE_SCHEMA = "v4"
const CACHE_UPDATED_EVENT = "easy-education-cache-updated"
const LEARNING_PUSH_EVENT = "easy-education-learning-push-result"

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

function isCommunityPublicUserRead(ref) {
  if (typeof window === "undefined") return false
  if (collectionName(ref) !== "users") return false
  return window.location.pathname === "/community"
}

function shouldUsePermanentCache(ref) {
  return PERMANENT_CACHE_COLLECTIONS.has(collectionName(ref)) || isCommunityPublicUserRead(ref)
}

function shouldUseCacheOnlyListener(ref) {
  const collection = collectionName(ref)
  if (!PERMANENT_CACHE_COLLECTIONS.has(collection)) return false
  // The sync-feed document must stay live so targeted invalidations can arrive.
  if (ref?.path === "settings/contentSync") return false
  return true
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

function emitCacheUpdated(ref, action = "changed") {
  if (typeof window === "undefined") return
  const collection = collectionName(ref)
  if (!collection) return
  window.dispatchEvent(new CustomEvent(CACHE_UPDATED_EVENT, {
    detail: {
      collection,
      docId: String(ref?.id || ""),
      action,
      local: true,
    },
  }))
}

function isArchivedClassData(data) {
  if (data?.isArchived === true) return true
  const subjects = Array.isArray(data?.subject) ? data.subject : [data?.subject]
  const chapters = Array.isArray(data?.chapter) ? data.chapter : [data?.chapter]
  return subjects.includes("archive") || chapters.includes("archive")
}

function emitLearningPush(detail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LEARNING_PUSH_EVENT, { detail }))
}

async function notifyCreatedClass(classId) {
  if (typeof window === "undefined") return null
  const user = getAuth().currentUser
  if (!user) return null
  try {
    const token = await user.getIdToken()
    const response = await fetch("/api/learning-push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "class-created", classId }),
      keepalive: true,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.success) {
      throw new Error(body?.error || `Class notification failed: ${response.status}`)
    }
    emitLearningPush({ ok: true, classId, ...body })
    return body
  } catch (error) {
    console.warn("Class was created, but enrolled-user push notification failed:", error)
    emitLearningPush({ ok: false, classId, error: error?.message || "Notification failed" })
    return null
  }
}

export function hasSeenPermanentCollection(collection) {
  if (typeof localStorage === "undefined") return false
  return PERMANENT_CACHE_COLLECTIONS.has(collection)
    && localStorage.getItem(collectionMarker(collection)) === "1"
}

export async function getDoc(ref) {
  if (!shouldUsePermanentCache(ref)) return tracked.getDoc(ref)

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

function observerForArgs(args) {
  let index = 0
  if (args[index] && typeof args[index] === "object" && typeof args[index].next !== "function") {
    index += 1
  }
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

async function readPermanentListenerSnapshot(ref, initial = false) {
  const isDocument = Boolean(ref?.path && !ref?._query)
  if (initial) return isDocument ? getDoc(ref) : getDocs(ref)
  return isDocument ? tracked.getDocFromCache(ref) : tracked.getDocsFromCache(ref)
}

export function onSnapshot(ref, ...args) {
  if (!shouldUseCacheOnlyListener(ref) || typeof window === "undefined") {
    return tracked.onSnapshot(ref, ...args)
  }

  const observer = observerForArgs(args)
  let active = true
  let work = Promise.resolve()
  const deliver = (initial = false) => {
    work = work.then(async () => {
      if (!active) return
      try {
        const snapshot = await readPermanentListenerSnapshot(ref, initial)
        if (active) observer.next?.(snapshot)
      } catch (error) {
        if (active) observer.error?.(error)
      }
    })
  }

  deliver(true)
  const collection = collectionName(ref)
  const onCacheUpdated = (event) => {
    if (event?.detail?.collection !== collection) return
    deliver(false)
  }
  window.addEventListener(CACHE_UPDATED_EVENT, onCacheUpdated)

  return () => {
    active = false
    window.removeEventListener(CACHE_UPDATED_EVENT, onCacheUpdated)
  }
}

export async function addDoc(collectionRef, data) {
  const result = await tracked.addDoc(collectionRef, data)
  emitCacheUpdated(result, "changed")
  if (collectionName(collectionRef) === "classes" && !isArchivedClassData(data)) {
    notifyCreatedClass(result.id).catch(() => {})
  }
  return result
}

export async function setDoc(ref, data, options) {
  const result = options === undefined
    ? await tracked.setDoc(ref, data)
    : await tracked.setDoc(ref, data, options)
  emitCacheUpdated(ref, "changed")
  return result
}

export async function updateDoc(ref, ...args) {
  const result = await tracked.updateDoc(ref, ...args)
  emitCacheUpdated(ref, "changed")
  return result
}

export async function deleteDoc(ref) {
  const result = await tracked.deleteDoc(ref)
  emitCacheUpdated(ref, "deleted")
  return result
}

// The sync feed is the only automatic server refresh path for permanent data.
// A change causes exactly one affected document read; parent queries remain cache-only.
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
