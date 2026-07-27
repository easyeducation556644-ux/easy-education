import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

const DEFAULT_PROJECT_ID = "easy-education-real"

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

function ensureAdminApp() {
  if (getApps().length > 0) return getApps()[0]

  const serviceAccount = getServiceAccount()
  const projectId =
    serviceAccount?.projectId ||
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
    auth: getAuth(app),
    db: getFirestore(app),
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

  const { auth, db } = getAdminServices()
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
    decodedToken,
    userProfile,
    db,
  }
}

export function isFullAdminProfile(userProfile) {
  return (
    userProfile?.role === "admin" &&
    userProfile?.adminAccess?.mode !== "limited"
  )
}
