import { createHash } from "node:crypto"
import {
  FieldPath,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore"
import {
  isFullAdminProfile,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"

const ALLOWED_EVENT_TYPES = new Set([
  "devtools_shortcut",
  "view_source_shortcut",
  "devtools_size_heuristic",
  "video_context_menu",
])

const MAX_PAGE_SIZE = 50
const DEDUPE_WINDOW_MS = 5 * 60 * 1000

const cleanText = (value, maxLength = 300) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : ""

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"]
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0].trim().slice(0, 80)
  }
  return cleanText(req.headers["x-real-ip"], 80)
}

function encodeCursor(snapshot) {
  if (!snapshot) return null
  const timestamp = snapshot.get("lastDetectedAt")
  if (!timestamp?.toMillis) return null

  return Buffer.from(
    JSON.stringify({
      timestamp: timestamp.toMillis(),
      id: snapshot.id,
    }),
  ).toString("base64url")
}

function decodeCursor(cursor) {
  if (!cursor) return null

  try {
    const parsed = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8"),
    )
    if (!Number.isFinite(parsed.timestamp) || !parsed.id) return null
    return parsed
  } catch {
    return null
  }
}

function serializeEvent(snapshot) {
  const data = snapshot.data()
  const toISOString = (value) =>
    value?.toDate ? value.toDate().toISOString() : null

  return {
    id: snapshot.id,
    ...data,
    firstDetectedAt: toISOString(data.firstDetectedAt),
    lastDetectedAt: toISOString(data.lastDetectedAt),
  }
}

async function createSecurityEvent(req, res) {
  const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
  const eventType = cleanText(req.body?.eventType, 60)

  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported security event type",
    })
  }

  const route = cleanText(req.body?.route, 500) || "/"
  const detectionMethod = cleanText(req.body?.detectionMethod, 120)
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS)
  const eventId = createHash("sha256")
    .update(`${decodedToken.uid}|${eventType}|${route}|${bucket}`)
    .digest("hex")
    .slice(0, 40)
  const eventRef = db.collection("securityEvents").doc(eventId)

  const details = req.body?.details || {}
  const safeDetails = {
    shortcut: cleanText(details.shortcut, 80),
    widthGap: Number.isFinite(details.widthGap) ? details.widthGap : null,
    heightGap: Number.isFinite(details.heightGap) ? details.heightGap : null,
    viewport: cleanText(details.viewport, 50),
    screen: cleanText(details.screen, 50),
  }

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(eventRef)
    const commonData = {
      userId: decodedToken.uid,
      userName: cleanText(
        userProfile?.name || decodedToken.name || "Unknown User",
        160,
      ),
      userEmail: cleanText(
        userProfile?.email || decodedToken.email || "",
        200,
      ),
      userRole: cleanText(userProfile?.role || "user", 80),
      eventType,
      detectionMethod,
      route,
      ipAddress: getClientIp(req),
      userAgent: cleanText(req.headers["user-agent"], 600),
      platform: cleanText(req.body?.platform, 120),
      timezone: cleanText(req.body?.timezone, 100),
      details: safeDetails,
      lastDetectedAt: FieldValue.serverTimestamp(),
    }

    if (existing.exists) {
      transaction.update(eventRef, {
        ...commonData,
        hitCount: FieldValue.increment(1),
      })
    } else {
      transaction.create(eventRef, {
        ...commonData,
        hitCount: 1,
        firstDetectedAt: FieldValue.serverTimestamp(),
      })
    }
  })

  return res.status(201).json({ success: true })
}

async function listSecurityEvents(req, res) {
  const { userProfile, db } = await requireAuthenticatedUser(req)

  if (!isFullAdminProfile(userProfile)) {
    return res.status(403).json({
      success: false,
      error: "Full admin access required",
    })
  }

  const requestedLimit = Number.parseInt(req.query?.limit, 10)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10),
  )
  const cursor = decodeCursor(req.query?.cursor)

  let eventsQuery = db
    .collection("securityEvents")
    .orderBy("lastDetectedAt", "desc")
    .orderBy(FieldPath.documentId())

  if (cursor) {
    eventsQuery = eventsQuery.startAfter(
      Timestamp.fromMillis(cursor.timestamp),
      cursor.id,
    )
  }

  const snapshot = await eventsQuery.limit(pageSize + 1).get()
  const pageDocs = snapshot.docs.slice(0, pageSize)
  const hasMore = snapshot.docs.length > pageSize

  return res.status(200).json({
    success: true,
    events: pageDocs.map(serializeEvent),
    nextCursor: hasMore
      ? encodeCursor(pageDocs[pageDocs.length - 1])
      : null,
  })
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")

  try {
    if (req.method === "POST") {
      return await createSecurityEvent(req, res)
    }

    if (req.method === "GET") {
      return await listSecurityEvents(req, res)
    }

    res.setHeader("Allow", ["GET", "POST"])
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed",
    })
  } catch (error) {
    console.error("Security events API error:", error)
    return res.status(error.statusCode || 500).json({
      success: false,
      error:
        error.statusCode === 401
          ? "Authentication required"
          : "Unable to process security event",
    })
  }
}
