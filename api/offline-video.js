import ytdl from "@distube/ytdl-core"
import {
  isFullAdminProfile,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"

const DEFAULT_HEIGHT = 360
const MAX_HEIGHT = 720

function parseHeight(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_HEIGHT), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(144, parsed))
}

function selectProgressiveMp4(formats, requestedHeight) {
  const progressive = formats
    .filter(
      (format) =>
        format.hasVideo &&
        format.hasAudio &&
        format.container === "mp4" &&
        Number.isFinite(format.height),
    )
    .sort((a, b) => a.height - b.height)

  if (progressive.length === 0) return null

  const withinLimit = progressive.filter(
    (format) => format.height <= requestedHeight,
  )
  return withinLimit.at(-1) || progressive[0]
}

function getProgressiveMp4Options(formats) {
  const byHeight = new Map()

  formats
    .filter(
      (format) =>
        format.hasVideo &&
        format.hasAudio &&
        format.container === "mp4" &&
        Number.isFinite(format.height) &&
        format.height <= MAX_HEIGHT,
    )
    .forEach((format) => {
      const current = byHeight.get(format.height)
      const currentBitrate = Number(current?.bitrate) || 0
      const nextBitrate = Number(format.bitrate) || 0
      if (!current || nextBitrate > currentBitrate) {
        byHeight.set(format.height, format)
      }
    })

  return [...byHeight.values()]
    .sort((a, b) => a.height - b.height)
    .map((format) => ({
      height: format.height,
      contentLength: Number(format.contentLength) || null,
      mimeType: format.mimeType || "video/mp4",
    }))
}

async function hasCourseAccess({ db, uid, userProfile, courseId }) {
  if (isFullAdminProfile(userProfile)) return true

  const enrollmentId = `${uid}_${courseId}`
  const enrollment = await db.collection("userCourses").doc(enrollmentId).get()
  if (enrollment.exists) return true

  const payments = await db
    .collection("payments")
    .where("userId", "==", uid)
    .where("status", "==", "approved")
    .get()

  return payments.docs.some((paymentDoc) => {
    const courses = paymentDoc.data()?.courses
    return Array.isArray(courses) && courses.some((course) => course?.id === courseId)
  })
}

function sendError(res, statusCode, message) {
  if (!res.headersSent) {
    res.status(statusCode).json({ error: message })
  } else {
    res.end()
  }
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

    if (!classSnapshot.exists) {
      return sendError(res, 404, "Class not found")
    }

    const classData = classSnapshot.data() || {}
    const courseId = String(classData.courseId || "")
    const videoUrl = String(classData.youtubeLink || classData.videoURL || "")

    if (!courseId || !ytdl.validateURL(videoUrl)) {
      return sendError(res, 400, "This class does not have a valid YouTube video")
    }

    const canDownload = await hasCourseAccess({
      db,
      uid: decodedToken.uid,
      userProfile,
      courseId,
    })

    if (!canDownload) return sendError(res, 403, "Course access required")

    const info = await ytdl.getInfo(videoUrl)
    const options = getProgressiveMp4Options(info.formats)

    if (req.query?.options === "1") {
      const recommended = options.filter((option) => option.height <= 360).at(-1)
        || options[0]
        || null
      return res.status(200).json({
        options,
        recommendedHeight: recommended?.height || null,
      })
    }

    const requestedHeight = parseHeight(req.query?.height)
    const format = selectProgressiveMp4(info.formats, requestedHeight)
    if (!format) {
      return sendError(res, 422, "No offline-compatible MP4 format is available")
    }

    res.setHeader("Content-Type", format.mimeType || "video/mp4")
    if (format.contentLength) {
      res.setHeader("Content-Length", format.contentLength)
    }
    res.setHeader("Cache-Control", "private, no-store")
    res.setHeader("Content-Disposition", "inline")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Offline-Video-Height", String(format.height || ""))

    const stream = ytdl.downloadFromInfo(info, { format })
    stream.on("error", (error) => {
      console.error("Offline video stream failed:", error)
      sendError(res, 502, "Video stream failed")
    })
    stream.pipe(res)
  } catch (error) {
    console.error("Offline video request failed:", error)
    return sendError(
      res,
      error.statusCode || 500,
      error.statusCode ? error.message : "Unable to prepare offline video",
    )
  }
}
