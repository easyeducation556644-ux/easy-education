import { FieldValue } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import { requireAuthenticatedUser } from "./utils/firebase-admin.js"

const MAX_TOKENS_PER_MESSAGE = 500
const TOKEN_PATTERN = /^[A-Za-z0-9_:\-\.]{20,4096}$/
const ID_PATTERN = /^[A-Za-z0-9_:\-]{1,240}$/
const STAFF_ROLES = new Set(["class_pdf_admin", "class_exam_admin"])

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message })
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim()
  return normalized || fallback
}

function canNotifyCourse(userProfile, courseId) {
  if (userProfile?.role === "admin" && userProfile?.adminAccess?.mode !== "limited") return true
  const limitedAdmin = userProfile?.role === "admin" && userProfile?.adminAccess?.mode === "limited"
  const staff = STAFF_ROLES.has(userProfile?.role)
  if (!limitedAdmin && !staff) return false
  return (userProfile?.adminAccess?.classPdfCourseIds || []).includes(courseId)
}

async function registerDevice(req, res) {
  const { decodedToken, db } = await requireAuthenticatedUser(req)
  const token = text(req.body?.token)
  const deviceId = text(req.body?.deviceId)

  if (!TOKEN_PATTERN.test(token)) return sendError(res, 400, "Invalid push token")
  if (!ID_PATTERN.test(deviceId)) return sendError(res, 400, "Invalid device id")

  // One FCM token belongs to the currently signed-in account on this device.
  // Account switching removes the token from older user subscriptions first.
  const existingOwners = await db.collection("pushSubscriptions")
    .where("tokens", "array-contains", token)
    .get()
  const ownerBatch = db.batch()
  let ownerChanges = 0
  existingOwners.docs.forEach((snapshot) => {
    if (snapshot.id === decodedToken.uid) return
    ownerBatch.set(snapshot.ref, {
      tokens: FieldValue.arrayRemove(token),
      deviceIds: FieldValue.arrayRemove(deviceId),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    ownerChanges += 1
  })
  if (ownerChanges > 0) await ownerBatch.commit()

  const enrollments = await db.collection("userCourses")
    .where("userId", "==", decodedToken.uid)
    .get()
  const courseIds = unique(enrollments.docs.map((item) => text(item.data()?.courseId)))

  const ref = db.collection("pushSubscriptions").doc(decodedToken.uid)
  await ref.set({
    userId: decodedToken.uid,
    tokens: FieldValue.arrayUnion(token),
    deviceIds: FieldValue.arrayUnion(deviceId),
    courseIds,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return res.status(200).json({ success: true, courseCount: courseIds.length })
}

async function resolveNames(db, classData) {
  const courseId = text(classData.courseId)
  const subjectIds = unique(Array.isArray(classData.subject) ? classData.subject : [classData.subject])
  const chapterIds = unique(Array.isArray(classData.chapter) ? classData.chapter : [classData.chapter])

  const refs = [
    ...(courseId ? [db.collection("courses").doc(courseId)] : []),
    ...subjectIds.map((id) => db.collection("subjects").doc(id)),
    ...chapterIds.map((id) => db.collection("chapters").doc(id)),
  ]
  const snapshots = refs.length ? await db.getAll(...refs) : []
  const byPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]))

  const course = courseId ? byPath.get(`courses/${courseId}`)?.data() : null
  const subjects = subjectIds.map((id) => byPath.get(`subjects/${id}`)?.data()).filter(Boolean)
  const chapters = chapterIds.map((id) => byPath.get(`chapters/${id}`)?.data()).filter(Boolean)

  return {
    courseId,
    courseTitle: text(course?.title || course?.name, "Course"),
    subjectTitle: subjects.map((item) => text(item.title || item.name)).filter(Boolean).join(", ") || "Subject",
    chapterTitle: chapters.map((item) => text(item.title || item.name)).filter(Boolean).join(", ") || "Chapter",
  }
}

async function sendInChunks(messaging, tokens, data) {
  let successCount = 0
  let failureCount = 0
  const invalidTokens = []

  for (let index = 0; index < tokens.length; index += MAX_TOKENS_PER_MESSAGE) {
    const chunk = tokens.slice(index, index + MAX_TOKENS_PER_MESSAGE)
    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      data,
      android: { priority: "high" },
    })
    successCount += response.successCount
    failureCount += response.failureCount
    response.responses.forEach((result, responseIndex) => {
      if (result.success) return
      const code = result.error?.code || ""
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token") ||
        code.includes("invalid-argument")
      ) invalidTokens.push(chunk[responseIndex])
    })
  }

  return { successCount, failureCount, invalidTokens }
}

