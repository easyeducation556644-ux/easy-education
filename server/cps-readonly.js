import { getAdminServices, isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const ENTITLEMENTS = "cpsEntitlements"
const MAX_LIST_PAGES = 20
const PAGE_SIZE = 100

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

function docId(name = "") {
  const pieces = String(name).split("/")
  return pieces[pieces.length - 1] || ""
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
  return { id: docId(raw.name), ...decodeFields(raw.fields || {}) }
}

function cpsHeaders() {
  const headers = { Accept: "application/json" }
  const token = process.env.CPS_FIREBASE_ID_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function cpsRead(url) {
  // IMPORTANT: CPS is an upstream READ-ONLY source. Every upstream request is a GET.
  // Administrative grants and revocations are stored only in Easy Education Firestore below.
  const response = await fetch(url, { method: "GET", headers: cpsHeaders(), redirect: "follow" })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw httpError(
      response.status === 401 || response.status === 403 ? 502 : response.status,
      `CPS read failed (${response.status})${text ? `: ${text.slice(0, 220)}` : ""}`,
    )
  }
  return response.json()
}

function cpsUrl(path, params = {}) {
  const suffix = path.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  const url = new URL(`${CPS_ROOT}/${suffix}`)
  url.searchParams.set("key", CPS_API_KEY)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function readCpsDocument(collectionName, id, subcollection = "", subId = "") {
  const path = [collectionName, id, subcollection, subId].filter(Boolean).join("/")
  try {
    return decodeDocument(await cpsRead(cpsUrl(path)))
  } catch (error) {
    if (error.statusCode === 404) return null
    throw error
  }
}

async function listCpsCollection(path) {
  const docs = []
  let pageToken = ""
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const payload = await cpsRead(cpsUrl(path, { pageSize: PAGE_SIZE, pageToken }))
    for (const raw of payload.documents || []) {
      const decoded = decodeDocument(raw)
      if (decoded) docs.push(decoded)
    }
    pageToken = payload.nextPageToken || ""
    if (!pageToken) break
  }
  return docs
}

function entitlementId(uid, courseId) {
  return `${uid}_${courseId}`
}

function normalizeCourseId(value) {
  return String(value || "").trim().replace(/^cps:/, "")
}

function activeEntitlement(data, now = Date.now()) {
  if (!data || data.status === "revoked") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > now
}

async function getEntitlement(db, uid, rawCourseId) {
  const snapshot = await db.collection(ENTITLEMENTS).doc(entitlementId(uid, rawCourseId)).get()
  if (!snapshot.exists) return null
  const data = snapshot.data() || {}
  return { id: snapshot.id, ...data }
}

async function requireCourseAccess(authenticated, rawCourseId) {
  if (isFullAdminProfile(authenticated.userProfile)) return { adminPreview: true, expiresAtMs: 0 }
  const entitlement = await getEntitlement(authenticated.db, authenticated.decodedToken.uid, rawCourseId)
  if (!activeEntitlement(entitlement)) throw httpError(403, "CPS course access is missing or expired")
  return entitlement
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function instructorName(course) {
  return asArray(course.instructors)
    .map((item) => firstText(item?.name, item?.title))
    .filter(Boolean)
    .join(", ") || "CPS"
}

function resourceLinks(item) {
  const links = []
  const add = (label, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return
    if (links.some((entry) => entry.url === url.trim())) return
    links.push({ label, url: url.trim() })
  }
  add("Class resource", item?.resourceUrl)
  asArray(item?.notes).forEach((note, index) => {
    if (typeof note === "string") add(`Note ${index + 1}`, note)
    else add(firstText(note?.title, note?.label, note?.name) || `Note ${index + 1}`, firstText(note?.url, note?.link, note?.href))
  })
  return links
}

function mapRecordedClass(rawCourseId, course, playlist, item, index) {
  const rawId = firstText(item?.id) || `${playlist?.id || "playlist"}-${index}`
  const published = Date.parse(firstText(item?.createdAt))
  return {
    id: `cps-class:${rawId}`,
    courseId: `cps:${rawCourseId}`,
    title: firstText(item?.title, item?.topic) || `Class ${index + 1}`,
    topic: firstText(item?.description, item?.topic),
    subject: [firstText(playlist?.title, playlist?.name) || "Classes"],
    chapter: [],
    order: Number(item?.order ?? index),
    duration: firstText(item?.duration, item?.durationSeconds ? `${item.durationSeconds}s` : ""),
    videoURL: firstText(item?.videoUrl, item?.videoURL, item?.url),
    teacherName: instructorName(course),
    imageURL: firstText(item?.thumbnailUrl, item?.thumbnail, course?.thumbnail),
    resourceLinks: resourceLinks(item),
    createdAt: Number.isFinite(published) ? published : 0,
    cpsSource: true,
  }
}

function recordingUrl(recording) {
  if (typeof recording === "string") return recording.trim()
  return firstText(recording?.url, recording?.videoUrl, recording?.videoURL, recording?.link)
}

function mapLiveRecording(rawCourseId, course, live, recording, index) {
  const url = recordingUrl(recording)
  if (!url) return null
  const baseId = firstText(live?.id) || "live"
  return {
    id: `cps-recording:${baseId}:${index}`,
    courseId: `cps:${rawCourseId}`,
    title: firstText(recording?.title, live?.title, live?.topic) || `Live recording ${index + 1}`,
    topic: "Past live class recording",
    subject: ["Past live classes"],
    chapter: [],
    order: 50_000 + index,
    duration: "",
    videoURL: url,
    teacherName: instructorName(course),
    imageURL: firstText(recording?.thumbnailUrl, live?.thumbnailUrl, course?.thumbnail),
    resourceLinks: [],
    createdAt: Date.parse(firstText(live?.startTime)) || 0,
    cpsSource: true,
  }
}

function mapCourse(rawCourseId, course, expiresAtMs = 0) {
  return {
    id: `cps:${rawCourseId}`,
    title: firstText(course?.title, course?.name) || "CPS Course",
    description: firstText(course?.description),
    thumbnail: firstText(course?.thumbnail, course?.thumbnailUrl),
    price: Number(course?.price || 0),
    courseFormat: "cps",
    telegramLink: firstText(course?.groupLink),
    source: "cps",
    accessExpiresAtMs: Number(expiresAtMs || 0),
  }
}

function mapLive(live) {
  return {
    id: String(live.id || ""),
    title: firstText(live.title, live.topic) || "Live class",
    topic: firstText(live.topic),
    startTime: firstText(live.startTime),
    url: firstText(live.url),
    status: firstText(live.status) || "upcoming",
    platform: firstText(live.platform),
    thumbnailUrl: firstText(live.thumbnailUrl),
  }
}

function mapExam(exam) {
  return {
    id: String(exam.id || ""),
    title: firstText(exam.title) || "Exam",
    description: firstText(exam.description),
    status: firstText(exam.status),
    date: firstText(exam.date),
    startTime: firstText(exam.startTime),
    endTime: firstText(exam.endTime),
    duration: Number(exam.duration || 0),
    questionsCount: Number(exam.questionsCount || 0),
    maxScore: Number(exam.maxScore || 0),
    negativeMarks: Number(exam.negativeMarks || 0),
  }
}

async function coursePayload(rawCourseId, expiresAtMs) {
  const course = await readCpsDocument("courses", rawCourseId)
  if (!course) throw httpError(404, "CPS course was not found")

  const [allLive, allExams] = await Promise.all([
    listCpsCollection("live_classes"),
    listCpsCollection("exams"),
  ])
  const liveClasses = allLive.filter((item) => String(item.courseId || "") === rawCourseId)
  const exams = allExams.filter((item) => String(item.courseId || "") === rawCourseId)

  const classes = []
  asArray(course.playlists).forEach((playlist, playlistIndex) => {
    asArray(playlist?.classes).forEach((item, index) => {
      classes.push(mapRecordedClass(rawCourseId, course, { ...playlist, id: playlist?.id || `p${playlistIndex}` }, item, index))
    })
  })
  liveClasses.forEach((live) => {
    asArray(live.recordings).forEach((recording, index) => {
      const mapped = mapLiveRecording(rawCourseId, course, live, recording, index)
      if (mapped) classes.push(mapped)
    })
  })

  return {
    course: mapCourse(rawCourseId, course, expiresAtMs),
    classes,
    liveClasses: liveClasses.map(mapLive),
    exams: exams.map(mapExam),
    routines: course.routines || "",
    updates: course.updates || "",
    accessExpiresAtMs: Number(expiresAtMs || 0),
  }
}

function durationMs(value, unit) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, "A positive duration value is required")
  const normalized = String(unit || "").toLowerCase()
  const multipliers = {
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
    month: 30 * 86_400_000,
    months: 30 * 86_400_000,
  }
  const multiplier = multipliers[normalized]
  if (!multiplier) throw httpError(400, "Duration unit must be minutes, hours, days or months")
  return amount * multiplier
}

