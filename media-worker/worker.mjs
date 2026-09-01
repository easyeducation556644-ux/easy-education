import { spawn } from "node:child_process"
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import process from "node:process"
import readline from "node:readline"
import { downloadLikeAndroid } from "./youtube-android-resolver.mjs"

const VERSION = "1.2.1"

function loadEnv(path = resolve(".env")) {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const equals = line.indexOf("=")
    if (equals < 1) continue
    const key = line.slice(0, equals).trim()
    let value = line.slice(equals + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnv()

const config = {
  baseUrl: String(process.env.OPERATIONS_URL || "https://easy-education.vercel.app").replace(/\/$/, ""),
  secret: String(process.env.AUTOMATION_SECRET || ""),
  botToken: String(process.env.TELEGRAM_BOT_TOKEN || ""),
  telegramBase: String(process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org").replace(/\/$/, ""),
  workerId: String(process.env.WORKER_ID || `worker-${process.platform}`).trim(),
  workerName: String(process.env.WORKER_NAME || "Easy Education PC").trim(),
  workDir: resolve(process.env.WORK_DIR || "./work"),
  pollMs: Math.max(10, Number(process.env.POLL_SECONDS || 20)) * 1000,
  minFreeBytes: Math.max(2, Number(process.env.MIN_FREE_DISK_GB || 8)) * 1024 ** 3,
  ytdlp: process.env.YTDLP_PATH || "yt-dlp",
  ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  curl: process.env.CURL_PATH || "curl",
  youtubeCookiesBrowser: String(process.env.YOUTUBE_COOKIES_BROWSER || "").trim(),
  font: process.env.WATERMARK_FONT || "C:/Windows/Fonts/Nirmala.ttf",
}

mkdirSync(config.workDir, { recursive: true })

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const stamp = () => new Date().toISOString()
const log = (...args) => console.log(stamp(), ...args)

async function api(action, body = {}, attempts = 3) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${config.baseUrl}/api/telegram-bot?action=${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Operations API failed (${response.status})`)
      return payload
    } catch (error) {
      last = error
      if (attempt < attempts) await sleep(attempt * 1500)
    }
  }
  throw last
}

function diskFreeBytes(path) {
  const stat = statfsSync(path)
  return Number(stat.bavail) * Number(stat.bsize)
}

function taskDirectory(taskId) {
  const dir = join(config.workDir, taskId.replace(/[^a-zA-Z0-9_-]/g, "_"))
  mkdirSync(dir, { recursive: true })
  return dir
}

function mediaFiles(dir) {
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".part") && !name.endsWith(".ytdl") && /\.(mp4|mkv|webm|mov|m4v)$/i.test(name))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

class ControlSignal extends Error {
  constructor(type) { super(type); this.type = type }
}

async function taskControl(taskId) {
  const result = await api("media-worker-heartbeat", { workerId: config.workerId, taskId }, 2)
  if (result.cancelled) throw new ControlSignal("cancelled")
  if (result.paused) throw new ControlSignal("paused")
}

async function runCommand(command, args, { taskId, onLine, heartbeat = true } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ""
    let stopped = false
    const consume = (stream) => {
      const lines = readline.createInterface({ input: stream })
      lines.on("line", (line) => {
        onLine?.(line)
        if (stream === child.stderr) stderr = `${stderr}\n${line}`.slice(-6000)
      })
    }
    consume(child.stdout)
    consume(child.stderr)

    const timer = heartbeat && taskId ? setInterval(async () => {
      try {
        await taskControl(taskId)
      } catch (error) {
        if (error instanceof ControlSignal && !stopped) {
          stopped = true
          child.kill("SIGTERM")
          setTimeout(() => child.kill("SIGKILL"), 5000).unref()
          rejectRun(error)
        }
      }
    }, 12_000) : null

    child.on("error", (error) => { if (timer) clearInterval(timer); rejectRun(error) })
    child.on("close", (code) => {
      if (timer) clearInterval(timer)
      if (stopped) return
      if (code === 0) resolveRun({ code, stderr })
      else rejectRun(new Error(`${basename(command)} exited with code ${code}: ${stderr.trim().slice(-1200)}`))
    })
  })
}

let lastProgressAt = 0
async function progress(task, stage, percent, detail = {}) {
  const now = Date.now()
  if (percent < 100 && now - lastProgressAt < 10_000) return
  lastProgressAt = now
  await api("media-worker-progress", {
    workerId: config.workerId,
    taskId: task.id,
    stage,
    percent: Number(percent || 0),
    ...detail,
  }, 2)
}

async function download(task, dir) {
  await progress(task, "downloading", 0, { message: "Resolving source video" })
  const quality = Math.max(144, Math.min(2160, Number(task.quality || 720)))
  const output = join(dir, "source.%(ext)s")
  let pendingUpdate = Promise.resolve()
  const commonArgs = [
    "--continue", "--part", "--newline", "--no-playlist", "--restrict-filenames",
    "--retries", "10", "--fragment-retries", "10", "--file-access-retries", "3",
    "--concurrent-fragments", "4",
    "--merge-output-format", "mp4",
    "--format", `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`,
    "--output", output,
    "--progress-template", "download:%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
  ]
  const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(String(task.source.url || ""))
  if (isYouTube) {
    try {
      await progress(task, "downloading", 0, { message: "Resolving with Android downloader" })
      log("Download strategy: Android branch resolver (iOS/Android youtubei)")
      const direct = await downloadLikeAndroid({
        sourceUrl: task.source.url,
        requestedHeight: quality,
        outputPath: join(dir, "source.android.mp4"),
        onProgress: async (downloaded, total) => {
          const percent = total > 0 ? Math.min(99, downloaded / total * 100) : 0
          await progress(task, "downloading", percent, { downloadedBytes: downloaded, totalBytes: total })
        },
        onControl: () => taskControl(task.id),
        log,
      })
      await pendingUpdate
      return direct.path
    } catch (error) {
      if (error instanceof ControlSignal) throw error
      log("Android branch resolver failed; using yt-dlp fallback:", error.message)
      await progress(task, "downloading", 0, { message: "Android resolver unavailable; trying compatibility fallback" })
    }
  }
  const attempts = isYouTube ? [
    { name: "YouTube default", args: ["--remote-components", "ejs:github"] },
    { name: "YouTube alternate client", args: ["--remote-components", "ejs:github", "--extractor-args", "youtube:player_client=default,web_safari"] },
    { name: "YouTube Android VR client", args: ["--remote-components", "ejs:github", "--extractor-args", "youtube:player_client=android_vr"] },
    ...(config.youtubeCookiesBrowser ? [{
      name: `YouTube ${config.youtubeCookiesBrowser} cookies`,
      args: ["--remote-components", "ejs:github", "--cookies-from-browser", config.youtubeCookiesBrowser, "--extractor-args", "youtube:player_client=default,web_safari"],
    }] : []),
  ] : [{ name: "direct source", args: [] }]

  let lastError
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const strategy = attempts[attempt]
    await progress(task, "downloading", 0, {
      message: `${strategy.name}${attempt ? ` fallback ${attempt + 1}/${attempts.length}` : ""}`,
    })
    log(`Download strategy ${attempt + 1}/${attempts.length}: ${strategy.name}`)
    try {
      await runCommand(config.ytdlp, [...commonArgs, ...strategy.args, task.source.url], {
        taskId: task.id,
        onLine: (line) => {
          if (!line.startsWith("download:")) return
          const [downloaded, total, rawPercent, speed, eta] = line.slice(9).split("|")
          const percent = Number(String(rawPercent || "").replace(/[^0-9.]/g, "")) || 0
          pendingUpdate = pendingUpdate.then(() => progress(task, "downloading", percent, {
            downloadedBytes: Number(downloaded || 0), totalBytes: Number(total || 0), speed, eta,
          })).catch((error) => log("Progress update skipped:", error.message))
        },
      })
      lastError = null
      break
    } catch (error) {
      lastError = error
      log(`${strategy.name} failed:`, error.message)
    }
  }
  if (lastError) throw lastError
  await pendingUpdate
  const file = mediaFiles(dir)[0]
  if (!file) throw new Error("Downloader finished but no video file was created")
  return file
}

export function escapeDrawText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
}

function ffmpegFont() {
  return config.font.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:")
}

function xy(position) {
  if (position === "top-left") return ["30", "30"]
  if (position === "bottom-left") return ["30", "h-th-30"]
  if (position === "bottom-right") return ["w-tw-30", "h-th-30"]
  if (position === "center") return ["(w-tw)/2", "(h-th)/2"]
  return ["w-tw-30", "30"]
}

export function watermarkFilter(preset = {}) {
  if (!preset || preset.mode === "none") return ""
  const font = ffmpegFont()
  const size = Math.max(14, Math.min(120, Number(preset.fontSize || 36)))
  const alpha = Math.max(0.05, Math.min(1, Number(preset.opacity ?? 0.28)))
  const [x, y] = xy(preset.position)
  const filters = []
  if (["permanent", "combined"].includes(preset.mode) && preset.text) {
    filters.push(`drawtext=fontfile='${font}':text='${escapeDrawText(preset.text)}':fontsize=${size}:fontcolor=white@${alpha}:borderw=2:bordercolor=black@${Math.min(0.6, alpha + 0.15)}:x=${x}:y=${y}`)
  }
  if (["timed", "combined"].includes(preset.mode) && preset.text) {
    const times = Array.isArray(preset.timed) && preset.timed.length ? preset.timed : [{ start: 300, duration: 10 }]
    times.slice(0, 10).forEach((item, index) => {
      const start = Math.max(0, Number(item.start || 0))
      const end = start + Math.max(1, Number(item.duration || 10))
      const positions = [["(w-tw)/2", "(h-th)/2"], ["30", "h-th-30"], ["w-tw-30", "30"]]
      const [tx, ty] = positions[index % positions.length]
      filters.push(`drawtext=fontfile='${font}':text='${escapeDrawText(preset.text)}':fontsize=${Math.round(size * 1.25)}:fontcolor=white@${Math.max(alpha, 0.6)}:borderw=3:bordercolor=black@0.55:x=${tx}:y=${ty}:enable='between(t,${start},${end})'`)
    })
  }
  if (["ticker", "combined"].includes(preset.mode) && (preset.tickerText || preset.text)) {
    const ticker = escapeDrawText(preset.tickerText || preset.text)
    const speed = Math.max(20, Math.min(500, Number(preset.tickerSpeed || 110)))
    filters.push("drawbox=x=0:y=ih-74:w=iw:h=74:color=black@0.55:t=fill")
    filters.push(`drawtext=fontfile='${font}':text='${ticker}':fontsize=${Math.max(18, Math.round(size * 0.75))}:fontcolor=white@0.95:x=w-mod(t*${speed}\\,w+tw):y=h-th-22`)
  }
  return filters.join(",")
}

async function durationSeconds(file) {
  let output = ""
  await runCommand(config.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { onLine: (line) => { output += line } })
  return Number(output.trim()) || 0
}

async function render(task, input, dir) {
  const filter = watermarkFilter(task.preset)
  if (!filter) return input
  const output = join(dir, "watermarked.mp4")
  const duration = await durationSeconds(input)
  await progress(task, "processing", 0, { message: "Applying watermark" })
  let pendingUpdate = Promise.resolve()
  await runCommand(config.ffmpeg, [
    "-y", "-i", input, "-vf", filter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats", output,
  ], {
    taskId: task.id,
    onLine: (line) => {
      if (!line.startsWith("out_time_ms=")) return
      const seconds = Number(line.slice(12)) / 1_000_000
      const percent = duration > 0 ? Math.min(99, seconds / duration * 100) : 0
      pendingUpdate = pendingUpdate.then(() => progress(task, "processing", percent, { message: "Applying watermark" })).catch(() => {})
    },
  })
  await pendingUpdate
  return output
}

async function telegramUpload(task, file) {
  const size = statSync(file).size
  const isLocal = !/^https:\/\/api\.telegram\.org/i.test(config.telegramBase)
  const maxBytes = isLocal ? 2_000_000_000 : 50_000_000
  if (size > maxBytes) {
    throw new Error(`Output is ${(size / 1024 ** 2).toFixed(1)} MB, above the configured Telegram API limit of ${(maxBytes / 1024 ** 2).toFixed(0)} MB. Configure Telegram Local Bot API for files up to 2 GB.`)
  }
  await progress(task, "uploading", 0, { totalBytes: size, message: "Uploading to Telegram" })
  const cloudBase = "https://api.telegram.org"
  const bases = [config.telegramBase]
  if (isLocal && size <= 50_000_000) bases.push(cloudBase)
  log(`Telegram streaming upload file: ${file} (${size} bytes)`)
  const controller = new AbortController()
  let controlError = null
  const timer = setInterval(async () => {
    try {
      await taskControl(task.id)
    } catch (error) {
      if (error instanceof ControlSignal) {
        controlError = error
        controller.abort(error)
      }
    }
  }, 12_000)
  let lastTransportError
  try {
    for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
      const base = bases[baseIndex]
      const endpoint = `${base}/bot${config.botToken}/sendVideo`
      if (baseIndex > 0) log("Local Telegram API unavailable; trying Telegram cloud API")
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          log(`Telegram endpoint ${new URL(base).origin}, attempt ${attempt}/3`)
          const response = await postTelegramVideo({
            url: endpoint,
            file,
            fields: {
              chat_id: task.channel.chatId,
              supports_streaming: "true",
              message_thread_id: task.channel.threadId || null,
              caption: task.caption || null,
            },
            signal: controller.signal,
            onProgress: (uploaded, total) => {
              const percent = total > 0 ? Math.min(99, uploaded / total * 100) : 0
              progress(task, "uploading", percent, { uploadedBytes: uploaded, totalBytes: total, message: "Uploading to Telegram" }).catch(() => {})
            },
            onStatus: (message) => log(`Telegram transport: ${message}`),
          })
          const result = response.payload
          if (!result?.ok) throw new TelegramApiError(result?.description || `Telegram returned HTTP ${response.status}`)
          return {
            messageId: result.result?.message_id || null,
            fileId: result.result?.video?.file_id || result.result?.document?.file_id || null,
            size,
          }
        } catch (error) {
          if (controlError) throw controlError
          if (error instanceof TelegramApiError) throw error
          lastTransportError = error
          log(`Telegram transport attempt ${attempt} failed:`, error.message)
          if (attempt < 3) await sleep(attempt * 1500)
        }
      }
    }
  } finally {
    clearInterval(timer)
  }
  throw lastTransportError || new Error("Telegram upload transport failed")
}

class TelegramApiError extends Error {}

function safeHeader(value) {
  return String(value || "").replace(/[\r\n"]/g, "_")
}

function telegramTransportError(error, target) {
  if (error instanceof ControlSignal) return error
  const code = error?.code || error?.cause?.code || "NETWORK_ERROR"
  const detail = error?.cause?.message || error?.message || "connection failed"
  return new Error(`Telegram connection to ${target.origin} failed: ${code} — ${detail}`)
}

export async function postTelegramVideo({ url, file, fields = {}, signal, onProgress = () => {}, onStatus = () => {} }) {
  const target = new URL(url)
  const boundary = `----EasyEducation${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const parts = []
  for (const [rawName, value] of Object.entries(fields)) {
    if (value === null || value === undefined || String(value) === "") continue
    const name = safeHeader(rawName)
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`))
  }
  const filename = safeHeader(basename(file))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`))
  const preamble = Buffer.concat(parts)
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
  const fileSize = statSync(file).size
  const contentLength = preamble.length + fileSize + footer.length

  return new Promise((resolveUpload, rejectUpload) => {
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest
    let input = null
    let settled = false
    let connectTimer = null
    let stallTimer = null
    const clearTimers = () => {
      if (connectTimer) clearTimeout(connectTimer)
      if (stallTimer) clearTimeout(stallTimer)
    }
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        const error = new Error("upload made no network progress for 15 minutes")
        error.code = "UPLOAD_STALLED"
        request.destroy(error)
      }, 15 * 60_000)
    }
    const finishError = (error) => {
      if (settled) return
      settled = true
      clearTimers()
      input?.destroy()
      rejectUpload(signal?.aborted && signal.reason ? signal.reason : telegramTransportError(error, target))
    }
    const request = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: "POST",
      path: `${target.pathname}${target.search}`,
      family: 4,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(contentLength),
        Connection: "keep-alive",
      },
    }, (response) => {
      const chunks = []
      let responseBytes = 0
      response.on("data", (chunk) => {
        resetStallTimer()
        responseBytes += chunk.length
        if (responseBytes <= 2 * 1024 * 1024) chunks.push(chunk)
      })
      response.on("end", () => {
        if (settled) return
        settled = true
        clearTimers()
        const text = Buffer.concat(chunks).toString("utf8")
        let payload
        try { payload = JSON.parse(text || "{}") } catch { payload = { ok: false, description: text || `Telegram returned HTTP ${response.statusCode}` } }
        resolveUpload({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, payload })
      })
      response.on("error", finishError)
    })
    request.on("error", finishError)
    connectTimer = setTimeout(() => {
      const error = new Error("could not connect to Telegram within 45 seconds")
      error.code = "CONNECT_TIMEOUT"
      request.destroy(error)
    }, 45_000)
    request.on("socket", (socket) => {
      socket.setKeepAlive(true, 30_000)
      const connected = () => {
        if (connectTimer) clearTimeout(connectTimer)
        connectTimer = null
        resetStallTimer()
        onStatus(`${target.protocol === "https:" ? "TLS" : "TCP"} connected over IPv4`)
      }
      if (target.protocol === "https:") socket.once("secureConnect", connected)
      else socket.once("connect", connected)
    })
    const abort = () => request.destroy(signal?.reason || new Error("Upload aborted"))
    if (signal) {
      if (signal.aborted) return abort()
      signal.addEventListener("abort", abort, { once: true })
    }
    request.write(preamble)
    input = createReadStream(file, { highWaterMark: 1024 * 1024 })
    let uploaded = 0
    input.on("error", (error) => request.destroy(error))
    input.on("data", (chunk) => {
      uploaded += chunk.length
      onProgress(uploaded, fileSize)
      resetStallTimer()
      if (!request.write(chunk)) input.pause()
    })
    request.on("drain", () => {
      resetStallTimer()
      input?.resume()
    })
    input.on("end", () => request.end(footer))
  })
}