async function notifyClassCreated(req, res) {
  const { userProfile, db } = await requireAuthenticatedUser(req)
  const classId = text(req.body?.classId)
  if (!ID_PATTERN.test(classId)) return sendError(res, 400, "Invalid class id")

  const classSnapshot = await db.collection("classes").doc(classId).get()
  if (!classSnapshot.exists) return sendError(res, 404, "Class not found")
  const classData = classSnapshot.data() || {}
  const { courseId, courseTitle, subjectTitle, chapterTitle } = await resolveNames(db, classData)
  if (!courseId) return sendError(res, 422, "Class course is missing")
  if (!canNotifyCourse(userProfile, courseId)) return sendError(res, 403, "Course notification permission denied")

  // Strict eligibility: only live userCourses records for this exact course count.
  const enrollments = await db.collection("userCourses")
    .where("courseId", "==", courseId)
    .get()
  const eligibleUserIds = unique(enrollments.docs.map((item) => text(item.data()?.userId)))
  if (eligibleUserIds.length === 0) {
    return res.status(200).json({ success: true, eligibleUsers: 0, delivered: 0 })
  }

  const subscriptionRefs = eligibleUserIds.map((uid) => db.collection("pushSubscriptions").doc(uid))
  const subscriptionSnapshots = await db.getAll(...subscriptionRefs)
  const tokenOwners = new Map()
  subscriptionSnapshots.forEach((snapshot) => {
    if (!snapshot.exists) return
    const tokens = Array.isArray(snapshot.data()?.tokens) ? snapshot.data().tokens : []
    tokens.forEach((token) => {
      if (TOKEN_PATTERN.test(String(token))) tokenOwners.set(String(token), snapshot.id)
    })
  })
  const tokens = [...tokenOwners.keys()]

  const classTitle = text(classData.title || classData.topic, "New class")
  const url = `/course/${encodeURIComponent(courseId)}/watch/${encodeURIComponent(classId)}`
  if (tokens.length === 0) {
    return res.status(200).json({ success: true, eligibleUsers: eligibleUserIds.length, delivered: 0 })
  }

  const messaging = getMessaging()
  const result = await sendInChunks(messaging, tokens, {
    type: "new_class",
    title: classTitle,
    body: `${courseTitle} • ${subjectTitle} • ${chapterTitle}`,
    url,
    classId,
    classTitle,
    courseId,
    courseTitle,
    subjectTitle,
    chapterTitle,
  })

  if (result.invalidTokens.length > 0) {
    const removals = new Map()
    result.invalidTokens.forEach((token) => {
      const owner = tokenOwners.get(token)
      if (!owner) return
      if (!removals.has(owner)) removals.set(owner, [])
      removals.get(owner).push(token)
    })
    await Promise.all([...removals.entries()].map(([uid, staleTokens]) =>
      db.collection("pushSubscriptions").doc(uid).set({
        tokens: FieldValue.arrayRemove(...staleTokens),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ))
  }

  return res.status(200).json({
    success: true,
    eligibleUsers: eligibleUserIds.length,
    registeredDevices: tokens.length,
    delivered: result.successCount,
    failed: result.failureCount,
  })
}

export async function addCoursesToPushSubscription({ db, userId, courseIds }) {
  const ids = unique(courseIds.map(text))
  if (!userId || ids.length === 0) return
  await db.collection("pushSubscriptions").doc(userId).set({
    userId,
    courseIds: FieldValue.arrayUnion(...ids),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

export default async function learningPushHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return sendError(res, 405, "Method not allowed")
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0")

  try {
    const action = text(req.body?.action)
    if (action === "register") return await registerDevice(req, res)
    if (action === "class-created") return await notifyClassCreated(req, res)
    return sendError(res, 400, "Unknown learning push action")
  } catch (error) {
    console.error("Learning push error:", error)
    return sendError(res, error?.statusCode || 500, error?.message || "Learning push failed")
  }
}
