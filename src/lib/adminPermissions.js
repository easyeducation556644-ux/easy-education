export const ADMIN_PERMISSION_KEYS = {
  CLASS_PDF: "classPdf",
  EXAM_CREATE: "examCreate",
  MANAGE_USERS: "manageUsers",
}

export const STAFF_ROLES = [
  "class_pdf_admin",
  "exam_create_admin",
  "class_exam_admin",
  "users_admin",
  "staff_admin",
]

export const isAdminPanelUser = (userProfile) =>
  userProfile?.role === "admin" || STAFF_ROLES.includes(userProfile?.role)

export const isFullAdmin = (userProfile) =>
  userProfile?.role === "admin" && userProfile?.adminAccess?.mode !== "limited"

const isLegacyLimitedAdmin = (userProfile) =>
  userProfile?.role === "admin" && userProfile?.adminAccess?.mode === "limited"

const isLimitedStaff = (userProfile) =>
  STAFF_ROLES.includes(userProfile?.role) || isLegacyLimitedAdmin(userProfile)

export const hasAdminPermission = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return true
  if (!isLimitedStaff(userProfile)) return false

  if (permission === ADMIN_PERMISSION_KEYS.CLASS_PDF) {
    return (userProfile.adminAccess?.classPdfCourseIds || []).length > 0
  }

  if (permission === ADMIN_PERMISSION_KEYS.EXAM_CREATE) {
    return (userProfile.adminAccess?.examCourseIds || []).length > 0
  }

  if (permission === ADMIN_PERMISSION_KEYS.MANAGE_USERS) {
    return userProfile.adminAccess?.manageUsers === true || userProfile?.role === "users_admin"
  }

  return false
}

export const getAllowedCourseIds = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return null
  if (!isLimitedStaff(userProfile)) return []

  if (permission === ADMIN_PERMISSION_KEYS.CLASS_PDF) {
    return userProfile.adminAccess?.classPdfCourseIds || []
  }

  if (permission === ADMIN_PERMISSION_KEYS.EXAM_CREATE) {
    return userProfile.adminAccess?.examCourseIds || []
  }

  return []
}

export const canManageCourse = (userProfile, permission, courseId) => {
  if (isFullAdmin(userProfile)) return true
  return getAllowedCourseIds(userProfile, permission).includes(courseId)
}

export const getDefaultAdminPath = (userProfile) => {
  if (isFullAdmin(userProfile)) return "/admin"
  if (hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.MANAGE_USERS)) return "/admin/users"
  if (hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.CLASS_PDF)) return "/admin/classes"
  if (hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.EXAM_CREATE)) return "/admin/exams"
  return "/dashboard"
}

export const getStaffRole = ({ classPdfCourseIds = [], examCourseIds = [], manageUsers = false }) => {
  const hasContent = classPdfCourseIds.length > 0
  const hasExam = examCourseIds.length > 0

  if (manageUsers && (hasContent || hasExam)) return "staff_admin"
  if (manageUsers) return "users_admin"
  if (hasContent && hasExam) return "class_exam_admin"
  if (hasContent) return "class_pdf_admin"
  if (hasExam) return "exam_create_admin"
  return "user"
}

function limitedPermissionLabels(role, adminAccess = {}) {
  const labels = []
  const hasContent =
    (adminAccess.classPdfCourseIds || []).length > 0 ||
    role === "class_pdf_admin" ||
    role === "class_exam_admin"
  const hasExam =
    (adminAccess.examCourseIds || []).length > 0 ||
    role === "exam_create_admin" ||
    role === "class_exam_admin"
  const hasUsers = adminAccess.manageUsers === true || role === "users_admin"

  if (hasContent) labels.push("Content")
  if (hasExam) labels.push("Exam")
  if (hasUsers) labels.push("Users Access")
  return labels
}

export const getRoleLabel = (role, adminAccess = {}) => {
  if (role === "admin" && adminAccess?.mode !== "limited") return "Full Admin"

  if (role === "admin" || STAFF_ROLES.includes(role)) {
    const labels = limitedPermissionLabels(role, adminAccess)
    return labels.length > 0 ? `Limited Admin · ${labels.join(" + ")}` : "Limited Admin"
  }

  if (role === "user" || !role) return "Normal User"
  return role.replaceAll("_", " ")
}
