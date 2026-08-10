import { useEffect } from "react"
import { hasNativeDownloader } from "../lib/nativeAndroid"

const OFFLINE_CACHE = "easy-education-offline-v2"
const LEGACY_HLS_PATH = "/offline-assets/hls.min.js"
const NATIVE_HLS_PATH = "/native-assets/hls.min.js"

export default function NativeHlsBootstrap() {
  useEffect(() => {
    if (!hasNativeDownloader()) return
    if (document.querySelector('script[data-ee-native-hls="true"]')) return

    let cancelled = false
    const bootstrap = async () => {
      try {
        const runtime = await fetch(NATIVE_HLS_PATH, { cache: "force-cache" })
        if (!runtime.ok) throw new Error(`HTTP ${runtime.status}`)

        if ("caches" in window) {
          const cache = await caches.open(OFFLINE_CACHE)
          await cache.put(LEGACY_HLS_PATH, runtime.clone())
        }

        if (cancelled || window.Hls) return
        const script = document.createElement("script")
        script.src = NATIVE_HLS_PATH
        script.async = true
        script.dataset.eeNativeHls = "true"
        script.addEventListener("error", () => {
          console.error("Native HLS runtime failed to load")
        })
        document.head.appendChild(script)
      } catch (error) {
        console.error("Unable to prepare native HLS runtime", error)
      }
    }

    bootstrap()
    return () => { cancelled = true }
  }, [])

  return null
}
