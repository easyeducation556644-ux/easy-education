export const ADMIN_PERMISSION_KEYS = {
  CLASS_PDF: "classPdf",
  EXAM_CREATE: "examCreate",
}

export const isFullAdmin = (userProfile) =>
  userProfile?.role === "admin" && userProfile?.adminAccess?.mode !== "limited"

export const hasAdminPermission = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return true
  if (userProfile?.role !== "admin" || userProfile?.adminAccess?.mode !== "limited") return false

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
  if (userProfile?.role !== "admin" || userProfile?.adminAccess?.mode !== "limited") return []

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
