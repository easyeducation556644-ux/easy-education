"use client"

import { useEffect, useRef, useState } from "react"

const UNPIRATOR_COMPONENT_URL = "https://esm.sh/@unpirator/web-component@0.1.0"
let componentLoaderPromise = null

function loadUnpiratorComponent() {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.customElements?.get("unpirator-player")) return Promise.resolve()
  if (componentLoaderPromise) return componentLoaderPromise

  componentLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-unpirator-component="true"]')
    const finish = async () => {
      try {
        await window.customElements.whenDefined("unpirator-player")
        resolve()
      } catch (error) {
        reject(error)
      }
    }

    if (existing) {
      existing.addEventListener("load", finish, { once: true })
      existing.addEventListener("error", () => reject(new Error("Unable to load protected player")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.type = "module"
    script.src = UNPIRATOR_COMPONENT_URL
    script.dataset.unpiratorComponent = "true"
    script.addEventListener("load", finish, { once: true })
    script.addEventListener("error", () => reject(new Error("Unable to load protected player")), { once: true })
    document.head.appendChild(script)
  })

  return componentLoaderPromise
}

export default function UnpiratorYouTubePlayer({ url, title, user, onEnded }) {
  const hostRef = useRef(null)
  const onEndedRef = useRef(onEnded)
  const [error, setError] = useState("")

  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  useEffect(() => {
    let active = true
    let element = null
    let video = null

    const handleEnded = () => onEndedRef.current?.()
    const handlePlayerError = () => {
      if (active) setError("Protected playback is temporarily unavailable. Please try again.")
    }

    ;(async () => {
      try {
        setError("")
        if (!user) throw new Error("Sign in required")

        const [idToken] = await Promise.all([
          user.getIdToken(),
          loadUnpiratorComponent(),
        ])
        if (!active || !hostRef.current) return

        element = document.createElement("unpirator-player")
        element.setAttribute("src", url)
        element.setAttribute("endpoint", "/api/unpirator-playback")
        if (title) element.setAttribute("title", title)
        element.currentUser = { idToken }
        element.addEventListener("unpirator-error", handlePlayerError)
        element.addEventListener("unpirator-ready", () => {
          video = element?.player?.video || null
          video?.addEventListener("ended", handleEnded)
        }, { once: true })

        hostRef.current.replaceChildren(element)
      } catch {
        if (active) setError("Protected playback is temporarily unavailable. Please try again.")
      }
    })()

    return () => {
      active = false
      video?.removeEventListener("ended", handleEnded)
      element?.removeEventListener("unpirator-error", handlePlayerError)
      element?.remove()
    }
  }, [url, title, user])

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black px-6 text-center text-sm text-white">
        {error}
      </div>
    )
  }

  return (
    <div ref={hostRef} className="w-full h-full bg-black">
      <div className="w-full h-full flex items-center justify-center text-sm text-white/70">Preparing protected playback…</div>
    </div>
  )
}
