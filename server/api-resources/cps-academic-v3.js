import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const PAGE_SIZE = 100
const MAX_PAGES = 20
const MISSING_ORDER = 2147483647

const asArray = (value) => Array.isArray(value) ? value : []
const text = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim() || ""
const normalizeCourseId = (value) => String(value || "").trim().replace(/^cps:/, "")

function httpError(statusCode, message, code = "CPS_ACADEMIC_ERROR") {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}

function decodeValue(value = {}) {
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue)
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue)
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue)
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue)
  if (value.mapValue) return decodeFields(value.mapValue.fields || {})
  if (value.referenceValue) return value.referenceValue
  return null
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function decodeDocument(raw) {
  if (!raw?.name) return null
  return { id: String(raw.name).split("/").pop(), ...decodeFields(raw.fields || {}) }
}

function sourceToken(req) {
  const header = String(req.headers?.["x-cps-firebase-token"] || "").replace(/^Bearer\s+/i, "").trim()
  const env = String(process.env.CPS_FIREBASE_ID_TOKEN || "").replace(/^Bearer\s+/i, "").trim()
  return header || env
}

async function queryPage(collectionId, token, offset) {
  const url = new URL(`${CPS_ROOT}:runQuery`)
  url.searchParams.set("key", CPS_API_KEY)
  const headers = { "Content-Type": "application/json", Accept: "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        limit: PAGE_SIZE,
        ...(offset ? { offset } : {}),
      },
    }),
    redirect: "follow",
  })
}

async function readCollection(collectionId, token, optional = false) {
  const all = []
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * PAGE_SIZE
      let response = await queryPage(collectionId, token, offset)
      if (token && (response.status === 401 || response.status === 403)) response = await queryPage(collectionId, "", offset)
      if (!response.ok) throw httpError(response.status === 403 ? 503 : 502, "CPS academic data is temporarily unavailable")
      const payload = await response.json()
      const batch = Array.isArray(payload) ? payload.map((entry) => decodeDocument(entry?.document)).filter(Boolean) : []
      all.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
    return all
  } catch (error) {
    if (optional) return []
    throw error
  }
}

function activeEntitlement(data) {
  if (!data || data.status === "revoked") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > Date.now()
}

async function courseAccess(authenticated, courseId) {
  if (isFullAdminProfile(authenticated.userProfile)) return { active: true, expiresAtMs: 0, type: "admin" }
  const id = `${authenticated.decodedToken.uid}_${courseId}`
  const snapshot = await authenticated.db.collection("cpsEntitlements").doc(id).get()
  const data = snapshot.exists ? snapshot.data() : null
  if (!activeEntitlement(data)) return { active: false, expiresAtMs: 0, type: "locked" }
  return {
    active: true,
    expiresAtMs: Number(data.expiresAtMs || 0),
    type: data.accessType || (data.expiresAtMs ? "trial" : "permanent"),
  }
}

function safeLink(url, allowed) {
  const value = text(url)
  return allowed && /^https?:\/\//i.test(value) ? value : ""
}

function normalizeRecording(recording, index, allowed) {
  if (typeof recording === "string") {
    return { id: `recording-${index}`, title: `Recording ${index + 1}`, url: safeLink(recording, allowed), thumbnailUrl: "" }
  }
  return {
    id: text(recording?.id) || `recording-${index}`,
    title: text(recording?.title, recording?.name) || `Recording ${index + 1}`,
    url: safeLink(recording?.url || recording?.videoUrl || recording?.videoURL || recording?.link, allowed),
    thumbnailUrl: text(recording?.thumbnailUrl, recording?.thumbnail),
  }
}

