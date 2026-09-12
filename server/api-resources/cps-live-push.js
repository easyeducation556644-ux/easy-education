import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import { getAdminServices } from "./utils/firebase-admin.js"

const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const PAGE_SIZE = 100
const MAX_PAGES = 20
const MAX_TOKENS_PER_MESSAGE = 500
const TOKEN_PATTERN = /^[A-Za-z0-9_:\-\.]{20,4096}$/
const LIVE_GRACE_MS = 6 * 60 * 60 * 1000
const LEASE_MS = 4 * 60 * 1000
const LIVE_STATUSES = new Set(["live", "ongoing", "started", "active", "running", "live_now", "live now"])
const ENDED_STATUSES = new Set(["ended", "completed", "finished", "cancelled", "canceled", "recorded"])

function text(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function normalizeCourseId(value) {
  return String(value || "").trim().replace(/^cps:/, "")
}

function liveCourseId(live) {
  return normalizeCourseId(text(
    live?.courseId,
    live?.courseID,
    live?.course,
    live?.batchId,
    live?.batchID,
  ))
}

function liveUrl(live) {
  return text(
    live?.url,
    live?.liveUrl,
    live?.liveURL,
    live?.joinUrl,
    live?.joinURL,
    live?.meetingUrl,
    live?.meetingURL,
    live?.link,
  )
}

function liveStartTime(live) {
  return text(live?.startTime, live?.startAt, live?.scheduledAt, live?.dateTime, live?.date)
}

function activeEntitlement(data, now = Date.now()) {
  if (!data || String(data.status || "").toLowerCase() === "revoked") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > now
}

function isLiveNow(live, now = Date.now()) {
  const url = liveUrl(live)
  if (!/^https?:\/\//i.test(url)) return false
  const status = text(live?.status, live?.liveStatus).toLowerCase()
  if (ENDED_STATUSES.has(status)) return false
  if (LIVE_STATUSES.has(status)) return true

  const startMs = Date.parse(liveStartTime(live))
  return Number.isFinite(startMs) && startMs <= now && now - startMs <= LIVE_GRACE_MS
}

function decodeValue(value = {}) {
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue)
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue)
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue)
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue)
  if (value.mapValue) return decodeFields(value.mapValue.fields || {})
  if (value.referenceValue) return value.referenceValue
  return null
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function decodeDocument(raw) {
  if (!raw?.name) return null
  return { id: String(raw.name).split("/").pop(), ...decodeFields(raw.fields || {}) }
}

async function queryPage(collectionId, token, offset) {
  const url = new URL(`${CPS_ROOT}:runQuery`)
  url.searchParams.set("key", CPS_API_KEY)
  const headers = { "Content-Type": "application/json", Accept: "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        limit: PAGE_SIZE,
        ...(offset ? { offset } : {}),
      },
    }),
    redirect: "follow",
  })
}

async function readCpsCollection(collectionId) {
  const docs = []
  const sourceToken = String(process.env.CPS_FIREBASE_ID_TOKEN || "").replace(/^Bearer\s+/i, "").trim()

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    let response = await queryPage(collectionId, sourceToken, offset)
    if (sourceToken && (response.status === 401 || response.status === 403)) {
      response = await queryPage(collectionId, "", offset)
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`CPS ${collectionId} read failed (${response.status}): ${detail.slice(0, 180)}`)
    }
    const payload = await response.json()
    const batch = Array.isArray(payload)
      ? payload.map((entry) => decodeDocument(entry?.document)).filter(Boolean)
      : []
    docs.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return docs
}

function validAutomationSecret(req) {
  const expected = String(process.env.AUTOMATION_SECRET || "")
  return Boolean(expected) && String(req.headers?.authorization || "") === `Bearer ${expected}`
}

function stateId(courseId, liveId) {
  return createHash("sha256").update(`${courseId}:${liveId}`).digest("hex").slice(0, 40)
}

async function claimLive(db, courseId, live) {
  const ref = db.collection("cpsLivePushState").doc(stateId(courseId, live.id))
  const now = Date.now()
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() || {} : {}
    if (Number(data.notifiedAtMs || 0) > 0) return { claimed: false, ref }
    if (Number(data.leaseUntilMs || 0) > now) return { claimed: false, ref }
    tx.set(ref, {
      courseId,
      liveId: String(live.id || ""),
      liveTitle: text(live?.title, live?.topic, live?.name) || "Live class",
      startTime: liveStartTime(live),
      status: text(live?.status, live?.liveStatus) || "upcoming",
      leaseUntilMs: now + LEASE_MS,
      lastCheckedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { claimed: true, ref }
  })
}

async function eligibleUsersForCourse(db, courseId) {
  const [byCpsCourse, byCourse] = await Promise.all([
    db.collection("cpsEntitlements").where("cpsCourseId", "==", courseId).get(),
    db.collection("cpsEntitlements").where("courseId", "==", courseId).get(),
  ])
  const now = Date.now()
  const users = new Set()
  ;[...byCpsCourse.docs, ...byCourse.docs].forEach((doc) => {
    const data = doc.data() || {}
    if (!activeEntitlement(data, now)) return
    const uid = text(data.userId)
    if (uid) users.add(uid)
  })
  return [...users]
}

