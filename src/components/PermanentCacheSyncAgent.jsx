import { useEffect, useRef } from "react"
import { doc, onSnapshot } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import {
  CACHE_V2_PUBLIC_COLLECTIONS,
  CACHE_V2_USER_COLLECTIONS,
  hasAnySeenCacheV2Collection,
  hasSeenCacheV2Collection,
  invalidateCacheV2Collections,
  syncChangedDocument,
} from "../lib/cacheV2Firestore"

const PUBLIC_SEQ_KEY = "ee_content_sync_seq_v2"
const USER_SEQ_PREFIX = "ee_user_sync_seq_v2:"
const ACTIVE_USER_KEY = "ee_cache_v2_active_user"
const CACHE_EVENT = "easy-education-cache-updated"

function readSeq(key) {
  if (typeof localStorage === "undefined") return null
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function writeSeq(key, value) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(key, String(Math.max(0, Number(value) || 0)))
}

function sortedEvents(feed) {
  if (!Array.isArray(feed?.events)) return []
  return feed.events
    .filter((event) => Number.isFinite(Number(event?.seq)))
    .sort((a, b) => Number(a.seq) - Number(b.seq))
}

function dispatchCacheUpdate(event) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CACHE_EVENT, {
    detail: {
      collection: String(event?.collection || ""),
      docId: String(event?.docId || ""),
      action: event?.action === "deleted" ? "deleted" : "changed",
      seq: Number(event?.seq || 0),
      targeted: true,
    },
  }))
}

async function applyFeed(feed, storageKey, scopeCollections) {
  if (!feed) return
  const feedSeq = Math.max(0, Number(feed.seq || 0))
  const events = sortedEvents(feed)
  let lastSeq = readSeq(storageKey)

  // Fresh Cache V2 installations have no trusted v4 query markers. Baseline the
  // tiny feed and let each query/document perform exactly one server prime when
  // it is first needed. We never baseline an already-trusted cache silently.
  if (lastSeq === null && !hasAnySeenCacheV2Collection(scopeCollections)) {
    writeSeq(storageKey, feedSeq)
    return
  }

  if (lastSeq === null) lastSeq = 0

  // Feed reset or event truncation means continuity cannot be proven. In that
  // exceptional case drop only this scope's trust markers; active listeners
  // server-prime again and then resume changed-document sync.
  if (feedSeq < lastSeq) {
    invalidateCacheV2Collections(scopeCollections, "sync-sequence-reset")
    writeSeq(storageKey, feedSeq)
    return
  }

  if (feedSeq === lastSeq) return

  const pending = events.filter((event) => Number(event.seq) > lastSeq)
  if (pending.length === 0 || Number(pending[0].seq) !== lastSeq + 1) {
    invalidateCacheV2Collections(scopeCollections, "sync-sequence-gap")
    writeSeq(storageKey, feedSeq)
    return
  }

  for (const event of pending) {
    const seq = Number(event.seq || 0)
    if (seq !== lastSeq + 1) {
      invalidateCacheV2Collections(scopeCollections, "sync-sequence-gap")
      writeSeq(storageKey, feedSeq)
      return
    }

    const collection = String(event?.collection || "")
    const docId = String(event?.docId || "")

    if (collection && docId && scopeCollections.has(collection) && hasSeenCacheV2Collection(collection)) {
      try {
        // Exactly one server document read updates Firestore's persistent cache.
        // Cache-only parent queries then re-evaluate locally from that changed doc.
        await syncChangedDocument(collection, docId)
        dispatchCacheUpdate(event)
      } catch (error) {
        console.warn("Targeted Cache V2 sync failed:", collection, docId, error)
        return
      }
    }

    lastSeq = seq
    writeSeq(storageKey, lastSeq)
  }
}

export default function PermanentCacheSyncAgent() {
  const { currentUser, userProfile } = useAuth()
  const publicWork = useRef(Promise.resolve())
  const userWork = useRef(Promise.resolve())

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => false)

    const syncRef = doc(db, "settings", "contentSync")
    const unsubscribe = onSnapshot(syncRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (readSeq(PUBLIC_SEQ_KEY) === null) writeSeq(PUBLIC_SEQ_KEY, 0)
        return
      }
      publicWork.current = publicWork.current
        .then(() => applyFeed(snapshot.data(), PUBLIC_SEQ_KEY, CACHE_V2_PUBLIC_COLLECTIONS))
        .catch((error) => console.warn("Public Cache V2 sync failed:", error))
    }, (error) => {
      console.warn("Public content sync listener unavailable:", error)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const uid = currentUser?.uid || ""
    let previousUid = ""
    try {
      previousUid = localStorage.getItem(ACTIVE_USER_KEY) || ""
      if (previousUid !== uid) {
        invalidateCacheV2Collections(CACHE_V2_USER_COLLECTIONS, "auth-user-changed")
        if (uid) localStorage.setItem(ACTIVE_USER_KEY, uid)
        else localStorage.removeItem(ACTIVE_USER_KEY)
      }
    } catch (_) {
      // Ignore storage failures.
    }

    if (!uid) return

    const key = `${USER_SEQ_PREFIX}${uid}`
    if (!userProfile?.syncFeed) {
      if (readSeq(key) === null) writeSeq(key, 0)
      return
    }

    userWork.current = userWork.current
      .then(() => applyFeed(userProfile.syncFeed, key, CACHE_V2_USER_COLLECTIONS))
      .catch((error) => console.warn("User Cache V2 sync failed:", error))
  }, [currentUser?.uid, userProfile?.syncFeed])

  return null
}