function classResources(course, allowed) {
  const result = []
  asArray(course?.playlists).forEach((playlist, playlistIndex) => {
    const playlistId = text(playlist?.id) || `playlist-${playlistIndex}`
    const chapter = text(playlist?.title, playlist?.name) || `Part ${playlistIndex + 1}`
    asArray(playlist?.classes).forEach((item, classIndex) => {
      const classId = text(item?.id) || `${playlistId}-${classIndex}`
      const add = (title, url, kind, downloadable = null) => {
        const raw = text(url)
        if (!raw || !/^https?:\/\//i.test(raw)) return
        result.push({
          id: `${classId}:${kind}:${result.length}`,
          classId: `cps-class:${classId}`,
          playlistId,
          chapter,
          title: title || "Resource",
          kind,
          isDownloadable: typeof downloadable === "boolean" ? downloadable : null,
          url: safeLink(raw, allowed),
          locked: !allowed,
        })
      }
      add(text(item?.resourceTitle) || `${text(item?.title) || "Class"} resource`, item?.resourceUrl, "resource")
      asArray(item?.notes).forEach((note, noteIndex) => {
        if (typeof note === "string") add(`Note ${noteIndex + 1}`, note, "note")
        else add(text(note?.title, note?.label, note?.name) || `Note ${noteIndex + 1}`, note?.url || note?.link || note?.href, "note", note?.isDownloadable)
      })
    })
  })
  return result
}

function lectureNoteResources(notes, courseId, classIndex, allowed) {
  return notes
    .filter((note) => normalizeCourseId(note?.courseId) === courseId)
    .filter((note) => !note?.status || String(note.status).toLowerCase() === "approved")
    .flatMap((note) => {
      const rawVideoId = text(note?.videoId).replace(/^cps-class:/, "")
      const classMeta = classIndex.get(rawVideoId)
      const link = text(note?.link)
      if (!link || !/^https?:\/\//i.test(link)) return []
      return [{
        id: `lecture-note:${note.id}`,
        classId: rawVideoId ? `cps-class:${rawVideoId}` : "",
        playlistId: classMeta?.playlistId || "",
        chapter: text(note?.categoryTitle) || classMeta?.chapter || "Resources",
        title: text(note?.videoTitle) || "Class note",
        kind: "lecture-note",
        isDownloadable: null,
        url: safeLink(link, allowed),
        locked: !allowed,
      }]
    })
}

function parseTimestampSeconds(rawValue) {
  const parts = String(rawValue || "").trim().split(":").map((part) => Number(part))
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null
  if (parts.length === 2) return Math.floor(parts[0] * 60 + parts[1])
  return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2])
}

function topicsFromCourseTimestamps(course, allowed) {
  const topics = []
  asArray(course?.playlists).forEach((playlist, playlistIndex) => {
    const playlistId = text(playlist?.id) || `playlist-${playlistIndex}`
    const chapter = text(playlist?.title, playlist?.name) || `Part ${playlistIndex + 1}`
    asArray(playlist?.classes).forEach((item, classIndex) => {
      const rawClassId = text(item?.id) || `${playlistId}-${classIndex}`
      const classTitle = text(item?.title, item?.topic) || `Class ${classIndex + 1}`
      const rawTimestamps = typeof item?.timestamps === "string" ? item.timestamps : ""
      rawTimestamps.split(/\r?\n/).forEach((line, lineIndex) => {
        const match = line.match(/^\s*(\d{1,3}(?::\d{1,2}){1,2})\s*[-–—]\s*(.+?)\s*$/)
        if (!match) return
        const seconds = parseTimestampSeconds(match[1])
        const title = text(match[2])
        if (seconds == null || !title) return
        topics.push({
          id: `topic:${rawClassId}:${seconds}:${lineIndex}`,
          classId: `cps-class:${rawClassId}`,
          classTitle,
          playlistId,
          chapter,
          title,
          videoTimestamp: seconds,
          canOpen: allowed,
        })
      })
    })
  })
  return topics
}

