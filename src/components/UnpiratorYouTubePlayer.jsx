"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { UnpiratorPlayer } from "@unpirator/react"

export default function UnpiratorYouTubePlayer({ url: youtubeUrl, title, user, onEnded }) {
  const onEndedRef = useRef(onEnded)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  useEffect(() => {
    setError("")
    setReady(false)
  }, [youtubeUrl])

  const getAccessToken = useCallback(async () => {
    if (!user) throw new Error("Sign in required")
    return user.getIdToken()
  }, [user])

  const handleReady = useCallback((player) => {
    setError("")
    setReady(true)
    player?.video?.addEventListener("ended", () => onEndedRef.current?.())
  }, [])

  const handleError = useCallback(() => {
    setReady(false)
    setError("Protected playback is temporarily unavailable. Please try again.")
  }, [])

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black px-6 text-center text-sm text-white">
        {error}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-black">
      <UnpiratorPlayer
        src={youtubeUrl}
        youtubeDirect
        endpoint="/api/unpirator/playback"
        title={title}
        getAccessToken={getAccessToken}
        onReady={handleReady}
        onError={handleError}
        className="w-full h-full bg-black"
        style={{ height: "100%" }}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black text-sm text-white/70">
          Preparing protected playback…
        </div>
      )}
    </div>
  )
}
