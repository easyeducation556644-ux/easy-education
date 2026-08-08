import { hasNativeDownloader, nativeRequest } from "./nativeAndroid"

const OFFLINE_CACHE = "easy-education-offline-v2"
const OFFLINE_VIDEO_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FALLBACK_CHUNK_SIZE = 8 * 1024 * 1024
const HLS_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"
const OFFLINE_HLS_LIBRARY_URL = "/offline-assets/hls.min.js"


function nativeDownloadId(userId, classId) {
  return `${userId}:${classId}`
}

async function saveNativeHlsVideo({ user, classId, option, title, courseTitle, totalBytes, onProgress, signal }) {
  const id = nativeDownloadId(user.uid, classId)
  await nativeRequest("start", {
    id,
    title: title || "Class video",
    courseTitle: courseTitle || "",
    playlistUrl: option.playlistUrl,
    height: option.height,
    totalBytes: Number(totalBytes || option.contentLength) || 0,
  })

  while (true) {
    if (signal?.aborted) {
      await nativeRequest("pause", { id }).catch(() => null)
      throw new DOMException("Download paused", "AbortError")
    }
    const status = await nativeRequest("status", { id })
    onProgress?.(status.progress || 0, status)
    if (status.state === "completed") return status.playbackUrl
    if (status.state === "paused") throw new DOMException("Download paused", "AbortError")
    if (status.state === "failed") {
      throw new Error(status.error || "Native download failed")
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

function ensureSupport() {
  if (!("caches" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Offline video is not supported in this browser")
  }
}

export function getOfflineVideoUrl(userId, classId) {
  return `/offline-media/${encodeURIComponent(userId)}/${encodeURIComponent(classId)}`
}

function getManifestUrl(userId, classId) {
  return `${getOfflineVideoUrl(userId, classId)}/manifest`
}

function getChunkUrl(userId, classId, index) {
  return `${getOfflineVideoUrl(userId, classId)}/chunks/${index}`
}

function getHlsPlaylistUrl(userId, classId) {
  return `${getOfflineVideoUrl(userId, classId)}/playlist.m3u8`
}

function getHlsSegmentUrl(userId, classId, index) {
  return `${getOfflineVideoUrl(userId, classId)}/segments/${index}.ts`
}

export async function getSavedOfflineVideoUrl(userId, classId) {
  if (hasNativeDownloader()) {
    const native = await nativeRequest("status", { id: nativeDownloadId(userId, classId) }).catch(() => null)
    if (native?.state === "completed") return native.playbackUrl
  }
  if (!("caches" in window)) return null
  const cache = await caches.open(OFFLINE_CACHE)
  const manifest = await readManifest(cache, userId, classId)
  if (!manifest) return null
  return manifest.kind === "hls"
    ? getHlsPlaylistUrl(userId, classId)
    : getOfflineVideoUrl(userId, classId)
}

async function readManifest(cache, userId, classId) {
  const response = await cache.match(getManifestUrl(userId, classId))
  if (!response) return null
  return response.json().catch(() => null)
}

export async function hasOfflineVideo(userId, classId) {
  if (hasNativeDownloader()) {
    const native = await nativeRequest("status", { id: nativeDownloadId(userId, classId) }).catch(() => null)
    if (native?.state === "completed") return true
  }
  if (!("caches" in window)) return false
  const cache = await caches.open(OFFLINE_CACHE)
  const manifest = await readManifest(cache, userId, classId)
  if (!manifest) return false
  if (!manifest.savedAt || Date.now() - manifest.savedAt > OFFLINE_VIDEO_TTL_MS) {
    await removeOfflineVideo(userId, classId)
    return false
  }
  return true
}

export async function removeOfflineVideo(userId, classId) {
  if (hasNativeDownloader()) {
    await nativeRequest("remove", { id: nativeDownloadId(userId, classId) }).catch(() => null)
  }
  if (!("caches" in window)) return false
  const cache = await caches.open(OFFLINE_CACHE)
  const prefix = `${window.location.origin}${getOfflineVideoUrl(userId, classId)}/`
  const keys = await cache.keys()
  const targets = keys.filter((request) => request.url.startsWith(prefix))
  await Promise.all(targets.map((request) => cache.delete(request)))
  return targets.length > 0
}

export async function getOfflineVideoOptions({ user, classId, videoUrl, signal }) {
  const token = await user.getIdToken()
  const response = await fetch(
    `/api/offline-video?classId=${encodeURIComponent(classId)}&options=1&videoUrl=${encodeURIComponent(videoUrl || "")}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to load offline video qualities")
  }
  return payload
}

async function ensureStorageSpace(requiredBytes) {
  await navigator.storage?.persist?.().catch(() => false)
  const estimate = await navigator.storage?.estimate?.()
  if (!estimate?.quota) return
  const available = Math.max(0, estimate.quota - (estimate.usage || 0))
  if (available < requiredBytes * 1.08) {
    const neededGb = (requiredBytes / (1024 ** 3)).toFixed(1)
    const availableGb = (available / (1024 ** 3)).toFixed(1)
    throw new Error(`Storage কম: ভিডিওতে প্রায় ${neededGb} GB লাগবে, খালি আছে ${availableGb} GB`)
  }
}

function getHlsSegmentLength(segmentUrl) {
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

async function cacheHlsLibrary(cache) {
  const existing = await cache.match(OFFLINE_HLS_LIBRARY_URL)
  if (existing) return
  const response = await fetch(HLS_LIBRARY_URL)
  if (!response.ok) throw new Error("Offline HLS player download failed")
  await cache.put(OFFLINE_HLS_LIBRARY_URL, response)
}

async function saveHlsVideo({ user, classId, option, title, courseTitle, totalBytes, onProgress, signal }) {
  if (hasNativeDownloader()) {
    return saveNativeHlsVideo({ user, classId, option, title, courseTitle, totalBytes, onProgress, signal })
  }

  const playlistResponse = await fetch(option.playlistUrl, { signal })
  if (!playlistResponse.ok) throw new Error("Rumble HLS playlist download failed")
  const playlistText = await playlistResponse.text()
  const lines = playlistText.split(/\r?\n/)
  const segmentLineIndexes = lines
    .map((line, index) => line && !line.startsWith("#") ? index : -1)
    .filter((index) => index >= 0)
  const segmentUrls = segmentLineIndexes.map(
    (lineIndex) => new URL(lines[lineIndex], option.playlistUrl).toString(),
  )
  const segmentLengths = segmentUrls.map(getHlsSegmentLength)
  const totalBytes = segmentLengths.reduce((total, size) => total + size, 0)
  if (!segmentUrls.length || !totalBytes) {
    throw new Error("Rumble HLS segment sizes are unavailable")
  }

  await ensureStorageSpace(totalBytes)
  const cache = await caches.open(OFFLINE_CACHE)
  await cacheHlsLibrary(cache)

  const writeCheckpoint = async (completedSegments, status) => {
    if (completedSegments <= 0) return
    const cutoff = segmentLineIndexes[completedSegments - 1] + 1
    let segmentIndex = 0
    const partialLines = lines.slice(0, cutoff)
      .filter((line) => line !== "#EXT-X-ENDLIST")
      .map((line) => {
        if (!line || line.startsWith("#")) return line
        const localUrl = getHlsSegmentUrl(user.uid, classId, segmentIndex)
        segmentIndex += 1
        return localUrl
      })
    partialLines.push("#EXT-X-ENDLIST")

    const progress = Math.min(100, Math.round(
      segmentLengths.slice(0, completedSegments)
        .reduce((total, size) => total + size, 0) / totalBytes * 100,
    ))
    const savedAt = Date.now()
    await Promise.all([
      cache.put(
        getHlsPlaylistUrl(user.uid, classId),
        new Response(partialLines.join("\n"), {
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        }),
      ),
      cache.put(
        getManifestUrl(user.uid, classId),
        new Response(JSON.stringify({
          version: 4,
          kind: "hls",
          status,
          progress,
          savedAt,
          userId: user.uid,
          classId,
          height: option.height,
          contentLength: totalBytes,
          contentType: "application/vnd.apple.mpegurl",
          totalChunks: segmentUrls.length,
          completedChunks: completedSegments,
        }), {
          headers: {
            "Content-Type": "application/json",
            "X-Offline-Saved-At": String(savedAt),
          },
        }),
      ),
    ])
  }

  let completedBytes = 0
  for (let index = 0; index < segmentUrls.length; index += 1) {
    if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError")
    const cacheUrl = getHlsSegmentUrl(user.uid, classId, index)
    const existing = await cache.match(cacheUrl)
    if (!existing) {
      const response = await fetch(segmentUrls[index], { signal })
      if (!response.ok) throw new Error(`Segment ${index + 1} download failed`)
      const bytes = await response.arrayBuffer()
      if (signal?.aborted) throw new DOMException("Download interrupted", "AbortError")
      await cache.put(
        cacheUrl,
        new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": response.headers.get("content-type") || "video/mp2t",
            "Content-Length": String(bytes.byteLength),
          },
        }),
      )
    }

    completedBytes += segmentLengths[index]
    const completedSegments = index + 1
    const progress = Math.min(99, Math.round((completedBytes / totalBytes) * 100))
    onProgress?.(progress)
    if (completedSegments === 1 || completedSegments % 5 === 0) {
      await writeCheckpoint(completedSegments, "downloading")
    }
  }

  await writeCheckpoint(segmentUrls.length, "completed")
  onProgress?.(100)
  return getHlsPlaylistUrl(user.uid, classId)
}

export async function saveOfflineVideo({
  user,
  classId,
  videoUrl,
  height = 360,
  title,
  courseTitle,
  totalBytes,
  onProgress,
  signal,
}) {
  ensureSupport()
  const metadata = await getOfflineVideoOptions({ user, classId, videoUrl, signal })
  const option = metadata.options?.find((item) => item.height === height)
    || metadata.options?.filter((item) => item.height <= height).at(-1)
    || metadata.options?.[0]
  if (!option?.contentLength) throw new Error("Selected quality size is unavailable")
  if (option.kind === "hls" && option.playlistUrl) {
    return saveHlsVideo({ user, classId, option, title, courseTitle, totalBytes, onProgress, signal })
  }

  const totalBytes = Number(option.contentLength)
  const chunkSize = Math.min(Number(metadata.chunkSize) || FALLBACK_CHUNK_SIZE, 10 * 1024 * 1024)
  const totalChunks = Math.ceil(totalBytes / chunkSize)
  await ensureStorageSpace(totalBytes)

  const cache = await caches.open(OFFLINE_CACHE)
  let completedBytes = 0

  for (let index = 0; index < totalChunks; index += 1) {
    if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError")
    const start = index * chunkSize
    const end = Math.min(totalBytes - 1, start + chunkSize - 1)
    const expectedLength = end - start + 1
    const chunkUrl = getChunkUrl(user.uid, classId, index)
    const existing = await cache.match(chunkUrl)
    if (existing && Number(existing.headers.get("content-length")) === expectedLength) {
      completedBytes += expectedLength
      onProgress?.(Math.min(99, Math.round((completedBytes / totalBytes) * 100)))
      continue
    }

    const response = await fetch(
      `/api/offline-video?classId=${encodeURIComponent(classId)}&height=${option.height}&start=${start}&end=${end}&downloadToken=${encodeURIComponent(metadata.downloadToken || "")}`,
      { signal },
    )
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error || `Chunk ${index + 1} download failed`)
    }
    const receivedLength = Number(response.headers.get("content-length"))
    if (receivedLength !== expectedLength) {
      throw new Error(`Chunk ${index + 1} was incomplete`)
    }
    await cache.put(chunkUrl, response)
    completedBytes += expectedLength
    onProgress?.(Math.min(99, Math.round((completedBytes / totalBytes) * 100)))
  }

  const manifest = {
    version: 2,
    savedAt: Date.now(),
    userId: user.uid,
    classId,
    height: option.height,
    contentLength: totalBytes,
    contentType: option.mimeType || "video/mp4",
    chunkSize,
    totalChunks,
  }
  await cache.put(
    getManifestUrl(user.uid, classId),
    new Response(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/json", "X-Offline-Saved-At": String(manifest.savedAt) },
    }),
  )
  onProgress?.(100)
  return getOfflineVideoUrl(user.uid, classId)
}

async function removeByPrefix(prefix) {
  if (!("caches" in window)) return
  const cache = await caches.open(OFFLINE_CACHE)
  const keys = await cache.keys()
  await Promise.all(
    keys.filter((request) => request.url.startsWith(prefix)).map((request) => cache.delete(request)),
  )
}

export async function removeOfflineVideosForOtherUsers(currentUserId) {
  const root = `${window.location.origin}/offline-media/`
  const own = `${root}${encodeURIComponent(currentUserId)}/`
  if (!("caches" in window)) return
  const cache = await caches.open(OFFLINE_CACHE)
  const keys = await cache.keys()
  await Promise.all(
    keys.filter((request) => request.url.startsWith(root) && !request.url.startsWith(own))
      .map((request) => cache.delete(request)),
  )
}

export async function removeOfflineVideosForUser(userId) {
  if (!userId) return
  await removeByPrefix(`${window.location.origin}/offline-media/${encodeURIComponent(userId)}/`)
}

export { OFFLINE_CACHE }
