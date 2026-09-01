import { createWriteStream, existsSync, renameSync, statSync, unlinkSync } from "node:fs"
import { once } from "node:events"

const YOUTUBE_REFERER = "https://www.youtube.com/"
const DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0"
const WEB_USER_AGENT = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Mobile Safari/537.36"

const CLIENTS = [
  {
    name: "IOS",
    version: "21.03.2",
    id: "5",
    userAgent: "com.google.ios.youtube/21.03.2 (iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X; en_US)",
    extra: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iOS", osVersion: "18.7.2.22H124" },
  },
  {
    name: "ANDROID",
    version: "21.03.36",
    id: "3",
    userAgent: "com.google.android.youtube/21.03.36 (Linux; U; Android 16; en_US) gzip",
    extra: { androidSdkVersion: 36, osName: "Android", osVersion: "16" },
  },
]

export function youtubeVideoId(value) {
  try {
    const url = new URL(String(value || "").trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "")
    let id = null
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0]
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      id = url.searchParams.get("v")
      if (!id) {
        const parts = url.pathname.split("/").filter(Boolean)
        if (["shorts", "embed", "live"].includes(parts[0])) id = parts[1]
      }
    }
    return /^[A-Za-z0-9_-]{6,20}$/.test(id || "") ? id : null
  } catch {
    return null
  }
}

function visitorDataFromHtml(html) {
  return [
    /"VISITOR_DATA"\s*:\s*"([^"]+)"/,
    /"visitorData"\s*:\s*"([^"]+)"/,
  ].map((pattern) => pattern.exec(html)?.[1]).find(Boolean) || null
}

function randomToken(length = 12) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let result = ""
  for (let i = 0; i < length; i += 1) result += alphabet[Math.floor(Math.random() * alphabet.length)]
  return result
}

async function fetchVisitorData(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { "User-Agent": WEB_USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return null
  return visitorDataFromHtml((await response.text()).slice(0, 768 * 1024))
}

async function playerResponse(videoId, visitorData, region, profile) {
  const client = {
    clientName: profile.name,
    clientVersion: profile.version,
    hl: "en",
    gl: region,
    utcOffsetMinutes: 0,
    ...profile.extra,
  }
  if (visitorData) client.visitorData = visitorData
  const response = await fetch(
    `https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false&t=${randomToken()}&id=${videoId}`,
    {
      method: "POST",
      headers: {
        "User-Agent": profile.userAgent,
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json; charset=utf-8",
        "X-Goog-Api-Format-Version": "2",
        ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
      },
      body: JSON.stringify({
        context: { client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } },
      }),
      signal: AbortSignal.timeout(25_000),
    },
  )
  if (!response.ok) throw new Error(`YouTube ${profile.name} resolver HTTP ${response.status}`)
  return response.json()
}

export function progressiveFormats(player, profile) {
  const formats = Array.isArray(player?.streamingData?.formats) ? player.streamingData.formats : []
  const byHeight = new Map()
  for (const item of formats) {
    const mime = String(item?.mimeType || "")
    let host = ""
    try { host = new URL(item?.url || "").hostname.toLowerCase() } catch { continue }
    if (!(host === "googlevideo.com" || host.endsWith(".googlevideo.com"))) continue
    if (!mime.toLowerCase().startsWith("video/mp4")) continue
    if (!/avc1/i.test(mime) || !/mp4a/i.test(mime)) continue
    const height = Number(item.height || 0)
    if (height < 1 || height > 2160) continue
    const format = {
      url: item.url,
      height,
      qualityLabel: item.qualityLabel || `${height}p`,
      contentLength: Number(item.contentLength || 0),
      bitrate: Number(item.bitrate || 0),
      userAgent: profile.userAgent,
      clientName: profile.name,
    }
    const old = byHeight.get(height)
    if (!old || format.bitrate > old.bitrate) byHeight.set(height, format)
  }
  return [...byHeight.values()].sort((a, b) => a.height - b.height)
}

export function pickProgressive(formats, requestedHeight) {
  return formats.find((item) => item.height === requestedHeight)
    || formats.filter((item) => item.height <= requestedHeight).sort((a, b) => b.height - a.height)[0]
    || formats[0]
    || null
}

