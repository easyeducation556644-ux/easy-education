import { useEffect } from "react"
import { hasNativeDownloader } from "../lib/nativeAndroid"

export default function NativeHlsBootstrap() {
  useEffect(() => {
    if (!hasNativeDownloader() || window.Hls) return
    if (document.querySelector('script[data-ee-native-hls="true"]')) return

    const script = document.createElement("script")
    script.src = "/native-assets/hls.min.js"
    script.async = true
    script.dataset.eeNativeHls = "true"
    script.addEventListener("error", () => {
      console.error("Native HLS runtime failed to load")
    })
    document.head.appendChild(script)
  }, [])

  return null
}
