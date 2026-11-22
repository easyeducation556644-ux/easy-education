import { auth } from "./firebase"

// A client can request a free enrollment, but it must never create an
// approved payment or a userCourses entitlement directly. The server verifies
// the Firebase ID token, prices the current catalog, and writes both records.
export async function enrollInFreeCourse(userId, userEmail, userName, course) {
  try {
    const user = auth.currentUser
    if (!user?.uid || user.uid !== userId) {
      return { success: false, message: "Please sign in to enroll" }
    }
    if (!course?.id || typeof course.id !== "string") {
      return { success: false, message: "Invalid course" }
    }
    const token = await user.getIdToken()
    const response = await fetch("/api/process-enrollment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: user.uid,
        userEmail: user.email || userEmail || "",
        userName: user.displayName || userName || "",
        transaction_id: `FREE-${crypto.randomUUID()}`,
        skipPaymentVerification: true,
        paymentMethod: "Free Course",
        courses: [{ id: course.id }],
        subtotal: 0,
        discount: 0,
        couponCode: "",
        finalAmount: 0,
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.success) {
      return { success: false, message: result.error || "Could not enroll. Please try again." }
    }
    return { success: true, message: "Successfully enrolled in free course!" }
  } catch (error) {
    console.error("Free course enrollment failed", error)
    return { success: false, message: "Failed to enroll. Please try again." }
  }
}