async function processTask(task) {
  const dir = taskDirectory(task.id)
  if (diskFreeBytes(config.workDir) < config.minFreeBytes) throw new Error(`Less than ${Math.round(config.minFreeBytes / 1024 ** 3)} GB free disk space; task paused to protect the SSD`)
  log("Starting", task.id, task.source.url)
  await taskControl(task.id)
  const input = await download(task, dir)
  await taskControl(task.id)
  const output = await render(task, input, dir)
  await taskControl(task.id)
  const telegram = await telegramUpload(task, output)
  await api("media-worker-finish", {
    workerId: config.workerId,
    taskId: task.id,
    success: true,
    telegramMessageId: telegram.messageId,
    telegramFileId: telegram.fileId,
    outputBytes: telegram.size,
    title: basename(output),
  })
  log("Completed", task.id, `message=${telegram.messageId}`)
  // Telegram has acknowledged the file, so local media is no longer needed.
  // Keeping only active/failed task folders protects a 120 GB SSD from filling up.
  rmSync(dir, { recursive: true, force: true })
}

async function failTask(task, error) {
  if (error instanceof ControlSignal) {
    log(`Task ${error.type}`, task.id)
    return
  }
  log("Failed", task.id, error.message)
  await api("media-worker-finish", { workerId: config.workerId, taskId: task.id, success: false, error: error.message }).catch((finishError) => log("Could not report failure:", finishError.message))
}

