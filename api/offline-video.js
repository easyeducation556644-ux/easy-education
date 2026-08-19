import { createHmac, timingSafeEqual } from "node:crypto"
import { Readable } from "node:stream"
import { requireVerifiedUser } from "./utils/firebase-admin.js"

const DEFAULT_HEIGHT = 360
const MAX_HEIGHT = 2160
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

function inferHeight(value, keyHint = "", url = "", fallback = 0) {
  const candidates = [
    value?.meta?.h,
    value?.meta?.height,
    value?.h,
    value?.height,
    String(value?.resolution || "").split("x")[1],
    /^\d{3,4}$/.test(String(keyHint)) ? keyHint : "",
    String(keyHint).match(/(\d{3,4})p/i)?.[1],
    String(url).match(/(?:^|[-_/])(\d{3,4})p(?:[-_.?/]|$)/i)?.[1],
    fallback,
  ]
  for (const candidate of candidates) {
    const height = Number.parseInt(String(candidate || ""), 10)
    if (Number.isFinite(height) && height >= 144 && height <= MAX_HEIGHT) return height
  }
  return 0
}

function inferKind(url, keyHint = "", object = null) {
  const normalizedUrl = String(url || "").toLowerCase()
  const hint = String(keyHint || "").toLowerCase()
  const type = String(object?.type || object?.mime || object?.mimeType || "").toLowerCase()
  if (normalizedUrl.includes(".m3u8") || hint.includes("hls") || type.includes("mpegurl")) return "hls"
  if (normalizedUrl.includes(".mp4") || hint.includes("mp4") || type.includes("video/mp4")) return "mp4"
  return ""
}

function collectMediaEntries(node, output, context = {}, seenObjects = new Set()) {
  if (node == null) return
  if (typeof node === "string") {
    if (!/^https?:\/\//i.test(node)) return
    const kind = inferKind(node, context.keyHint)
    if (!kind) return
    output.push({
      kind,
      url: node,
      height: inferHeight(context.parent, context.keyHint, node, context.fallbackHeight),
      contentLength: 0,
      bitrate: Number(context.parent?.meta?.bitrate || context.parent?.bitrate || 0),
    })
    return
  }
  if (typeof node !== "object") return
  if (seenObjects.has(node)) return
  seenObjects.add(node)

  if (Array.isArray(node)) {
    node.forEach((entry, index) => collectMediaEntries(entry, output, {
      ...context,
      keyHint: context.keyHint || String(index),
      parent: entry,
    }, seenObjects))
    return
  }

  if (typeof node.url === "string" && /^https?:\/\//i.test(node.url)) {
    const kind = inferKind(node.url, context.keyHint, node)
    if (kind) {
      output.push({
        kind,
        url: node.url,
        height: inferHeight(node, context.keyHint, node.url, context.fallbackHeight),
        contentLength: Number.parseInt(String(node?.meta?.size || node?.size || node?.contentLength || ""), 10),
        bitrate: Number(node?.meta?.bitrate || node?.bitrate || 0),
      })
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "url") continue
    collectMediaEntries(value, output, {
      keyHint: key,
      parent: typeof value === "object" && value ? value : node,
      fallbackHeight: inferHeight(node, context.keyHint, node.url, context.fallbackHeight),
    }, seenObjects)
  }
}

function getRumbleRawCandidates(payload) {
  const entries = []
  const fallbackHeight = inferHeight(payload, "", "", DEFAULT_HEIGHT)
  collectMediaEntries(payload?.ua, entries, { fallbackHeight })
  collectMediaEntries(payload?.u, entries, { fallbackHeight })
  const byKey = new Map()
  for (const entry of entries) {
    if (!entry.url || !entry.kind) continue
    const key = `${entry.kind}:${entry.url}`
    const previous = byKey.get(key)
    if (!previous || (!previous.height && entry.height)) byKey.set(key, entry)
  }
  return [...byKey.values()]
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

async function getRumbleMp4Formats(payload, videoUrl) {
  const candidates = getRumbleRawCandidates(payload).filter((item) => item.kind === "mp4")
  const discovered = await Promise.all(
    candidates.map((format) => discoverContentLength(format, videoUrl).catch(() => format)),
  )
  return discovered
    .filter((format) => format.height > 0 && Number.isFinite(format.contentLength) && format.contentLength > 0)
    .map((format) => ({ ...format, kind: "mp4", mimeType: "video/mp4" }))
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

function estimatePlaylistLength(playlistText, playlistUrl) {
  const segmentUrls = playlistText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new URL(line, playlistUrl).toString())
  const contentLength = segmentUrls.reduce(
    (total, segmentUrl) => total + getSegmentLength(segmentUrl),
    0,
  )
  return { segmentUrls, contentLength }
}

async function expandHlsCandidate(candidate, videoUrl) {
  const response = await fetch(candidate.url, {
    headers: { ...REQUEST_HEADERS, Referer: videoUrl },
    redirect: "follow",
  })
  if (!response.ok) return []
  const text = await response.text()
  const lines = text.split(/\r?\n/)
  const master = lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:"))

  if (!master) {
    const { segmentUrls, contentLength } = estimatePlaylistLength(text, candidate.url)
    if (!segmentUrls.length) return []
    const height = candidate.height || DEFAULT_HEIGHT
    return [{
      height,
      bitrate: Number(candidate.bitrate || 0),
      playlistUrl: candidate.url,
      contentLength,
      kind: "hls",
      mimeType: "application/vnd.apple.mpegurl",
    }]
  }

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
      playlistUrl: new URL(source, candidate.url).toString(),
    })
  }

  return Promise.all(variants.map(async (variant) => {
    const playlistResponse = await fetch(variant.playlistUrl, {
      headers: { ...REQUEST_HEADERS, Referer: videoUrl },
      redirect: "follow",
    })
    if (!playlistResponse.ok) return null
    const playlistText = await playlistResponse.text()
    const { segmentUrls, contentLength } = estimatePlaylistLength(playlistText, variant.playlistUrl)
    if (!segmentUrls.length) return null
    return {
      ...variant,
      contentLength,
      kind: "hls",
      mimeType: "application/vnd.apple.mpegurl",
    }
  })).then((items) => items.filter(Boolean))
}

