import {
  getOfflineVideoUrl,
  getSavedOfflineVideoUrl,
  removeOfflineVideo,
  saveOfflineVideo,
} from "./offlineVideos"

const DOWNLOADS_KEY = "easy-education-download-jobs-v1"
const DOWNLOADS_EVENT = "easy-education-downloads-changed"
const activeDownloads = new Map()

function readJobs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DOWNLOADS_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeJobs(jobs) {
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(jobs))
  window.dispatchEvent(new CustomEvent(DOWNLOADS_EVENT, { detail: jobs }))
  return jobs
}

function updateJob(id, patch) {
  const jobs = readJobs()
  const index = jobs.findIndex((job) => job.id === id)
  if (index < 0) return null
  jobs[index] = { ...jobs[index], ...patch, updatedAt: Date.now() }
  writeJobs(jobs)
  return jobs[index]
}

function getJobId(userId, classId) {
  return `${userId}:${classId}`
}

export function getDownloadJobs(userId) {
  return readJobs()
    .filter((job) => !userId || job.userId === userId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
}

export function subscribeToDownloads(listener) {
  const handleChange = (event) => listener(event.detail || readJobs())
  window.addEventListener(DOWNLOADS_EVENT, handleChange)
  return () => window.removeEventListener(DOWNLOADS_EVENT, handleChange)
}

export async function startOfflineDownload({ user, job }) {
  if (!user?.uid || !job?.classId) return
  const id = getJobId(user.uid, job.classId)
  if (activeDownloads.has(id)) return activeDownloads.get(id).promise

  const controller = new AbortController()
  const promise = (async () => {
    updateJob(id, { status: "downloading", error: null })
    try {
      const playbackUrl = await saveOfflineVideo({
        user,
        classId: job.classId,
        videoUrl: job.videoUrl,
        height: job.height,
        signal: controller.signal,
        onProgress: (progress) => {
          updateJob(id, {
            status: "downloading",
            progress,
            downloadedBytes: Math.round((Number(job.totalBytes) || 0) * progress / 100),
          })
        },
      })
      updateJob(id, {
        status: "completed",
        progress: 100,
        downloadedBytes: Number(job.totalBytes) || 0,
        playbackUrl,
        completedAt: Date.now(),
      })
      return playbackUrl
    } catch (error) {
      const message = error?.message || "Download failed"
      const intentionallyPaused = activeDownloads.get(id)?.intentionalPause === true
      const reloadOrNetworkInterruption = !intentionallyPaused && (
        error?.name === "AbortError"
        || /Cache\.put|network error|Failed to fetch|Load failed/i.test(message)
      )
      updateJob(id, {
        status: intentionallyPaused
          ? "paused"
          : reloadOrNetworkInterruption
            ? "queued"
            : "error",
        error: intentionallyPaused
          ? null
          : reloadOrNetworkInterruption
            ? "Download interrupted — automatically resuming"
            : message,
      })
      throw error
    } finally {
      activeDownloads.delete(id)
    }
  })()

  activeDownloads.set(id, { controller, promise })
  promise.catch(() => {})
  return promise
}

export function queueOfflineDownload({
  user,
  classId,
  title,
  courseTitle,
  courseId,
  videoUrl,
  height,
  kind,
  totalBytes,
}) {
  const id = getJobId(user.uid, classId)
  const jobs = readJobs()
  const existing = jobs.find((job) => job.id === id)
  const job = {
    ...existing,
    id,
    userId: user.uid,
    classId,
    title: title || "Untitled class",
    courseTitle: courseTitle || "",
    courseId: courseId || "",
    videoUrl,
    height,
    kind: kind || "mp4",
    playbackUrl: existing?.playbackUrl || (
      kind === "hls"
        ? `${getOfflineVideoUrl(user.uid, classId)}/playlist.m3u8`
        : getOfflineVideoUrl(user.uid, classId)
    ),
    totalBytes: Number(totalBytes) || 0,
    downloadedBytes: Number(existing?.downloadedBytes) || 0,
    progress: Number(existing?.progress) || 0,
    status: existing?.status === "completed" ? "completed" : "queued",
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    error: null,
  }
  const next = jobs.filter((item) => item.id !== id)
  next.push(job)
  writeJobs(next)
  if (job.status !== "completed") startOfflineDownload({ user, job })
  return job
}

export function pauseOfflineDownload(userId, classId) {
  const id = getJobId(userId, classId)
  const active = activeDownloads.get(id)
  if (active) {
    active.intentionalPause = true
    active.controller.abort()
  }
  updateJob(id, { status: "paused" })
}

export function resumeOfflineDownload(user, classId) {
  const job = readJobs().find(
    (item) => item.userId === user?.uid && item.classId === classId,
  )
  if (!job || job.status === "completed") return null
  return startOfflineDownload({ user, job })
}

export function resumePendingDownloads(user) {
  if (!user?.uid) return
  for (const job of getDownloadJobs(user.uid)) {
    const reloadError = (
      job.status === "error"
      && /Cache\.put|network error|Failed to fetch|Load failed/i.test(job.error || "")
    )
    if (["queued", "downloading"].includes(job.status) || reloadError) {
      startOfflineDownload({ user, job })
    }
  }
}

export async function removeDownloadJob(userId, classId) {
  pauseOfflineDownload(userId, classId)
  await removeOfflineVideo(userId, classId)
  writeJobs(readJobs().filter(
    (job) => !(job.userId === userId && job.classId === classId),
  ))
}

export async function refreshDownloadPlaybackUrls(userId) {
  const jobs = getDownloadJobs(userId)
  let changed = false
  for (const job of jobs) {
    if (job.status !== "completed" && job.progress <= 0) continue
    const playbackUrl = await getSavedOfflineVideoUrl(userId, job.classId)
    if (playbackUrl && playbackUrl !== job.playbackUrl) {
      job.playbackUrl = playbackUrl
      changed = true
    }
  }
  if (changed) {
    const others = readJobs().filter((job) => job.userId !== userId)
    writeJobs([...others, ...jobs])
  }
  return jobs
}
