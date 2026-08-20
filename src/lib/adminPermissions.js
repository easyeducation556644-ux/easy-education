export const ADMIN_PERMISSION_KEYS = {
  OVERVIEW: "overview",
  READ_USAGE: "readUsage",
  ADMINISTRATION: "administration",
  SECURITY_EVENTS: "securityEvents",
  NOTIFICATIONS: "notifications",
  BAN_ALERTS: "banAlerts",
  BAN_MANAGEMENT: "banManagement",
  USERS: "users",
  CATEGORIES: "categories",
  COURSES: "courses",
  SUBJECTS: "subjects",
  CHAPTERS: "chapters",
  CLASSES: "classes",
  CLASS_COMMENTS: "classComments",
  EXAMS: "exams",
  EXAM_RESULTS: "examResults",
  EXAM_SUBMISSIONS: "examSubmissions",
  TEACHERS: "teachers",
  ANNOUNCEMENTS: "announcements",
  COUPONS: "coupons",
  PAYMENTS: "payments",
  TELEGRAM: "telegram",
  SETTINGS: "settings",
  RANKINGS: "rankings",

  // Backward-compatible aliases used by the existing content/exam pages.
  CLASS_PDF: "classPdf",
  EXAM_CREATE: "examCreate",
}

export const USER_ADMIN_ACTION_KEYS = {
  VIEW_DETAILS: "viewDetails",
  BAN: "ban",
  GRANT_COURSE_ACCESS: "grantCourseAccess",
  MANAGE_COURSE_ACCESS: "manageCourseAccess",
  SCREEN_CAPTURE: "screenCapture",
  DELETE: "delete",
  PROMOTE_ADMIN: "promoteAdmin",
  FIX_ACCOUNTS: "fixAccounts",
  SCAN_ORPHANS: "scanOrphans",
}

export const USER_ADMIN_ACTIONS = [
  {
    id: USER_ADMIN_ACTION_KEYS.VIEW_DETAILS,
    label: "View user details",
    description: "Open profile, device and ban-history details.",
  },
  {
    id: USER_ADMIN_ACTION_KEYS.BAN,
    label: "Ban / unban users",
    description: "Temporarily ban users or clear an existing ban.",
  },
  {
    id: USER_ADMIN_ACTION_KEYS.GRANT_COURSE_ACCESS,
    label: "Grant course access",
    description: "Enroll a user in one of the moderator's allowed courses.",
    courseScoped: true,
  },
  {
    id: USER_ADMIN_ACTION_KEYS.MANAGE_COURSE_ACCESS,
    label: "Manage course access",
    description: "View and remove enrollments for allowed courses.",
    courseScoped: true,
  },
  {
    id: USER_ADMIN_ACTION_KEYS.SCREEN_CAPTURE,
    label: "Manage screen capture access",
    description: "Allow or restore screenshot and screen-recording protection for specific users.",
    dangerous: true,
  },
  {
    id: USER_ADMIN_ACTION_KEYS.DELETE,
    label: "Delete users",
    description: "Permanently delete a user profile.",
    dangerous: true,
  },
  {
    id: USER_ADMIN_ACTION_KEYS.PROMOTE_ADMIN,
    label: "Make a user Full Admin",
    description: "High-risk permission. Promotion requires two confirmations every time.",
    dangerous: true,
    doubleConfirm: true,
  },
  {
    id: USER_ADMIN_ACTION_KEYS.FIX_ACCOUNTS,
    label: "Fix stale account data",
    description: "Run the existing stale-device / expired-ban cleanup tool.",
  },
  {
    id: USER_ADMIN_ACTION_KEYS.SCAN_ORPHANS,
    label: "Scan orphaned course access",
    description: "Inspect and remove suspicious orphaned enrollment records.",
    dangerous: true,
  },
]

