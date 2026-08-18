import { initializeApp } from "firebase/app"
import { getAuth, GoogleAuthProvider } from "firebase/auth"
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore"
import { getMessaging, isSupported } from "firebase/messaging"

console.log(" Initializing Firebase...")

const firebaseConfig = {
  apiKey: "AIzaSyA9U8SwZAaMjF90fkIbs8sYHev_VSbBZjc",
  authDomain: "easy-education-real.firebaseapp.com",
  projectId: "easy-education-real",
  storageBucket: "easy-education-real.firebasestorage.app",
  messagingSenderId: "457903642621",
  appId: "1:457903642621:web:5910d351656ef32d2ceb94",
  measurementId: "G-4BE9SRM6HK"
};

let app
let auth
let db
let googleProvider
let messaging

function clearLegacyCacheMarkers() {
  if (typeof window === "undefined") return
  try {
    const prefixes = [
      "ee_permanent_cache:",
      "ee_permanent_collection:",
      "ee_content_sync_seq_v1",
      "ee_user_sync_seq_v1:",
    ]
    Object.keys(localStorage).forEach((key) => {
      if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
        localStorage.removeItem(key)
      }
    })
  } catch (error) {
    console.warn(" Unable to clear legacy cache markers", error)
  }
}

function clearCacheV2TrustMarkers() {
  if (typeof window === "undefined") return
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("ee_cache_v4:") || key.startsWith("ee_cache_v4_seen:")) {
        localStorage.removeItem(key)
      }
    })
  } catch (_) {
    // Ignore storage failures.
  }
}

try {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  clearLegacyCacheMarkers()

  // Cache V2 deliberately persists Firestore data on both web and Android. The
  // cache wrapper never trusts old IndexedDB entries unless a v4 marker proves
  // that the exact document/query was primed from the server under this schema.
  // Targeted sync events then refresh only changed documents.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        cacheSizeBytes: 200 * 1024 * 1024,
        tabManager: persistentMultipleTabManager(),
      }),
    })
    if (typeof window !== "undefined") {
      window.__EASY_EDUCATION_PERSISTENT_FIRESTORE__ = true
      navigator.storage?.persist?.().catch(() => false)
    }
    console.log(" Firestore persistent Cache V2 storage enabled")
  } catch (cacheError) {
    console.warn(" Persistent Firestore cache unavailable; falling back to memory cache", cacheError)
    db = initializeFirestore(app, { localCache: memoryLocalCache() })
    if (typeof window !== "undefined") {
      window.__EASY_EDUCATION_PERSISTENT_FIRESTORE__ = false
      clearCacheV2TrustMarkers()
    }
  }

  googleProvider = new GoogleAuthProvider()
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  })

  isSupported().then((supported) => {
    if (supported) {
      messaging = getMessaging(app)
      console.log(" Firebase Messaging initialized successfully")
    } else {
      console.warn(" Firebase Messaging not supported in this browser")
    }
  }).catch((error) => {
    console.error(" Firebase Messaging initialization error:", error)
  })

  console.log(" Firebase initialized successfully")
  console.log(" Project ID:", firebaseConfig.projectId)
  console.log(" Using imgbb.com for image storage and Firebase Cloud Messaging for notifications")
} catch (error) {
  console.error(" Firebase initialization error:", error)
  throw new Error("Failed to initialize Firebase. Please check your configuration.")
}

export { auth, db, googleProvider, messaging }
export default app
