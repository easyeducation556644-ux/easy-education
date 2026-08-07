import { Readable } from "node:stream"
import { Innertube } from "youtubei.js"
import {
  isFullAdminProfile,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"

const DEFAULT_HEIGHT = 360
const MAX_HEIGHT = 720
const MAX_CHUNK_BYTES = 10 * 1024 * 1024

let youtubePromise

function getYoutubeClient() {
  const cookie = String(process.env.YOUTUBE_COOKIE || "").trim()
  if (!cookie) {
    const error = new Error("YouTube cookie is not configured")
    error.statusCode = 503
    throw error
  }
  if (!youtubePromise) {
    youtubePromise = Innertube.create({ cookie }).catch((error) => {
      youtubePromise = null
      throw error
    })
  }
  return youtubePromise
}

function parseHeight(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_HEIGHT), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(144, parsed))
}

function getVideoId(value) {
  try {
    const url = new URL(String(value || ""))
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || ""
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return ""
    if (url.searchParams.get("v")) return url.searchParams.get("v")
    const parts = url.pathname.split("/").filter(Boolean)
    if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || ""
  } catch {
    return ""
  }
  return ""
}

function getCombinedMp4Formats(info) {
  const streaming = info.streaming_data || {}
  return [...(streaming.formats || []), ...(streaming.adaptive_formats || [])]
    .filter((format) =>
      format.has_video &&
      format.has_audio &&
      String(format.mime_type || "").includes("video/mp4") &&
      Number.isFinite(format.height) &&
      format.height <= MAX_HEIGHT &&
      Number(format.content_length) > 0
    )
}

function selectFormat(info, requestedHeight) {
  const formats = getCombinedMp4Formats(info).sort((a, b) => a.height - b.height)
  if (!formats.length) return null
  const withinLimit = formats.filter((format) => format.height <= requestedHeight)
  return withinLimit.at(-1) || formats[0]
}

function getOptions(info) {
  const byHeight = new Map()
  for (const format of getCombinedMp4Formats(info)) {
    const current = byHeight.get(format.height)
    if (!current || Number(format.bitrate) > Number(current.bitrate)) {
      byHeight.set(format.height, format)
    }
  }
  return [...byHeight.values()]
    .sort((a, b) => a.height - b.height)
    .map((format) => ({
      height: format.height,
      contentLength: Number(format.content_length),
      mimeType: format.mime_type || "video/mp4",
    }))
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

  try {
    const classId = String(req.query?.classId || "").trim()
    if (!classId) return sendError(res, 400, "classId is required")

    const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
    const classSnapshot = await db.collection("classes").doc(classId).get()
    if (!classSnapshot.exists) return sendError(res, 404, "Class not found")

    const classData = classSnapshot.data() || {}
    const courseId = String(classData.courseId || "")
    const videoUrl = String(classData.videoURL || classData.youtubeLink || "")
    const videoId = getVideoId(videoUrl)
    if (!courseId || !videoId) {
      return sendError(res, 400, "This class does not have a valid YouTube video")
    }

    const canDownload = await hasCourseAccess({
      db,
      uid: decodedToken.uid,
      userProfile,
      courseId,
    })
    if (!canDownload) return sendError(res, 403, "Course access required")

    const youtube = await getYoutubeClient()
    const info = await youtube.getBasicInfo(videoId)
    const options = getOptions(info)

    if (req.query?.options === "1") {
      const recommended = options.filter((option) => option.height <= 360).at(-1)
        || options[0]
        || null
      return res.status(200).json({
        options,
        recommendedHeight: recommended?.height || null,
        chunkSize: MAX_CHUNK_BYTES,
      })
    }

    const requestedHeight = parseHeight(req.query?.height)
    const format = selectFormat(info, requestedHeight)
    if (!format) return sendError(res, 422, "No combined MP4 quality is available")

    const totalLength = Number(format.content_length)
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
    const stream = await info.download({
      itag: format.itag,
      range: { start, end },
    })

    res.status(206)
    res.setHeader("Content-Type", format.mime_type || "video/mp4")
    res.setHeader("Content-Length", String(end - start + 1))
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalLength}`)
    res.setHeader("Accept-Ranges", "bytes")
    res.setHeader("Cache-Control", "private, no-store")
    res.setHeader("X-Content-Type-Options", "nosniff")
    Readable.fromWeb(stream).pipe(res)
  } catch (error) {
    console.error("Offline video request failed:", error)
    const message = error?.message || "Unable to prepare offline video"
    const isAuthError = /bot|login|required|cookie|sign in/i.test(message)
    return sendError(
      res,
      error.statusCode || (isAuthError ? 502 : 500),
      isAuthError
        ? "YouTube authentication failed. Refresh the YOUTUBE_COOKIE secret."
        : message,
    )
  }
}