async function subscriptionTokens(db, userIds) {
  const tokenOwners = new Map()
  for (let index = 0; index < userIds.length; index += 250) {
    const ids = userIds.slice(index, index + 250)
    const refs = ids.map((uid) => db.collection("pushSubscriptions").doc(uid))
    const snapshots = refs.length ? await db.getAll(...refs) : []
    snapshots.forEach((snapshot) => {
      if (!snapshot.exists) return
      const tokens = Array.isArray(snapshot.data()?.tokens) ? snapshot.data().tokens : []
      tokens.forEach((token) => {
        const normalized = String(token || "")
        if (TOKEN_PATTERN.test(normalized)) tokenOwners.set(normalized, snapshot.id)
      })
    })
  }
  return tokenOwners
}

async function sendInChunks(messaging, tokens, data) {
  let successCount = 0
  let failureCount = 0
  const invalidTokens = []
  const failureCodes = {}

  for (let index = 0; index < tokens.length; index += MAX_TOKENS_PER_MESSAGE) {
    const chunk = tokens.slice(index, index + MAX_TOKENS_PER_MESSAGE)
    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      data,
      android: { priority: "high" },
    })
    successCount += response.successCount
    failureCount += response.failureCount
    response.responses.forEach((result, responseIndex) => {
      if (result.success) return
      const code = result.error?.code || "messaging/unknown"
      failureCodes[code] = (failureCodes[code] || 0) + 1
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token") ||
        code.includes("invalid-argument")
      ) invalidTokens.push(chunk[responseIndex])
    })
  }

  return { successCount, failureCount, invalidTokens, failureCodes }
}

async function removeInvalidTokens(db, tokenOwners, invalidTokens) {
  const removals = new Map()
  invalidTokens.forEach((token) => {
    const uid = tokenOwners.get(token)
    if (!uid) return
    if (!removals.has(uid)) removals.set(uid, [])
    removals.get(uid).push(token)
  })
  await Promise.all([...removals.entries()].map(([uid, staleTokens]) =>
    db.collection("pushSubscriptions").doc(uid).set({
      tokens: FieldValue.arrayRemove(...staleTokens),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ))
}

export async function runCpsLivePushSweep() {
  const { app, db } = getAdminServices()
  const [liveClasses, courses] = await Promise.all([
    readCpsCollection("live_classes"),
    readCpsCollection("courses"),
  ])
  const courseTitles = new Map(courses.map((course) => [
    String(course.id || ""),
    text(course?.title, course?.name) || "CPS Course",
  ]))
  const now = Date.now()
  const activeLives = liveClasses.filter((live) => live?.id && liveCourseId(live) && isLiveNow(live, now))
  const messaging = getMessaging(app)
  const summary = {
    scanned: liveClasses.length,
    active: activeLives.length,
    claimed: 0,
    eligibleUsers: 0,
    registeredDevices: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
  }

  for (const live of activeLives) {
    const courseId = liveCourseId(live)
    const claim = await claimLive(db, courseId, live)
    if (!claim.claimed) {
      summary.skipped += 1
      continue
    }
    summary.claimed += 1

    try {
      const userIds = await eligibleUsersForCourse(db, courseId)
      summary.eligibleUsers += userIds.length
      const tokenOwners = await subscriptionTokens(db, userIds)
      const tokens = [...tokenOwners.keys()]
      summary.registeredDevices += tokens.length

      if (tokens.length === 0) {
        await claim.ref.set({
          leaseUntilMs: 0,
          lastCheckedAt: FieldValue.serverTimestamp(),
          lastResult: "no-registered-devices",
        }, { merge: true })
        continue
      }

      const liveTitle = text(live?.title, live?.topic, live?.name) || "Live class"
      const courseTitle = courseTitles.get(courseId) || "CPS Course"
      const result = await sendInChunks(messaging, tokens, {
        type: "cps_live_started",
        liveId: String(live.id || ""),
        classId: String(live.id || ""),
        liveTitle,
        title: liveTitle,
        courseId,
        courseTitle,
        liveUrl: liveUrl(live),
        startTime: liveStartTime(live),
        status: text(live?.status, live?.liveStatus) || "live",
      })

      summary.delivered += result.successCount
      summary.failed += result.failureCount
      if (result.invalidTokens.length) await removeInvalidTokens(db, tokenOwners, result.invalidTokens)

      await claim.ref.set({
        leaseUntilMs: result.successCount > 0 ? Number.MAX_SAFE_INTEGER : 0,
        notifiedAtMs: result.successCount > 0 ? Date.now() : 0,
        notifiedAt: result.successCount > 0 ? FieldValue.serverTimestamp() : null,
        delivered: result.successCount,
        failed: result.failureCount,
        failureCodes: result.failureCodes,
        lastResult: result.successCount > 0 ? "sent" : "failed",
        lastCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      await claim.ref.set({
        leaseUntilMs: 0,
        lastResult: "error",
        lastError: String(error?.message || error).slice(0, 300),
        lastCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {})
      throw error
    }
  }

  return summary
}

export default async function cpsLivePushHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  if (!validAutomationSecret(req)) return res.status(401).json({ success: false, error: "Invalid automation secret" })

  try {
    const summary = await runCpsLivePushSweep()
    return res.status(200).json({ success: true, ...summary })
  } catch (error) {
    console.error("CPS live push sweep failed:", error)
    return res.status(500).json({ success: false, error: error?.message || "CPS live push sweep failed" })
  }
}
