import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { resumePendingDownloads } from "../lib/offlineDownloadManager"
import { hasNativeDownloader } from "../lib/nativeAndroid"

const WEB_DOWNLOAD_STYLE_ID = "easy-education-web-download-guard"
const WEB_DOWNLOAD_NOTE_CLASS = "easy-education-app-download-note"
const PAGE_SKELETON_CLASS = "easy-education-page-loading-skeleton"
const OFFLINE_VIDEO_CACHE = "easy-education-offline-v2"
const OFFLINE_HLS_RUNTIME = "/offline-assets/hls.min.js"
const NATIVE_HLS_BOOTSTRAP = "/native-assets/hls.min.js"
const NATIVE_HLS_SCRIPT_ID = "easy-education-native-hls-runtime"

export default function DownloadResumeAgent() {
  const { currentUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [showRouteProgress, setShowRouteProgress] = useState(false)
  const nativeApp = hasNativeDownloader()

  useEffect(() => {
    if (!nativeApp || !currentUser?.uid) return

    const resume = () => {
      try {
        resumePendingDownloads(currentUser)
      } catch (error) {
        console.warn("Unable to resume pending downloads:", error)
      }
    }

    resume()
    window.addEventListener("online", resume)
    return () => window.removeEventListener("online", resume)
  }, [nativeApp, currentUser?.uid])

  useEffect(() => {
    if (!nativeApp || window.Hls) return

    let script = document.getElementById(NATIVE_HLS_SCRIPT_ID)
    if (!script) {
      script = document.createElement("script")
      script.id = NATIVE_HLS_SCRIPT_ID
      script.src = NATIVE_HLS_BOOTSTRAP
      script.async = false
      script.dataset.easyEducationNativeHls = "true"
      document.head.appendChild(script)
    }
  }, [nativeApp])

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
        .${PAGE_SKELETON_CLASS} {
          display: block !important;
          min-height: 55vh !important;
          width: min(100%, 72rem);
          margin: 0 auto;
          padding: 1.5rem 1rem !important;
          position: relative;
        }
        .${PAGE_SKELETON_CLASS} > .animate-spin {
          display: none !important;
        }
        .${PAGE_SKELETON_CLASS}::before {
          content: "";
          display: block;
          width: 100%;
          height: min(460px, 58vh);
          border-radius: 18px;
          background:
            linear-gradient(100deg, transparent 20%, hsl(var(--background) / .62) 42%, transparent 64%) 0 0 / 220% 100% no-repeat,
            linear-gradient(hsl(var(--muted)) 0 0) 0 0 / 32% 26px no-repeat,
            linear-gradient(hsl(var(--muted)) 0 0) 0 46px / 58% 15px no-repeat,
            linear-gradient(hsl(var(--muted)) 0 0) 0 92px / 100% 190px no-repeat,
            linear-gradient(hsl(var(--muted)) 0 0) 0 306px / 48% 22px no-repeat,
            linear-gradient(hsl(var(--muted)) 0 0) 0 348px / 100% 92px no-repeat;
          animation: easyEducationSkeletonShimmer 1.25s ease-in-out infinite;
          opacity: .78;
        }
        @keyframes easyEducationSkeletonShimmer {
          0% { background-position: 130% 0, 0 0, 0 46px, 0 92px, 0 306px, 0 348px; }
          100% { background-position: -130% 0, 0 0, 0 46px, 0 92px, 0 306px, 0 348px; }
        }
      `
      document.head.appendChild(style)
    }

    const removeNotes = () => {
      document.querySelectorAll(`.${WEB_DOWNLOAD_NOTE_CLASS}`).forEach((node) => node.remove())
    }

    const syncPageLoadingSkeletons = () => {
      document.querySelectorAll(".min-h-screen.flex.items-center.justify-center").forEach((node) => {
        const spinner = node.querySelector(":scope > .animate-spin")
        if (spinner) node.classList.add(PAGE_SKELETON_CLASS)
        else node.classList.remove(PAGE_SKELETON_CLASS)
      })
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

    const syncUi = () => {
      syncPageLoadingSkeletons()
      syncWebDownloadNote()
    }

    syncUi()
    const observer = new MutationObserver(() => window.requestAnimationFrame(syncUi))
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      removeNotes()
      document.querySelectorAll(`.${PAGE_SKELETON_CLASS}`).forEach((node) => {
        node.classList.remove(PAGE_SKELETON_CLASS)
      })
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
