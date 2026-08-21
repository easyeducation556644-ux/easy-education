import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const ENTITLEMENTS = "cpsEntitlements"
const PAGE_SIZE = 100
const MAX_LIST_PAGES = 20
const SOURCE_CACHE_TTL_MS = 60_000
const sourceCache = new Map()

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
  // CPS is strictly upstream READ-ONLY. Every request to the CPS project is GET.
  // All access grants/revocations are written only to Easy Education Firestore.
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
  const suffix = String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/")
  const url = new URL(`${CPS_ROOT}/${suffix}`)
  url.searchParams.set("key", CPS_API_KEY)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function cachedSource(key, loader) {
  const now = Date.now()
  const cached = sourceCache.get(key)
  if (cached && now - cached.at < SOURCE_CACHE_TTL_MS) return cached.value
  const value = await loader()
  sourceCache.set(key, { at: now, value })
  return value
}

async function readCpsDocument(collectionName, id, subcollection = "", subId = "") {
  const path = [collectionName, id, subcollection, subId].filter(Boolean).join("/")
  return cachedSource(`doc:${path}`, async () => {
    try {
      return decodeDocument(await cpsRead(cpsUrl(path)))
    } catch (error) {
      if (error.statusCode === 404) return null
      throw error
    }
  })
}

async function listCpsCollection(path) {
  return cachedSource(`list:${path}`, async () => {
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
  })
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
  return asArray(course?.instructors)
    .map((item) => firstText(item?.name, item?.title))
    .filter(Boolean)
    .join(", ") || "CPS"
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

async function entitlementMap(authenticated) {
  if (isFullAdminProfile(authenticated.userProfile)) return { adminAll: true, map: new Map() }
  const uid = authenticated.decodedToken.uid
  const snapshot = await authenticated.db.collection(ENTITLEMENTS).where("userId", "==", uid).get()
  const now = Date.now()
  const map = new Map()
  snapshot.docs.forEach((item) => {
    const data = item.data() || {}
    if (!activeEntitlement(data, now)) return
    const courseId = normalizeCourseId(data.cpsCourseId || data.courseId)
    if (courseId) map.set(courseId, { id: item.id, ...data })
  })
  return { adminAll: false, map }
}

async function getEntitlement(authenticated, rawCourseId) {
  if (isFullAdminProfile(authenticated.userProfile)) {
    return { adminPreview: true, status: "active", accessType: "permanent", expiresAtMs: 0 }
  }
  const snapshot = await authenticated.db.collection(ENTITLEMENTS)
    .doc(entitlementId(authenticated.decodedToken.uid, rawCourseId)).get()
  if (!snapshot.exists) return null
  const data = { id: snapshot.id, ...(snapshot.data() || {}) }
  return activeEntitlement(data) ? data : null
}

async function requireCourseAccess(authenticated, rawCourseId) {
  const entitlement = await getEntitlement(authenticated, rawCourseId)
  if (!entitlement) throw httpError(403, "CPS course access is missing or expired")
  return entitlement
}

function mapCourseBase(rawCourseId, course, options = {}) {
  const playlists = asArray(course?.playlists)
  const classCount = playlists.reduce((sum, playlist) => sum + asArray(playlist?.classes).length, 0)
  return {
    id: `cps:${rawCourseId}`,
    title: firstText(course?.title, course?.name) || "CPS Course",
    description: firstText(course?.description),
    thumbnail: firstText(course?.thumbnail, course?.thumbnailUrl),
    price: Number(course?.price || 0),
    courseFormat: "cps",
    source: "cps",
    playlistCount: playlists.length,
    classCount,
    hasInstantClass: classCount > 0,
    hasLiveClass: Boolean(options.hasLiveClass),
    hasAccess: Boolean(options.hasAccess),
    accessExpiresAtMs: Number(options.accessExpiresAtMs || 0),
    accessType: firstText(options.accessType),
    ...(options.includeProtected ? { telegramLink: firstText(course?.groupLink) } : {}),
  }
}

function mapPreviewClass(rawCourseId, course, playlist, item, index) {
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
    teacherName: instructorName(course),
    imageURL: firstText(item?.thumbnailUrl, item?.thumbnail, course?.thumbnail),
    hasVideo: Boolean(firstText(item?.videoUrl, item?.videoURL, item?.url)),
    hasResource: Boolean(firstText(item?.resourceUrl)) || asArray(item?.notes).length > 0,
    locked: true,
    createdAt: Number.isFinite(published) ? published : 0,
    cpsSource: true,
  }
}

