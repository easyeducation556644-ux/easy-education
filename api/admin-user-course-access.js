import { FieldValue } from "firebase-admin/firestore"
import { processPaymentAndEnrollUser } from "./utils/process-payment.js"
import {
  profileHasUserAction,
  profilePageCourseIds,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"
import { publishEnrollmentSync, publishServerUserSyncEvents } from "./_sync-event.js"

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message })
}

function normalizeCourseIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 50)
}

function bundledCourseIds(courseData = {}) {
  const values = Array.isArray(courseData.bundledCourses) ? courseData.bundledCourses : []
  return values
    .map((item) => typeof item === "string" ? item : item?.id || item?.courseId)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
}

async function loadSelectedCourses(db, courseIds) {
  const result = []
  for (const courseId of courseIds) {
    const snapshot = await db.collection("courses").doc(courseId).get()
    if (!snapshot.exists) {
      const error = new Error(`Course not found: ${courseId}`)
      error.statusCode = 404
      throw error
    }
    result.push({ id: snapshot.id, ...snapshot.data() })
  }
  return result
}

function assertSelectedCourseScope(userProfile, courseIds) {
  const allowedCourseIds = profilePageCourseIds(userProfile, "users")
  if (allowedCourseIds === null) return
  const allowed = new Set(allowedCourseIds)
  if (courseIds.some((courseId) => !allowed.has(courseId))) {
    const error = new Error("One or more selected courses are outside your assigned Users course scope")
    error.statusCode = 403
    throw error
  }
}

async function grantCourses({ db, targetUserId, selectedCourses, actor }) {
  const targetSnapshot = await db.collection("users").doc(targetUserId).get()
  if (!targetSnapshot.exists) {
    const error = new Error("Target user not found")
    error.statusCode = 404
    throw error
  }
  const target = targetSnapshot.data() || {}
  const transactionId = `MANUAL_${Date.now()}_${targetUserId}`
  const requestCourses = selectedCourses.map((course) => ({
    id: course.id,
    title: course.title || course.name || "Untitled Course",
    price: 0,
    courseFormat: course.courseFormat || "",
    bundledCourses: Array.isArray(course.bundledCourses) ? course.bundledCourses : [],
  }))

  const result = await processPaymentAndEnrollUser({
    userId: targetUserId,
    userName: target.name || target.displayName || "N/A",
    userEmail: target.email || "",
    mobileNumber: target.phone || target.mobileNumber || "",
    transactionId,
    invoiceId: transactionId,
    trxId: transactionId,
    paymentMethod: "Manual Grant by Admin",
    courses: requestCourses,
    subtotal: 0,
    discount: 0,
    couponCode: "MANUAL_ADMIN_GRANT",
    finalAmount: 0,
    currency: "BDT",
  })

  if (!result?.success) {
    const error = new Error(result?.error || "Failed to grant course access")
    error.statusCode = 500
    throw error
  }

  await publishEnrollmentSync({
    db,
    userId: targetUserId,
    transactionId,
    enrolledCourseIds: result.enrollmentDetails?.enrolledCourses || [],
  })

  await db.collection("notifications").add({
    type: "admin_course_grant",
    title: "Admin Granted Course Access",
    message: `${actor.name || actor.email || "Admin"} granted access to ${selectedCourses.length} course(s)`,
    userId: targetUserId,
    userName: target.name || "",
    userEmail: target.email || "",
    adminId: actor.uid,
    adminName: actor.name || "Admin",
    adminEmail: actor.email || "",
    courses: selectedCourses.map((course) => ({ id: course.id, title: course.title || course.name || "Untitled Course" })),
    transactionId,
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
    link: "/admin/payments",
  })

  return {
    transactionId,
    enrolledCourseIds: result.enrollmentDetails?.enrolledCourses || [],
  }
}

async function removeCourses({ db, targetUserId, selectedCourses }) {
  const roots = new Set(selectedCourses.map((course) => course.id))
  const expanded = new Set(roots)
  selectedCourses.forEach((course) => {
    if (course.courseFormat === "bundle") {
      bundledCourseIds(course).forEach((courseId) => expanded.add(courseId))
    }
  })

  const paymentsSnapshot = await db
    .collection("payments")
    .where("userId", "==", targetUserId)
    .where("status", "==", "approved")
    .get()

  const batch = db.batch()
  const changedPaymentIds = []
  for (const paymentDoc of paymentsSnapshot.docs) {
    const payment = paymentDoc.data() || {}
    const before = Array.isArray(payment.courses) ? payment.courses : []
    const after = before.filter((entry) => {
      const id = typeof entry === "string" ? entry : entry?.id || entry?.courseId
      return !expanded.has(String(id || ""))
    })
    if (after.length !== before.length) {
      batch.update(paymentDoc.ref, { courses: after, updatedAt: FieldValue.serverTimestamp() })
      changedPaymentIds.push(paymentDoc.id)
    }
  }

  const deletedEnrollmentIds = []
  for (const courseId of expanded) {
    const enrollmentId = `${targetUserId}_${courseId}`
    const enrollmentRef = db.collection("userCourses").doc(enrollmentId)
    const snapshot = await enrollmentRef.get()
    if (snapshot.exists) {
      batch.delete(enrollmentRef)
      deletedEnrollmentIds.push(enrollmentId)
    }
  }

  await batch.commit()

  const events = [
    ...changedPaymentIds.map((docId) => ({ collection: "payments", docId, action: "changed" })),
    ...deletedEnrollmentIds.map((docId) => ({ collection: "userCourses", docId, action: "deleted" })),
  ]
  if (events.length > 0) {
    await publishServerUserSyncEvents({
      db,
      userId: targetUserId,
      events,
      nonce: `admin-remove-${Date.now().toString(36)}`,
    })
  }

  return {
    removedCourseIds: [...expanded],
    changedPayments: changedPaymentIds.length,
    deletedEnrollments: deletedEnrollmentIds.length,
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return sendError(res, 405, "Method not allowed")
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0")

  try {
    const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
    const action = String(req.body?.action || "").trim()
    const targetUserId = String(req.body?.userId || "").trim()
    const courseIds = normalizeCourseIds(req.body?.courseIds)

    if (!targetUserId || courseIds.length === 0) return sendError(res, 400, "User and at least one course are required")
    if (action !== "grant" && action !== "remove") return sendError(res, 400, "Invalid course-access action")

    const permission = action === "grant" ? "grantCourseAccess" : "manageCourseAccess"
    if (!profileHasUserAction(userProfile, permission)) return sendError(res, 403, "You do not have permission for this action")
    assertSelectedCourseScope(userProfile, courseIds)

    const selectedCourses = await loadSelectedCourses(db, courseIds)
    const result = action === "grant"
      ? await grantCourses({
          db,
          targetUserId,
          selectedCourses,
          actor: {
            uid: decodedToken.uid,
            name: userProfile?.name || userProfile?.displayName || "Admin",
            email: userProfile?.email || decodedToken.email || "",
          },
        })
      : await removeCourses({ db, targetUserId, selectedCourses })

    return res.status(200).json({ success: true, ...result })
  } catch (error) {
    console.error("Admin course access error:", error)
    return sendError(res, error?.statusCode || 500, error?.message || "Course access update failed")
  }
}
