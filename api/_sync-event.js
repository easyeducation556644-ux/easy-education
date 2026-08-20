import {
  isFullAdminProfile,
  profileHasAdminPage,
  profileHasUserAction,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"

const PUBLIC_COLLECTIONS = new Set([
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

const USER_COLLECTIONS = new Set([
  "payments",
  "userCourses",
  "watched",
  "userProgress",
  "votes",
  "examResults",
  "examAttempts",
  "cqSubmissions",
])

const PUBLIC_COLLECTION_PAGE = {
  courses: "courses",
  classes: "classes",
  subjects: "subjects",
  chapters: "chapters",
  settings: "settings",
  categories: "categories",
  teachers: "teachers",
  announcements: "announcements",
  exams: "exams",
  examQuestions: "exams",
}

const FEED_LIMIT = 1000
const ID_PATTERN = /^[A-Za-z0-9_:-]{1,220}$/

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message })
}

function normalizeEvent(body = {}) {
  const collection = String(body.collection || "").trim()
  const docId = String(body.docId || "").trim()
  const eventId = String(body.eventId || "").trim()
  const action = body.action === "deleted" ? "deleted" : "changed"
  const requestedUserId = String(body.userId || "").trim()

  if (!PUBLIC_COLLECTIONS.has(collection) && !USER_COLLECTIONS.has(collection)) {
    const error = new Error("Collection is not enabled for targeted sync")
    error.statusCode = 400
    throw error
  }
  if (!ID_PATTERN.test(docId) || !ID_PATTERN.test(eventId)) {
    const error = new Error("Invalid sync event identifier")
    error.statusCode = 400
    throw error
  }

  return { collection, docId, eventId, action, requestedUserId }
}

function appendToFeed(currentFeed, event) {
  const currentSeq = Number(currentFeed?.seq || 0)
  const currentEvents = Array.isArray(currentFeed?.events) ? currentFeed.events : []
  if (currentEvents.some((item) => item?.eventId === event.eventId)) {
    return { duplicate: true, feed: currentFeed || { seq: currentSeq, events: currentEvents } }
  }

  const nextSeq = currentSeq + 1
  const nextEvent = { ...event, seq: nextSeq, createdAt: Date.now() }
  return {
    duplicate: false,
    feed: {
      seq: nextSeq,
      events: [...currentEvents, nextEvent].slice(-FEED_LIMIT),
      updatedAt: Date.now(),
    },
  }
}

function appendManyToFeed(currentFeed, events) {
  let feed = currentFeed || { seq: 0, events: [] }
  let added = 0
  for (const event of events) {
    const result = appendToFeed(feed, event)
    feed = result.feed
    if (!result.duplicate) added += 1
  }
  return { feed, added }
}

