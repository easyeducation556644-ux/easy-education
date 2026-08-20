const RUMBLE_HOST_PATTERN = /(^|\.)rumble\.com$/i
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  Accept: "*/*",
}

function parseRumbleUrl(value) {
  try {
    const url = new URL(String(value || "").trim())
    if (url.protocol !== "https:" || !RUMBLE_HOST_PATTERN.test(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function normalizeEmbedUrl(value) {
  const decoded = decodeHtmlAttribute(value)
  const parsed = parseRumbleUrl(decoded)
  if (!parsed || !/^\/embed\//i.test(parsed.pathname)) return ""
  return parsed.toString()
}

function extractEmbedUrl(html) {
  const text = String(html || "")
  const patterns = [
    /<iframe\b[^>]*\bsrc=["']([^"']*rumble\.com\/embed\/[^"']+)["']/i,
    /(?:https?:)?\\?\/\\?\/rumble\.com\\?\/embed\\?\/[^"'\s<]+/i,
    /["']embedUrl["']\s*:\s*["']([^"']*rumble\.com\/embed\/[^"']+)["']/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const raw = match?.[1] || match?.[0] || ""
    if (!raw) continue
    const unescaped = raw
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/^\/\//, "https://")
    const normalized = normalizeEmbedUrl(unescaped)
    if (normalized) return normalized
  }
  return ""
}

async function resolveRumbleEmbedUrl(videoUrl) {
  const parsed = parseRumbleUrl(videoUrl)
  if (!parsed) {
    const error = new Error("A valid HTTPS Rumble video URL is required")
    error.statusCode = 400
    throw error
  }

  if (/^\/embed\//i.test(parsed.pathname)) return parsed.toString()

  const oEmbedUrl = new URL("https://rumble.com/api/Media/oembed.json")
  oEmbedUrl.searchParams.set("url", parsed.toString())
  const oEmbedResponse = await fetch(oEmbedUrl, {
    headers: { ...REQUEST_HEADERS, Accept: "application/json" },
    redirect: "follow",
  })
  if (oEmbedResponse.ok) {
    const oEmbed = await oEmbedResponse.json().catch(() => null)
    const embedUrl = extractEmbedUrl(oEmbed?.html)
    if (embedUrl) return embedUrl
  }

  const pageResponse = await fetch(parsed, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  })
  if (!pageResponse.ok) {
    const error = new Error(`Rumble page returned HTTP ${pageResponse.status}`)
    error.statusCode = 502
    throw error
  }

  const embedUrl = extractEmbedUrl(await pageResponse.text())
  if (embedUrl) return embedUrl

  const error = new Error("Unable to resolve the canonical Rumble embed URL")
  error.statusCode = 422
  throw error
}

export default async function rumbleEmbedHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET")
    return res.status(405).json({ error: "Method not allowed" })
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  res.setHeader("CDN-Cache-Control", "no-store")
  res.setHeader("Vercel-CDN-Cache-Control", "no-store")

  try {
    const embedUrl = await resolveRumbleEmbedUrl(req.query?.videoUrl)
    return res.status(200).json({ embedUrl })
  } catch (error) {
    console.error("Rumble embed resolution failed:", error)
    return res.status(error?.statusCode || 500).json({
      error: error?.message || "Unable to resolve Rumble video",
    })
  }
}
