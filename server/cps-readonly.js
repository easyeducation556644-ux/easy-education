import { getAdminServices, isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const ENTITLEMENTS = "cpsEntitlements"
const MAX_LIST_PAGES = 20
const PAGE_SIZE = 100
const WRITE_BATCH_SIZE = 400
const MAX_BULK_TARGETS = 20_000

const sharedCache = globalThis.__easyEducationCpsReadCache || new Map()
globalThis.__easyEducationCpsReadCache = sharedCache

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
  res.setHeader("Cache-Control", "private, no-store")
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
  // CPS is an upstream READ-ONLY source. Every request to the CPS project is GET-only.
  // Grants, trials and revocations are stored only in Easy Education Firestore.
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

function cacheTtl(path) {
  if (path === "courses") return 5 * 60_000
  if (path === "live_classes") return 20_000
  if (path === "exams") return 90_000
  if (/^exams\/[^/]+\/questions$/.test(path)) return 60_000
  return 60_000
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

async function listCpsCollection(path, { force = false } = {}) {
  const key = `list:${path}`
  const cached = sharedCache.get(key)
  const now = Date.now()
  if (!force && cached && now - cached.at < cacheTtl(path)) return cached.value

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
  sharedCache.set(key, { at: now, value: docs })
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
  return { id: snapshot.id, ...(snapshot.data() || {}) }
}

async function getActiveEntitlementMap(db, uid) {
  const snapshot = await db.collection(ENTITLEMENTS).where("userId", "==", uid).get()
  const now = Date.now()
  const result = new Map()
  snapshot.docs.forEach((entry) => {
    const data = { id: entry.id, ...entry.data() }
    if (!activeEntitlement(data, now)) return
    const rawCourseId = normalizeCourseId(data.cpsCourseId || data.courseId)
    if (rawCourseId) result.set(rawCourseId, data)
  })
  return result
}

async function optionalCourseAccess(authenticated, rawCourseId) {
  if (isFullAdminProfile(authenticated.userProfile)) return { adminPreview: true, expiresAtMs: 0 }
  const entitlement = await getEntitlement(authenticated.db, authenticated.decodedToken.uid, rawCourseId)
  return activeEntitlement(entitlement) ? entitlement : null
}

async function requireCourseAccess(authenticated, rawCourseId) {
  const access = await optionalCourseAccess(authenticated, rawCourseId)
  if (!access) throw httpError(403, "CPS course access is missing or expired")
  return access
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

function isVisibleCourse(course) {
  return course && course.isDeleted !== true && course.bin !== true && course.hidden !== true
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

function mapRecordedClass(rawCourseId, course, playlist, item, index, playable) {
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
    videoURL: playable ? firstText(item?.videoUrl, item?.videoURL, item?.url) : "",
    teacherName: instructorName(course),
    imageURL: firstText(item?.thumbnailUrl, item?.thumbnail, course?.thumbnail),
    resourceLinks: playable ? resourceLinks(item) : [],
    createdAt: Number.isFinite(published) ? published : 0,
    cpsSource: true,
    locked: !playable,
  }
}

function recordingUrl(recording) {
  if (typeof recording === "string") return recording.trim()
  return firstText(recording?.url, recording?.videoUrl, recording?.videoURL, recording?.link)
}

function mapLiveRecording(rawCourseId, course, live, recording, index, playable) {
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
    videoURL: playable ? url : "",
    teacherName: instructorName(course),
    imageURL: firstText(recording?.thumbnailUrl, live?.thumbnailUrl, course?.thumbnail),
    resourceLinks: [],
    createdAt: Date.parse(firstText(live?.startTime)) || 0,
    cpsSource: true,
    locked: !playable,
  }
}

function mapCourse(rawCourseId, course, access = null) {
  const hasAccess = Boolean(access)
  return {
    id: `cps:${rawCourseId}`,
    title: firstText(course?.title, course?.name) || "CPS Course",
    description: firstText(course?.description),
    thumbnail: firstText(course?.thumbnail, course?.thumbnailUrl),
    price: Number(course?.price || 0),
    courseFormat: "cps",
    telegramLink: hasAccess ? firstText(course?.groupLink) : "",
    source: "cps",
    hasAccess,
    accessExpiresAtMs: hasAccess ? Number(access?.expiresAtMs || 0) : 0,
  }
}

function mapLive(live, { access = null, courseTitle = "" } = {}) {
  const hasAccess = Boolean(access)
  return {
    id: String(live.id || ""),
    courseId: `cps:${String(live.courseId || "")}`,
    courseTitle,
    title: firstText(live.title, live.topic) || "Live class",
    topic: firstText(live.topic),
    startTime: firstText(live.startTime),
    url: hasAccess ? firstText(live.url) : "",
    status: firstText(live.status) || "upcoming",
    platform: firstText(live.platform),
    thumbnailUrl: firstText(live.thumbnailUrl),
    hasAccess,
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

async function coursePayload(rawCourseId, access = null) {
  const course = await readCpsDocument("courses", rawCourseId)
  if (!course || !isVisibleCourse(course)) throw httpError(404, "CPS course was not found")
  const playable = Boolean(access)

  const [allLive, allExams] = await Promise.all([
    listCpsCollection("live_classes"),
    listCpsCollection("exams"),
  ])
  const liveClasses = allLive.filter((item) => String(item.courseId || "") === rawCourseId)
  const exams = allExams.filter((item) => String(item.courseId || "") === rawCourseId)

  const classes = []
  asArray(course.playlists).forEach((playlist, playlistIndex) => {
    asArray(playlist?.classes).forEach((item, index) => {
      classes.push(mapRecordedClass(rawCourseId, course, { ...playlist, id: playlist?.id || `p${playlistIndex}` }, item, index, playable))
    })
  })
  liveClasses.forEach((live) => {
    asArray(live.recordings).forEach((recording, index) => {
      const mapped = mapLiveRecording(rawCourseId, course, live, recording, index, playable)
      if (mapped) classes.push(mapped)
    })
  })

  return {
    course: mapCourse(rawCourseId, course, access),
    classes,
    liveClasses: liveClasses.map((live) => mapLive(live, { access, courseTitle: firstText(course.title, course.name) })),
    exams: exams.map(mapExam),
    routines: course.routines || "",
    updates: course.updates || "",
    hasAccess: playable,
    accessExpiresAtMs: playable ? Number(access?.expiresAtMs || 0) : 0,
  }
}

function dhakaDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return formatter.format(date)
}

function isTodayOrRunning(live, now = new Date()) {
  if (String(live.status || "").toLowerCase() === "live") return true
  const start = firstText(live.startTime)
  if (!start) return false
  return dhakaDateKey(start) !== "" && dhakaDateKey(start) === dhakaDateKey(now)
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

async function handleBrowse(authenticated, res) {
  const uid = authenticated.decodedToken.uid
  const [allCourses, allLive, entitlementMap] = await Promise.all([
    listCpsCollection("courses"),
    listCpsCollection("live_classes"),
    isFullAdminProfile(authenticated.userProfile)
      ? Promise.resolve(new Map())
      : getActiveEntitlementMap(authenticated.db, uid),
  ])
  const visibleCourses = allCourses.filter(isVisibleCourse)
  const sourceById = new Map(visibleCourses.map((course) => [String(course.id), course]))
  const accessFor = (rawCourseId) => {
    if (isFullAdminProfile(authenticated.userProfile)) return { adminPreview: true, expiresAtMs: 0 }
    return entitlementMap.get(rawCourseId) || null
  }

  const courses = visibleCourses
    .map((course) => mapCourse(String(course.id), course, accessFor(String(course.id))))
    .sort((a, b) => a.title.localeCompare(b.title))

  const liveHighlights = allLive
    .filter((live) => sourceById.has(String(live.courseId || "")) && isTodayOrRunning(live))
    .sort((a, b) => {
      const aLive = String(a.status || "").toLowerCase() === "live" ? 0 : 1
      const bLive = String(b.status || "").toLowerCase() === "live" ? 0 : 1
      if (aLive !== bLive) return aLive - bLive
      return (Date.parse(firstText(a.startTime)) || Number.MAX_SAFE_INTEGER) - (Date.parse(firstText(b.startTime)) || Number.MAX_SAFE_INTEGER)
    })
    .slice(0, 12)
    .map((live) => {
      const rawCourseId = String(live.courseId || "")
      const course = sourceById.get(rawCourseId)
      return mapLive(live, {
        access: accessFor(rawCourseId),
        courseTitle: firstText(course?.title, course?.name),
      })
    })

  res.status(200).json({ courses, liveHighlights, serverTimeMs: Date.now() })
}

async function handleMine(authenticated, res) {
  const uid = authenticated.decodedToken.uid
  const entitlementMap = isFullAdminProfile(authenticated.userProfile)
    ? null
    : await getActiveEntitlementMap(authenticated.db, uid)
  const courses = []
  const sourceCourses = (await listCpsCollection("courses")).filter(isVisibleCourse)
  for (const source of sourceCourses) {
    const rawCourseId = String(source.id)
    const access = isFullAdminProfile(authenticated.userProfile)
      ? { adminPreview: true, expiresAtMs: 0 }
      : entitlementMap.get(rawCourseId)
    if (access) courses.push(mapCourse(rawCourseId, source, access))
  }
  res.status(200).json({ courses, serverTimeMs: Date.now() })
}

async function handlePreview(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  if (!rawCourseId) throw httpError(400, "courseId is required")
  const access = await optionalCourseAccess(authenticated, rawCourseId)
  res.status(200).json(await coursePayload(rawCourseId, access))
}

async function handleCourse(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  if (!rawCourseId) throw httpError(400, "courseId is required")
  const access = await requireCourseAccess(authenticated, rawCourseId)
  res.status(200).json(await coursePayload(rawCourseId, access))
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
  const courses = (await listCpsCollection("courses")).filter(isVisibleCourse)
  res.status(200).json({
    courses: courses
      .map((course) => ({
        ...mapCourse(String(course.id), course, null),
        hasActiveLiveClass: course.hasActiveLiveClass === true,
        batch: firstText(course.batch),
        category: firstText(course.category),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  })
}

function normalizeIds(value, mapper = String) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => mapper(item)).map((item) => String(item || "").trim()).filter(Boolean))]
}

async function resolveBulkTargets(authenticated, body) {
  const allUsers = body?.allUsers === true
  const allCourses = body?.allCourses === true
  const userIds = allUsers
    ? (await authenticated.db.collection("users").get()).docs.map((entry) => entry.id)
    : normalizeIds(body?.userIds)
  const visibleCourses = (await listCpsCollection("courses")).filter(isVisibleCourse)
  const courseById = new Map(visibleCourses.map((course) => [String(course.id), course]))
  const courseIds = allCourses
    ? [...courseById.keys()]
    : normalizeIds(body?.courseIds, normalizeCourseId).filter((id) => courseById.has(id))

  if (userIds.length === 0) throw httpError(400, "Select at least one user")
  if (courseIds.length === 0) throw httpError(400, "Select at least one CPS course")
  if (userIds.length * courseIds.length > MAX_BULK_TARGETS) {
    throw httpError(400, `Bulk grant is limited to ${MAX_BULK_TARGETS.toLocaleString()} user-course targets per request`)
  }
  return { userIds, courseIds, courseById }
}

async function handleGrantBatch(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const { userIds, courseIds, courseById } = await resolveBulkTargets(authenticated, req.body || {})
  const permanent = req.body?.permanent === true || String(req.body?.durationUnit || "").toLowerCase() === "permanent"
  const now = Date.now()
  const expiresAtMs = permanent ? 0 : now + durationMs(req.body?.durationValue, req.body?.durationUnit)
  const batchId = `cps-grant-${now}-${authenticated.decodedToken.uid}`

  let batch = authenticated.db.batch()
  let batchCount = 0
  let written = 0
  const flush = async () => {
    if (!batchCount) return
    await batch.commit()
    batch = authenticated.db.batch()
    batchCount = 0
  }

  for (const userId of userIds) {
    for (const rawCourseId of courseIds) {
      const course = courseById.get(rawCourseId)
      const data = {
        userId,
        cpsCourseId: rawCourseId,
        courseTitle: firstText(course?.title, course?.name) || "CPS Course",
        source: "cps",
        status: "active",
        accessType: permanent ? "permanent" : "trial",
        durationValue: permanent ? null : Number(req.body.durationValue),
        durationUnit: permanent ? "permanent" : String(req.body.durationUnit || "").toLowerCase(),
        grantedAtMs: now,
        expiresAtMs,
        grantedBy: authenticated.decodedToken.uid,
        updatedAtMs: now,
        batchId,
      }
      const ref = authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId))
      batch.set(ref, data, { merge: true })
      batchCount += 1
      written += 1
      if (batchCount >= WRITE_BATCH_SIZE) await flush()
    }
  }
  await flush()

  res.status(200).json({
    ok: true,
    users: userIds.length,
    courses: courseIds.length,
    grants: written,
    expiresAtMs,
    accessType: permanent ? "permanent" : "trial",
    batchId,
  })
}

async function handleGrant(authenticated, req, res) {
  req.body = {
    ...(req.body || {}),
    userIds: [String(req.body?.userId || "").trim()].filter(Boolean),
    courseIds: [normalizeCourseId(req.body?.courseId)].filter(Boolean),
  }
  return handleGrantBatch(authenticated, req, res)
}

async function handleRevokeBatch(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const { userIds, courseIds } = await resolveBulkTargets(authenticated, req.body || {})
  const now = Date.now()
  let batch = authenticated.db.batch()
  let batchCount = 0
  let written = 0
  const flush = async () => {
    if (!batchCount) return
    await batch.commit()
    batch = authenticated.db.batch()
    batchCount = 0
  }
  for (const userId of userIds) {
    for (const rawCourseId of courseIds) {
      const ref = authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId))
      batch.set(ref, {
        status: "revoked",
        revokedAtMs: now,
        updatedAtMs: now,
        revokedBy: authenticated.decodedToken.uid,
      }, { merge: true })
      batchCount += 1
      written += 1
      if (batchCount >= WRITE_BATCH_SIZE) await flush()
    }
  }
  await flush()
  res.status(200).json({ ok: true, revocations: written })
}

