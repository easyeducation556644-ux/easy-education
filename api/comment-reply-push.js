import { FieldValue } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import { requireAuthenticatedUser } from "./utils/firebase-admin.js"

const ID_PATTERN = /^[A-Za-z0-9_:\-]{1,240}$/
const MAX_TOKENS_PER_MESSAGE = 500
const TOKEN_PATTERN = /^[A-Za-z0-9_:\-\.]{20,4096}$/

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim()
  return normalized || fallback
}

function errorResponse(res, status, message) {
  return res.status(status).json({ success: false, error: message })
}

function staffCanAccessCourse(userProfile, courseId) {
  if (userProfile?.role === "admin" && userProfile?.adminAccess?.mode !== "limited") return true
  const limitedAdmin = userProfile?.role === "admin" && userProfile?.adminAccess?.mode === "limited"
  const staff = ["class_pdf_admin", "class_exam_admin"].includes(userProfile?.role)
  if (!limitedAdmin && !staff) return false
  return (userProfile?.adminAccess?.classPdfCourseIds || []).includes(courseId)
}

export default async function commentReplyPush(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return errorResponse(res, 405, "Method not allowed")
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0")

  try {
    const { app, decodedToken, userProfile, db } = await requireAuthenticatedUser(req)
    const parentCommentId = text(req.body?.parentCommentId)
    const classId = text(req.body?.classId)
    const courseId = text(req.body?.courseId)
    const classTitle = text(req.body?.classTitle, "Class").slice(0, 180)
    const replyText = text(req.body?.replyText).slice(0, 500)

    if (!ID_PATTERN.test(parentCommentId)) return errorResponse(res, 400, "Invalid parent comment id")
    if (!ID_PATTERN.test(classId)) return errorResponse(res, 400, "Invalid class id")
    if (!ID_PATTERN.test(courseId)) return errorResponse(res, 400, "Invalid course id")
    if (!replyText) return errorResponse(res, 400, "Reply text is required")

    const [parentSnapshot, classSnapshot, enrollmentSnapshots] = await Promise.all([
      db.collection("classComments").doc(parentCommentId).get(),
      db.collection("classes").doc(classId).get(),
      db.collection("userCourses").where("userId", "==", decodedToken.uid).get(),
    ])

    if (!parentSnapshot.exists) return errorResponse(res, 404, "Parent comment not found")
    const parent = parentSnapshot.data() || {}
    if (text(parent.classId) !== classId) return errorResponse(res, 409, "Comment does not belong to this class")

    if (!classSnapshot.exists) return errorResponse(res, 404, "Class not found")
    const classData = classSnapshot.data() || {}
    if (text(classData.courseId) !== courseId) return errorResponse(res, 409, "Class does not belong to this course")

    const enrolled = enrollmentSnapshots.docs.some((snapshot) => text(snapshot.data()?.courseId) === courseId)
    if (!enrolled && !staffCanAccessCourse(userProfile, courseId)) {
      return errorResponse(res, 403, "Course access required")
    }

    const targetUserId = text(parent.userId)
    if (!targetUserId || targetUserId === decodedToken.uid) {
      return res.status(200).json({ success: true, delivered: 0, skipped: true })
    }

    const subscriptionRef = db.collection("pushSubscriptions").doc(targetUserId)
    const subscriptionSnapshot = await subscriptionRef.get()
    const tokens = subscriptionSnapshot.exists && Array.isArray(subscriptionSnapshot.data()?.tokens)
      ? [...new Set(subscriptionSnapshot.data().tokens.map(String).filter((token) => TOKEN_PATTERN.test(token)))]
      : []

    if (tokens.length === 0) {
      return res.status(200).json({ success: true, delivered: 0, registeredDevices: 0 })
    }

    const senderName = text(
      userProfile?.name || userProfile?.displayName || decodedToken?.name || decodedToken?.email,
      "A student",
    ).slice(0, 90)
    const messaging = getMessaging(app)
    const invalidTokens = []
    let delivered = 0
    let failed = 0

    for (let index = 0; index < tokens.length; index += MAX_TOKENS_PER_MESSAGE) {
      const chunk = tokens.slice(index, index + MAX_TOKENS_PER_MESSAGE)
      const result = await messaging.sendEachForMulticast({
        tokens: chunk,
        data: {
          type: "comment_reply",
          title: `${senderName} replied to you`,
          body: replyText,
          url: `/course/${encodeURIComponent(courseId)}/watch/${encodeURIComponent(classId)}`,
          classId,
          classTitle,
          courseId,
          senderName,
          parentCommentId,
        },
        android: { priority: "high" },
      })
      delivered += result.successCount
      failed += result.failureCount
      result.responses.forEach((item, responseIndex) => {
        if (item.success) return
        const code = item.error?.code || ""
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token") ||
          code.includes("invalid-argument")
        ) invalidTokens.push(chunk[responseIndex])
      })
    }

    if (invalidTokens.length > 0) {
      await subscriptionRef.set({
        tokens: FieldValue.arrayRemove(...invalidTokens),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }

    return res.status(200).json({
      success: true,
      registeredDevices: tokens.length,
      delivered,
      failed,
    })
  } catch (error) {
    console.error("Comment reply push error:", error)
    return errorResponse(res, error?.statusCode || 500, error?.message || "Reply notification failed")
  }
}