function explicitOrder(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sortTimeMs(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 100000000000 ? value * 1000 : value
    const raw = String(value).trim()
    if (!raw) continue
    const numeric = Number(raw)
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 100000000000 ? numeric * 1000 : numeric
    const idMillis = raw.match(/(?:^|[-_:])(\d{12,14})(?:$|[-_:])/)
    if (idMillis) return Number(idMillis[1])
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return Number.MAX_SAFE_INTEGER
}

function buildCourseIndex(course, allowed) {
  const playlistIndex = new Map()
  const classIndex = new Map()
  const playlists = asArray(course?.playlists).map((playlist, playlistIndexNumber) => {
    const id = text(playlist?.id) || `playlist-${playlistIndexNumber}`
    const title = text(playlist?.title, playlist?.name) || `Part ${playlistIndexNumber + 1}`
    const type = text(playlist?.type)
    const sourceOrder = explicitOrder(playlist?.order)
    const playlistTime = sortTimeMs(
      playlist?.createdAt,
      playlist?.updatedAt,
      id,
      ...asArray(playlist?.classes).slice(0, 3).map((item) => item?.createdAt),
    )
    const order = sourceOrder ?? MISSING_ORDER
    const classes = asArray(playlist?.classes).map((item, classIndexNumber) => {
      const rawClassId = text(item?.id) || `${id}-${classIndexNumber}`
      const normalizedId = `cps-class:${rawClassId}`
      const classTitle = text(item?.title, item?.topic) || `Class ${classIndexNumber + 1}`
      const classSourceOrder = explicitOrder(item?.order)
      const classTime = sortTimeMs(item?.createdAt, item?.updatedAt, rawClassId)
      classIndex.set(rawClassId, { playlistId: id, chapter: title, classTitle })
      return {
        id: normalizedId,
        rawId: rawClassId,
        title: classTitle,
        description: text(item?.description),
        cdnType: text(item?.cdnType),
        videoUrl: safeLink(item?.videoUrl || item?.videoURL || item?.url, allowed),
        thumbnailUrl: text(item?.thumbnailUrl, item?.thumbnail),
        order: classSourceOrder ?? MISSING_ORDER,
        orderExplicit: classSourceOrder !== null,
        sortTimeMs: classTime,
        timestamps: typeof item?.timestamps === "string" ? item.timestamps : "",
        hasAccess: allowed,
      }
    }).sort((a, b) => a.order - b.order || a.sortTimeMs - b.sortTimeMs || a.title.localeCompare(b.title))
    const mapped = {
      id,
      title,
      type,
      order,
      orderExplicit: sourceOrder !== null,
      sortTimeMs: playlistTime,
      classIds: classes.map((item) => item.id),
      classes,
    }
    playlistIndex.set(id, mapped)
    return mapped
  }).sort((a, b) => a.order - b.order || a.sortTimeMs - b.sortTimeMs || a.title.localeCompare(b.title))
  return { playlists, playlistIndex, classIndex }
}

function routineValue(course) {
  const explicit = text(course?.routines, course?.routine)
  if (explicit) return explicit
  const config = course?.routineConfig
  if (config && typeof config === "object") {
    const url = text(config.url, config.link)
    if (url) return url
  }
  return ""
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CPS-Firebase-Token")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Cache-Control", "private, no-store")
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  try {
    const authenticated = await requireAuthenticatedUser(req)
    const courseId = normalizeCourseId(req.query?.courseId)
    if (!courseId) throw httpError(400, "courseId is required")
    const token = sourceToken(req)
    const [courses, liveClasses, exams, lectureNotes] = await Promise.all([
      readCollection("courses", token),
      readCollection("live_classes", token, true),
      readCollection("exams", token, true),
      readCollection("lectureNotes", token, true),
    ])
    const course = courses.find((item) => String(item.id) === courseId && item.isDeleted !== true && item.hidden !== true && item.bin !== true)
    if (!course) throw httpError(404, "CPS course was not found")
    const access = await courseAccess(authenticated, courseId)
    const { playlists, playlistIndex, classIndex } = buildCourseIndex(course, access.active)

    const courseLive = liveClasses
      .filter((item) => normalizeCourseId(item?.courseId) === courseId)
      .map((item) => {
        const playlistId = text(item?.playlistId)
        const playlistTitle = playlistIndex.get(playlistId)?.title || text(item?.topic) || "Live classes"
        return {
          id: String(item.id || ""),
          courseId: `cps:${courseId}`,
          playlistId,
          playlistTitle,
          title: text(item?.title, item?.topic) || "Live class",
          topic: text(item?.topic),
          startTime: text(item?.startTime),
          status: text(item?.status) || "upcoming",
          platform: text(item?.platform),
          thumbnailUrl: text(item?.thumbnailUrl),
          url: safeLink(item?.url, access.active),
          recordings: asArray(item?.recordings).map((recording, index) => normalizeRecording(recording, index, access.active)),
          hasAccess: access.active,
        }
      })
      .sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0))

    const allResources = [
      ...classResources(course, access.active),
      ...lectureNoteResources(lectureNotes, courseId, classIndex, access.active),
    ]
    const topics = topicsFromCourseTimestamps(course, access.active)
    const courseExams = exams.filter((item) => normalizeCourseId(item?.courseId) === courseId)
    const routine = routineValue(course)

    res.status(200).json({
      courseId: `cps:${courseId}`,
      hasAccess: access.active,
      accessExpiresAtMs: access.expiresAtMs,
      playlists,
      liveClasses: courseLive,
      resources: allResources,
      topics,
      routine,
      routineConfig: course?.routineConfig && typeof course.routineConfig === "object" ? course.routineConfig : null,
      calendarEvents: [
        ...courseLive.map((item) => ({ id: `live:${item.id}`, kind: "live", title: item.title, startTime: item.startTime, endTime: "", status: item.status, playlistId: item.playlistId })),
        ...courseExams.map((item) => ({ id: `exam:${item.id}`, kind: "exam", title: text(item?.title) || "Exam", startTime: text(item?.startTime, item?.date), endTime: text(item?.endTime), status: text(item?.status), playlistId: text(item?.playlistId) })),
      ],
    })
  } catch (error) {
    const status = Number(error?.statusCode || 500)
    res.status(status).json({ error: error?.message || "CPS academic data could not be loaded", code: error?.code || "CPS_ACADEMIC_ERROR" })
  }
}
