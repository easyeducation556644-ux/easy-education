const OFFLINE_CACHE = "easy-education-offline-v2"
const OFFLINE_VIDEO_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FALLBACK_CHUNK_SIZE = 8 * 1024 * 1024

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

async function readManifest(cache, userId, classId) {
  const response = await cache.match(getManifestUrl(userId, classId))
  if (!response) return null
  return response.json().catch(() => null)
}

export async function hasOfflineVideo(userId, classId) {
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
  if (!("caches" in window)) return false
  const cache = await caches.open(OFFLINE_CACHE)
  const prefix = `${window.location.origin}${getOfflineVideoUrl(userId, classId)}/`
  const keys = await cache.keys()
  const targets = keys.filter((request) => request.url.startsWith(prefix))
  await Promise.all(targets.map((request) => cache.delete(request)))
  return targets.length > 0
}

export async function getOfflineVideoOptions({ user, classId, signal }) {
  const token = await user.getIdToken()
  const response = await fetch(
    `/api/offline-video?classId=${encodeURIComponent(classId)}&options=1`,
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

export async function saveOfflineVideo({
  user,
  classId,
  height = 360,
  onProgress,
  signal,
}) {
  ensureSupport()
  const metadata = await getOfflineVideoOptions({ user, classId, signal })
  const option = metadata.options?.find((item) => item.height === height)
    || metadata.options?.filter((item) => item.height <= height).at(-1)
    || metadata.options?.[0]
  if (!option?.contentLength) throw new Error("Selected quality size is unavailable")

  const totalBytes = Number(option.contentLength)
  const chunkSize = Math.min(Number(metadata.chunkSize) || FALLBACK_CHUNK_SIZE, 10 * 1024 * 1024)
  const totalChunks = Math.ceil(totalBytes / chunkSize)
  await ensureStorageSpace(totalBytes)

  const token = await user.getIdToken()
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
