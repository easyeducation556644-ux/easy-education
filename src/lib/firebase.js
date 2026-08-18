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

function isNativeAndroidApp() {
  return typeof window !== "undefined" && Boolean(window.EasyEducationNative?.postMessage)
}

function clearLegacyPermanentCacheMarkers() {
  if (typeof window === "undefined" || isNativeAndroidApp()) return
  try {
    const prefixes = [
      "ee_permanent_cache:",
      "ee_permanent_collection:",
      "ee_content_sync_seq_v1",
      "ee_user_sync_seq_v1:",
      "ee_targeted_sync_queue_v1",
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

try {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)

  // Persistent Firestore caching is retained for the native Android app where it is
  // an explicit offline feature. On the website we intentionally use memory-only
  // caching so stale IndexedDB state can never survive a reload and become the
  // source of truth for access, payment, or course data.
  if (isNativeAndroidApp()) {
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          cacheSizeBytes: 100 * 1024 * 1024,
          tabManager: persistentMultipleTabManager(),
        }),
      })
      console.log(" Firestore persistent cache enabled for native Android")
    } catch (cacheError) {
      console.warn(" Persistent Firestore cache unavailable; falling back to memory cache", cacheError)
      db = initializeFirestore(app, { localCache: memoryLocalCache() })
    }
  } else {
    clearLegacyPermanentCacheMarkers()
    db = initializeFirestore(app, { localCache: memoryLocalCache() })
    console.log(" Firestore memory cache enabled for web")
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
