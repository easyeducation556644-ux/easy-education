import { useEffect, useRef, useState } from "react"
import { mountProtectedPlayer } from "../lib/unpiratorPlayerAdapter"

const DEVICE_STORAGE_KEY = "easy_education_unpirator_device_v1"

function getDeviceId() {
  try {
    let value = localStorage.getItem(DEVICE_STORAGE_KEY)
    if (!value) {
      value = crypto.randomUUID()
      localStorage.setItem(DEVICE_STORAGE_KEY, value)
    }
    return value
  } catch {
    return crypto.randomUUID()
  }
}

function getSafePlaybackError(error) {
  const message = String(error?.message || "")
  if (/supported secure browser|does not support protected playback/i.test(message)) {
    return "This browser does not support protected playback. Please use a supported secure browser."
  }
  return "Protected playback is temporarily unavailable. Please try again."
}

export default function UnpiratorYouTubePlayer({ url, title, user, onEnded }) {
  const rootRef = useRef(null)
  const onEndedRef = useRef(onEnded)
  const [error, setError] = useState("")

  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  useEffect(() => {
    if (!rootRef.current || !url || !user) return

    let active = true
    let player = null
    const controller = new AbortController()

    setError("")

    ;(async () => {
      try {
        player = await mountProtectedPlayer({
          element: rootRef.current,
          onError: (playerError) => {
            if (active) setError(getSafePlaybackError(playerError))
          },
          bootstrap: async () => {
            const firebaseToken = await user.getIdToken()
            const response = await fetch("/api/unpirator-playback", {
              method: "POST",
              credentials: "same-origin",
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${firebaseToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                youtubeUrl: url,
                title: title || undefined,
                deviceId: getDeviceId(),
                client: {
                  browser: navigator.userAgent.slice(0, 100),
                },
              }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
              throw new Error(data?.error?.message || data?.error || "Protected playback failed")
            }
            return data
          },
        })

        if (!active) {
          player.destroy()
          return
        }

        player.video?.addEventListener("ended", () => onEndedRef.current?.())
      } catch (playbackError) {
        if (!active || playbackError?.name === "AbortError") return
        setError(getSafePlaybackError(playbackError))
      }
    })()

    return () => {
      active = false
      controller.abort()
      player?.destroy()
    }
  }, [url, title, user])

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={rootRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-6 text-center text-sm text-white">
          {error}
        </div>
      )}
    </div>
  )
}
