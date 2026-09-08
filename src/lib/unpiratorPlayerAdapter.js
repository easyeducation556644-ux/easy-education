// Local compatibility adapter ported from @unpirator/player.
// Source: masharzy/theunpirator packages/player/src/index.js @ 3832b122ac16c11c1eb0ef2836529618d0856226.
// TODO(unpirator): replace this adapter with @unpirator/player once the package is published/installed.

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

function protectedPlaybackSupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false
  const ua = navigator.userAgent || ""
  return (
    /(Chrome|Chromium|Edg)\/[0-9]+/i.test(ua)
    && !/(1DM|\bIDM\b|Download Manager|;\s*wv\)|\bWebView\b)/i.test(ua)
    && Boolean(window.MediaSource && window.Worker && crypto?.subtle)
  )
}

export class ProtectedPlayer {
  constructor({ element, bootstrap, refreshEndpoint, onError = () => {} }) {
    this.root = typeof element === "string" ? document.querySelector(element) : element
    if (!this.root) throw new Error("ProtectedPlayer target element not found")
    this.bootstrap = bootstrap
    this.refreshEndpoint = refreshEndpoint
    this.onError = onError
    this.hls = null
    this.protected = null
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
    this.video.style.background = "#07110b"
    this.video.setAttribute("controlsList", "nodownload")
    this.root.appendChild(this.video)

    this.state = await this.bootstrap()
    if (this.state.mode === "protected_segments") this.setupProtectedSurface()
    this.setupWatermark(this.state?.watermark)
    await this.attachMedia()
    this.scheduleRefresh()
    this.scheduleHeartbeat()
    return this
  }

  setupProtectedSurface() {
    this.host = document.createElement("div")
    this.host.style.cssText = "display:block;position:relative;width:100%;height:100%;overflow:hidden;background:#07110b"
    this.root.replaceChildren(this.host)
    this.surface = this.host.attachShadow({ mode: "closed" })
    this.frame = document.createElement("div")
    this.frame.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#07110b"
    this.frame.appendChild(this.video)
    this.surface.appendChild(this.frame)
  }

  async attachMedia() {
    if (this.state.mode === "protected_segments") {
      await this.attachProtectedSegments()
      return
    }

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

  async attachProtectedSegments() {
    if (!protectedPlaybackSupported()) {
      throw new Error("Use a supported secure browser to watch this protected video")
    }

    this.protected = new ProtectedSegmentRuntime({
      video: this.video,
      root: this.root,
      surface: this.surface,
      host: this.host,
      watermark: this.watermarkElement,
      state: this.state,
      onError: this.onError,
    })
    await this.protected.mount()
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
    this.protected?.setToken(data.token)

    if (!this.protected && !this.hls && this.video?.src) {
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

    const mark = document.createElement("canvas")
    mark.width = 440
    mark.height = 42
    mark.setAttribute("aria-hidden", "true")
    mark.textContent = `${policy.label || "Viewer"} • ${policy.sessionCode || ""}`
    const context = mark.getContext("2d")
    if (context) {
      context.font = "600 15px system-ui,sans-serif"
      context.fillStyle = "rgba(255,255,255,.78)"
      context.shadowColor = "rgba(0,0,0,.85)"
      context.shadowBlur = 4
      context.fillText(`${policy.label || "Viewer"} • ${policy.sessionCode || ""}`, 8, 27)
    }
    Object.assign(mark.style, {
      position: "absolute",
      zIndex: "20",
      pointerEvents: "none",
      opacity: "0.34",
      width: "min(440px,72%)",
      height: "42px",
      transition: "all 600ms ease",
      userSelect: "none",
    })
    ;(this.frame || this.root).appendChild(mark)
    this.watermarkElement = mark

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
    this.protected?.destroy()
    this.video?.pause()
    this.root.innerHTML = ""
  }
}

function segmentWorkerRuntime() {
  let token = ""
  let baseUrl = ""
  let key = null
  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  const auth = () => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" })

  async function json(response) {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error?.message || `Protected request failed (${response.status})`)
    return data
  }

  self.onmessage = async ({ data }) => {
    try {
      if (data.type === "bootstrap") {
        token = data.token
        baseUrl = data.baseUrl
        const pair = await crypto.subtle.generateKey(
          { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
          false,
          ["encrypt", "decrypt"],
        )
        const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey)
        const result = await json(
          await fetch(`${baseUrl}/bootstrap`, {
            method: "POST",
            credentials: "include",
            headers: auth(),
            body: JSON.stringify({ publicKey, playerBuild: "protected-v1" }),
          }),
        )
        const raw = await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          pair.privateKey,
          fromBase64(result.wrappedKey),
        )
        key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"])
        self.postMessage({ type: "ready", manifest: result.manifest })
        return
      }

      if (data.type === "token") {
        token = data.token
        return
      }

      if (data.type === "integrity") {
        await json(
          await fetch(`${baseUrl}/integrity`, {
            method: "POST",
            credentials: "include",
            headers: auth(),
            body: JSON.stringify({ sequence: data.sequence, tampered: data.tampered === true }),
          }),
        )
        self.postMessage({ type: "integrity", id: data.id })
        return
      }

      if (data.type === "segment") {
        if (!key) throw new Error("Protected player key unavailable")
        const ticket = await json(
          await fetch(`${baseUrl}/ticket`, {
            method: "POST",
            credentials: "include",
            headers: auth(),
            body: JSON.stringify({ track: data.track, variant: data.variant, sequence: data.sequence }),
          }),
        )
        const response = await fetch(
          `${baseUrl}/chunk/${data.track}/${data.variant}/${data.sequence}?ticket=${encodeURIComponent(ticket.ticket)}`,
          { credentials: "include", headers: { Authorization: `Bearer ${token}` } },
        )
        if (!response.ok) throw new Error(`Protected segment failed (${response.status})`)
        const context = response.headers.get("x-unpirator-context") || ""
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: fromBase64(response.headers.get("x-unpirator-iv") || ""),
            additionalData: new TextEncoder().encode(context),
          },
          key,
          await response.arrayBuffer(),
        )
        self.postMessage(
          { type: "segment", id: data.id, track: data.track, sequence: data.sequence, buffer: decrypted },
          [decrypted],
        )
      }
    } catch (error) {
      self.postMessage({ type: "error", id: data.id, message: error.message || "Protected playback failed" })
    }
  }
}

