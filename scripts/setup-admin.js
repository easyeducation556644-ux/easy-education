// Run this script to make yourself an admin
// Instructions:
// 1. Replace 'YOUR_USER_ID' with your actual Firebase Auth UID
// 2. Run this from the browser console on your app

import { doc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"

async function makeAdmin(userId) {
  try {
    const userRef = doc(db, "users", userId)
    await updateDoc(userRef, {
      isAdmin: true,
      role: "admin",
    })
    console.log(" Successfully made user admin:", userId)
    alert("Admin status granted! Please refresh the page.")
  } catch (error) {
    console.error(" Error making admin:", error)
    alert("Error: " + error.message)
  }
}

// Replace with your Firebase Auth UID
const YOUR_USER_ID = "1:1047552618209:web:09b31cb8d8fc2ff0dfd1a0"
makeAdmin(YOUR_USER_ID)
