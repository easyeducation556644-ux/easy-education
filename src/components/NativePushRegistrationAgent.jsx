import { useEffect } from "react"
import { useAuth } from "../contexts/AuthContext"
import { hasNativeDownloader, nativeRequest } from "../lib/nativeAndroid"

const REGISTRATION_KEY = "ee_native_push_registration_v2"
const STATUS_KEY = "ee_native_push_status_v1"
const RETRY_DELAYS = [1200, 5000, 15000, 60000, 180000]

function saveStatus(status) {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ ...status, at: Date.now() }))
  } catch (_) {
    // Status is diagnostic only.
  }
  window.dispatchEvent(new CustomEvent("easy-education-push-registration", { detail: status }))
}

export default function NativePushRegistrationAgent() {
  const { currentUser } = useAuth()

  useEffect(() => {
    if (!currentUser?.uid || !hasNativeDownloader()) return
    let cancelled = false
    let attempt = 0
    let timer = null
    let inFlight = false

    const schedule = (delay) => {
      if (cancelled) return
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(register, delay)
    }

    const register = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const native = await nativeRequest("pushToken")
        const token = String(native?.token || "")
        const deviceId = String(native?.deviceId || "")
        const notificationsAllowed = native?.notificationsAllowed !== false
        if (!token || !deviceId) throw new Error("App notification token is unavailable")

        if (!notificationsAllowed) {
          saveStatus({ ok: false, reason: "permission", message: "Notification permission is disabled" })
          attempt = Math.min(attempt + 1, RETRY_DELAYS.length - 1)
          schedule(RETRY_DELAYS[attempt])
          return
        }

        const signature = `${currentUser.uid}:${deviceId}:${token}`
        if (localStorage.getItem(REGISTRATION_KEY) === signature) {
          saveStatus({ ok: true, cached: true, deviceId })
          attempt = 0
          return
        }

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
            notificationsAllowed: true,
          }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok || !body?.success) {
          throw new Error(body?.error || `Push registration failed: ${response.status}`)
        }
        if (cancelled) return
        localStorage.setItem(REGISTRATION_KEY, signature)
        saveStatus({
          ok: true,
          cached: false,
          deviceId,
          courseCount: Number(body.courseCount || 0),
        })
        attempt = 0
      } catch (error) {
        if (cancelled) return
        console.warn("Native learning notification registration failed:", error)
        saveStatus({ ok: false, reason: "registration", message: error?.message || "Registration failed" })
        attempt = Math.min(attempt + 1, RETRY_DELAYS.length - 1)
        schedule(RETRY_DELAYS[attempt])
      } finally {
        inFlight = false
      }
    }

    const onOnline = () => schedule(250)
    const onVisibility = () => {
      if (!document.hidden) schedule(250)
    }

    window.addEventListener("online", onOnline)
    document.addEventListener("visibilitychange", onVisibility)
    schedule(RETRY_DELAYS[0])

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      window.removeEventListener("online", onOnline)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [currentUser?.uid])

  return null
}
