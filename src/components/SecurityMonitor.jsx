import { useEffect, useRef } from "react"
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore"
import { auth, db } from "../lib/firebase"

const CLIENT_COOLDOWN_MS = 2 * 60 * 1000
const DEVTOOLS_GAP_THRESHOLD = 220

const getShortcutLabel = (event) => {
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean)

  return [...modifiers, event.key].join("+")
}

export default function SecurityMonitor() {
  const cooldownsRef = useRef(new Map())
  const devtoolsOpenRef = useRef(false)

  useEffect(() => {
    let disposed = false

    const reportEvent = async (eventType, detectionMethod, details = {}) => {
      const user = auth.currentUser
      if (!user || disposed) return

      const route = `${window.location.pathname}${window.location.search}`
      const cooldownKey = `${eventType}:${route}`
      const lastSentAt = cooldownsRef.current.get(cooldownKey) || 0
      if (Date.now() - lastSentAt < CLIENT_COOLDOWN_MS) return
      cooldownsRef.current.set(cooldownKey, Date.now())

      try {
        const eventId = [
          "security",
          String(Date.now()).padStart(13, "0"),
          user.uid,
          crypto.randomUUID?.() || Math.random().toString(36).slice(2),
        ].join("_")
        const eventRef = doc(collection(db, "examAttempts"), eventId)

        await setDoc(eventRef, {
          eventCategory: "security_event",
          eventType,
          detectionMethod,
          route,
          userId: user.uid,
          userName: user.displayName || "Unknown User",
          userEmail: user.email || "",
          userAgent: navigator.userAgent || "",
          platform: navigator.userAgentData?.platform || navigator.platform || "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
          details: {
            ...details,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            screen: `${window.screen.width}x${window.screen.height}`,
          },
          hitCount: 1,
          firstDetectedAt: serverTimestamp(),
          lastDetectedAt: serverTimestamp(),
        })
      } catch {
        // Security telemetry must never interrupt normal site usage.
      }
    }

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase()
      const devtoolsShortcut =
        event.key === "F12" ||
        ((event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          ["i", "j", "c", "k"].includes(key)) ||
        (event.metaKey && event.altKey && ["i", "j", "c"].includes(key))

      const viewSourceShortcut =
        (event.ctrlKey && !event.shiftKey && key === "u") ||
        (event.metaKey && event.altKey && key === "u")

      if (devtoolsShortcut) {
        reportEvent("devtools_shortcut", "keyboard_shortcut", {
          shortcut: getShortcutLabel(event),
        })
      } else if (viewSourceShortcut) {
        reportEvent("view_source_shortcut", "keyboard_shortcut", {
          shortcut: getShortcutLabel(event),
        })
      }
    }

    const handleContextMenu = (event) => {
      if (event.target.closest?.('[data-security-zone="video-player"]')) {
        reportEvent("video_context_menu", "video_context_menu")
      }
    }

    const checkDevtoolsGap = () => {
      const likelyMobile =
        window.screen.width < 800 ||
        /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
      if (likelyMobile) return

      const widthGap = Math.max(0, window.outerWidth - window.innerWidth)
      const heightGap = Math.max(0, window.outerHeight - window.innerHeight)
      const looksOpen =
        widthGap > DEVTOOLS_GAP_THRESHOLD ||
        heightGap > DEVTOOLS_GAP_THRESHOLD

      if (looksOpen && !devtoolsOpenRef.current) {
        reportEvent("devtools_size_heuristic", "window_size_gap", {
          widthGap,
          heightGap,
        })
      }

      devtoolsOpenRef.current = looksOpen
    }

    window.addEventListener("keydown", handleKeyDown, true)
    document.addEventListener("contextmenu", handleContextMenu, true)
    window.addEventListener("resize", checkDevtoolsGap)

    const initialCheck = window.setTimeout(checkDevtoolsGap, 1500)
    const periodicCheck = window.setInterval(checkDevtoolsGap, 3000)

    return () => {
      disposed = true
      window.removeEventListener("keydown", handleKeyDown, true)
      document.removeEventListener("contextmenu", handleContextMenu, true)
      window.removeEventListener("resize", checkDevtoolsGap)
      window.clearTimeout(initialCheck)
      window.clearInterval(periodicCheck)
    }
  }, [])

  return null
}
