import { createHmac, timingSafeEqual } from "node:crypto"
import { Readable } from "node:stream"
import {
  isFullAdminProfile,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"

const DEFAULT_HEIGHT = 360
const MAX_HEIGHT = 1080
const MAX_CHUNK_BYTES = 10 * 1024 * 1024
const RUMBLE_HOST_PATTERN = /(^|\.)rumble\.com$/i
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  Accept: "*/*",
}

function getTokenSecret() {
  const secret = process.env.OFFLINE_VIDEO_SECRET
    || process.env.FIREBASE_PRIVATE_KEY
    || process.env.FIREBASE_SERVICE_ACCOUNT
  if (!secret) {
    const error = new Error("Offline video signing secret is not configured")
    error.statusCode = 503
    throw error
  }
  return secret
}

function signDownloadToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", getTokenSecret()).update(encoded).digest("base64url")
  return `${encoded}.${signature}`
}

function verifyDownloadToken(token, classId) {
  const [encoded, signature] = String(token || "").split(".")
  if (!encoded || !signature) {
    const error = new Error("A valid offline download token is required")
    error.statusCode = 401
    throw error
  }

  const expected = createHmac("sha256", getTokenSecret()).update(encoded).digest("base64url")
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (
    actualBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    const error = new Error("Invalid offline download token")
    error.statusCode = 401
    throw error
  }

  let payload
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    payload = null
  }
  if (
    !payload
    || payload.classId !== classId
    || !payload.videoUrl
    || Number(payload.expiresAt) < Date.now()
  ) {
    const error = new Error("Offline download token has expired")
    error.statusCode = 401
    throw error
  }
  return payload
}

function parseHeight(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_HEIGHT), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(144, parsed))
}

