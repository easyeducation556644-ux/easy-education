import * as firestore from "firebase/firestore"
import { getAuth } from "firebase/auth"

export * from "firebase/firestore"

const pending = new Map()
let flushInFlight = null

const PUBLIC_SYNC_COLLECTIONS = new Set([
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
const USER_SYNC_COLLECTIONS = new Set([
  "payments",
  "userCourses",
  "watched",
  "userProgress",
  "votes",
  "examResults",
  "examAttempts",
  "cqSubmissions",
])
const SYNC_QUEUE_KEY = "ee_targeted_sync_queue_v1"
let syncQueueFlushInFlight = null
let syncQueueTimer = null

function hashString(value = "") {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function getSessionId() {
  if (typeof window === "undefined") return "server"
  const key = "ee_firestore_read_session"
  let value = sessionStorage.getItem(key)
  if (!value) {
    value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(key, value)
  }
  return value
}

function normalizeDynamicPath(path = "/") {
  const parts = String(path).split("/").filter(Boolean)
  return "/" + parts.map((part) => {
    if (/^[A-Za-z0-9_-]{16,}$/.test(part) || /^\d{8,}$/.test(part)) return ":id"
    return part
  }).join("/")
}

function normalizeFirestorePath(path = "unknown") {
  const parts = String(path).split("/").filter(Boolean)
  return parts.map((part, index) => (index % 2 === 1 ? "{doc}" : part)).join("/") || "unknown"
}

function rawCollectionName(ref) {
  try {
    if (ref?.path) return String(ref.path).split("/").filter(Boolean)[0] || ""
    const queryPath = ref?._query?.path?.canonicalString?.()
    if (queryPath) return String(queryPath).split("/").filter(Boolean)[0] || ""
  } catch (_) {
    // Fall through.
  }
  return ""
}

function describeSource(ref) {
  try {
    const directPath = ref?.path
    if (directPath) return normalizeFirestorePath(directPath)

    const queryPath = ref?._query?.path?.canonicalString?.()
    if (queryPath) return normalizeFirestorePath(queryPath)

    if (ref?._query?.collectionGroup) return `collectionGroup:${ref._query.collectionGroup}`
  } catch (_) {
    // Fall through to a stable generic label.
  }
  return ref?.type || "unknown"
}

function currentPage() {
  if (typeof window === "undefined") return "server"
  return normalizeDynamicPath(window.location?.pathname || "/")
}

function getDhakaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function usageDayAndHour(date = new Date()) {
  const parts = getDhakaParts(date)
  const hour = Number(parts.hour || 0)
  const current = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+06:00`)
  if (hour < 14) current.setUTCDate(current.getUTCDate() - 1)
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(current)
  return { day, hour: String(hour).padStart(2, "0") }
}

function queueRead({ operation, source, reads, calls = 1 }) {
  if (!Number.isFinite(reads) || reads <= 0 || typeof window === "undefined") return

  const now = new Date()
  const { day, hour } = usageDayAndHour(now)
  const page = currentPage()
  const sourceLabel = source || "unknown"
  const key = [day, hour, page, operation, sourceLabel].join("|")
  const existing = pending.get(key)

  if (existing) {
    existing.reads += reads
    existing.calls += calls
    existing.lastSeen = now.toISOString()
  } else {
    pending.set(key, {
      usageDay: day,
      hour,
      page,
      operation,
      source: sourceLabel,
      reads,
      calls,
      lastSeen: now.toISOString(),
    })
  }

  if (pending.size >= 20 || [...pending.values()].reduce((sum, item) => sum + item.reads, 0) >= 100) {
    scheduleFlush(0)
  }
}

let flushTimer = null
function scheduleFlush(delay = 1500) {
  if (typeof window === "undefined" || flushTimer) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushUsage().catch(() => {})
  }, delay)
}

function mergeBack(events) {
  events.forEach((event) => {
    const key = [event.usageDay, event.hour, event.page, event.operation, event.source].join("|")
    const current = pending.get(key)
    if (current) {
      current.reads += event.reads
      current.calls += event.calls
      current.lastSeen = event.lastSeen > current.lastSeen ? event.lastSeen : current.lastSeen
    } else {
      pending.set(key, event)
    }
  })
}

export async function flushUsage() {
  if (typeof window === "undefined" || pending.size === 0) return
  if (flushInFlight) return flushInFlight

  const events = [...pending.values()]
  pending.clear()
  const sessionId = getSessionId()

  flushInFlight = (async () => {
    try {
      let token = null
      try {
        token = await getAuth().currentUser?.getIdToken()
      } catch (_) {
        token = null
      }

      const response = await fetch("/api/firestore-read-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId, events }),
        keepalive: true,
      })

      if (!response.ok) throw new Error(`Usage flush failed: ${response.status}`)
    } catch (error) {
      mergeBack(events)
      scheduleFlush(15000)
      throw error
    } finally {
      flushInFlight = null
    }
  })()

  return flushInFlight
}

function isServerReadSnapshot(snapshot) {
  return !snapshot?.metadata?.fromCache && !snapshot?.metadata?.hasPendingWrites
}

function countQuerySnapshot(snapshot, operation, source, state) {
  if (!isServerReadSnapshot(snapshot)) return

  if (!state.serverInitialRecorded) {
    state.serverInitialRecorded = true
    queueRead({ operation, source, reads: Math.max(1, snapshot?.size ?? 1) })
    return
  }

  if (typeof snapshot?.docChanges === "function") {
    const changes = snapshot.docChanges({ includeMetadataChanges: false })
    if (changes.length > 0) queueRead({ operation, source, reads: changes.length })
    return
  }

  queueRead({ operation, source, reads: 1 })
}

function wrapObserver(observer, operation, source, state) {
  if (!observer || typeof observer !== "object" || typeof observer.next !== "function") return observer
  return {
    ...observer,
    next(snapshot) {
      countQuerySnapshot(snapshot, operation, source, state)
      return observer.next(snapshot)
    },
  }
}

function syncedCollection(ref) {
  const collection = rawCollectionName(ref)
  return PUBLIC_SYNC_COLLECTIONS.has(collection) || USER_SYNC_COLLECTIONS.has(collection)
    ? collection
    : ""
}

function makeSyncEventId(collection, docId) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  return `${collection}:${String(docId).slice(0, 80)}:${Date.now().toString(36)}:${random}`.slice(0, 220)
}

function loadSyncQueue() {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function saveSyncQueue(events) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(events.slice(-200)))
  } catch (_) {
    // If local storage is unavailable, the source Firestore mutation still succeeded.
  }
}

function scheduleSyncQueueFlush(delay = 0) {
  if (typeof window === "undefined" || syncQueueTimer) return
  syncQueueTimer = window.setTimeout(() => {
    syncQueueTimer = null
    flushTargetedSyncQueue().catch(() => {})
  }, delay)
}

function enqueueTargetedSync(event) {
  if (typeof window === "undefined") return
  const queue = loadSyncQueue()
  if (!queue.some((item) => item.eventId === event.eventId)) queue.push(event)
  saveSyncQueue(queue)
  scheduleSyncQueueFlush(0)
}

async function cachedOwnerId(ref) {
  if (!USER_SYNC_COLLECTIONS.has(rawCollectionName(ref))) return ""
  try {
    const snapshot = await firestore.getDocFromCache(ref)
    const data = snapshot.exists() ? snapshot.data() : null
    return String(data?.userId || data?.uid || "")
  } catch (_) {
    return ""
  }
}

function hintForRef(ref, action = "changed", userId = "") {
  const collection = syncedCollection(ref)
  const docId = String(ref?.id || "")
  if (!collection || !docId) return null
  if (collection === "settings" && docId === "contentSync") return null
  return {
    eventId: makeSyncEventId(collection, docId),
    collection,
    docId,
    action: action === "deleted" ? "deleted" : "changed",
    ...(userId ? { userId } : {}),
  }
}

export async function flushTargetedSyncQueue() {
  if (typeof window === "undefined") return
  if (syncQueueFlushInFlight) return syncQueueFlushInFlight

  syncQueueFlushInFlight = (async () => {
    const user = getAuth().currentUser
    if (!user) return

    while (true) {
      const queue = loadSyncQueue()
      const event = queue[0]
      if (!event) return

      const token = await user.getIdToken()
      const response = await fetch("/api/sync-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(event),
        keepalive: true,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const message = body?.error || `Sync hint failed: ${response.status}`
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          saveSyncQueue(queue.slice(1))
          console.warn("Dropping rejected targeted sync hint:", message)
          continue
        }
        throw new Error(message)
      }

      const latest = loadSyncQueue()
      saveSyncQueue(latest.filter((item) => item.eventId !== event.eventId))
    }
  })().finally(() => {
    syncQueueFlushInFlight = null
    if (loadSyncQueue().length > 0) scheduleSyncQueueFlush(15000)
  })

  return syncQueueFlushInFlight
}

async function queueMutationHint(ref, action = "changed", explicitUserId = "") {
  const collection = syncedCollection(ref)
  if (!collection) return
  const userId = explicitUserId || (USER_SYNC_COLLECTIONS.has(collection) ? await cachedOwnerId(ref) : "")
  const event = hintForRef(ref, action, userId)
  if (event) enqueueTargetedSync(event)
}

export async function getDoc(ref) {
  const snapshot = await firestore.getDoc(ref)
  if (isServerReadSnapshot(snapshot)) queueRead({ operation: "getDoc", source: describeSource(ref), reads: 1 })
  return snapshot
}

export async function getDocFromServer(ref) {
  const snapshot = await firestore.getDocFromServer(ref)
  queueRead({ operation: "getDocFromServer", source: describeSource(ref), reads: 1 })
  return snapshot
}

export async function getDocs(ref) {
  const snapshot = await firestore.getDocs(ref)
  if (isServerReadSnapshot(snapshot)) {
    queueRead({ operation: "getDocs", source: describeSource(ref), reads: Math.max(1, snapshot.size) })
  }
  return snapshot
}

export async function getDocsFromServer(ref) {
  const snapshot = await firestore.getDocsFromServer(ref)
  queueRead({ operation: "getDocsFromServer", source: describeSource(ref), reads: Math.max(1, snapshot.size) })
  return snapshot
}

export function onSnapshot(ref, ...args) {
  const source = describeSource(ref)
  const state = { serverInitialRecorded: false }
  const wrapped = [...args]

  const observerIndex = wrapped.findIndex((arg) => arg && typeof arg === "object" && typeof arg.next === "function")
  if (observerIndex >= 0) {
    wrapped[observerIndex] = wrapObserver(wrapped[observerIndex], "onSnapshot", source, state)
    return firestore.onSnapshot(ref, ...wrapped)
  }

  const callbackIndex = wrapped.findIndex((arg) => typeof arg === "function")
  if (callbackIndex >= 0) {
    const original = wrapped[callbackIndex]
    wrapped[callbackIndex] = (snapshot) => {
      countQuerySnapshot(snapshot, "onSnapshot", source, state)
      return original(snapshot)
    }
  }

  return firestore.onSnapshot(ref, ...wrapped)
}

export async function addDoc(collectionRef, data) {
  const result = await firestore.addDoc(collectionRef, data)
  const explicitUserId = String(data?.userId || data?.uid || "")
  queueMutationHint(result, "changed", explicitUserId).catch(() => {})
  return result
}

export async function setDoc(ref, data, options) {
  const result = options === undefined
    ? await firestore.setDoc(ref, data)
    : await firestore.setDoc(ref, data, options)
  const explicitUserId = String(data?.userId || data?.uid || "")
  queueMutationHint(ref, "changed", explicitUserId).catch(() => {})
  return result
}

export async function updateDoc(ref, ...args) {
  const preOwner = await cachedOwnerId(ref)
  const result = await firestore.updateDoc(ref, ...args)
  const objectData = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : null
  const explicitUserId = String(objectData?.userId || objectData?.uid || preOwner || "")
  queueMutationHint(ref, "changed", explicitUserId).catch(() => {})
  return result
}

export async function deleteDoc(ref) {
  const preOwner = await cachedOwnerId(ref)
  const result = await firestore.deleteDoc(ref)
  queueMutationHint(ref, "deleted", preOwner).catch(() => {})
  return result
}

export function writeBatch(db) {
  const batch = firestore.writeBatch(db)
  const mutations = []
  let proxy

  proxy = new Proxy(batch, {
    get(target, prop, receiver) {
      if (prop === "set") {
        return (ref, data, options) => {
          mutations.push({ ref, action: "changed", userId: String(data?.userId || data?.uid || "") })
          if (options === undefined) target.set(ref, data)
          else target.set(ref, data, options)
          return proxy
        }
      }
      if (prop === "update") {
        return (ref, ...args) => {
          mutations.push({ ref, action: "changed", userId: "" })
          target.update(ref, ...args)
          return proxy
        }
      }
      if (prop === "delete") {
        return (ref) => {
          mutations.push({ ref, action: "deleted", userId: "" })
          target.delete(ref)
          return proxy
        }
      }
      if (prop === "commit") {
        return async () => {
          const result = await target.commit()
          mutations.forEach((item) => queueMutationHint(item.ref, item.action, item.userId).catch(() => {}))
          return result
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

  return proxy
}

export async function runTransaction(db, updateFunction, options) {
  let committedMutations = []
  const result = await firestore.runTransaction(
    db,
    async (transaction) => {
      const attemptMutations = []
      let trackedTransaction
      trackedTransaction = new Proxy(transaction, {
        get(target, prop, receiver) {
          if (prop === "get") {
            return async (ref) => {
              const snapshot = await target.get(ref)
              queueRead({ operation: "transaction.get", source: describeSource(ref), reads: 1 })
              return snapshot
            }
          }
          if (prop === "set") {
            return (ref, data, optionsArg) => {
              attemptMutations.push({ ref, action: "changed", userId: String(data?.userId || data?.uid || "") })
              if (optionsArg === undefined) target.set(ref, data)
              else target.set(ref, data, optionsArg)
              return trackedTransaction
            }
          }
          if (prop === "update") {
            return (ref, ...args) => {
              attemptMutations.push({ ref, action: "changed", userId: "" })
              target.update(ref, ...args)
              return trackedTransaction
            }
          }
          if (prop === "delete") {
            return (ref) => {
              attemptMutations.push({ ref, action: "deleted", userId: "" })
              target.delete(ref)
              return trackedTransaction
            }
          }
          const value = Reflect.get(target, prop, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      const value = await updateFunction(trackedTransaction)
      committedMutations = attemptMutations
      return value
    },
    options,
  )

  committedMutations.forEach((item) => queueMutationHint(item.ref, item.action, item.userId).catch(() => {}))
  return result
}

export async function getCountFromServer(ref) {
  const snapshot = await firestore.getCountFromServer(ref)
  queueRead({ operation: "getCountFromServer", source: describeSource(ref), reads: 1 })
  return snapshot
}

if (typeof window !== "undefined" && !window.__eeFirestoreReadTrackerStarted) {
  window.__eeFirestoreReadTrackerStarted = true
  window.setInterval(() => flushUsage().catch(() => {}), 60000)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushUsage().catch(() => {})
  })
  window.addEventListener("online", () => {
    flushTargetedSyncQueue().catch(() => {})
  })
  window.setTimeout(() => flushTargetedSyncQueue().catch(() => {}), 1500)
}

export const __firestoreReadTracker = {
  hashString,
  usageDayAndHour,
  flushUsage,
}
