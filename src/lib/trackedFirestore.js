import * as firestore from "firebase/firestore"
import { getAuth } from "firebase/auth"

export * from "firebase/firestore"

const pending = new Map()
let flushInFlight = null

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

export function runTransaction(db, updateFunction, options) {
  return firestore.runTransaction(
    db,
    async (transaction) => {
      const trackedTransaction = new Proxy(transaction, {
        get(target, prop, receiver) {
          if (prop === "get") {
            return async (ref) => {
              const snapshot = await target.get(ref)
              queueRead({ operation: "transaction.get", source: describeSource(ref), reads: 1 })
              return snapshot
            }
          }
          const value = Reflect.get(target, prop, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      return updateFunction(trackedTransaction)
    },
    options,
  )
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
}

export const __firestoreReadTracker = {
  hashString,
  usageDayAndHour,
  flushUsage,
}
