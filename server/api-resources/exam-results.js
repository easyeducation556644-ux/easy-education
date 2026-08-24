import { FieldValue } from "firebase-admin/firestore"
import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const RESULTS = "cpsExamResults"
const ENTITLEMENTS = "cpsEntitlements"
const MAX_ANSWERS = 500
const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const PAGE_SIZE = 100
const MAX_PAGES = 20

function httpError(statusCode, message, code = "EXAM_RESULT_ERROR") {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CPS-Firebase-Token")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Cache-Control", "private, no-store")
}

const text = (value) => String(value || "").trim()
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const normalizeCourseId = (value) => text(value).replace(/^cps:/, "")
const normalizeEmail = (value) => text(value).toLowerCase()

function timeMs(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) {
    const n = Number(value)
    return n < 10_000_000_000 ? Math.floor(n * 1000) : Math.floor(n)
  }
  const parsed = Date.parse(text(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function serialize(snapshot) {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    source: "easy",
    userId: text(data.userId),
    userName: text(data.userName),
    userEmail: text(data.userEmail),
    courseId: text(data.courseId),
    courseTitle: text(data.courseTitle),
    examId: text(data.examId),
    examTitle: text(data.examTitle),
    startedAtMs: number(data.startedAtMs),
    submittedAtMs: number(data.submittedAtMs),
    timeTakenSeconds: number(data.timeTakenSeconds),
    answered: number(data.answered),
    correct: number(data.correct),
    wrong: number(data.wrong),
    unanswered: number(data.unanswered),
    marks: number(data.marks),
    maxScore: number(data.maxScore),
    negativeMarks: number(data.negativeMarks),
    questionCount: number(data.questionCount),
  }
}

function normalizeSourceToken(value) {
  return text(value).replace(/^Bearer\s+/i, "")
}

function sourceContext(req) {
  return {
    token: normalizeSourceToken(req.headers?.["x-cps-firebase-token"])
      || normalizeSourceToken(process.env.CPS_FIREBASE_ID_TOKEN),
  }
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
  const pieces = String(raw.name).split("/")
  return { id: pieces[pieces.length - 1] || "", ...decodeFields(raw.fields || {}) }
}

function runQueryUrl(path) {
  const pieces = String(path || "").split("/").filter(Boolean)
  const collectionId = pieces.pop()
  if (!collectionId) throw httpError(500, "CPS source query path is invalid")
  const parent = pieces.map(encodeURIComponent).join("/")
  const url = new URL(`${CPS_ROOT}${parent ? `/${parent}` : ""}:runQuery`)
  url.searchParams.set("key", CPS_API_KEY)
  return { url: url.toString(), collectionId }
}

async function readCpsPage(path, token, offset) {
  const { url, collectionId } = runQueryUrl(path)
  const headers = { "Content-Type": "application/json", Accept: "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        limit: PAGE_SIZE,
        ...(offset > 0 ? { offset } : {}),
      },
    }),
    redirect: "follow",
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    console.error("CPS exam submissions read failed", { path, status: response.status, detail: detail.slice(0, 220) })
    if (response.status === 401 || response.status === 403) {
      throw httpError(403, "Leaderboard needs a valid CPS session. Reconnect CPS and try again.", "CPS_SOURCE_PERMISSION")
    }
    throw httpError(502, "CPS leaderboard data could not be loaded right now.", "CPS_SOURCE_READ")
  }
  const payload = await response.json()
  if (!Array.isArray(payload)) return []
  return payload.map((entry) => decodeDocument(entry?.document)).filter(Boolean)
}

async function listCpsSubmissions(examId, source) {
  if (!source.token) {
    throw httpError(403, "Leaderboard needs a CPS session. Reconnect CPS and try again.", "CPS_SESSION_REQUIRED")
  }
  const path = `exams/${encodeURIComponent(examId)}/submissions`
  const docs = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await readCpsPage(path, source.token, page * PAGE_SIZE)
    docs.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return docs
}

