import { requireVerifiedUser } from "../../api/utils/firebase-admin.js"

const RESPONSE_FIELDS = [
  "sessionId",
  "playbackUrl",
  "token",
  "tokenExpiresIn",
  "refreshUrl",
  "mode",
  "sessionExpiresAt",
  "watermark",
]

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

function normalizeYoutubeUrl(value) {
  const raw = String(value || "").trim()
  if (!raw || raw.length > 2048) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null

    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "")
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ? url.toString() : null
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null

    if (url.pathname === "/watch" && url.searchParams.get("v")) return url.toString()
    if (/^\/(embed|shorts|live)\/[^/]+/i.test(url.pathname)) return url.toString()
    return null
  } catch {
    return null
  }
}

function allowlistedSession(payload) {
  const output = {}
  for (const key of RESPONSE_FIELDS) {
    if (payload?.[key] !== undefined) output[key] = payload[key]
  }
  return output
}

export default async function unpiratorPlaybackHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED")
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  res.setHeader("CDN-Cache-Control", "no-store")
  res.setHeader("Vercel-CDN-Cache-Control", "no-store")
  res.setHeader("Vary", "Authorization")

  try {
    assertSameOrigin(req)
    const viewer = await requireVerifiedUser(req)

    const apiUrl = String(process.env.UNPIRATOR_API_URL || "").replace(/\/$/, "")
    const apiKey = String(process.env.UNPIRATOR_API_KEY || "")
    const siteId = String(process.env.UNPIRATOR_SITE_ID || "")
    if (!apiUrl || !apiKey || !siteId) {
      return sendError(res, 503, "Protected playback is not configured", "UNPIRATOR_NOT_CONFIGURED")
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {})
    if (body.userId !== undefined || body.externalUserId !== undefined) {
      return sendError(res, 400, "Viewer identity cannot be supplied by the browser", "INVALID_VIEWER")
    }

    const youtubeUrl = normalizeYoutubeUrl(body.youtubeUrl)
    if (!youtubeUrl) {
      return sendError(res, 400, "A valid YouTube URL is required", "INVALID_YOUTUBE_URL")
    }

    const title = String(body.title || "").trim().slice(0, 240)
    const deviceId = String(body.deviceId || "").trim().slice(0, 160)
    if (!deviceId) {
      return sendError(res, 400, "Device ID is required", "DEVICE_ID_REQUIRED")
    }

    const rawClient = body.client && typeof body.client === "object" ? body.client : {}
    const client = {
      ...(rawClient.browser ? { browser: String(rawClient.browser).slice(0, 160) } : {}),
      ip: String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim().slice(0, 80),
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
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
          externalUserId: viewer.uid,
          displayLabel: viewer.email || viewer.uid,
          deviceId,
          client,
          source: {
            provider: "youtube_custom",
            url: youtubeUrl,
            ...(title ? { title } : {}),
          },
        }),
      })
    } finally {
      clearTimeout(timeout)
    }

    const payload = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502
      const code = String(payload?.error?.code || "UNPIRATOR_REQUEST_FAILED").slice(0, 80)
      const message = status >= 500
        ? "Protected playback service is temporarily unavailable"
        : String(payload?.error?.message || "Protected playback request was rejected").slice(0, 240)
      return sendError(res, status, message, code)
    }

    return res.status(201).json(allowlistedSession(payload))
  } catch (error) {
    if (error?.name === "AbortError") {
      return sendError(res, 504, "Protected playback service timed out", "UNPIRATOR_TIMEOUT")
    }

    const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) <= 599
      ? Number(error.statusCode)
      : 500
    const message = status === 401
      ? "Sign in required"
      : status === 403
        ? error.message
        : "Unable to start protected playback"
    return sendError(res, status, message)
  }
}
