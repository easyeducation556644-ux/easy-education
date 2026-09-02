import { spawn } from "node:child_process"
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { Agent as HttpsAgent, request as httpsRequest } from "node:https"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import process from "node:process"
import readline from "node:readline"
import { downloadLikeAndroid } from "./youtube-android-resolver.mjs"

const VERSION = "1.5.0"

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
  telegramLocalAutoDetect: !/^(0|false|no)$/i.test(String(process.env.TELEGRAM_LOCAL_API_AUTODETECT || "true").trim()),
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
const telegramHttpsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 2, maxFreeSockets: 2 })

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

function diskFreeBytes(path) { const stat = statfsSync(path); return Number(stat.bavail) * Number(stat.bsize) }
function taskDirectory(taskId) { const dir = join(config.workDir, taskId.replace(/[^a-zA-Z0-9_-]/g, "_")); mkdirSync(dir, { recursive: true }); return dir }
function mediaFiles(dir) {
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".part") && !name.endsWith(".ytdl") && /\.(mp4|mkv|webm|mov|m4v)$/i.test(name))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}
function validMediaCheckpoint(file) { if (!file || !existsSync(file)) return false; try { return statSync(file).size > 1024 } catch { return false } }
function sourceCheckpoint(dir) { return mediaFiles(dir).find((file) => basename(file).toLowerCase() !== "watermarked.mp4" && validMediaCheckpoint(file)) || null }