export const ADMIN_PAGE_CATALOG = [
  { id: ADMIN_PERMISSION_KEYS.OVERVIEW, label: "Overview", path: "/admin", description: "Dashboard summary." },
  { id: ADMIN_PERMISSION_KEYS.READ_USAGE, label: "Read Usage", path: "/admin/read-usage", description: "Firestore read-usage analytics." },
  {
    id: ADMIN_PERMISSION_KEYS.ADMINISTRATION,
    label: "Administration",
    path: "/admin/administration",
    description: "Assign roles and permissions. Reserved for Full Admins to prevent privilege escalation.",
    fullAdminOnly: true,
  },
  { id: ADMIN_PERMISSION_KEYS.SECURITY_EVENTS, label: "Security Events", path: "/admin/security-events", description: "Security-event history." },
  { id: ADMIN_PERMISSION_KEYS.NOTIFICATIONS, label: "Notifications", path: "/admin/notifications", description: "Admin notifications." },
  { id: ADMIN_PERMISSION_KEYS.BAN_ALERTS, label: "Ban Alerts", path: "/admin/ban-notifications", description: "Automatic ban alerts." },
  { id: ADMIN_PERMISSION_KEYS.BAN_MANAGEMENT, label: "Ban Info", path: "/admin/ban-management", description: "Ban-management records." },
  {
    id: ADMIN_PERMISSION_KEYS.USERS,
    label: "Users",
    path: "/admin/users",
    description: "User management. Select the allowed actions below.",
    hasUserActions: true,
  },
  { id: ADMIN_PERMISSION_KEYS.CATEGORIES, label: "Categories", path: "/admin/categories", description: "Manage course categories." },
  { id: ADMIN_PERMISSION_KEYS.COURSES, label: "Courses", path: "/admin/courses", description: "Manage course catalogue." },
  {
    id: ADMIN_PERMISSION_KEYS.SUBJECTS,
    label: "Subjects",
    path: "/admin/subjects",
    description: "Manage subjects in selected courses.",
    courseScoped: true,
  },
  {
    id: ADMIN_PERMISSION_KEYS.CHAPTERS,
    label: "Chapters",
    path: "/admin/chapters",
    description: "Manage chapters in selected courses.",
    courseScoped: true,
  },
  {
    id: ADMIN_PERMISSION_KEYS.CLASSES,
    label: "Classes & PDF",
    path: "/admin/classes",
    description: "Manage classes and resources in selected courses.",
    courseScoped: true,
  },
  {
    id: ADMIN_PERMISSION_KEYS.CLASS_COMMENTS,
    label: "Class Comments",
    path: "/admin/class-comments",
    description: "Moderate comments for selected courses.",
    courseScoped: true,
  },
  {
    id: ADMIN_PERMISSION_KEYS.EXAMS,
    label: "Exam Create",
    path: "/admin/exams",
    description: "Create exams and questions for selected courses.",
    courseScoped: true,
  },
  {
    id: ADMIN_PERMISSION_KEYS.EXAM_RESULTS,
    label: "Exam Results",
    path: "/admin/exam-results",
    description: "View exam results for selected courses.",
    courseScoped: true,
  },
  {
    id: ADMIN_PERMISSION_KEYS.EXAM_SUBMISSIONS,
    label: "CQ Submissions",
    path: "/admin/exam-submissions",
    description: "Review CQ submissions for selected courses.",
    courseScoped: true,
  },
  { id: ADMIN_PERMISSION_KEYS.TEACHERS, label: "Teachers", path: "/admin/teachers", description: "Manage teachers." },
  { id: ADMIN_PERMISSION_KEYS.ANNOUNCEMENTS, label: "Announcements", path: "/admin/announcements", description: "Manage announcements." },
  { id: ADMIN_PERMISSION_KEYS.COUPONS, label: "Coupons", path: "/admin/coupons", description: "Manage coupons." },
  { id: ADMIN_PERMISSION_KEYS.PAYMENTS, label: "Payments", path: "/admin/payments", description: "Review payments." },
  { id: ADMIN_PERMISSION_KEYS.TELEGRAM, label: "Telegram Subs", path: "/admin/telegram", description: "Review Telegram submissions." },
  { id: ADMIN_PERMISSION_KEYS.SETTINGS, label: "Settings", path: "/admin/settings", description: "Website settings.", dangerous: true },
  { id: ADMIN_PERMISSION_KEYS.RANKINGS, label: "Rankings", path: "/admin/rankings", description: "Manage rankings." },
]

export const STAFF_ROLES = ["class_pdf_admin", "exam_create_admin", "class_exam_admin"]

const LIMITED_MODES = new Set(["limited", "custom"])

export const isFullAdmin = (userProfile) =>
  userProfile?.role === "admin" && !LIMITED_MODES.has(userProfile?.adminAccess?.mode)

const isLimitedAdmin = (userProfile) =>
  userProfile?.role === "admin" && LIMITED_MODES.has(userProfile?.adminAccess?.mode)

const legacyRolePages = (userProfile) => {
  const role = userProfile?.role
  const access = userProfile?.adminAccess || {}
  const pages = new Set()

  const hasClassAccess =
    role === "class_pdf_admin" ||
    role === "class_exam_admin" ||
    (isLimitedAdmin(userProfile) && (access.classPdfCourseIds || []).length > 0)
  const hasExamAccess =
    role === "exam_create_admin" ||
    role === "class_exam_admin" ||
    (isLimitedAdmin(userProfile) && (access.examCourseIds || []).length > 0)

  if (hasClassAccess) {
    pages.add(ADMIN_PERMISSION_KEYS.SUBJECTS)
    pages.add(ADMIN_PERMISSION_KEYS.CHAPTERS)
    pages.add(ADMIN_PERMISSION_KEYS.CLASSES)
  }
  if (hasExamAccess) pages.add(ADMIN_PERMISSION_KEYS.EXAMS)

  return pages
}

export const getExplicitAdminPages = (userProfile) => {
  const access = userProfile?.adminAccess || {}
  const configured = Array.isArray(access.pages)
    ? access.pages
    : Array.isArray(access.permissions)
      ? access.permissions
      : []
  return new Set(configured.filter(Boolean))
}