function resourceLinks(item) {
  const links = []
  const add = (label, url) => {
    const value = firstText(url)
    if (!/^https?:\/\//i.test(value)) return
    if (!links.some((entry) => entry.url === value)) links.push({ label, url: value })
  }
  add("Class resource", item?.resourceUrl)
  asArray(item?.notes).forEach((note, index) => {
    if (typeof note === "string") add(`Note ${index + 1}`, note)
    else add(firstText(note?.title, note?.label, note?.name) || `Note ${index + 1}`, firstText(note?.url, note?.link, note?.href))
  })
  return links
}

function mapFullClass(rawCourseId, course, playlist, item, index) {
  return {
    ...mapPreviewClass(rawCourseId, course, playlist, item, index),
    videoURL: firstText(item?.videoUrl, item?.videoURL, item?.url),
    resourceLinks: resourceLinks(item),
    locked: false,
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
    locked: false,
    createdAt: Date.parse(firstText(live?.startTime)) || 0,
    cpsSource: true,
  }
}

function mapLive(live, { courseTitle = "", hasAccess = false, includeUrl = false } = {}) {
  return {
    id: String(live?.id || ""),
    courseId: `cps:${normalizeCourseId(live?.courseId)}`,
    courseTitle,
    title: firstText(live?.title, live?.topic) || "Live class",
    topic: firstText(live?.topic),
    startTime: firstText(live?.startTime),
    status: firstText(live?.status) || "upcoming",
    platform: firstText(live?.platform),
    thumbnailUrl: firstText(live?.thumbnailUrl),
    hasAccess,
    url: includeUrl ? firstText(live?.url) : "",
  }
}

function mapExam(exam) {
  return {
    id: String(exam?.id || ""),
    title: firstText(exam?.title) || "Exam",
    description: firstText(exam?.description),
    status: firstText(exam?.status),
    date: firstText(exam?.date),
    startTime: firstText(exam?.startTime),
    endTime: firstText(exam?.endTime),
    duration: Number(exam?.duration || 0),
    questionsCount: Number(exam?.questionsCount || 0),
    maxScore: Number(exam?.maxScore || 0),
    negativeMarks: Number(exam?.negativeMarks || 0),
  }
}

function dhakaDayKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value || ""
  return `${read("year")}-${read("month")}-${read("day")}`
}

function isRunningLive(live) {
  return ["live", "running", "ongoing", "started"].includes(firstText(live?.status).toLowerCase())
}

function chooseFeaturedLive(liveClasses, courseById, accessInfo) {
  const now = new Date()
  const todayKey = dhakaDayKey(now)
  const mapped = liveClasses.map((live) => {
    const rawCourseId = normalizeCourseId(live?.courseId)
    const course = courseById.get(rawCourseId)
    const entitlement = accessInfo.adminAll ? { expiresAtMs: 0 } : accessInfo.map.get(rawCourseId)
    return {
      source: live,
      value: mapLive(live, {
        courseTitle: firstText(course?.title, course?.name) || "CPS",
        hasAccess: accessInfo.adminAll || Boolean(entitlement),
        includeUrl: false,
      }),
    }
  })
  const running = mapped.filter(({ source }) => isRunningLive(source))
  if (running.length > 0) return running.sort((a, b) => (Date.parse(a.value.startTime) || 0) - (Date.parse(b.value.startTime) || 0))[0].value
  const today = mapped.filter(({ value }) => dhakaDayKey(value.startTime) === todayKey)
  if (today.length > 0) return today.sort((a, b) => (Date.parse(a.value.startTime) || Number.MAX_SAFE_INTEGER) - (Date.parse(b.value.startTime) || Number.MAX_SAFE_INTEGER))[0].value
  return null
}

async function sourceCatalog(authenticated) {
  const [courses, liveClasses, accessInfo] = await Promise.all([
    listCpsCollection("courses"),
    listCpsCollection("live_classes"),
    entitlementMap(authenticated),
  ])
  const courseById = new Map(courses.map((course) => [String(course.id), course]))
  const liveCourseIds = new Set(liveClasses.map((live) => normalizeCourseId(live.courseId)).filter(Boolean))
  const mappedCourses = courses.map((course) => {
    const entitlement = accessInfo.adminAll ? { expiresAtMs: 0, accessType: "permanent" } : accessInfo.map.get(String(course.id))
    return mapCourseBase(String(course.id), course, {
      hasLiveClass: liveCourseIds.has(String(course.id)),
      hasAccess: accessInfo.adminAll || Boolean(entitlement),
      accessExpiresAtMs: entitlement?.expiresAtMs || 0,
      accessType: entitlement?.accessType || "",
      includeProtected: false,
    })
  })
  return {
    courses: mappedCourses,
    featuredLive: chooseFeaturedLive(liveClasses, courseById, accessInfo),
    serverTimeMs: Date.now(),
  }
}

