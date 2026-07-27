export const ADMIN_PERMISSION_KEYS = {
  CLASS_PDF: "classPdf",
  EXAM_CREATE: "examCreate",
}

export const STAFF_ROLES = ["class_pdf_admin", "exam_create_admin", "class_exam_admin"]

export const isAdminPanelUser = (userProfile) =>
  userProfile?.role === "admin" || STAFF_ROLES.includes(userProfile?.role)

export const isFullAdmin = (userProfile) =>
  userProfile?.role === "admin" && userProfile?.adminAccess?.mode !== "limited"

const isLegacyLimitedAdmin = (userProfile) =>
  userProfile?.role === "admin" && userProfile?.adminAccess?.mode === "limited"

export const hasAdminPermission = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return true
  if (!STAFF_ROLES.includes(userProfile?.role) && !isLegacyLimitedAdmin(userProfile)) return false

  if (permission === ADMIN_PERMISSION_KEYS.CLASS_PDF) {
    return (userProfile.adminAccess.classPdfCourseIds || []).length > 0
  }

  if (permission === ADMIN_PERMISSION_KEYS.EXAM_CREATE) {
    return (userProfile.adminAccess.examCourseIds || []).length > 0
  }

  return false
}

export const getAllowedCourseIds = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return null
  if (!STAFF_ROLES.includes(userProfile?.role) && !isLegacyLimitedAdmin(userProfile)) return []

  if (permission === ADMIN_PERMISSION_KEYS.CLASS_PDF) {
    return userProfile.adminAccess.classPdfCourseIds || []
  }

  if (permission === ADMIN_PERMISSION_KEYS.EXAM_CREATE) {
    return userProfile.adminAccess.examCourseIds || []
  }

  return []
}

export const canManageCourse = (userProfile, permission, courseId) => {
  if (isFullAdmin(userProfile)) return true
  return getAllowedCourseIds(userProfile, permission).includes(courseId)
}

export const getDefaultAdminPath = (userProfile) => {
  if (isFullAdmin(userProfile)) return "/admin"
  if (hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.CLASS_PDF)) return "/admin/classes"
  if (hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.EXAM_CREATE)) return "/admin/exams"
  return "/dashboard"
}

export const getStaffRole = ({ classPdfCourseIds = [], examCourseIds = [] }) => {
  if (classPdfCourseIds.length > 0 && examCourseIds.length > 0) return "class_exam_admin"
  if (classPdfCourseIds.length > 0) return "class_pdf_admin"
  if (examCourseIds.length > 0) return "exam_create_admin"
  return "user"
}

export const getRoleLabel = (role, adminAccess) => {
  if (role === "admin" && adminAccess?.mode === "limited") {
    return getRoleLabel(
      getStaffRole({
        classPdfCourseIds: adminAccess.classPdfCourseIds || [],
        examCourseIds: adminAccess.examCourseIds || [],
      }),
    )
  }
  if (role === "admin") return "Full Admin"
  if (role === "class_pdf_admin") return "Class & PDF Admin"
  if (role === "exam_create_admin") return "Exam Create Admin"
  if (role === "class_exam_admin") return "Class, PDF & Exam Admin"
  if (role === "user") return "Normal User"
  return role ? role.replaceAll("_", " ") : "Normal User"
}