class ProtectedSegmentRuntime {
  constructor({ video, root, surface, host, watermark, state, onError }) {
    this.video = video
    this.root = root
    this.surface = surface
    this.host = host
    this.watermark = watermark
    this.state = state
    this.onError = onError
    this.pending = new Map()
    this.nextId = 1
    this.nextSequence = 1
    this.destroyed = false
  }

  async mount() {
    const workerUrl = URL.createObjectURL(
      new Blob([`(${segmentWorkerRuntime.toString()})()`], { type: "text/javascript" }),
    )
    this.workerUrl = workerUrl
    this.worker = new Worker(workerUrl)
    this.worker.onmessage = ({ data }) => this.onWorkerMessage(data)

    const mediaUrl = new URL(this.state.playbackUrl)
    mediaUrl.search = ""
    const baseUrl = mediaUrl.toString().replace(/\/media$/, "")
    const ready = new Promise((resolve, reject) => {
      this.ready = { resolve, reject }
    })
    this.worker.postMessage({ type: "bootstrap", baseUrl, token: this.state.token })
    this.manifest = await ready

    this.videoVariant = chooseVideoVariant(this.manifest.video)
    this.audioVariant = 0
    this.mediaSource = new MediaSource()
    this.objectUrl = URL.createObjectURL(this.mediaSource)
    this.video.src = this.objectUrl

    await new Promise((resolve, reject) => {
      this.mediaSource.addEventListener("sourceopen", resolve, { once: true })
      this.mediaSource.addEventListener("error", reject, { once: true })
    })

    this.videoBuffer = this.mediaSource.addSourceBuffer(
      `${this.manifest.video[this.videoVariant].mimeType}; codecs="${this.manifest.video[this.videoVariant].codec}"`,
    )
    this.audioBuffer = this.mediaSource.addSourceBuffer(
      `${this.manifest.audio[this.audioVariant].mimeType}; codecs="${this.manifest.audio[this.audioVariant].codec}"`,
    )

    await Promise.all([
      this.append("video", this.videoVariant, 0, this.videoBuffer),
      this.append("audio", this.audioVariant, 0, this.audioBuffer),
    ])
    await this.fillBuffer()

    this.heartbeat = setInterval(() => this.sendIntegrity(false).catch(this.fail), 5_000)
    this.pump = setInterval(() => this.fillBuffer().catch(this.fail), 1_000)
    this.installIntegrityGuard()
  }