async function register() {
  await api("media-worker-register", {
    workerId: config.workerId,
    name: config.workerName,
    version: VERSION,
    platform: `${process.platform}-${process.arch}`,
    capabilities: { download: true, youtube: true, hls: true, watermark: true, telegram: true, encodeConcurrency: 1 },
  })
}

async function main() {
  if (!config.secret || !config.botToken) throw new Error("Missing AUTOMATION_SECRET or TELEGRAM_BOT_TOKEN in media-worker/.env")
  log(`Easy Education Media Worker ${VERSION}`)
  log(`Worker: ${config.workerName} (${config.workerId})`)
  log(`Work directory: ${config.workDir}`)
  await register()
  for (;;) {
    try {
      const result = await api("media-worker-claim", { workerId: config.workerId, name: config.workerName, version: VERSION, platform: `${process.platform}-${process.arch}` })
      if (result.paused) {
        log("Global media processing is paused")
        await sleep(config.pollMs)
        continue
      }
      if (!result.task) {
        await sleep(config.pollMs)
        continue
      }
      await processTask(result.task).catch((error) => failTask(result.task, error))
    } catch (error) {
      log("Worker loop error:", error.message)
      await sleep(Math.max(config.pollMs, 30_000))
    }
  }
}

process.on("SIGINT", () => { log("Worker stopped; active download files are kept for resume"); process.exit(0) })
process.on("SIGTERM", () => { log("Worker stopped; active download files are kept for resume"); process.exit(0) })

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) main().catch((error) => { console.error(error); process.exit(1) })