export async function resolveAndroidYoutube(sourceUrl, requestedHeight) {
  const videoId = youtubeVideoId(sourceUrl)
  if (!videoId) throw new Error("Invalid YouTube URL")
  const visitorData = await fetchVisitorData(videoId).catch(() => null)
  const attempts = [
    { visitorData, region: "US" },
    ...(visitorData ? [{ visitorData: null, region: "US" }] : []),
    { visitorData, region: "BD" },
    ...(visitorData ? [{ visitorData: null, region: "BD" }] : []),
  ]
  let reason = "YouTube did not expose a progressive Android/iOS stream"
  for (const attempt of attempts) {
    for (const profile of CLIENTS) {
      try {
        const player = await playerResponse(videoId, attempt.visitorData, attempt.region, profile)
        const status = player?.playabilityStatus
        if (status?.status !== "OK") {
          reason = status?.reason || status?.messages?.[0] || reason
          continue
        }
        const selected = pickProgressive(progressiveFormats(player, profile), requestedHeight)
        if (selected) return { ...selected, videoId, title: player?.videoDetails?.title || "YouTube video" }
      } catch (error) {
        reason = error.message || reason
      }
    }
  }
  throw new Error(reason)
}

function totalFromResponse(response, offset, expected) {
  const range = response.headers.get("content-range") || ""
  const fromRange = Number(range.slice(range.lastIndexOf("/") + 1))
  if (Number.isFinite(fromRange) && fromRange > 0) return fromRange
  if (expected > 0) return expected
  const length = Number(response.headers.get("content-length") || 0)
  return length > 0 ? offset + length : 0
}

async function appendResponse(response, partPath, offset, total, onProgress, onControl) {
  const output = createWriteStream(partPath, { flags: offset > 0 ? "a" : "w" })
  const reader = response.body?.getReader()
  if (!reader) throw new Error("YouTube video response was empty")
  let downloaded = offset
  let nextControl = Date.now() + 12_000
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!output.write(value)) await once(output, "drain")
      downloaded += value.byteLength
      await onProgress(downloaded, total)
      if (Date.now() >= nextControl) {
        await onControl()
        nextControl = Date.now() + 12_000
      }
    }
  } finally {
    const closed = once(output, "close")
    output.end()
    await closed.catch(() => {})
  }
  return downloaded
}

export async function downloadLikeAndroid({ sourceUrl, requestedHeight, outputPath, onProgress, onControl, log }) {
  const partPath = `${outputPath}.part`
  if (existsSync(outputPath) && statSync(outputPath).size > 0) {
    log(`Reusing completed Android download (${statSync(outputPath).size} bytes)`)
    return { path: outputPath, format: { height: requestedHeight, clientName: "CACHED" } }
  }
  let selected = await resolveAndroidYoutube(sourceUrl, requestedHeight)
  let refreshed = false
  const finalize = () => {
    if (existsSync(outputPath)) unlinkSync(outputPath)
    renameSync(partPath, outputPath)
    return { path: outputPath, format: selected }
  }
  for (;;) {
    await onControl()
    if (selected.contentLength > 0 && existsSync(partPath)) {
      const partSize = statSync(partPath).size
      if (partSize === selected.contentLength) return finalize()
      if (partSize > selected.contentLength) unlinkSync(partPath)
    }
    const offset = existsSync(partPath) ? statSync(partPath).size : 0
    const response = await fetch(selected.url, {
      headers: {
        "User-Agent": DOWNLOAD_USER_AGENT,
        Referer: YOUTUBE_REFERER,
        "Accept-Encoding": "identity",
        ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}),
      },
    })
    if ([403, 410].includes(response.status) && !refreshed) {
      refreshed = true
      log(`Android ${selected.clientName} URL expired (${response.status}); resolving again`)
      selected = await resolveAndroidYoutube(sourceUrl, requestedHeight)
      continue
    }
    if (response.status === 416 && selected.contentLength > 0 && existsSync(partPath) && statSync(partPath).size === selected.contentLength) {
      return finalize()
    }
    if (!response.ok) throw new Error(`YouTube Android download returned HTTP ${response.status}`)
    const contentType = String(response.headers.get("content-type") || "").toLowerCase()
    if (/text\/html|application\/(?:json|xml)/.test(contentType)) {
      throw new Error(`YouTube media host returned ${contentType || "a non-video response"}`)
    }
    if (offset > 0 && response.status === 200) {
      unlinkSync(partPath)
      continue
    }
    const total = totalFromResponse(response, offset, selected.contentLength)
    const downloaded = await appendResponse(response, partPath, offset, total, onProgress, onControl)
    if (total > 0 && downloaded < total) continue
    if (total > 0 && statSync(partPath).size !== total) throw new Error(`YouTube download was incomplete (${statSync(partPath).size}/${total})`)
    return finalize()
  }
}