  onWorkerMessage(data) {
    if (data.type === "ready") {
      this.ready?.resolve(data.manifest)
      return
    }

    if (data.type === "error") {
      const error = new Error(data.message)
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id).reject(error)
        this.pending.delete(data.id)
      } else {
        this.ready?.reject(error)
      }
      return
    }

    if (data.type === "segment" && this.pending.has(data.id)) {
      this.pending.get(data.id).resolve(data.buffer)
      this.pending.delete(data.id)
    }

    if (data.type === "integrity" && this.pending.has(data.id)) {
      this.pending.get(data.id).resolve()
      this.pending.delete(data.id)
    }
  }

  request(track, variant, sequence) {
    const id = this.nextId++
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.worker.postMessage({ type: "segment", id, track, variant, sequence })
    return promise
  }

  async append(track, variant, sequence, sourceBuffer) {
    const buffer = await this.request(track, variant, sequence)
    await appendBuffer(sourceBuffer, buffer)
  }

  async fillBuffer() {
    if (this.destroyed || this.loading) return
    const ahead = bufferedAhead(this.video)
    if (ahead >= 20) return

    const max = Math.min(
      this.manifest.video[this.videoVariant].segments.length,
      this.manifest.audio[this.audioVariant].segments.length,
    )
    if (this.nextSequence > max) {
      if (this.mediaSource.readyState === "open") this.mediaSource.endOfStream()
      return
    }

    this.loading = true
    try {
      await this.sendIntegrity(false)
      const sequence = this.nextSequence
      await Promise.all([
        this.append("video", this.videoVariant, sequence, this.videoBuffer),
        this.append("audio", this.audioVariant, sequence, this.audioBuffer),
      ])
      this.nextSequence += 1
    } finally {
      this.loading = false
    }
  }

  sendIntegrity(tampered) {
    if (!this.worker) return Promise.resolve()
    const id = this.nextId++
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.worker.postMessage({ type: "integrity", id, sequence: this.nextSequence, tampered })
    return promise
  }

  installIntegrityGuard() {
    this.originalParent = this.video.parentNode
    const verify = () => {
      const watermarkStyle = this.watermark ? getComputedStyle(this.watermark) : null
      if (
        !this.video.isConnected
        || this.video.parentNode !== this.originalParent
        || !this.host?.isConnected
        || (this.watermark
          && (!this.watermark.isConnected
            || watermarkStyle.display === "none"
            || watermarkStyle.visibility === "hidden"
            || Number(watermarkStyle.opacity) < 0.08))
      ) {
        this.tamper()
      }
    }

    this.observers = [this.root, this.surface].filter(Boolean).map((target) => {
      const observer = new MutationObserver(verify)
      observer.observe(target, { childList: true, subtree: true, attributes: true })
      return observer
    })
    this.visibilityGuard = setInterval(verify, 1_000)
  }

  tamper() {
    if (this.destroyed) return
    this.sendIntegrity(true).catch(() => {})
    this.destroy()
    this.root.replaceChildren()
  }

  setToken(token) {
    this.worker?.postMessage({ type: "token", token })
  }

  fail = (error) => {
    this.onError(error)
    this.destroy()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    clearInterval(this.heartbeat)
    clearInterval(this.pump)
    for (const observer of this.observers || []) observer.disconnect()
    clearInterval(this.visibilityGuard)
    this.worker?.terminate()
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl)
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    for (const pending of this.pending.values()) pending.reject(new Error("Player stopped"))
    this.pending.clear()
  }
}

function chooseVideoVariant(variants) {
  const connection = navigator.connection
  const target = connection?.saveData || Number(connection?.downlink || 10) < 2 ? 480 : 720
  const candidates = variants
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Number(a.item.height) - Number(b.item.height))
  return (candidates.filter(({ item }) => Number(item.height) <= target).pop() || candidates[0]).index
}

function appendBuffer(sourceBuffer, buffer) {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error("Protected media buffer failed"))
    }
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", done)
      sourceBuffer.removeEventListener("error", failed)
    }
    sourceBuffer.addEventListener("updateend", done, { once: true })
    sourceBuffer.addEventListener("error", failed, { once: true })
    sourceBuffer.appendBuffer(buffer)
  })
}

function bufferedAhead(video) {
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) >= video.currentTime) {
      return video.buffered.end(index) - video.currentTime
    }
  }
  return 0
}

export async function mountProtectedPlayer(options) {
  const player = new ProtectedPlayer(options)
  await player.mount()
  return player
}
