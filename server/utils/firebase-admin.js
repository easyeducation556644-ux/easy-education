import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

const DEFAULT_PROJECT_ID = "easy-education-real"
const DEFAULT_APP_NAME = "[DEFAULT]"
const OPERATIONS_APP_NAME = "easy-education-operations"
const LIMITED_ADMIN_MODES = new Set(["limited", "custom"])

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }
  }

  return null
}

function getOperationsServiceAccount() {
  if (process.env.OPS_FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.OPS_FIREBASE_SERVICE_ACCOUNT)
  if (process.env.OPS_FIREBASE_PROJECT_ID && process.env.OPS_FIREBASE_CLIENT_EMAIL && process.env.OPS_FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.OPS_FIREBASE_PROJECT_ID,
      clientEmail: process.env.OPS_FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.OPS_FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }
  }
  return null
}

function ensureAdminApp() {
  const existingDefault = getApps().find((app) => app.name === DEFAULT_APP_NAME)
  if (existingDefault) return existingDefault

  const serviceAccount = getServiceAccount()
  const projectId =
    serviceAccount?.projectId ||
    serviceAccount?.project_id ||
    process.env.FIREBASE_PROJECT_ID ||
    DEFAULT_PROJECT_ID

  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId,
    })
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  })
}

export function getAdminServices() {
  const app = ensureAdminApp()
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
  }
}

export function getOperationsServices() {
  const existing = getApps().find((app) => app.name === OPERATIONS_APP_NAME)
  if (existing) return { app: existing, db: getFirestore(existing) }
  const serviceAccount = getOperationsServiceAccount()
  if (!serviceAccount) {
    const error = new Error("Operations database is not configured")
    error.code = "OPS_DATABASE_NOT_CONFIGURED"
    error.statusCode = 503
    throw error
  }
  const projectId = serviceAccount.projectId || serviceAccount.project_id || process.env.OPS_FIREBASE_PROJECT_ID
  if (!projectId) throw new Error("Operations Firebase project ID is missing")
  const app = initializeApp({ credential: cert(serviceAccount), projectId }, OPERATIONS_APP_NAME)
  return { app, db: getFirestore(app) }
}

export async function requireVerifiedUser(req) {
  const authorization = req.headers.authorization || ""
  const match = authorization.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    const error = new Error("Authentication required")
    error.statusCode = 401
    throw error
  }

  const { auth } = getAdminServices()
  try {
    return await auth.verifyIdToken(match[1])
  } catch {
    const error = new Error("Invalid or expired authentication token")
    error.statusCode = 401
    throw error
  }
}

export async function requireAuthenticatedUser(req) {
  const authorization = req.headers.authorization || ""
  const match = authorization.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    const error = new Error("Authentication required")
    error.statusCode = 401
    throw error
  }

  const { app, auth, db } = getAdminServices()
  let decodedToken

  try {
    decodedToken = await auth.verifyIdToken(match[1])
  } catch {
    const error = new Error("Invalid or expired authentication token")
    error.statusCode = 401
    throw error
  }

  const userSnapshot = await db.collection("users").doc(decodedToken.uid).get()
  const userProfile = userSnapshot.exists ? userSnapshot.data() : {}

  return {
    app,
    decodedToken,
    userProfile,
    db,
  }
}

export function isLimitedAdminProfile(userProfile) {
  return userProfile?.role === "admin" && LIMITED_ADMIN_MODES.has(userProfile?.adminAccess?.mode)
}

export function isFullAdminProfile(userProfile) {
  return userProfile?.role === "admin" && !LIMITED_ADMIN_MODES.has(userProfile?.adminAccess?.mode)
}

export function profileHasAdminPage(userProfile, page) {
  if (isFullAdminProfile(userProfile)) return true
  if (!isLimitedAdminProfile(userProfile)) return false
  return Array.isArray(userProfile?.adminAccess?.pages) && userProfile.adminAccess.pages.includes(page)
}

export function profileHasUserAction(userProfile, action) {
  if (isFullAdminProfile(userProfile)) return true
  if (!profileHasAdminPage(userProfile, "users")) return false
  return Array.isArray(userProfile?.adminAccess?.userActions)
    && userProfile.adminAccess.userActions.includes(action)
}

export function profilePageCourseIds(userProfile, page) {
  if (isFullAdminProfile(userProfile)) return null
  if (!profileHasAdminPage(userProfile, page)) return []
  const values = userProfile?.adminAccess?.courseIdsByPage?.[page]
  return Array.isArray(values) ? [...new Set(values.filter(Boolean))] : []
}

export function profileCanManageCourse(userProfile, page, courseId) {
  const allowed = profilePageCourseIds(userProfile, page)
  return allowed === null || allowed.includes(courseId)
}
