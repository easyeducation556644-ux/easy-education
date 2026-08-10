import { useEffect } from "react"
import { useAuth } from "../contexts/AuthContext"
import { hasNativeDownloader, nativeRequest } from "../lib/nativeAndroid"

const REGISTRATION_KEY = "ee_native_push_registration_v1"

export default function NativePushRegistrationAgent() {
  const { currentUser } = useAuth()

  useEffect(() => {
    if (!currentUser?.uid || !hasNativeDownloader()) return
    let cancelled = false

    const register = async () => {
      try {
        const native = await nativeRequest("pushToken")
        const token = String(native?.token || "")
        const deviceId = String(native?.deviceId || "")
        if (!token || !deviceId || cancelled) return

        const signature = `${currentUser.uid}:${deviceId}:${token}`
        if (localStorage.getItem(REGISTRATION_KEY) === signature) return

        const idToken = await currentUser.getIdToken()
        const response = await fetch("/api/learning-push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            action: "register",
            token,
            deviceId,
            platform: "android",
          }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error || `Push registration failed: ${response.status}`)
        }
        if (!cancelled) localStorage.setItem(REGISTRATION_KEY, signature)
      } catch (error) {
        if (!cancelled) console.warn("Native learning notification registration failed:", error)
      }
    }

    const timer = window.setTimeout(register, 1200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [currentUser?.uid])

  return null
}
