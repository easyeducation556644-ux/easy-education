const WATERMARK_POSITIONS = [
  ["8%", "8%"],
  ["65%", "10%"],
  ["35%", "42%"],
  ["8%", "78%"],
  ["65%", "76%"],
]

let hlsRuntimePromise = null

function loadHlsRuntime() {
  if (typeof window === "undefined") return Promise.resolve(null)
  if (window.Hls) return Promise.resolve(window.Hls)
  if (hlsRuntimePromise) return hlsRuntimePromise

  hlsRuntimePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-unpirator-hls="true"]')
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Hls || null), { once: true })
      existing.addEventListener("error", () => reject(new Error("Unable to load HLS runtime")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = "/offline-assets/hls.min.js"
    script.async = true
    script.dataset.unpiratorHls = "true"
    script.onload = () => resolve(window.Hls || null)
    script.onerror = () => reject(new Error("Unable to load HLS runtime"))
    document.head.appendChild(script)
  })

  return hlsRuntimePromise
}

export class ProtectedPlayer {
  constructor({ element, bootstrap, refreshEndpoint, onError = console.error }) {
    this.root = typeof element === "string" ? document.querySelector(element) : element
    if (!this.root) throw new Error("ProtectedPlayer target element not found")
    this.bootstrap = bootstrap
    this.refreshEndpoint = refreshEndpoint
    this.onError = onError
    this.hls = null
    this.state = null
    this.timers = []
    this.watermarkTimer = null
  }

  async mount() {
    this.root.innerHTML = ""
    this.root.style.position = "relative"

    this.video = document.createElement("video")
    this.video.controls = true
    this.video.playsInline = true
    this.video.crossOrigin = "use-credentials"
    this.video.preload = "metadata"
    this.video.style.width = "100%"
    this.video.style.height = "100%"
    this.video.setAttribute("controlsList", "nodownload")
    this.root.appendChild(this.video)

    this.state = await this.bootstrap()
    this.setupWatermark(this.state?.watermark)
    await this.attachMedia()
    this.scheduleRefresh()
    this.scheduleHeartbeat()
    return this
  }

  async attachMedia() {
    const playbackUrl = new URL(this.state.playbackUrl)
    playbackUrl.searchParams.delete("token")

    if (this.state.mode === "hls") {
      const Hls = await loadHlsRuntime().catch(() => null)
      if (Hls?.isSupported?.()) {
        this.hls = new Hls({
          xhrSetup: (xhr) => {
            xhr.withCredentials = true
            xhr.setRequestHeader("Authorization", `Bearer ${this.state.token}`)
          },
        })
        this.hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) this.onError(data)
        })
        this.hls.loadSource(playbackUrl.toString())
        this.hls.attachMedia(this.video)
        return
      }
    }

    this.video.src = this.state.playbackUrl
  }

  async refreshToken() {
    const endpoint = this.refreshEndpoint ? this.refreshEndpoint(this.state) : this.state.refreshUrl
    if (!endpoint) return

    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${this.state.token}` },
    })
    if (!response.ok) {
      this.video?.pause()
      throw new Error("Playback token refresh failed")
    }

    const data = await response.json()
    this.state.token = data.token
    this.state.tokenExpiresIn = data.tokenExpiresIn

    if (!this.hls && this.video?.src) {
      const position = this.video.currentTime
      const wasPlaying = !this.video.paused
      const nextUrl = new URL(this.state.playbackUrl)
      nextUrl.searchParams.set("token", data.token)
      this.state.playbackUrl = nextUrl.toString()
      this.video.addEventListener("loadedmetadata", () => {
        this.video.currentTime = position
        if (wasPlaying) this.video.play().catch(this.onError)
      }, { once: true })
      this.video.src = this.state.playbackUrl
    }
  }

  scheduleRefresh() {
    const everyMs = Math.max(20_000, (Number(this.state.tokenExpiresIn || 90) - 25) * 1000)
    this.timers.push(setInterval(() => this.refreshToken().catch(this.onError), everyMs))
  }

  scheduleHeartbeat() {
    this.timers.push(setInterval(async () => {
      try {
        const url = new URL(this.state.playbackUrl)
        url.searchParams.delete("token")
        const response = await fetch(url.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${this.state.token}` },
        })
        if (response.status === 401) await this.refreshToken()
        if (response.status === 403) {
          this.video?.pause()
          this.onError(new Error("Playback session ended"))
        }
      } catch (error) {
        this.onError(error)
      }
    }, 30_000))
  }

  setupWatermark(policy) {
    if (!policy?.enabled) return

    const mark = document.createElement("div")
    mark.textContent = `${policy.label || "Viewer"} • ${policy.sessionCode || ""}`
    Object.assign(mark.style, {
      position: "absolute",
      zIndex: "20",
      pointerEvents: "none",
      opacity: "0.34",
      fontSize: "14px",
      fontFamily: "system-ui,sans-serif",
      color: "white",
      textShadow: "0 1px 3px rgba(0,0,0,.8)",
      transition: "all 600ms ease",
      userSelect: "none",
    })
    this.root.appendChild(mark)

    const move = () => {
      const [left, top] = WATERMARK_POSITIONS[Math.floor(Math.random() * WATERMARK_POSITIONS.length)]
      mark.style.left = left
      mark.style.top = top
    }

    move()
    const min = Number(policy.minMoveSeconds || 20)
    const max = Number(policy.maxMoveSeconds || 45)
    const loop = () => {
      move()
      this.watermarkTimer = setTimeout(loop, (min + Math.random() * (max - min)) * 1000)
    }
    this.watermarkTimer = setTimeout(loop, min * 1000)
  }

  destroy() {
    for (const timer of this.timers) clearInterval(timer)
    clearTimeout(this.watermarkTimer)
    this.hls?.destroy()
    this.video?.pause()
    this.root.innerHTML = ""
  }
}

export async function mountProtectedPlayer(options) {
  const player = new ProtectedPlayer(options)
  await player.mount()
  return player
}

// TODO(unpirator): replace this compatibility adapter with @unpirator/player
// once that package is installed directly in Easy Education.
