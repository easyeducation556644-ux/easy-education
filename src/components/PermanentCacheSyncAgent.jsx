import { useEffect, useRef } from "react"
import { doc, onSnapshot } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import {
  hasSeenPermanentCollection,
  syncChangedDocument,
} from "../lib/nativeCachedFirestore"

const PUBLIC_SEQ_KEY = "ee_content_sync_seq_v1"
const USER_SEQ_PREFIX = "ee_user_sync_seq_v1:"

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

async function applyFeed(feed, storageKey) {
  if (!feed || !Array.isArray(feed.events)) return
  const feedSeq = Number(feed.seq || 0)
  let lastSeq = readSeq(storageKey)

  // If this device first sees an already-populated feed, its v3 permanent queries
  // have not been established yet, so baseline to current and let each query load once.
  // If it previously saw an empty feed, storageKey is already 0 and the first event runs.
  if (lastSeq === null) {
    writeSeq(storageKey, feedSeq)
    return
  }

  const pending = feed.events
    .filter((event) => Number(event?.seq || 0) > lastSeq)
    .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))

  for (const event of pending) {
    const seq = Number(event?.seq || 0)
    const collection = String(event?.collection || "")
    const docId = String(event?.docId || "")

    if (collection && docId && hasSeenPermanentCollection(collection)) {
      try {
        await syncChangedDocument(collection, docId)
        window.dispatchEvent(new CustomEvent("easy-education-cache-updated", {
          detail: {
            collection,
            docId,
            action: event?.action || "changed",
            seq,
          },
        }))
      } catch (error) {
        console.warn("Targeted permanent-cache sync failed:", collection, docId, error)
        break
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
      const feed = snapshot.data()
      publicWork.current = publicWork.current
        .then(() => applyFeed(feed, PUBLIC_SEQ_KEY))
        .catch((error) => console.warn("Public cache sync failed:", error))
    }, (error) => {
      console.warn("Public content sync listener unavailable:", error)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!currentUser?.uid) return
    const key = `${USER_SEQ_PREFIX}${currentUser.uid}`
    if (!userProfile?.syncFeed) {
      if (readSeq(key) === null) writeSeq(key, 0)
      return
    }

    userWork.current = userWork.current
      .then(() => applyFeed(userProfile.syncFeed, key))
      .catch((error) => console.warn("User cache sync failed:", error))
  }, [currentUser?.uid, userProfile?.syncFeed])

  return null
}
