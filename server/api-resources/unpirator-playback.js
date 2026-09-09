import { getAdminServices, requireVerifiedUser } from "../../api/utils/firebase-admin.js"

function sendError(res, status, message, code = "PLAYBACK_FAILED") {
  return res.status(status).json({ error: { code, message } })
}

function assertSameOrigin(req) {
  const origin = String(req.headers?.origin || "").trim()
  if (!origin) return

  const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").split(",")[0].trim()
  const host = forwardedHost || String(req.headers?.host || "").trim()
  if (!host) return

  let originHost = ""
  try {
    originHost = new URL(origin).host
  } catch {
    const error = new Error("Invalid request origin")
    error.statusCode = 403
    throw error
  }

  if (originHost !== host) {
    const error = new Error("Cross-site request rejected")
    error.statusCode = 403
    throw error
  }
}

function isYoutubeUrl(value) {
  const raw = String(value || "").trim()
  if (!raw || raw.length > 2048) return false

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "")
    if (host === "youtu.be") return Boolean(url.pathname.split("/").filter(Boolean)[0])
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return false
    return (url.pathname === "/watch" && Boolean(url.searchParams.get("v")))
      || /^\/(embed|shorts|live)\/[^/]+/i.test(url.pathname)
  } catch {
    return false
  }
}

function normalizeClient(value) {
  const raw = value && typeof value === "object" ? value : {}
  const browser = String(raw.browser || "").trim().slice(0, 100)
  const os = String(raw.os || "").trim().slice(0, 100)
  return {
    ...(browser ? { browser } : {}),
    ...(os ? { os } : {}),
  }
}

async function hasCourseAccess(db, uid, sourceUrl) {
  const userSnapshot = await db.collection("users").doc(uid).get()
  if (userSnapshot.exists && userSnapshot.data()?.role === "admin") return true

  const classesSnapshot = await db.collection("classes")
    .where("videoURL", "==", sourceUrl)
    .limit(10)
    .get()
  if (classesSnapshot.empty) return false

  const courseIds = [...new Set(classesSnapshot.docs.map((item) => item.data()?.courseId).filter(Boolean))]
  for (const courseId of courseIds) {
    const enrollment = await db.collection("userCourses").doc(`${uid}_${courseId}`).get()
    if (enrollment.exists) return true
  }

  const payments = await db.collection("payments")
    .where("userId", "==", uid)
    .where("status", "==", "approved")
    .get()
  return payments.docs.some((item) => {
    const courses = item.data()?.courses
    return Array.isArray(courses) && courses.some((entry) => courseIds.includes(entry?.id))
  })
}

function hasBearerToken(req) {
  return /^Bearer\s+\S+/i.test(String(req.headers?.authorization || "").trim())
}

export default async function unpiratorPlaybackHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED")
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  res.setHeader("CDN-Cache-Control", "no-store")
  res.setHeader("Vercel-CDN-Cache-Control", "no-store")

  try {
    assertSameOrigin(req)

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {})
    if (
      body.currentUser !== undefined
      || body.userId !== undefined
      || body.externalUserId !== undefined
      || body.apiKey !== undefined
    ) {
      return sendError(res, 400, "Viewer identity and API credentials cannot be supplied by the browser", "INVALID_REQUEST")
    }
    if (body.assetId) {
      return sendError(res, 400, "This Easy Education route currently accepts YouTube sources only", "INVALID_SOURCE")
    }

    const sourceUrl = String(body.src || "").trim()
    if (!isYoutubeUrl(sourceUrl)) {
      return sendError(res, 400, "A valid YouTube URL is required", "INVALID_YOUTUBE_URL")
    }

    let viewer
    try {
      viewer = await requireVerifiedUser(req)
    } catch {
      const bearerPresent = hasBearerToken(req)
      return sendError(
        res,
        401,
        bearerPresent ? "Invalid or expired authentication token" : "Sign in required",
        bearerPresent ? "AUTH_INVALID" : "AUTH_REQUIRED",
      )
    }

    const { db } = getAdminServices()
    if (!(await hasCourseAccess(db, viewer.uid, sourceUrl))) {
      return sendError(res, 403, "You do not have access to this lesson", "ACCESS_DENIED")
    }

    const apiUrl = String(process.env.UNPIRATOR_API_URL || "").replace(/\/$/, "")
    const apiKey = String(process.env.UNPIRATOR_API_KEY || "")
    const siteId = String(process.env.UNPIRATOR_SITE_ID || "")
    if (!apiUrl || !apiKey || !siteId) {
      return sendError(res, 503, "Protected playback is not configured", "UNPIRATOR_NOT_CONFIGURED")
    }

    const title = String(body.title || "").trim().slice(0, 240)
    const deviceId = String(body.deviceId || "").trim().slice(0, 160)
    if (!deviceId) return sendError(res, 400, "Device ID is required", "DEVICE_ID_REQUIRED")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let upstream
    try {
      upstream = await fetch(`${apiUrl}/v1/playback/sessions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          siteId,
          source: {
            provider: "youtube_custom",
            url: sourceUrl,
            ...(title ? { title } : {}),
          },
          externalUserId: viewer.uid,
          displayLabel: viewer.email || viewer.uid,
          deviceId,
          client: normalizeClient(body.client),
        }),
      })
    } finally {
      clearTimeout(timeout)
    }

    const payload = await upstream.json().catch(() => ({}))
    return res.status(upstream.status).json(payload)
  } catch (error) {
    if (error?.name === "AbortError") {
      return sendError(res, 504, "Protected playback service timed out", "UNPIRATOR_TIMEOUT")
    }
    const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) <= 599
      ? Number(error.statusCode)
      : 500
    return sendError(
      res,
      status,
      status === 403 ? error.message : "Unable to start protected playback",
    )
  }
}