function activeEntitlement(data, now = Date.now()) {
  if (!data || data.status === "revoked") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > now
}

async function requireCourseAccess(authenticated, rawCourseId) {
  if (isFullAdminProfile(authenticated.userProfile)) return
  const id = `${authenticated.decodedToken.uid}_${rawCourseId}`
  const snapshot = await authenticated.db.collection(ENTITLEMENTS).doc(id).get()
  if (!snapshot.exists || !activeEntitlement(snapshot.data())) {
    throw httpError(403, "This CPS course is locked.", "CPS_ACCESS_LOCKED")
  }
}

function decodeJwtPayload(token) {
  try {
    const pieces = String(token || "").split(".")
    if (pieces.length < 2) return {}
    const payload = pieces[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
  } catch {
    return {}
  }
}

function cpsSubmissionToResult(item, courseId, examId, examTitle = "", maxScore = 0, questionCount = 0) {
  const answered = Math.max(0, Math.floor(number(item?.answeredCount)))
  const correct = Math.max(0, Math.floor(number(item?.rightAnswers)))
  const wrong = Math.max(0, Math.floor(number(item?.wrongAnswers)))
  const submittedAtMs = timeMs(item?.submittedAt)
  const marks = Number.isFinite(Number(item?.actualMarks))
    ? Number(item.actualMarks)
    : number(item?.score)
  return {
    id: `cps:${text(item?.id) || `${text(item?.userId)}:${submittedAtMs}`}`,
    source: "cps",
    userId: text(item?.userId),
    userName: text(item?.userName),
    userEmail: text(item?.userEmail),
    courseId: `cps:${courseId}`,
    courseTitle: "",
    examId,
    examTitle: examTitle || "CPS Exam",
    startedAtMs: 0,
    submittedAtMs,
    timeTakenSeconds: Math.max(0, Math.floor(number(item?.timeTaken))),
    answered,
    correct,
    wrong,
    unanswered: questionCount > 0 ? Math.max(0, questionCount - answered) : 0,
    marks,
    maxScore: Math.max(0, number(maxScore)),
    negativeMarks: 0,
    questionCount: Math.max(0, Math.floor(number(questionCount))),
  }
}

function attemptMoment(row) {
  return row.submittedAtMs > 0
    ? row.submittedAtMs
    : row.startedAtMs > 0
      ? row.startedAtMs
      : Number.MAX_SAFE_INTEGER
}

function identityKey(row) {
  const email = normalizeEmail(row.userEmail)
  if (email) return `email:${email}`
  const uid = text(row.userId)
  if (uid) return `${row.source === "easy" ? "easy" : "cps"}:${uid}`
  return `anonymous:${text(row.id)}`
}

function stableAttemptSort(a, b) {
  const timeDelta = attemptMoment(a) - attemptMoment(b)
  if (timeDelta) return timeDelta
  const sourceDelta = (a.source === "cps" ? 0 : 1) - (b.source === "cps" ? 0 : 1)
  if (sourceDelta) return sourceDelta
  return String(a.id).localeCompare(String(b.id))
}

function mergedPeople(rows) {
  const groups = new Map()
  rows.forEach((row) => {
    const key = identityKey(row)
    const group = groups.get(key) || []
    group.push(row)
    groups.set(key, group)
  })
  return [...groups.entries()].map(([key, attempts]) => {
    const ordered = [...attempts].sort(stableAttemptSort)
    const first = ordered[0]
    const preferred = [...ordered].reverse().find((item) => item.source === "easy") || first
    return {
      key,
      first,
      attempts: ordered,
      displayName: text(preferred.userName) || text(first.userName) || "Student",
      email: normalizeEmail(preferred.userEmail || first.userEmail),
      userIds: new Set(ordered.map((item) => text(item.userId)).filter(Boolean)),
    }
  })
}

function leaderboardRows(people, viewer) {
  const ranked = people
    .filter((person) => person.first)
    .map((person) => {
      const first = person.first
      const isYou = (person.email && viewer.emails.has(person.email))
        || [...person.userIds].some((uid) => viewer.userIds.has(uid))
      return {
        identityKey: person.key,
        userName: person.displayName,
        marks: number(first.marks),
        maxScore: Math.max(0, number(first.maxScore)),
        correct: Math.max(0, Math.floor(number(first.correct))),
        wrong: Math.max(0, Math.floor(number(first.wrong))),
        answered: Math.max(0, Math.floor(number(first.answered))),
        timeTakenSeconds: Math.max(0, Math.floor(number(first.timeTakenSeconds))),
        submittedAtMs: Math.max(0, Math.floor(number(first.submittedAtMs))),
        isYou,
      }
    })
    .sort((a, b) => {
      const marksDelta = b.marks - a.marks
      if (marksDelta) return marksDelta
      const aTime = a.timeTakenSeconds > 0 ? a.timeTakenSeconds : Number.MAX_SAFE_INTEGER
      const bTime = b.timeTakenSeconds > 0 ? b.timeTakenSeconds : Number.MAX_SAFE_INTEGER
      if (aTime !== bTime) return aTime - bTime
      const submittedDelta = (a.submittedAtMs || Number.MAX_SAFE_INTEGER) - (b.submittedAtMs || Number.MAX_SAFE_INTEGER)
      if (submittedDelta) return submittedDelta
      return a.userName.localeCompare(b.userName)
    })

  return ranked.map((row, index) => ({ rank: index + 1, ...row }))
}

function currentViewer(authenticated, source) {
  const easyEmail = normalizeEmail(authenticated.userProfile?.email || authenticated.decodedToken.email)
  const cpsPayload = decodeJwtPayload(source.token)
  const cpsEmail = normalizeEmail(cpsPayload.email)
  const emails = new Set([easyEmail].filter(Boolean))
  const userIds = new Set([text(authenticated.decodedToken.uid)].filter(Boolean))
  if (!easyEmail || !cpsEmail || easyEmail === cpsEmail) {
    if (cpsEmail) emails.add(cpsEmail)
    const cpsUid = text(cpsPayload.user_id || cpsPayload.sub)
    if (cpsUid) userIds.add(cpsUid)
  }
  return { emails, userIds }
}

function isViewerPerson(person, viewer) {
  return (person.email && viewer.emails.has(person.email))
    || [...person.userIds].some((uid) => viewer.userIds.has(uid))
}

async function easyExamRows(authenticated, rawCourseId, examId) {
  const snapshot = await authenticated.db.collection(RESULTS).where("examId", "==", examId).get()
  return snapshot.docs
    .map(serialize)
    .filter((row) => normalizeCourseId(row.courseId) === rawCourseId)
}

async function save(authenticated, req, res) {
  const uid = authenticated.decodedToken.uid
  const body = req.body || {}
  const courseId = normalizeCourseId(body.courseId)
  const examId = text(body.examId)
  const examTitle = text(body.examTitle)
  if (!courseId || !examId) throw httpError(400, "courseId and examId are required")
  await requireCourseAccess(authenticated, courseId)
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, MAX_ANSWERS) : []
  const now = Date.now()
  const id = `${uid}_${examId}_${now}`
  const payload = {
    source: "cps",
    userId: uid,
    userName: authenticated.userProfile?.name || authenticated.decodedToken.name || "",
    userEmail: authenticated.userProfile?.email || authenticated.decodedToken.email || "",
    courseId: `cps:${courseId}`,
    courseTitle: text(body.courseTitle),
    examId,
    examTitle: examTitle || "CPS Exam",
    startedAtMs: Math.max(0, Math.floor(number(body.startedAtMs))),
    submittedAtMs: now,
    timeTakenSeconds: Math.max(0, Math.floor(number(body.timeTakenSeconds))),
    answered: Math.max(0, Math.floor(number(body.answered))),
    correct: Math.max(0, Math.floor(number(body.correct))),
    wrong: Math.max(0, Math.floor(number(body.wrong))),
    unanswered: Math.max(0, Math.floor(number(body.unanswered))),
    marks: number(body.marks),
    maxScore: Math.max(0, number(body.maxScore)),
    negativeMarks: Math.max(0, number(body.negativeMarks)),
    questionCount: Math.max(0, Math.floor(number(body.questionCount))),
    answers: answers.map((item) => ({
      questionId: text(item?.questionId),
      selectedIndex: Number.isInteger(Number(item?.selectedIndex)) ? Number(item.selectedIndex) : -1,
      correctIndex: Number.isInteger(Number(item?.correctIndex)) ? Number(item.correctIndex) : -1,
      isCorrect: item?.isCorrect === true,
    })).filter((item) => item.questionId),
    appVersion: text(body.appVersion),
    createdAt: FieldValue.serverTimestamp(),
    updatedAtMs: now,
  }
  await authenticated.db.collection(RESULTS).doc(id).set(payload)
  res.status(200).json({ ok: true, result: { id, ...payload, answers: undefined } })
}