export const getEffectiveAdminPages = (userProfile) => {
  if (isFullAdmin(userProfile)) {
    return new Set(ADMIN_PAGE_CATALOG.map((item) => item.id))
  }

  const pages = getExplicitAdminPages(userProfile)
  legacyRolePages(userProfile).forEach((page) => pages.add(page))
  return pages
}

export const isAdminPanelUser = (userProfile) =>
  isFullAdmin(userProfile) ||
  isLimitedAdmin(userProfile) ||
  STAFF_ROLES.includes(userProfile?.role)

const permissionForLegacyAlias = (permission) => {
  if (permission === ADMIN_PERMISSION_KEYS.CLASS_PDF) {
    if (typeof window !== "undefined") {
      const path = window.location.pathname
      if (path.startsWith("/admin/subjects")) return ADMIN_PERMISSION_KEYS.SUBJECTS
      if (path.startsWith("/admin/chapters")) return ADMIN_PERMISSION_KEYS.CHAPTERS
      if (path.startsWith("/admin/classes")) return ADMIN_PERMISSION_KEYS.CLASSES
    }
    return ADMIN_PERMISSION_KEYS.CLASSES
  }
  if (permission === ADMIN_PERMISSION_KEYS.EXAM_CREATE) return ADMIN_PERMISSION_KEYS.EXAMS
  return permission
}

export const hasAdminPermission = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return true
  const resolved = permissionForLegacyAlias(permission)
  if (resolved === ADMIN_PERMISSION_KEYS.ADMINISTRATION) return false
  return getEffectiveAdminPages(userProfile).has(resolved)
}

export const hasUserAdminAction = (userProfile, action) => {
  if (isFullAdmin(userProfile)) return true
  if (!hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.USERS)) return false
  const actions = userProfile?.adminAccess?.userActions
  return Array.isArray(actions) && actions.includes(action)
}

export const getPageDefinition = (permission) => {
  const resolved = permissionForLegacyAlias(permission)
  return ADMIN_PAGE_CATALOG.find((item) => item.id === resolved) || null
}

export const getPageCourseIds = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return null

  const access = userProfile?.adminAccess || {}
  const resolved = permissionForLegacyAlias(permission)
  const scoped = access.courseIdsByPage?.[resolved]
  if (Array.isArray(scoped)) return scoped

  // Backward compatibility for the old two-role model.
  if (
    resolved === ADMIN_PERMISSION_KEYS.SUBJECTS ||
    resolved === ADMIN_PERMISSION_KEYS.CHAPTERS ||
    resolved === ADMIN_PERMISSION_KEYS.CLASSES
  ) {
    return access.classPdfCourseIds || []
  }
  if (resolved === ADMIN_PERMISSION_KEYS.EXAMS) return access.examCourseIds || []
  return []
}

export const getAllowedCourseIds = (userProfile, permission) => {
  if (isFullAdmin(userProfile)) return null
  if (!hasAdminPermission(userProfile, permission)) return []
  const page = getPageDefinition(permission)
  if (!page?.courseScoped) return null
  return getPageCourseIds(userProfile, permission)
}

export const getUsersCourseIds = (userProfile) => {
  if (isFullAdmin(userProfile)) return null
  if (!hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.USERS)) return []
  const ids = userProfile?.adminAccess?.courseIdsByPage?.[ADMIN_PERMISSION_KEYS.USERS]
  return Array.isArray(ids) ? ids : []
}

export const canManageCourse = (userProfile, permission, courseId) => {
  const allowed = getAllowedCourseIds(userProfile, permission)
  return allowed === null || allowed.includes(courseId)
}

export const getDefaultAdminPath = (userProfile) => {
  if (isFullAdmin(userProfile)) return "/admin"
  const pages = getEffectiveAdminPages(userProfile)
  const first = ADMIN_PAGE_CATALOG.find((item) => !item.fullAdminOnly && pages.has(item.id))
  return first?.path || "/dashboard"
}

export const getStaffRole = ({ classPdfCourseIds = [], examCourseIds = [] }) => {
  if (classPdfCourseIds.length > 0 && examCourseIds.length > 0) return "class_exam_admin"
  if (classPdfCourseIds.length > 0) return "class_pdf_admin"
  if (examCourseIds.length > 0) return "exam_create_admin"
  return "user"
}

export const getRoleLabel = (role, adminAccess) => {
  if (role === "admin" && LIMITED_MODES.has(adminAccess?.mode)) return "Custom Moderator"
  if (role === "admin") return "Full Admin"
  if (role === "class_pdf_admin") return "Class, PDF, Subject & Chapter Admin (legacy)"
  if (role === "exam_create_admin") return "Exam Create Admin (legacy)"
  if (role === "class_exam_admin") return "Content & Exam Admin (legacy)"
  if (role === "user") return "Normal User"
  return role ? role.replaceAll("_", " ") : "Normal User"
}