async function getHlsFormats(payload, videoUrl) {
  const candidates = getRumbleRawCandidates(payload).filter((item) => item.kind === "hls")
  const groups = await Promise.all(candidates.map((candidate) =>
    expandHlsCandidate(candidate, videoUrl).catch(() => []),
  ))
  return groups.flat()
}

function getOptions(formats) {
  const byKindAndHeight = new Map()
  for (const format of formats) {
    if (!format.height || !format.kind) continue
    const key = `${format.kind}:${format.height}`
    const current = byKindAndHeight.get(key)
    if (
      !current
      || (!current.contentLength && format.contentLength)
      || (format.bitrate > current.bitrate)
    ) byKindAndHeight.set(key, format)
  }
  return [...byKindAndHeight.values()]
    .sort((a, b) => a.height - b.height || (a.kind === "mp4" ? -1 : 1))
    .map(({ height, contentLength, mimeType, kind, playlistUrl, bitrate }) => ({
      height,
      contentLength: Number(contentLength || 0),
      mimeType,
      kind,
      bitrate: Number(bitrate || 0),
      ...(playlistUrl ? { playlistUrl } : {}),
    }))
}

function selectMp4Format(formats, requestedHeight) {
  const sorted = formats
    .filter((format) => format.kind === "mp4")
    .sort((a, b) => a.height - b.height)
  if (!sorted.length) return null
  return sorted.find((format) => format.height === requestedHeight)
    || sorted.filter((format) => format.height <= requestedHeight).at(-1)
    || sorted[0]
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

  const [mp4Formats, hlsFormats] = await Promise.all([
    getRumbleMp4Formats(payload, videoUrl),
    getHlsFormats(payload, videoUrl),
  ])
  const formats = [...mp4Formats, ...hlsFormats]
  if (!formats.length) {
    const error = new Error("Rumble did not expose a playable MP4 or HLS quality")
    error.statusCode = 422
    throw error
  }
  return { formats }
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
      const decodedToken = await requireVerifiedUser(req)
      videoUrl = String(req.query?.videoUrl || "")
      if (!parseRumbleUrl(videoUrl)) {
        return sendError(res, 400, "A valid Rumble video URL is required")
      }

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
      const recommended = options.filter((option) => option.height <= 480).at(-1)
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
    const format = selectMp4Format(formats, requestedHeight)
    if (!format) return sendError(res, 422, "No progressive Rumble quality is available for ranged download")

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