async function handleRevoke(authenticated, req, res) {
  req.body = {
    ...(req.body || {}),
    userIds: [String(req.body?.userId || "").trim()].filter(Boolean),
    courseIds: [normalizeCourseId(req.body?.courseId)].filter(Boolean),
  }
  return handleRevokeBatch(authenticated, req, res)
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    // getAdminServices is imported by the shared auth helper in this route family; keeping the
    // import here also makes bundling of Firebase Admin deterministic in Vercel's function graph.
    void getAdminServices
    const authenticated = await requireAuthenticatedUser(req)
    const action = String(req.query.action || req.body?.action || "mine").trim()

    if (req.method === "GET") {
      if (action === "browse") return await handleBrowse(authenticated, res)
      if (action === "mine") return await handleMine(authenticated, res)
      if (action === "preview") return await handlePreview(authenticated, req, res)
      if (action === "course") return await handleCourse(authenticated, req, res)
      if (action === "exam") return await handleExam(authenticated, req, res)
      if (action === "catalog") return await handleCatalog(authenticated, res)
      throw httpError(400, "Unknown CPS read action")
    }

    if (action === "grant") return await handleGrant(authenticated, req, res)
    if (action === "grantBatch") return await handleGrantBatch(authenticated, req, res)
    if (action === "revoke") return await handleRevoke(authenticated, req, res)
    if (action === "revokeBatch") return await handleRevokeBatch(authenticated, req, res)
    throw httpError(400, "Unknown CPS write action")
  } catch (error) {
    console.error("CPS bridge error:", error)
    res.status(Number(error?.statusCode) || 500).json({ error: error?.message || "CPS request failed" })
  }
}
