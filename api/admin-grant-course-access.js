import { publishEnrollmentSync } from "./_sync-event.js"
import { requireAuthenticatedUser, isFullAdminProfile } from "./utils/firebase-admin.js"
import { processPaymentAndEnrollUser } from "./utils/process-payment.js"

const LIMITED_ADMIN_ROLES = new Set([
  "class_pdf_admin",
  "exam_create_admin",
  "class_exam_admin",
  "users_admin",
  "staff_admin",
])
const MAX_COURSES_PER_GRANT = 50

function canGrantCourseAccess(userProfile = {}) {
  if (isFullAdminProfile(userProfile)) return true
  const limitedAdmin =
    LIMITED_ADMIN_ROLES.has(userProfile?.role) ||
    (userProfile?.role === "admin" && userProfile?.adminAccess?.mode === "limited")
  return limitedAdmin && userProfile?.adminAccess?.manageUsers === true
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : ""
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"])
    return res.status(405).json({ success: false, error: "Method Not Allowed" })
  }

  try {
    const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
    if (!canGrantCourseAccess(userProfile)) {
      return res.status(403).json({ success: false, error: "Manage Users permission is required" })
    }

    const userId = cleanId(req.body?.userId)
    const requestedCourseIds = Array.isArray(req.body?.courseIds)
      ? [...new Set(req.body.courseIds.map(cleanId).filter(Boolean))]
      : []

    if (!userId) {
      return res.status(400).json({ success: false, error: "A target user is required" })
    }
    if (requestedCourseIds.length === 0) {
      return res.status(400).json({ success: false, error: "Select at least one course" })
    }
    if (requestedCourseIds.length > MAX_COURSES_PER_GRANT) {
      return res.status(400).json({
        success: false,
        error: `You can grant at most ${MAX_COURSES_PER_GRANT} courses at once`,
      })
    }

    const targetUserRef = db.collection("users").doc(userId)
    const targetUserSnapshot = await targetUserRef.get()
    if (!targetUserSnapshot.exists) {
      return res.status(404).json({ success: false, error: "Target user was not found" })
    }
    const targetUser = targetUserSnapshot.data() || {}

    const courseRefs = requestedCourseIds.map((courseId) => db.collection("courses").doc(courseId))
    const courseSnapshots = await db.getAll(...courseRefs)
    const courses = courseSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const data = snapshot.data() || {}
        return {
          id: snapshot.id,
          title: String(data.title || "Untitled Course").slice(0, 180),
          price: Number(data.price || 0),
          courseFormat: data.courseFormat || "single",
          bundledCourses: Array.isArray(data.bundledCourses) ? data.bundledCourses : [],
        }
      })

    if (courses.length !== requestedCourseIds.length) {
      return res.status(400).json({ success: false, error: "One or more selected courses no longer exist" })
    }

    const transactionId = `MANUAL_${Date.now()}_${userId}_${decodedToken.uid}`
    const result = await processPaymentAndEnrollUser({
      userId,
      userName: targetUser.name || targetUser.displayName || "User",
      userEmail: targetUser.email || "",
      mobileNumber: targetUser.mobileNumber || targetUser.phone || "",
      transactionId,
      invoiceId: transactionId,
      trxId: transactionId,
      paymentMethod: "Manual Grant by Admin",
      courses,
      subtotal: 0,
      discount: 0,
      couponCode: "MANUAL_ADMIN_GRANT",
      finalAmount: 0,
      currency: "BDT",
    })

    if (!result?.success) {
      return res.status(500).json({
        success: false,
        error: result?.error || "Failed to grant course access",
      })
    }

    await publishEnrollmentSync({
      db,
      userId,
      transactionId,
      enrolledCourseIds: result.enrollmentDetails?.enrolledCourses || [],
    }).catch((error) => {
      console.error("Failed to publish grant-only enrollment sync:", error)
    })

    return res.status(200).json({
      success: true,
      alreadyProcessed: Boolean(result.alreadyProcessed),
      grantedCourseIds: result.enrollmentDetails?.enrolledCourses || requestedCourseIds,
    })
  } catch (error) {
    console.error("Grant-only course access failed:", error)
    return res.status(error?.statusCode || 500).json({
      success: false,
      error: error?.message || "Failed to grant course access",
    })
  }
}