async function mine(authenticated, res) {
  const uid = authenticated.decodedToken.uid
  const snapshot = await authenticated.db.collection(RESULTS).where("userId", "==", uid).get()
  const results = snapshot.docs.map(serialize).sort((a, b) => b.submittedAtMs - a.submittedAtMs).slice(0, 200)
  res.status(200).json({ results, serverTimeMs: Date.now() })
}

async function examOverview(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query?.courseId)
  const examId = text(req.query?.examId)
  if (!rawCourseId || !examId) throw httpError(400, "courseId and examId are required")
  await requireCourseAccess(authenticated, rawCourseId)

  const source = sourceContext(req)
  const [easyRows, cpsRaw] = await Promise.all([
    easyExamRows(authenticated, rawCourseId, examId),
    listCpsSubmissions(examId, source),
  ])

  const easyExample = easyRows.find((row) => row.maxScore > 0 || row.questionCount > 0) || easyRows[0]
  const examTitle = text(req.query?.examTitle || easyExample?.examTitle)
  const maxScore = number(req.query?.maxScore, number(easyExample?.maxScore))
  const questionCount = Math.max(0, Math.floor(number(req.query?.questionCount, number(easyExample?.questionCount))))
  const cpsRows = cpsRaw.map((item) => cpsSubmissionToResult(item, rawCourseId, examId, examTitle, maxScore, questionCount))
  const allRows = [...easyRows, ...cpsRows]
  const people = mergedPeople(allRows)
  const viewer = currentViewer(authenticated, source)
  const viewerPerson = people.find((person) => isViewerPerson(person, viewer))
  const viewerAttempts = viewerPerson?.attempts || []

  res.status(200).json({
    examId,
    courseId: `cps:${rawCourseId}`,
    attempts: viewerAttempts,
    firstAttempt: viewerAttempts[0] || null,
    retakeCount: Math.max(0, viewerAttempts.length - 1),
    leaderboard: leaderboardRows(people, viewer),
    leaderboardRule: {
      attemptsUsed: "first-only",
      sort: "marks-desc,time-asc",
    },
    serverTimeMs: Date.now(),
  })
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === "OPTIONS") return res.status(204).end()
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" })
  try {
    const authenticated = await requireAuthenticatedUser(req)
    const action = text(req.query?.action || req.body?.action || (req.method === "GET" ? "mine" : "save"))
    if (req.method === "GET" && action === "mine") return await mine(authenticated, res)
    if (req.method === "GET" && action === "exam") return await examOverview(authenticated, req, res)
    if (req.method === "POST" && action === "save") return await save(authenticated, req, res)
    throw httpError(400, "Unknown exam result action")
  } catch (error) {
    console.error("Exam result API error", { code: error?.code || "EXAM_RESULT_ERROR", message: error?.message })
    res.status(Number(error?.statusCode) || 500).json({
      error: error?.message || "Exam result service is temporarily unavailable",
      code: error?.code || "EXAM_RESULT_ERROR",
    })
  }
}