async function handleMine(authenticated, res) {
  const uid = authenticated.decodedToken.uid
  const snapshot = await authenticated.db.collection(ENTITLEMENTS).where("userId", "==", uid).get()
  const now = Date.now()
  const active = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => activeEntitlement(item, now))
  const courses = []
  for (const entitlement of active) {
    const rawCourseId = normalizeCourseId(entitlement.cpsCourseId || entitlement.courseId)
    if (!rawCourseId) continue
    const source = await readCpsDocument("courses", rawCourseId)
    if (!source) continue
    courses.push(mapCourse(rawCourseId, source, entitlement.expiresAtMs))
  }
  res.status(200).json({ courses, serverTimeMs: now })
}

async function handleCourse(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  if (!rawCourseId) throw httpError(400, "courseId is required")
  const entitlement = await requireCourseAccess(authenticated, rawCourseId)
  res.status(200).json(await coursePayload(rawCourseId, entitlement.expiresAtMs))
}

async function handleExam(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  const examId = String(req.query.examId || "").trim()
  if (!rawCourseId || !examId) throw httpError(400, "courseId and examId are required")
  await requireCourseAccess(authenticated, rawCourseId)
  const exam = await readCpsDocument("exams", examId)
  if (!exam || String(exam.courseId || "") !== rawCourseId) throw httpError(404, "Exam was not found for this course")
  const questions = await listCpsCollection(`exams/${examId}/questions`)
  res.status(200).json({
    exam: mapExam(exam),
    questions: questions.map((question) => ({
      id: String(question.id || ""),
      question: firstText(question.question),
      questionImageUrl: firstText(question.questionImageUrl),
      options: asArray(question.options).map(String),
      optionImageUrls: asArray(question.optionImageUrls).map(String),
      correctIndex: Number(question.correctIndex),
      explanation: firstText(question.explanation),
    })),
    submissionMode: "local-only",
  })
}