async function coursePayload(authenticated, rawCourseId, previewOnly = false) {
  const course = await readCpsDocument("courses", rawCourseId)
  if (!course) throw httpError(404, "CPS course was not found")
  const entitlement = await getEntitlement(authenticated, rawCourseId)
  const hasAccess = Boolean(entitlement)
  if (!previewOnly && !hasAccess) throw httpError(403, "CPS course access is missing or expired")

  const [allLive, allExams] = await Promise.all([
    listCpsCollection("live_classes"),
    listCpsCollection("exams"),
  ])
  const liveClasses = allLive.filter((item) => normalizeCourseId(item.courseId) === rawCourseId)
  const exams = allExams.filter((item) => normalizeCourseId(item.courseId) === rawCourseId)
  const classes = []

  asArray(course.playlists).forEach((playlist, playlistIndex) => {
    asArray(playlist?.classes).forEach((item, index) => {
      const playlistWithId = { ...playlist, id: playlist?.id || `p${playlistIndex}` }
      classes.push(previewOnly
        ? mapPreviewClass(rawCourseId, course, playlistWithId, item, index)
        : mapFullClass(rawCourseId, course, playlistWithId, item, index))
    })
  })

  if (!previewOnly) {
    liveClasses.forEach((live) => {
      asArray(live.recordings).forEach((recording, index) => {
        const mapped = mapLiveRecording(rawCourseId, course, live, recording, index)
        if (mapped) classes.push(mapped)
      })
    })
  }

  return {
    preview: previewOnly,
    hasAccess,
    course: mapCourseBase(rawCourseId, course, {
      hasLiveClass: liveClasses.length > 0,
      hasAccess,
      accessExpiresAtMs: entitlement?.expiresAtMs || 0,
      accessType: entitlement?.accessType || "",
      includeProtected: !previewOnly,
    }),
    classes,
    liveClasses: liveClasses.map((live) => mapLive(live, {
      courseTitle: firstText(course.title, course.name) || "CPS",
      hasAccess,
      includeUrl: !previewOnly && hasAccess,
    })),
    exams: exams.map(mapExam),
    routines: course.routines || "",
    updates: course.updates || "",
    accessExpiresAtMs: Number(entitlement?.expiresAtMs || 0),
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
  const catalog = await sourceCatalog(authenticated)
  res.status(200).json({
    courses: catalog.courses.filter((course) => course.hasAccess),
    serverTimeMs: catalog.serverTimeMs,
  })
}

async function handleCatalog(authenticated, res) {
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate")
  res.status(200).json(await sourceCatalog(authenticated))
}

async function handlePreview(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  if (!rawCourseId) throw httpError(400, "courseId is required")
  res.status(200).json(await coursePayload(authenticated, rawCourseId, true))
}

async function handleCourse(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  if (!rawCourseId) throw httpError(400, "courseId is required")
  res.status(200).json(await coursePayload(authenticated, rawCourseId, false))
}

async function handleExam(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query.courseId)
  const examId = String(req.query.examId || "").trim()
  if (!rawCourseId || !examId) throw httpError(400, "courseId and examId are required")
  await requireCourseAccess(authenticated, rawCourseId)
  const exam = await readCpsDocument("exams", examId)
  if (!exam || normalizeCourseId(exam.courseId) !== rawCourseId) throw httpError(404, "Exam was not found for this course")
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

async function handleAdminCatalog(authenticated, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const [courses, liveClasses] = await Promise.all([
    listCpsCollection("courses"),
    listCpsCollection("live_classes"),
  ])
  const liveCourseIds = new Set(liveClasses.map((item) => normalizeCourseId(item.courseId)).filter(Boolean))
  res.status(200).json({
    courses: courses.map((course) => mapCourseBase(String(course.id), course, {
      hasLiveClass: liveCourseIds.has(String(course.id)),
      includeProtected: false,
    })),
  })
}

async function grantOne(authenticated, { userId, rawCourseId, permanent, durationValue, durationUnit }) {
  const course = await readCpsDocument("courses", rawCourseId)
  if (!course) throw httpError(404, `CPS course was not found: ${rawCourseId}`)
  const now = Date.now()
  const expiresAtMs = permanent ? 0 : now + durationMs(durationValue, durationUnit)
  const data = {
    userId,
    cpsCourseId: rawCourseId,
    courseTitle: firstText(course.title, course.name) || "CPS Course",
    source: "cps",
    status: "active",
    accessType: permanent ? "permanent" : "trial",
    durationValue: permanent ? null : Number(durationValue),
    durationUnit: permanent ? "permanent" : String(durationUnit || "").toLowerCase(),
    grantedAtMs: now,
    expiresAtMs,
    grantedBy: authenticated.decodedToken.uid,
    updatedAtMs: now,
  }
  await authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId)).set(data, { merge: true })
  return data
}

