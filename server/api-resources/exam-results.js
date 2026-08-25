import { FieldValue } from "firebase-admin/firestore"
import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const RESULTS = "cpsExamResults"
const ENTITLEMENTS = "cpsEntitlements"
const MAX_ANSWERS = 500

function httpError(statusCode, message, code = "EXAM_RESULT_ERROR") {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Cache-Control", "private, no-store")
}

const text = (value) => String(value || "").trim()
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const normalizeCourseId = (value) => text(value).replace(/^cps:/, "")

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

function attemptMoment(row) {
  if (Number(row.submittedAtMs) > 0) return Number(row.submittedAtMs)
  if (Number(row.startedAtMs) > 0) return Number(row.startedAtMs)
  return Number.MAX_SAFE_INTEGER
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
  const results = snapshot.docs
    .map(serialize)
    .sort((a, b) => b.submittedAtMs - a.submittedAtMs)
    .slice(0, 200)
  res.status(200).json({ results, serverTimeMs: Date.now() })
}

async function examOverview(authenticated, req, res) {
  const rawCourseId = normalizeCourseId(req.query?.courseId)
  const examId = text(req.query?.examId)
  if (!rawCourseId || !examId) throw httpError(400, "courseId and examId are required")
  await requireCourseAccess(authenticated, rawCourseId)

  const uid = authenticated.decodedToken.uid
  const snapshot = await authenticated.db.collection(RESULTS).where("examId", "==", examId).get()
  const attempts = snapshot.docs
    .map(serialize)
    .filter((row) => row.userId === uid && normalizeCourseId(row.courseId) === rawCourseId)
    .sort((a, b) => {
      const timeDelta = attemptMoment(a) - attemptMoment(b)
      if (timeDelta) return timeDelta
      return String(a.id).localeCompare(String(b.id))
    })

  res.status(200).json({
    examId,
    courseId: `cps:${rawCourseId}`,
    attempts,
    firstAttempt: attempts[0] || null,
    retakeCount: Math.max(0, attempts.length - 1),
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