async function handleCatalog(authenticated, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const courses = await listCpsCollection("courses")
  res.status(200).json({ courses: courses.map((course) => mapCourse(course.id, course, 0)) })
}

async function handleGrant(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const userId = String(req.body?.userId || "").trim()
  const rawCourseId = normalizeCourseId(req.body?.courseId)
  if (!userId || !rawCourseId) throw httpError(400, "userId and courseId are required")

  const course = await readCpsDocument("courses", rawCourseId)
  if (!course) throw httpError(404, "CPS course was not found")

  const permanent = req.body?.permanent === true || String(req.body?.durationUnit || "").toLowerCase() === "permanent"
  const now = Date.now()
  const expiresAtMs = permanent ? 0 : now + durationMs(req.body?.durationValue, req.body?.durationUnit)
  const data = {
    userId,
    cpsCourseId: rawCourseId,
    courseTitle: firstText(course.title, course.name) || "CPS Course",
    source: "cps",
    status: "active",
    accessType: permanent ? "permanent" : "trial",
    durationValue: permanent ? null : Number(req.body.durationValue),
    durationUnit: permanent ? "permanent" : String(req.body.durationUnit || "").toLowerCase(),
    grantedAtMs: now,
    expiresAtMs,
    grantedBy: authenticated.decodedToken.uid,
    updatedAtMs: now,
  }
  // This is deliberately OUR Easy Education Firestore, never CPS Firestore.
  await authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId)).set(data, { merge: true })
  res.status(200).json({ ok: true, entitlement: data })
}

async function handleRevoke(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const userId = String(req.body?.userId || "").trim()
  const rawCourseId = normalizeCourseId(req.body?.courseId)
  if (!userId || !rawCourseId) throw httpError(400, "userId and courseId are required")
  const now = Date.now()
  // This update is in OUR Easy Education Firestore only.
  await authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId)).set(
    { status: "revoked", revokedAtMs: now, updatedAtMs: now, revokedBy: authenticated.decodedToken.uid },
    { merge: true },
  )
  res.status(200).json({ ok: true })
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const authenticated = await requireAuthenticatedUser(req)
    const action = String(req.query.action || req.body?.action || "mine").trim()

    if (req.method === "GET") {
      if (action === "mine") return await handleMine(authenticated, res)
      if (action === "course") return await handleCourse(authenticated, req, res)
      if (action === "exam") return await handleExam(authenticated, req, res)
      if (action === "catalog") return await handleCatalog(authenticated, res)
      throw httpError(400, "Unknown CPS read action")
    }

    if (action === "grant") return await handleGrant(authenticated, req, res)
    if (action === "revoke") return await handleRevoke(authenticated, req, res)
    throw httpError(400, "Unknown CPS write action")
  } catch (error) {
    console.error("CPS bridge error:", error)
    res.status(Number(error?.statusCode) || 500).json({ error: error?.message || "CPS request failed" })
  }
}
