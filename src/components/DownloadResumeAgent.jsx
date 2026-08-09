import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { resumePendingDownloads } from "../lib/offlineDownloadManager"
import { hasNativeDownloader } from "../lib/nativeAndroid"

const WEB_DOWNLOAD_STYLE_ID = "easy-education-web-download-guard"
const WEB_DOWNLOAD_NOTE_CLASS = "easy-education-app-download-note"
const OFFLINE_VIDEO_CACHE = "easy-education-offline-v2"
const OFFLINE_HLS_RUNTIME = "/offline-assets/hls.min.js"
const NATIVE_HLS_BOOTSTRAP = "/native-assets/hls.min.js"

export default function DownloadResumeAgent() {
  const { currentUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [showRouteProgress, setShowRouteProgress] = useState(false)
  const nativeApp = hasNativeDownloader()

  useEffect(() => {
    if (nativeApp && currentUser?.uid) resumePendingDownloads(currentUser)
  }, [nativeApp, currentUser?.uid])

  useEffect(() => {
    if (!nativeApp || !("caches" in window)) return
    let cancelled = false

    ;(async () => {
      try {
        const cache = await caches.open(OFFLINE_VIDEO_CACHE)
        const existing = await cache.match(OFFLINE_HLS_RUNTIME)
        if (existing || cancelled) return

        const response = await fetch(NATIVE_HLS_BOOTSTRAP, { cache: "no-store" })
        if (!response.ok) throw new Error(`HLS runtime returned HTTP ${response.status}`)
        if (!cancelled) await cache.put(OFFLINE_HLS_RUNTIME, response.clone())
      } catch (error) {
        console.warn("Unable to prepare offline HLS playback:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [nativeApp])

  useEffect(() => {
    document.documentElement.dataset.easyEducationNativeApp = nativeApp ? "true" : "false"

    let style = document.getElementById(WEB_DOWNLOAD_STYLE_ID)
    if (!style) {
      style = document.createElement("style")
      style.id = WEB_DOWNLOAD_STYLE_ID
      style.textContent = `
        html[data-easy-education-native-app="false"] a[href="/downloads"] {
          display: none !important;
        }
        html[data-easy-education-native-app="false"] .aspect-video + .flex.flex-wrap.items-center.justify-between.gap-3.border-t.border-border.bg-card {
          display: none !important;
        }
        .${WEB_DOWNLOAD_NOTE_CLASS} {
          border-top: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.35);
          padding: 10px 16px;
          color: hsl(var(--muted-foreground));
          font-size: 0.875rem;
          line-height: 1.35rem;
        }
      `
      document.head.appendChild(style)
    }

    const removeNotes = () => {
      document.querySelectorAll(`.${WEB_DOWNLOAD_NOTE_CLASS}`).forEach((node) => node.remove())
    }

    const syncWebDownloadNote = () => {
      if (nativeApp || !/\/course\/[^/]+\/watch(?:\/|$)/.test(location.pathname)) {
        removeNotes()
        return
      }

      document.querySelectorAll(".aspect-video").forEach((videoBox) => {
        const parent = videoBox.parentElement
        if (!parent || parent.querySelector(`.${WEB_DOWNLOAD_NOTE_CLASS}`)) return

        const offlinePanel = videoBox.nextElementSibling
        const note = document.createElement("div")
        note.className = WEB_DOWNLOAD_NOTE_CLASS
        note.textContent = "ভিডিও ডাউনলোড করতে Easy Education app ব্যবহার করুন।"

        if (offlinePanel?.matches?.(".flex.flex-wrap.items-center.justify-between.gap-3.border-t.border-border.bg-card")) {
          offlinePanel.insertAdjacentElement("afterend", note)
        } else {
          videoBox.insertAdjacentElement("afterend", note)
        }
      })
    }

    syncWebDownloadNote()
    const observer = new MutationObserver(() => window.requestAnimationFrame(syncWebDownloadNote))
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      removeNotes()
    }
  }, [nativeApp, location.pathname])

  useEffect(() => {
    if (!nativeApp && location.pathname === "/downloads") {
      navigate("/courses", { replace: true })
    }
  }, [nativeApp, location.pathname, navigate])

  useEffect(() => {
    setShowRouteProgress(false)
    const showTimer = window.setTimeout(() => setShowRouteProgress(true), 140)
    const hideTimer = window.setTimeout(() => setShowRouteProgress(false), 520)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
    }
  }, [location.pathname, location.search])

  if (!showRouteProgress) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px] overflow-hidden bg-primary/10">
      <div className="h-full w-2/3 animate-[routeProgress_700ms_ease-out_infinite] bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
      <style>{`@keyframes routeProgress { 0% { transform: translateX(-100%); } 100% { transform: translateX(180%); } }`}</style>
    </div>
  )
}
