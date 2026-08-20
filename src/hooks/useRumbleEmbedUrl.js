import { useEffect, useState } from "react"

const RUMBLE_WATCH_ID = /rumble\.com\/(?:embed\/)?(v[a-zA-Z0-9]+)(?:[-/?#.]|$)/i
const resolvedCache = new Map()

function validateEmbedUrl(value) {
  try {
    const url = new URL(String(value || ""))
    const host = url.hostname.toLowerCase()
    if (url.protocol !== "https:") return ""
    if (host !== "rumble.com" && !host.endsWith(".rumble.com")) return ""
    if (!/^\/embed\//i.test(url.pathname)) return ""
    return url.toString()
  } catch {
    return ""
  }
}

function initialEmbedUrl(videoUrl) {
  const direct = validateEmbedUrl(videoUrl)
  if (direct) return direct

  const id = String(videoUrl || "").match(RUMBLE_WATCH_ID)?.[1]
  return id ? `https://rumble.com/embed/${id}/` : ""
}

export default function useRumbleEmbedUrl(videoUrl, enabled = true) {
  const [embedUrl, setEmbedUrl] = useState(() => enabled ? initialEmbedUrl(videoUrl) : "")

  useEffect(() => {
    if (!enabled || !videoUrl) {
      setEmbedUrl("")
      return
    }

    const direct = validateEmbedUrl(videoUrl)
    if (direct) {
      resolvedCache.set(videoUrl, direct)
      setEmbedUrl(direct)
      return
    }

    const cached = resolvedCache.get(videoUrl)
    if (cached) {
      setEmbedUrl(cached)
      return
    }

    setEmbedUrl(initialEmbedUrl(videoUrl))
    const controller = new AbortController()
    const endpoint = new URL("/api/version", window.location.origin)
    endpoint.searchParams.set("resource", "rumble-embed")
    endpoint.searchParams.set("videoUrl", videoUrl)

    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || "Rumble embed resolution failed")
        const resolved = validateEmbedUrl(payload?.embedUrl)
        if (!resolved) throw new Error("Rumble returned an invalid embed URL")
        resolvedCache.set(videoUrl, resolved)
        setEmbedUrl(resolved)
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          console.error("Unable to resolve Rumble embed URL:", error)
        }
      })

    return () => controller.abort()
  }, [videoUrl, enabled])

  return embedUrl
}