class ControlSignal extends Error { constructor(type) { super(type); this.type = type } }
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
      lines.on("line", (line) => { onLine?.(line); if (stream === child.stderr) stderr = `${stderr}\n${line}`.slice(-6000) })
    }
    consume(child.stdout); consume(child.stderr)
    const timer = heartbeat && taskId ? setInterval(async () => {
      try { await taskControl(taskId) }
      catch (error) {
        if (error instanceof ControlSignal && !stopped) {
          stopped = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); rejectRun(error)
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
  await api("media-worker-progress", { workerId: config.workerId, taskId: task.id, stage, percent: Number(percent || 0), ...detail }, 2)
}

async function download(task, dir) {
  await progress(task, "downloading", 0, { message: "Resolving source video" })
  const quality = Math.max(144, Math.min(2160, Number(task.quality || 720)))
  const output = join(dir, "source.%(ext)s")
  let pendingUpdate = Promise.resolve()
  const commonArgs = [
    "--continue", "--part", "--newline", "--no-playlist", "--restrict-filenames",
    "--retries", "10", "--fragment-retries", "10", "--file-access-retries", "3", "--concurrent-fragments", "4",
    "--merge-output-format", "mp4", "--format", `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`, "--output", output,
    "--progress-template", "download:%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
  ]
  const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(String(task.source.url || ""))
  if (isYouTube) {
    try {
      await progress(task, "downloading", 0, { message: "Resolving with Android downloader" })
      log("Download strategy: Android branch resolver (iOS/Android youtubei)")
      const direct = await downloadLikeAndroid({
        sourceUrl: task.source.url, requestedHeight: quality, outputPath: join(dir, "source.android.mp4"),
        onProgress: async (downloaded, total) => {
          const percent = total > 0 ? Math.min(99, downloaded / total * 100) : 0
          await progress(task, "downloading", percent, { downloadedBytes: downloaded, totalBytes: total })
        },
        onControl: () => taskControl(task.id), log,
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
    ...(config.youtubeCookiesBrowser ? [{ name: `YouTube ${config.youtubeCookiesBrowser} cookies`, args: ["--remote-components", "ejs:github", "--cookies-from-browser", config.youtubeCookiesBrowser, "--extractor-args", "youtube:player_client=default,web_safari"] }] : []),
  ] : [{ name: "direct source", args: [] }]
  let lastError
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const strategy = attempts[attempt]
    await progress(task, "downloading", 0, { message: `${strategy.name}${attempt ? ` fallback ${attempt + 1}/${attempts.length}` : ""}` })
    log(`Download strategy ${attempt + 1}/${attempts.length}: ${strategy.name}`)
    try {
      await runCommand(config.ytdlp, [...commonArgs, ...strategy.args, task.source.url], {
        taskId: task.id,
        onLine: (line) => {
          if (!line.startsWith("download:")) return
          const [downloaded, total, rawPercent, speed, eta] = line.slice(9).split("|")
          const percent = Number(String(rawPercent || "").replace(/[^0-9.]/g, "")) || 0
          pendingUpdate = pendingUpdate.then(() => progress(task, "downloading", percent, { downloadedBytes: Number(downloaded || 0), totalBytes: Number(total || 0), speed, eta })).catch((error) => log("Progress update skipped:", error.message))
        },
      })
      lastError = null; break
    } catch (error) { lastError = error; log(`${strategy.name} failed:`, error.message) }
  }
  if (lastError) throw lastError
  await pendingUpdate
  const file = mediaFiles(dir)[0]
  if (!file) throw new Error("Downloader finished but no video file was created")
  return file
}

export function escapeDrawText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "’").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
}
function ffmpegFont() { return config.font.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:") }
function xy(position) {
  if (position === "top-left") return ["30", "30"]
  if (position === "bottom-left") return ["30", "h-th-30"]
  if (position === "bottom-right") return ["w-tw-30", "h-th-30"]
  if (position === "center") return ["(w-tw)/2", "(h-th)/2"]
  return ["w-tw-30", "30"]
}
function textSeed(value) { let seed = 17; for (const char of String(value || "")) seed = (seed * 31 + char.codePointAt(0)) % 1000003; return seed }
function recurringEnable(start, repeat, duration) {
  const safeStart = Math.max(0, Number(start || 0)), safeRepeat = Math.max(0, Number(repeat || 0)), safeDuration = Math.max(0.25, Number(duration || 1))
  if (!safeRepeat) return `between(t,${safeStart},${safeStart + safeDuration})`
  return `gte(t,${safeStart})*lt(mod(t-${safeStart}\\,${safeRepeat}),${Math.min(safeDuration, safeRepeat)})`
}
function v2PermanentFilter(preset, font) {
  const item = preset.permanent || {}; if (!item.text) return ""
  const size = Math.max(14, Math.min(120, Number(item.fontSize || 36))), alpha = Math.max(0.05, Math.min(1, Number(item.opacity ?? 0.28)))
  const start = Math.max(0, Number(item.startAtSec || 0)), position = item.position || "top-right"
  let [x, y] = xy(position)
  if (position === "random") {
    const every = Math.max(5, Math.min(3600, Number(item.randomChangeEverySec || 30))), seed = textSeed(item.text), step = `floor(max(t-${start}\\,0)/${every})`
    x = `30+mod(${step}*193+${seed}\\,max(w-tw-60\\,1))`
    y = `30+mod(${step}*389+${seed * 3 + 7}\\,max(h-th-60\\,1))`
  }
  const enable = start > 0 ? `:enable='gte(t,${start})'` : ""
  return `drawtext=fontfile='${font}':text='${escapeDrawText(item.text)}':fontsize=${size}:fontcolor=white@${alpha}:borderw=2:bordercolor=black@${Math.min(0.6, alpha + 0.15)}:x=${x}:y=${y}${enable}`
}
function v2PopupFilter(preset, font) {
  const item = preset.popup || {}; if (!item.text) return ""
  const size = Math.max(14, Math.min(160, Number(item.fontSize || 44))), alpha = Math.max(0.1, Math.min(1, Number(item.opacity ?? 0.7)))
  const start = Math.max(0, Number(item.firstAfterSec ?? 300)), repeat = Math.max(0, Number(item.repeatEverySec ?? 1200)), duration = Math.max(1, Math.min(120, Number(item.durationSec || 10)))
  let [x, y] = xy(item.position || "center")
  if ((item.position || "rotate") === "rotate") {
    const seed = textSeed(item.text), period = repeat > 0 ? repeat : Math.max(duration, 1), step = `floor(max(t-${start}\\,0)/${period})`
    x = `30+mod(${step}*173+${seed}\\,max(w-tw-60\\,1))`
    y = `30+mod(${step}*307+${seed * 5 + 11}\\,max(h-th-60\\,1))`
  }
  const enable = recurringEnable(start, repeat, duration)
  return `drawtext=fontfile='${font}':text='${escapeDrawText(item.text)}':fontsize=${size}:fontcolor=white@${alpha}:borderw=3:bordercolor=black@0.55:x=${x}:y=${y}:enable='${enable}'`
}
function v2TickerFilters(preset, font) {
  const item = preset.ticker || {}; if (!item.text) return []
  const size = Math.max(14, Math.min(120, Number(item.fontSize || 28))), speed = Math.max(20, Math.min(500, Number(item.speedPxSec || 110)))
  const textAlpha = Math.max(0.1, Math.min(1, Number(item.textOpacity ?? 0.95))), bgAlpha = Math.max(0, Math.min(0.95, Number(item.backgroundOpacity ?? 0.55)))
  const barHeight = Math.max(56, Math.round(size * 2.1)), start = Math.max(0, Number(item.firstAfterSec || 0)), displayMode = item.displayMode === "always" ? "always" : "interval"
  const repeat = Math.max(10, Number(item.repeatEverySec || 600)), duration = Math.max(3, Math.min(600, Number(item.durationSec || 20)))
  const enable = displayMode === "always" ? "" : `:enable='${recurringEnable(start, repeat, duration)}'`
  const ticker = escapeDrawText(item.text)
  return [
    `drawbox=x=0:y=ih-${barHeight}:w=iw:h=${barHeight}:color=black@${bgAlpha}:t=fill${enable}`,
    `drawtext=fontfile='${font}':text='${ticker}':fontsize=${size}:fontcolor=white@${textAlpha}:x=w-mod(t*${speed}\\,w+tw):y=h-th-${Math.max(14, Math.round(size * 0.55))}${enable}`,
  ]
}

export function watermarkFilter(preset = {}) {
  if (!preset || preset.mode === "none") return ""
  const font = ffmpegFont()
  if (Number(preset.schemaVersion || 0) >= 2 && (preset.permanent || preset.popup || preset.ticker)) {
    const filters = []
    if (["permanent", "combined"].includes(preset.mode)) { const permanent = v2PermanentFilter(preset, font); if (permanent) filters.push(permanent) }
    if (["timed", "combined"].includes(preset.mode)) { const popup = v2PopupFilter(preset, font); if (popup) filters.push(popup) }
    if (["ticker", "combined"].includes(preset.mode)) filters.push(...v2TickerFilters(preset, font))
    return filters.join(",")
  }
  const size = Math.max(14, Math.min(120, Number(preset.fontSize || 36))), alpha = Math.max(0.05, Math.min(1, Number(preset.opacity ?? 0.28))), [x, y] = xy(preset.position), filters = []
  if (["permanent", "combined"].includes(preset.mode) && preset.text) filters.push(`drawtext=fontfile='${font}':text='${escapeDrawText(preset.text)}':fontsize=${size}:fontcolor=white@${alpha}:borderw=2:bordercolor=black@${Math.min(0.6, alpha + 0.15)}:x=${x}:y=${y}`)
  if (["timed", "combined"].includes(preset.mode) && preset.text) {
    const times = Array.isArray(preset.timed) && preset.timed.length ? preset.timed : [{ start: 300, duration: 10 }]
    times.slice(0, 10).forEach((item, index) => {
      const start = Math.max(0, Number(item.start || 0)), end = start + Math.max(1, Number(item.duration || 10)), positions = [["(w-tw)/2", "(h-th)/2"], ["30", "h-th-30"], ["w-tw-30", "30"]], [tx, ty] = positions[index % positions.length]
      filters.push(`drawtext=fontfile='${font}':text='${escapeDrawText(preset.text)}':fontsize=${Math.round(size * 1.25)}:fontcolor=white@${Math.max(alpha, 0.6)}:borderw=3:bordercolor=black@0.55:x=${tx}:y=${ty}:enable='between(t,${start},${end})'`)
    })
  }
  if (["ticker", "combined"].includes(preset.mode) && (preset.tickerText || preset.text)) {
    const ticker = escapeDrawText(preset.tickerText || preset.text), speed = Math.max(20, Math.min(500, Number(preset.tickerSpeed || 110)))
    filters.push("drawbox=x=0:y=ih-74:w=iw:h=74:color=black@0.55:t=fill")
    filters.push(`drawtext=fontfile='${font}':text='${ticker}':fontsize=${Math.max(18, Math.round(size * 0.75))}:fontcolor=white@0.95:x=w-mod(t*${speed}\\,w+tw):y=h-th-22`)
  }
  return filters.join(",")
}

async function probeMedia(file) {
  let output = ""
  await runCommand(config.ffprobe, ["-v", "error", "-show_entries", "format=duration,size,bit_rate", "-of", "json", file], { onLine: (line) => { output += line } })
  try {
    const parsed = JSON.parse(output || "{}"), duration = Number(parsed?.format?.duration || 0), size = Number(parsed?.format?.size || statSync(file).size || 0), bitRate = Number(parsed?.format?.bit_rate || (duration > 0 ? size * 8 / duration : 0))
    return { duration, size, bitRate }
  } catch { const size = statSync(file).size; return { duration: 0, size, bitRate: 0 } }
}

export function targetEncodeBitrates({ sourceBytes, durationSeconds, audioKbps = 96, scale = 1 } = {}) {
  const bytes = Math.max(1, Number(sourceBytes || 0)), duration = Math.max(1, Number(durationSeconds || 1)), sourceTotalKbps = bytes * 8 / duration / 1000
  const targetTotalKbps = Math.max(180, sourceTotalKbps * 0.96 * Math.max(0.35, Math.min(1, Number(scale || 1))))
  const safeAudioKbps = Math.min(Math.max(64, Number(audioKbps || 96)), Math.max(64, targetTotalKbps * 0.24))
  const videoKbps = Math.max(110, targetTotalKbps - safeAudioKbps - 12)
  return { sourceTotalKbps, targetTotalKbps, audioKbps: Math.round(safeAudioKbps), videoKbps: Math.round(videoKbps), maxrateKbps: Math.round(videoKbps * 1.18), bufsizeKbps: Math.round(videoKbps * 2) }
}

async function encodeWatermark(task, input, output, filter, media, scale = 1) {
  const budget = targetEncodeBitrates({ sourceBytes: media.size, durationSeconds: media.duration, scale })
  log(`Watermark bitrate budget: source=${budget.sourceTotalKbps.toFixed(0)}kbps video=${budget.videoKbps}kbps audio=${budget.audioKbps}kbps scale=${scale.toFixed(3)}`)
  let pendingUpdate = Promise.resolve()
  await runCommand(config.ffmpeg, [
    "-y", "-i", input, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${budget.videoKbps}k`, "-maxrate", `${budget.maxrateKbps}k`, "-bufsize", `${budget.bufsizeKbps}k`,
    "-c:a", "aac", "-b:a", `${budget.audioKbps}k`, "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output,
  ], {
    taskId: task.id,
    onLine: (line) => {
      if (!line.startsWith("out_time_ms=")) return
      const seconds = Number(line.slice(12)) / 1_000_000, percent = media.duration > 0 ? Math.min(99, seconds / media.duration * 100) : 0
      pendingUpdate = pendingUpdate.then(() => progress(task, "processing", percent, { message: "Applying watermark" })).catch(() => {})
    },
  })
  await pendingUpdate
  return budget
}

async function render(task, input, dir) {
  const filter = watermarkFilter(task.preset)
  if (!filter) return input
  const output = join(dir, "watermarked.mp4"), media = await probeMedia(input)
  if (!(media.duration > 0)) throw new Error("Could not read source video duration for safe watermark encoding")
  await progress(task, "processing", 0, { message: "Applying watermark with source-size protection" })
  await encodeWatermark(task, input, output, filter, media, 1)
  let outputBytes = statSync(output).size
  const preferredMax = media.size * 1.08
  if (outputBytes > preferredMax) {
    const correctiveScale = Math.max(0.45, Math.min(0.95, preferredMax / outputBytes * 0.94))
    log(`Watermark output ${(outputBytes / 1024 ** 2).toFixed(1)}MB exceeded source-size guard; re-encoding once at scale ${correctiveScale.toFixed(3)}`)
    await progress(task, "processing", 0, { message: "Optimizing watermark output size" })
    await encodeWatermark(task, input, output, filter, media, correctiveScale)
    outputBytes = statSync(output).size
  }
  log(`Watermark size: source=${(media.size / 1024 ** 2).toFixed(1)}MB output=${(outputBytes / 1024 ** 2).toFixed(1)}MB (${(outputBytes / media.size * 100).toFixed(1)}%)`)
  return output
}

async function telegramUpload(task, file) {
  const size = statSync(file).size, cloudBase = "https://api.telegram.org", localBase = "http://127.0.0.1:8081", configuredIsLocal = !/^https:\/\/api\.telegram\.org/i.test(config.telegramBase)
  const localDetected = config.telegramLocalAutoDetect && !configuredIsLocal ? await telegramApiAvailable(localBase, 1_200) : false
  const bases = []
  if (localDetected) { bases.push(localBase); log("Telegram Local Bot API detected; using the stable local transport first") }
  bases.push(config.telegramBase)
  if ((configuredIsLocal || localDetected) && size <= 50_000_000) bases.push(cloudBase)
  const uniqueBases = [...new Set(bases)], hasLocal = uniqueBases.some((base) => !/^https:\/\/api\.telegram\.org/i.test(base)), maxBytes = hasLocal ? 2_000_000_000 : 50_000_000
  if (size > maxBytes) throw new Error(`Output is ${(size / 1024 ** 2).toFixed(1)} MB, above the configured Telegram API limit of ${(maxBytes / 1024 ** 2).toFixed(0)} MB. Configure Telegram Local Bot API for files up to 2 GB.`)
  await progress(task, "uploading", 0, { totalBytes: size, message: "Uploading to Telegram" })
  log(`Telegram streaming upload file: ${file} (${size} bytes)`)
  const controller = new AbortController(); let controlError = null
  const timer = setInterval(async () => { try { await taskControl(task.id) } catch (error) { if (error instanceof ControlSignal) { controlError = error; controller.abort(error) } } }, 12_000)
  let lastTransportError, retryCycle = 0
  try {
    for (;;) {
      for (let baseIndex = 0; baseIndex < uniqueBases.length; baseIndex += 1) {
        const base = uniqueBases[baseIndex], endpoint = `${base}/bot${config.botToken}/sendVideo`, baseIsLocal = !/^https:\/\/api\.telegram\.org/i.test(base), transportName = baseIsLocal ? "local" : "cloud"
        try {
          log(`Telegram ${transportName} transport ${new URL(base).origin}, connection ${retryCycle + 1}`)
          const response = await postTelegramVideo({
            url: endpoint, file,
            fields: { chat_id: task.channel.chatId, supports_streaming: "true", message_thread_id: task.channel.threadId || null, caption: task.caption || null },
            connectTimeoutMs: baseIsLocal ? 3_000 : 15_000, signal: controller.signal,
            onProgress: (uploaded, total) => { const percent = total > 0 ? Math.min(99, uploaded / total * 100) : 0; progress(task, "uploading", percent, { uploadedBytes: uploaded, totalBytes: total, message: "Uploading to Telegram" }).catch(() => {}) },
            onStatus: (message) => log(`Telegram transport: ${message}`),
          })
          const result = response.payload
          if (!result?.ok) throw new TelegramApiError(result, response.status)
          return { messageId: result.result?.message_id || null, fileId: result.result?.video?.file_id || result.result?.document?.file_id || null, size }
        } catch (error) {
          if (controlError) throw controlError
          if (error instanceof TelegramApiError && !error.retryable) throw error
          lastTransportError = error; log(`Telegram ${transportName} transport temporarily unavailable:`, error.message)
        }
      }
      retryCycle += 1
      const retryAfterMs = lastTransportError instanceof TelegramApiError && lastTransportError.retryAfterSeconds ? lastTransportError.retryAfterSeconds * 1000 : [2_000, 5_000, 10_000, 15_000, 30_000][Math.min(retryCycle - 1, 4)]
      const retrySeconds = Math.ceil(retryAfterMs / 1000)
      await progress(task, "waiting_network", 0, { message: `Telegram connection unavailable; cached file is safe. Retrying in ${retrySeconds}s`, retryCount: retryCycle, nextRetrySeconds: retrySeconds }).catch(() => {})
      log(`Telegram connection unavailable; cached file is safe. Retrying in ${retrySeconds}s`)
      await sleep(retryAfterMs)
      if (controlError) throw controlError
    }
  } finally { clearInterval(timer) }
}

class TelegramApiError extends Error {
  constructor(payload = {}, status = 0) { super(payload?.description || `Telegram returned HTTP ${status}`); this.errorCode = Number(payload?.error_code || status || 0); this.retryAfterSeconds = Math.max(0, Number(payload?.parameters?.retry_after || 0)); this.retryable = this.errorCode === 429 || this.errorCode >= 500 }
}
async function telegramApiAvailable(base, timeoutMs) {
  try { const response = await fetch(`${base}/bot${config.botToken}/getMe`, { signal: AbortSignal.timeout(timeoutMs) }); const payload = await response.json().catch(() => ({})); return response.ok && payload?.ok === true } catch { return false }
}
function safeHeader(value) { return String(value || "").replace(/[\r\n"]/g, "_") }
function telegramTransportError(error, target) { if (error instanceof ControlSignal) return error; const code = error?.code || error?.cause?.code || "NETWORK_ERROR", detail = error?.cause?.message || error?.message || "connection failed"; return new Error(`Telegram connection to ${target.origin} failed: ${code} — ${detail}`) }

export async function postTelegramVideo({ url, file, fields = {}, connectTimeoutMs = 15_000, signal, onProgress = () => {}, onStatus = () => {} }) {
  const target = new URL(url), boundary = `----EasyEducation${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`, parts = []
  for (const [rawName, value] of Object.entries(fields)) {
    if (value === null || value === undefined || String(value) === "") continue
    const name = safeHeader(rawName)
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`))
  }
  const filename = safeHeader(basename(file))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`))
  const preamble = Buffer.concat(parts), footer = Buffer.from(`\r\n--${boundary}--\r\n`), fileSize = statSync(file).size, contentLength = preamble.length + fileSize + footer.length
  return new Promise((resolveUpload, rejectUpload) => {
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest
    let input = null, settled = false, connectTimer = null, stallTimer = null
    const clearTimers = () => { if (connectTimer) clearTimeout(connectTimer); if (stallTimer) clearTimeout(stallTimer) }
    const resetStallTimer = () => { if (stallTimer) clearTimeout(stallTimer); stallTimer = setTimeout(() => { const error = new Error("upload made no network progress for 15 minutes"); error.code = "UPLOAD_STALLED"; request.destroy(error) }, 15 * 60_000) }
    const finishError = (error) => { if (settled) return; settled = true; clearTimers(); input?.destroy(); rejectUpload(signal?.aborted && signal.reason ? signal.reason : telegramTransportError(error, target)) }
    const networkOptions = target.protocol === "https:" ? { family: 0, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 1_500, agent: telegramHttpsAgent } : {}
    const request = transport({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: "POST", path: `${target.pathname}${target.search}`, ...networkOptions, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(contentLength), Connection: "keep-alive" } }, (response) => {
      const chunks = []; let responseBytes = 0
      response.on("data", (chunk) => { resetStallTimer(); responseBytes += chunk.length; if (responseBytes <= 2 * 1024 * 1024) chunks.push(chunk) })
      response.on("end", () => { if (settled) return; settled = true; clearTimers(); const text = Buffer.concat(chunks).toString("utf8"); let payload; try { payload = JSON.parse(text || "{}") } catch { payload = { ok: false, description: text || `Telegram returned HTTP ${response.statusCode}` } }; resolveUpload({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, payload }) })
      response.on("error", finishError)
    })
    request.on("error", finishError)
    connectTimer = setTimeout(() => { const error = new Error(`could not connect to Telegram within ${Math.ceil(connectTimeoutMs / 1000)} seconds`); error.code = "CONNECT_TIMEOUT"; request.destroy(error) }, connectTimeoutMs)
    request.on("socket", (socket) => {
      socket.setKeepAlive(true, 30_000); let connectedOnce = false
      const connected = () => { if (connectedOnce || settled) return; connectedOnce = true; if (connectTimer) clearTimeout(connectTimer); connectTimer = null; resetStallTimer(); onStatus(`${target.protocol === "https:" ? "TLS" : "TCP"} connected over ${socket.remoteFamily || "network"}`); startBody() }
      if (!socket.connecting) connected(); else if (target.protocol === "https:") socket.once("secureConnect", connected); else socket.once("connect", connected)
    })
    const abort = () => request.destroy(signal?.reason || new Error("Upload aborted"))
    if (signal) { if (signal.aborted) return abort(); signal.addEventListener("abort", abort, { once: true }) }
    let bodyStarted = false
    const startBody = () => {
      if (bodyStarted || settled) return
      bodyStarted = true; request.write(preamble); input = createReadStream(file, { highWaterMark: 1024 * 1024 }); let uploaded = 0
      input.on("error", (error) => request.destroy(error))
      input.on("data", (chunk) => { uploaded += chunk.length; onProgress(uploaded, fileSize); resetStallTimer(); if (!request.write(chunk)) input.pause() })
      input.on("end", () => request.end(footer))
    }
    request.on("drain", () => { resetStallTimer(); input?.resume() })
  })
}

async function processTask(task) {
  const dir = taskDirectory(task.id)
  if (diskFreeBytes(config.workDir) < config.minFreeBytes) throw new Error(`Less than ${Math.round(config.minFreeBytes / 1024 ** 3)} GB free disk space; task paused to protect the SSD`)
  log("Starting", task.id, task.source.url)
  await taskControl(task.id)
  const needsWatermark = Boolean(watermarkFilter(task.preset)), processed = join(dir, "watermarked.mp4")
  let input = sourceCheckpoint(dir), output = null
  if (needsWatermark && validMediaCheckpoint(processed)) {
    output = processed
    log("Checkpoint: processed watermark file exists; skipping download and FFmpeg")
    await progress(task, "uploading", 0, { message: "Resuming from processed checkpoint" }).catch(() => {})
  } else {
    if (input) {
      log("Checkpoint: downloaded source exists; skipping download", basename(input))
      await progress(task, needsWatermark ? "processing" : "uploading", 0, { message: "Resuming from downloaded checkpoint" }).catch(() => {})
    } else input = await download(task, dir)
    await taskControl(task.id)
    output = needsWatermark ? await render(task, input, dir) : input
  }
  await taskControl(task.id)
  const telegram = await telegramUpload(task, output)
  await api("media-worker-finish", { workerId: config.workerId, taskId: task.id, success: true, telegramMessageId: telegram.messageId, telegramFileId: telegram.fileId, outputBytes: telegram.size, title: basename(output) })
  log("Completed", task.id, `message=${telegram.messageId}`)
  rmSync(dir, { recursive: true, force: true })
}

async function failTask(task, error) {
  if (error instanceof ControlSignal) { log(`Task ${error.type}`, task.id); return }
  log("Failed", task.id, error.message)
  await api("media-worker-finish", { workerId: config.workerId, taskId: task.id, success: false, error: error.message }).catch((finishError) => log("Could not report failure:", finishError.message))
}
async function register() { await api("media-worker-register", { workerId: config.workerId, name: config.workerName, version: VERSION, platform: `${process.platform}-${process.arch}`, capabilities: { download: true, youtube: true, hls: true, watermark: true, telegram: true, encodeConcurrency: 1 } }) }
async function main() {
  if (!config.secret || !config.botToken) throw new Error("Missing AUTOMATION_SECRET or TELEGRAM_BOT_TOKEN in media-worker/.env")
  log(`Easy Education Media Worker ${VERSION}`); log(`Worker: ${config.workerName} (${config.workerId})`); log(`Work directory: ${config.workDir}`); await register()
  for (;;) {
    try {
      const result = await api("media-worker-claim", { workerId: config.workerId, name: config.workerName, version: VERSION, platform: `${process.platform}-${process.arch}` })
      if (result.paused) { log("Global media processing is paused"); await sleep(config.pollMs); continue }
      if (!result.task) { await sleep(config.pollMs); continue }
      await processTask(result.task).catch((error) => failTask(result.task, error))
    } catch (error) { log("Worker loop error:", error.message); await sleep(Math.max(config.pollMs, 30_000)) }
  }
}
process.on("SIGINT", () => { log("Worker stopped; active download files are kept for resume"); process.exit(0) })
process.on("SIGTERM", () => { log("Worker stopped; active download files are kept for resume"); process.exit(0) })
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) main().catch((error) => { console.error(error); process.exit(1) })