function parseRumbleUrl(value) {
  try {
    const url = new URL(String(value || ""))
    if (!RUMBLE_HOST_PATTERN.test(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

function getEmbedIdFromUrl(url) {
  const match = url.pathname.match(/^\/embed\/(?:[0-9a-z]+\.)?([0-9a-z]+)/i)
  return match?.[1]?.toLowerCase() || ""
}

async function fetchRumbleEmbedId(videoUrl) {
  const parsedUrl = parseRumbleUrl(videoUrl)
  if (!parsedUrl) return ""

  const directId = getEmbedIdFromUrl(parsedUrl)
  if (directId) return directId

  const oEmbedUrl = new URL("https://rumble.com/api/Media/oembed.json")
  oEmbedUrl.searchParams.set("url", parsedUrl.toString())
  const oEmbedResponse = await fetch(oEmbedUrl, {
    headers: { ...REQUEST_HEADERS, Accept: "application/json" },
  })
  if (oEmbedResponse.ok) {
    const oEmbed = await oEmbedResponse.json()
    const embedId = String(oEmbed?.html || "").match(
      /rumble\.com\/embed\/(?:[0-9a-z]+\.)?([0-9a-z]+)/i,
    )?.[1]
    if (embedId) return embedId.toLowerCase()
  }

  const response = await fetch(parsedUrl, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  })
  if (!response.ok) {
    const error = new Error(`Rumble page returned HTTP ${response.status}`)
    error.statusCode = 502
    throw error
  }

  const webpage = await response.text()
  const patterns = [
    /(?:https?:)?\/\/rumble\.com\/embed\/(?:[0-9a-z]+\.)?([0-9a-z]+)/i,
    /["']embedUrl["']\s*:\s*["'][^"']*\/embed\/(?:[0-9a-z]+\.)?([0-9a-z]+)/i,
    /\bRumble\(\s*["']play["']\s*,\s*\{[^}]*["']?video["']?\s*:\s*["']([0-9a-z]+)["']/i,
  ]
  for (const pattern of patterns) {
    const id = webpage.match(pattern)?.[1]
    if (id) return id.toLowerCase()
  }
  return ""
}

function getRumbleFormatCandidates(payload) {
  const formats = []

  const addGroup = (container) => {
    for (const [type, group] of Object.entries(container || {})) {
      if (type !== "mp4") continue
      const entries = Array.isArray(group)
        ? group
        : group?.url
          ? [group]
          : group && typeof group === "object"
            ? Object.entries(group).map(([height, item]) => ({
                ...item,
                meta: { ...(item?.meta || {}), h: item?.meta?.h || height },
              }))
            : []

      for (const entry of entries) {
        const height = Number.parseInt(
          String(entry?.meta?.h || payload?.h || DEFAULT_HEIGHT),
          10,
        )
        if (!entry?.url || !Number.isFinite(height) || height > MAX_HEIGHT) continue
        formats.push({
          height,
          contentLength: Number.parseInt(String(entry?.meta?.size || ""), 10),
          bitrate: Number(entry?.meta?.bitrate || 0),
          url: entry.url,
          mimeType: "video/mp4",
        })
      }
    }
  }

  addGroup(payload?.ua)
  addGroup(payload?.u)
  return formats
}

async function discoverContentLength(format, videoUrl) {
  if (Number.isFinite(format.contentLength) && format.contentLength > 0) return format

  const response = await fetch(format.url, {
    headers: {
      ...REQUEST_HEADERS,
      Referer: videoUrl,
      Range: "bytes=0-0",
    },
    redirect: "follow",
  })
  const contentRange = response.headers.get("content-range") || ""
  const total = Number.parseInt(contentRange.match(/\/(\d+)$/)?.[1] || "", 10)
  const contentLength = total || (
    response.status === 200
      ? Number.parseInt(response.headers.get("content-length") || "", 10)
      : 0
  )
  await response.body?.cancel().catch(() => {})

  return { ...format, contentLength }
}

async function getRumbleFormats(payload, videoUrl) {
  const discovered = await Promise.all(
    getRumbleFormatCandidates(payload).map((format) => discoverContentLength(format, videoUrl)),
  )
  return discovered.filter(
    (format) => Number.isFinite(format.contentLength) && format.contentLength > 0,
  )
}

function getHlsMasterUrl(payload) {
  const candidates = [payload?.ua?.hls, payload?.u?.hls]
  for (const group of candidates) {
    if (group?.url) return group.url
    for (const entry of Object.values(group || {})) {
      if (entry?.url) return entry.url
    }
  }
  return ""
}

function parseHlsAttribute(line, name) {
  return line.match(new RegExp(`(?:^|,)${name}=([^,]+)`, "i"))?.[1] || ""
}

function getSegmentLength(segmentUrl) {
  try {
    const range = new URL(segmentUrl).searchParams.get("r_range") || ""
    const [start, end] = range.split("-").map(Number)
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? end - start + 1
      : 0
  } catch {
    return 0
  }
}

async function getHlsFormats(payload, videoUrl) {
  const masterUrl = getHlsMasterUrl(payload)
  if (!masterUrl) return []

  const response = await fetch(masterUrl, {
    headers: { ...REQUEST_HEADERS, Referer: videoUrl },
  })
  if (!response.ok) return []

  const lines = (await response.text()).split(/\r?\n/)
  const variants = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF:")) continue
    const source = lines.slice(index + 1).find((line) => line && !line.startsWith("#"))
    if (!source) continue
    const resolution = parseHlsAttribute(lines[index], "RESOLUTION")
    const height = Number.parseInt(resolution.split("x")[1] || "", 10)
    const bitrate = Number.parseInt(parseHlsAttribute(lines[index], "BANDWIDTH"), 10)
    if (!Number.isFinite(height) || height > MAX_HEIGHT) continue
    variants.push({
      height,
      bitrate: Number.isFinite(bitrate) ? bitrate : 0,
      playlistUrl: new URL(source, masterUrl).toString(),
    })
  }

  return Promise.all(variants.map(async (variant) => {
    const playlistResponse = await fetch(variant.playlistUrl, {
      headers: { ...REQUEST_HEADERS, Referer: videoUrl },
    })
    if (!playlistResponse.ok) return null
    const playlistText = await playlistResponse.text()
    const segmentUrls = playlistText
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => new URL(line, variant.playlistUrl).toString())
    const contentLength = segmentUrls.reduce(
      (total, segmentUrl) => total + getSegmentLength(segmentUrl),
      0,
    )
    if (!segmentUrls.length || !contentLength) return null
    return {
      ...variant,
      contentLength,
      kind: "hls",
      mimeType: "application/vnd.apple.mpegurl",
    }
  })).then((items) => items.filter(Boolean))
}

function getOptions(formats) {
  const byHeight = new Map()
  for (const format of formats) {
    const current = byHeight.get(format.height)
    if (!current || format.bitrate > current.bitrate) byHeight.set(format.height, format)
  }
  return [...byHeight.values()]
    .sort((a, b) => a.height - b.height)
    .map(({ height, contentLength, mimeType, kind, playlistUrl }) => ({
      height,
      contentLength,
      mimeType,
      kind: kind || "mp4",
      ...(playlistUrl ? { playlistUrl } : {}),
    }))
}

function selectFormat(formats, requestedHeight) {
  const sorted = [...formats].sort((a, b) => a.height - b.height)
  if (!sorted.length) return null
  return sorted.filter((format) => format.height <= requestedHeight).at(-1) || sorted[0]
}

async function getRumbleInfo(videoUrl) {
  const embedId = await fetchRumbleEmbedId(videoUrl)
  if (!embedId) {
    const error = new Error("Unable to find the Rumble video ID")
    error.statusCode = 422
    throw error
  }

  const endpoint = new URL("https://rumble.com/embedJS/u3/")
  endpoint.search = new URLSearchParams({
    request: "video",
    ver: "2",
    v: embedId,
  }).toString()

  const response = await fetch(endpoint, {
    headers: { ...REQUEST_HEADERS, Referer: videoUrl },
  })
  if (!response.ok) {
    const error = new Error(`Rumble metadata returned HTTP ${response.status}`)
    error.statusCode = 502
    throw error
  }

  const payload = await response.json()
  if (payload?.live === 2) {
    const error = new Error("Live Rumble videos cannot be saved offline")
    error.statusCode = 422
    throw error
  }

  const mp4Formats = await getRumbleFormats(payload, videoUrl)
  const hlsFormats = await getHlsFormats(payload, videoUrl)
  const formats = [...mp4Formats, ...hlsFormats]
  if (!formats.length) {
    const error = new Error("No downloadable Rumble MP4 quality is available")
    error.statusCode = 422
    throw error
  }
  return { formats }
}

async function hasCourseAccess({ db, uid, userProfile, courseId }) {
  if (isFullAdminProfile(userProfile)) return true
  const enrollment = await db.collection("userCourses").doc(`${uid}_${courseId}`).get()
  if (enrollment.exists) return true
  const payments = await db.collection("payments")
    .where("userId", "==", uid)
    .where("status", "==", "approved")
    .get()
  return payments.docs.some((doc) => {
    const courses = doc.data()?.courses
    return Array.isArray(courses) && courses.some((course) => course?.id === courseId)
  })
}

function sendError(res, statusCode, message) {
  if (!res.headersSent) res.status(statusCode).json({ error: message })
  else res.end()
}

export default async function offlineVideoHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET")
    return sendError(res, 405, "Method not allowed")
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  res.setHeader("CDN-Cache-Control", "no-store")
  res.setHeader("Vercel-CDN-Cache-Control", "no-store")
  res.setHeader("Vary", "Authorization")

  try {
    const classId = String(req.query?.classId || "").trim()
    if (!classId) return sendError(res, 400, "classId is required")

    let videoUrl
    let downloadToken

    if (req.query?.options === "1") {
      const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
      const classSnapshot = await db.collection("classes").doc(classId).get()
      if (!classSnapshot.exists) return sendError(res, 404, "Class not found")

      const classData = classSnapshot.data() || {}
      const courseId = String(classData.courseId || "")
      videoUrl = String(classData.videoURL || classData.youtubeLink || "")
      if (!courseId || !parseRumbleUrl(videoUrl)) {
        return sendError(res, 400, "Offline download is available only for Rumble videos")
      }

      const canDownload = await hasCourseAccess({
        db,
        uid: decodedToken.uid,
        userProfile,
        courseId,
      })
      if (!canDownload) return sendError(res, 403, "Course access required")

      downloadToken = signDownloadToken({
        classId,
        uid: decodedToken.uid,
        videoUrl,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      })
    } else {
      const payload = verifyDownloadToken(req.query?.downloadToken, classId)
      videoUrl = payload.videoUrl
    }

    const { formats } = await getRumbleInfo(videoUrl)
    const options = getOptions(formats)

    if (req.query?.options === "1") {
      const recommended = options.filter((option) => option.height <= 360).at(-1)
        || options[0]
        || null
      return res.status(200).json({
        options,
        recommendedHeight: recommended?.height || null,
        chunkSize: MAX_CHUNK_BYTES,
        downloadToken,
      })
    }

    const requestedHeight = parseHeight(req.query?.height)
    const format = selectFormat(formats, requestedHeight)
    if (!format) return sendError(res, 422, "No downloadable Rumble quality is available")
    if (format.kind === "hls") {
      return sendError(res, 400, "HLS segments must be downloaded directly by the browser")
    }

    const totalLength = format.contentLength
    const start = Number.parseInt(String(req.query?.start ?? ""), 10)
    const requestedEnd = Number.parseInt(String(req.query?.end ?? ""), 10)
    if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || requestedEnd < start) {
      return sendError(res, 400, "A valid byte range is required")
    }
    if (requestedEnd - start + 1 > MAX_CHUNK_BYTES) {
      return sendError(res, 400, "Requested chunk is too large")
    }
    if (start >= totalLength) return sendError(res, 416, "Byte range is outside the video")

    const end = Math.min(requestedEnd, totalLength - 1)
    const upstream = await fetch(format.url, {
      headers: {
        ...REQUEST_HEADERS,
        Referer: videoUrl,
        Range: `bytes=${start}-${end}`,
      },
      redirect: "follow",
    })
    if (upstream.status !== 206 || !upstream.body) {
      const error = new Error(`Rumble CDN did not honor the byte range (HTTP ${upstream.status})`)
      error.statusCode = 502
      throw error
    }

    const expectedLength = end - start + 1
    const receivedLength = Number(upstream.headers.get("content-length"))
    if (Number.isFinite(receivedLength) && receivedLength !== expectedLength) {
      const error = new Error("Rumble returned an incomplete video chunk")
      error.statusCode = 502
      throw error
    }

    res.status(206)
    res.setHeader("Content-Type", upstream.headers.get("content-type") || format.mimeType)
    res.setHeader("Content-Length", String(expectedLength))
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalLength}`)
    res.setHeader("Accept-Ranges", "bytes")
    res.setHeader("X-Content-Type-Options", "nosniff")
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (error) {
    console.error("Offline Rumble video request failed:", error)
    return sendError(
      res,
      error.statusCode || 500,
      error?.message || "Unable to prepare the Rumble video for offline use",
    )
  }
}
