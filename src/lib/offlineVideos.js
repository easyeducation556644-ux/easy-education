const OFFLINE_CACHE = "easy-education-offline-v1"
const OFFLINE_VIDEO_TTL_MS = 7 * 24 * 60 * 60 * 1000

function ensureSupport() {
  if (!("caches" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Offline video is not supported in this browser")
  }
}

export function getOfflineVideoUrl(userId, classId) {
  return `/offline-media/${encodeURIComponent(userId)}/${encodeURIComponent(classId)}`
}

export async function hasOfflineVideo(userId, classId) {
  if (!("caches" in window)) return false
  const cache = await caches.open(OFFLINE_CACHE)
  const cacheUrl = getOfflineVideoUrl(userId, classId)
  const response = await cache.match(cacheUrl)
  if (!response) return false

  const savedAt = Number(response.headers.get("x-offline-saved-at"))
  if (!savedAt || Date.now() - savedAt > OFFLINE_VIDEO_TTL_MS) {
    await cache.delete(cacheUrl)
    return false
  }

  return true
}

export async function removeOfflineVideo(userId, classId) {
  if (!("caches" in window)) return false
  const cache = await caches.open(OFFLINE_CACHE)
  return cache.delete(getOfflineVideoUrl(userId, classId))
}

export async function getOfflineVideoOptions({ user, classId, signal }) {
  const token = await user.getIdToken()
  const response = await fetch(
    `/api/offline-video?classId=${encodeURIComponent(classId)}&options=1`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  )

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to load offline video qualities")
  }

  return payload
}

export async function saveOfflineVideo({
  user,
  classId,
  height = 360,
  onProgress,
  signal,
}) {
  ensureSupport()

  const token = await user.getIdToken()
  const response = await fetch(
    `/api/offline-video?classId=${encodeURIComponent(classId)}&height=${height}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  )

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || "Unable to save video for offline viewing")
  }

  const contentLength = Number(response.headers.get("content-length")) || 0
  const cache = await caches.open(OFFLINE_CACHE)
  const cacheUrl = getOfflineVideoUrl(user.uid, classId)

  if (!response.body) {
    await cache.put(cacheUrl, response)
    onProgress?.(100)
    return cacheUrl
  }

  const [cacheBody, progressBody] = response.body.tee()
  const cacheHeaders = new Headers({
    "Content-Type": response.headers.get("content-type") || "video/mp4",
    "Cache-Control": "private, max-age=604800",
    "X-Offline-Saved-At": String(Date.now()),
  })
  if (response.headers.get("content-length")) {
    cacheHeaders.set("Content-Length", response.headers.get("content-length"))
  }

  const cacheResponse = new Response(cacheBody, {
    status: 200,
    headers: cacheHeaders,
  })

  const progressPromise = (async () => {
    const reader = progressBody.getReader()
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (contentLength > 0) {
        onProgress?.(Math.min(99, Math.round((received / contentLength) * 100)))
      }
    }
  })()

  try {
    await Promise.all([cache.put(cacheUrl, cacheResponse), progressPromise])
    onProgress?.(100)
    return cacheUrl
  } catch (error) {
    await cache.delete(cacheUrl)
    throw error
  }
}

export async function removeOfflineVideosForOtherUsers(currentUserId) {
  if (!("caches" in window)) return
  const cache = await caches.open(OFFLINE_CACHE)
  const keys = await cache.keys()
  const ownPrefix = `${window.location.origin}/offline-media/${encodeURIComponent(currentUserId)}/`

  await Promise.all(
    keys
      .filter((request) => !request.url.startsWith(ownPrefix))
      .map((request) => cache.delete(request)),
  )
}

export async function removeOfflineVideosForUser(userId) {
  if (!("caches" in window) || !userId) return
  const cache = await caches.open(OFFLINE_CACHE)
  const keys = await cache.keys()
  const userPrefix = `${window.location.origin}/offline-media/${encodeURIComponent(userId)}/`

  await Promise.all(
    keys
      .filter((request) => request.url.startsWith(userPrefix))
      .map((request) => cache.delete(request)),
  )
}

export { OFFLINE_CACHE }
