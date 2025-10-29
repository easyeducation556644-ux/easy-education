import { initializeApp } from "firebase/app"
import { getAuth, GoogleAuthProvider } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getMessaging, isSupported } from "firebase/messaging"

console.log(" Initializing Firebase...")

const firebaseConfig = {
  apiKey: "AIzaSyCeSmrbWCldLLI0D3UUhdY1Qinw3-puIPQ",
  authDomain: "easy-educat.firebaseapp.com",
  projectId: "easy-educat",
  storageBucket: "easy-educat.firebasestorage.app",
  messagingSenderId: "1047552618209",
  appId: "1:1047552618209:web:09b31cb8d8fc2ff0dfd1a0",
  measurementId: "G-7YJX7M1SX3",
}

let app
let auth
let db
let googleProvider
let messaging

try {
  app = initializeApp(firebaseConfig)

  auth = getAuth(app)
  db = getFirestore(app)
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