async function handleGrant(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const userId = String(req.body?.userId || "").trim()
  const rawCourseId = normalizeCourseId(req.body?.courseId)
  if (!userId || !rawCourseId) throw httpError(400, "userId and courseId are required")
  const permanent = req.body?.permanent === true || String(req.body?.durationUnit || "").toLowerCase() === "permanent"
  const entitlement = await grantOne(authenticated, {
    userId,
    rawCourseId,
    permanent,
    durationValue: req.body?.durationValue,
    durationUnit: req.body?.durationUnit,
  })
  res.status(200).json({ ok: true, entitlement })
}

async function handleGrantBulk(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  let userIds = asArray(req.body?.userIds).map(String).map((item) => item.trim()).filter(Boolean)
  let courseIds = asArray(req.body?.courseIds).map(normalizeCourseId).filter(Boolean)
  if (req.body?.allUsers === true) {
    const users = await authenticated.db.collection("users").select().get()
    userIds = users.docs.map((item) => item.id)
  }
  if (req.body?.allCourses === true) {
    courseIds = (await listCpsCollection("courses")).map((item) => String(item.id))
  }
  userIds = [...new Set(userIds)]
  courseIds = [...new Set(courseIds)]
  if (userIds.length === 0 || courseIds.length === 0) throw httpError(400, "Select at least one user and one CPS course")
  if (userIds.length * courseIds.length > 5000) throw httpError(400, "Bulk grant is limited to 5,000 user-course assignments per request")
  const permanent = req.body?.permanent === true || String(req.body?.durationUnit || "").toLowerCase() === "permanent"
  let granted = 0
  for (const rawCourseId of courseIds) {
    const course = await readCpsDocument("courses", rawCourseId)
    if (!course) continue
    const now = Date.now()
    const expiresAtMs = permanent ? 0 : now + durationMs(req.body?.durationValue, req.body?.durationUnit)
    for (let start = 0; start < userIds.length; start += 400) {
      const batch = authenticated.db.batch()
      for (const userId of userIds.slice(start, start + 400)) {
        const ref = authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId))
        batch.set(ref, {
          userId,
          cpsCourseId: rawCourseId,
          courseTitle: firstText(course.title, course.name) || "CPS Course",
          source: "cps",
          status: "active",
          accessType: permanent ? "permanent" : "trial",
          durationValue: permanent ? null : Number(req.body?.durationValue),
          durationUnit: permanent ? "permanent" : String(req.body?.durationUnit || "").toLowerCase(),
          grantedAtMs: now,
          expiresAtMs,
          grantedBy: authenticated.decodedToken.uid,
          updatedAtMs: now,
        }, { merge: true })
        granted += 1
      }
      await batch.commit()
    }
  }
  res.status(200).json({ ok: true, granted, users: userIds.length, courses: courseIds.length })
}

async function handleRevoke(authenticated, req, res) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required")
  const userId = String(req.body?.userId || "").trim()
  const rawCourseId = normalizeCourseId(req.body?.courseId)
  if (!userId || !rawCourseId) throw httpError(400, "userId and courseId are required")
  const now = Date.now()
  await authenticated.db.collection(ENTITLEMENTS).doc(entitlementId(userId, rawCourseId)).set(
    { status: "revoked", revokedAtMs: now, updatedAtMs: now, revokedBy: authenticated.decodedToken.uid },
    { merge: true },
  )
  res.status(200).json({ ok: true })
}

export default async function cpsV2Handler(req, res) {
  setCors(res)
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const authenticated = await requireAuthenticatedUser(req)
    const action = String(req.query.action || req.body?.action || "mine").trim()
    if (req.method === "GET") {
      if (action === "mine") return await handleMine(authenticated, res)
      if (action === "catalog") return await handleCatalog(authenticated, res)
      if (action === "preview") return await handlePreview(authenticated, req, res)
      if (action === "course") return await handleCourse(authenticated, req, res)
      if (action === "exam") return await handleExam(authenticated, req, res)
      if (action === "adminCatalog") return await handleAdminCatalog(authenticated, res)
      throw httpError(400, "Unknown CPS read action")
    }
    if (action === "grant") return await handleGrant(authenticated, req, res)
    if (action === "grantBulk") return await handleGrantBulk(authenticated, req, res)
    if (action === "revoke") return await handleRevoke(authenticated, req, res)
    throw httpError(400, "Unknown CPS write action")
  } catch (error) {
    console.error("CPS v2 bridge error:", error)
    return res.status(Number(error?.statusCode) || 500).json({ error: error?.message || "CPS request failed" })
  }
}