function serverEventId(collection, docId, nonce = "") {
  const suffix = nonce || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${collection}:${String(docId).slice(0, 100)}:${suffix}`.slice(0, 220)
}

export async function publishServerUserSyncEvents({ db, userId, events, nonce = "" }) {
  const normalizedUserId = String(userId || "").trim()
  if (!normalizedUserId || !Array.isArray(events) || events.length === 0) return { added: 0 }

  const normalizedEvents = events
    .map((event, index) => {
      const collection = String(event?.collection || "").trim()
      const docId = String(event?.docId || "").trim()
      if (!USER_COLLECTIONS.has(collection) || !ID_PATTERN.test(docId)) return null
      return {
        eventId: String(event?.eventId || serverEventId(collection, docId, `${nonce || Date.now().toString(36)}-${index}`)),
        collection,
        docId,
        action: event?.action === "deleted" ? "deleted" : "changed",
        scope: "user",
      }
    })
    .filter(Boolean)

  if (normalizedEvents.length === 0) return { added: 0 }

  const ref = db.collection("users").doc(normalizedUserId)
  let added = 0
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return
    const result = appendManyToFeed(snapshot.data()?.syncFeed, normalizedEvents)
    added = result.added
    if (added > 0) transaction.update(ref, { syncFeed: result.feed })
  })

  return { added }
}

export async function publishEnrollmentSync({ db, userId, transactionId, enrolledCourseIds = [] }) {
  if (!db || !userId) return { added: 0 }

  const events = []
  const transaction = String(transactionId || "").trim()
  if (transaction) {
    const paymentSnapshot = await db
      .collection("payments")
      .where("transactionId", "==", transaction)
      .limit(1)
      .get()
    if (!paymentSnapshot.empty) events.push({ collection: "payments", docId: paymentSnapshot.docs[0].id })
  }

  for (const courseId of [...new Set(enrolledCourseIds.filter(Boolean))]) {
    events.push({ collection: "userCourses", docId: `${userId}_${courseId}` })
  }

  return publishServerUserSyncEvents({
    db,
    userId,
    events,
    nonce: `enrollment-${transaction || Date.now().toString(36)}`,
  })
}

async function resolveUserId({ db, event, callerUid, isAdmin }) {
  if (!isAdmin) return callerUid
  if (event.requestedUserId) return event.requestedUserId
  if (event.action === "deleted") return ""

  const snapshot = await db.collection(event.collection).doc(event.docId).get()
  const data = snapshot.exists ? snapshot.data() : null
  return String(data?.userId || data?.uid || "").trim()
}

export async function publishTargetedSyncEvent({ db, event, callerUid, isAdmin }) {
  if (PUBLIC_COLLECTIONS.has(event.collection)) {
    if (!isAdmin) {
      const error = new Error("Admin access is required for public-content sync")
      error.statusCode = 403
      throw error
    }

    const ref = db.collection("settings").doc("contentSync")
    let duplicate = false
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const result = appendToFeed(snapshot.exists ? snapshot.data() : null, {
        eventId: event.eventId,
        collection: event.collection,
        docId: event.docId,
        action: event.action,
        scope: "public",
      })
      duplicate = result.duplicate
      if (!duplicate) transaction.set(ref, { type: "content-sync", ...result.feed }, { merge: true })
    })
    return { scope: "public", duplicate }
  }

  const userId = await resolveUserId({ db, event, callerUid, isAdmin })
  if (!userId) {
    const error = new Error("Unable to resolve the affected user for sync")
    error.statusCode = 422
    throw error
  }
  if (!isAdmin && userId !== callerUid) {
    const error = new Error("Cannot publish sync for another user")
    error.statusCode = 403
    throw error
  }

  const ref = db.collection("users").doc(userId)
  let duplicate = false
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) {
      const error = new Error("Affected user does not exist")
      error.statusCode = 404
      throw error
    }
    const result = appendToFeed(snapshot.data()?.syncFeed, {
      eventId: event.eventId,
      collection: event.collection,
      docId: event.docId,
      action: event.action,
      scope: "user",
    })
    duplicate = result.duplicate
    if (!duplicate) transaction.update(ref, { syncFeed: result.feed })
  })

  return { scope: "user", userId, duplicate }
}

function canPublishPublicEvent(userProfile, event) {
  if (isFullAdminProfile(userProfile)) return true
  const page = PUBLIC_COLLECTION_PAGE[event.collection]
  return Boolean(page && profileHasAdminPage(userProfile, page))
}

function canPublishUserEvent(userProfile, event) {
  if (isFullAdminProfile(userProfile)) return true
  if (event.collection === "payments" || event.collection === "userCourses") {
    return profileHasAdminPage(userProfile, "payments")
      || profileHasUserAction(userProfile, "grantCourseAccess")
      || profileHasUserAction(userProfile, "manageCourseAccess")
  }
  if (event.collection === "examResults" || event.collection === "cqSubmissions" || event.collection === "examAttempts") {
    return profileHasAdminPage(userProfile, "examResults")
      || profileHasAdminPage(userProfile, "examSubmissions")
  }
  return false
}

export default async function syncEventHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return sendError(res, 405, "Method not allowed")
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0")

  try {
    const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
    const event = normalizeEvent(req.body || {})
    const elevated = PUBLIC_COLLECTIONS.has(event.collection)
      ? canPublishPublicEvent(userProfile, event)
      : canPublishUserEvent(userProfile, event)
    const result = await publishTargetedSyncEvent({
      db,
      event,
      callerUid: decodedToken.uid,
      isAdmin: elevated,
    })
    return res.status(200).json({ success: true, ...result })
  } catch (error) {
    return sendError(res, error?.statusCode || 500, error?.message || "Sync event failed")
  }
}
