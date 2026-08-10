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

try {
  app = initializeApp(firebaseConfig)

  auth = getAuth(app)

  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        cacheSizeBytes: 100 * 1024 * 1024,
        tabManager: persistentMultipleTabManager(),
      }),
    })
    console.log(" Firestore persistent cache enabled")
  } catch (cacheError) {
    console.warn(" Persistent Firestore cache unavailable; falling back to memory cache", cacheError)
    db = initializeFirestore(app, { localCache: memoryLocalCache() })
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
