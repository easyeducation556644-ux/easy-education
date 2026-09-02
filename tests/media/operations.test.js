import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mediaId, validSourceUrl } from "../../server/media/helpers.js"
import { normalizeMediaPreset } from "../../server/media/operations.js"
import { escapeDrawText, postTelegramVideo, targetEncodeBitrates, watermarkFilter } from "../../media-worker/worker.mjs"

test("media fingerprints are stable and destination-sensitive", () => {
  assert.equal(mediaId("video", "a", "channel-1"), mediaId("video", "a", "channel-1"))
  assert.notEqual(mediaId("video", "a", "channel-1"), mediaId("video", "a", "channel-2"))
})

test("manual media tasks accept only HTTP video links", () => {
  assert.equal(validSourceUrl("https://youtu.be/dQw4w9WgXcQ"), "https://youtu.be/dQw4w9WgXcQ")
  assert.throws(() => validSourceUrl("file:///C:/secret.mp4"), /Only HTTP or HTTPS/)
})

test("legacy combined watermark remains compatible", () => {
  const filter = watermarkFilter({
    mode: "combined",
    text: "Easy Education",
    tickerText: "Breaking: HSC 26",
    opacity: 0.3,
    fontSize: 36,
    position: "top-right",
    timed: [{ start: 60, duration: 8 }, { start: 600, duration: 10 }],
  })
  assert.match(filter, /between\(t,60,68\)/)
  assert.match(filter, /between\(t,600,610\)/)
  assert.match(filter, /drawbox/)
  assert.match(filter, /mod\(t\*110/)
})

test("v2 random permanent watermark starts at video time and moves safely", () => {
  const filter = watermarkFilter({
    schemaVersion: 2,
    mode: "permanent",
    permanent: {
      text: "Easy Education",
      position: "random",
      startAtSec: 300,
      randomChangeEverySec: 30,
      opacity: 0.28,
      fontSize: 36,
    },
  })
  assert.match(filter, /enable='gte\(t,300\)'/)
  assert.match(filter, /floor\(max\(t-300\\,0\)\/30\)/)
  assert.match(filter, /max\(w-tw-60\\,1\)/)
  assert.match(filter, /max\(h-th-60\\,1\)/)
})

test("v2 popup and ticker use understandable recurring schedules", () => {
  const popup = watermarkFilter({
    schemaVersion: 2,
    mode: "timed",
    popup: { text: "Popup", firstAfterSec: 300, repeatEverySec: 1200, durationSec: 10, position: "rotate", opacity: 0.7, fontSize: 44 },
  })
  assert.match(popup, /gte\(t,300\)\*lt\(mod\(t-300\\,1200\),10\)/)

  const ticker = watermarkFilter({
    schemaVersion: 2,
    mode: "ticker",
    ticker: { text: "Ticker", displayMode: "interval", firstAfterSec: 0, repeatEverySec: 600, durationSec: 20, speedPxSec: 160, fontSize: 28, textOpacity: 0.95, backgroundOpacity: 0.55 },
  })
  assert.match(ticker, /drawbox/)
  assert.match(ticker, /lt\(mod\(t-0\\,600\),20\)/)
  assert.match(ticker, /mod\(t\*160/)
})

test("preset v2 defaults match production UI defaults", () => {
  const preset = normalizeMediaPreset({
    mode: "combined",
    permanent: { text: "Brand", position: "random" },
    popup: { text: "Popup" },
    ticker: { text: "Ticker" },
  })
  assert.equal(preset.schemaVersion, 2)
  assert.equal(preset.permanent.randomChangeEverySec, 30)
  assert.equal(preset.popup.firstAfterSec, 300)
  assert.equal(preset.popup.repeatEverySec, 1200)
  assert.equal(preset.popup.durationSec, 10)
  assert.equal(preset.ticker.displayMode, "interval")
  assert.equal(preset.ticker.repeatEverySec, 600)
  assert.equal(preset.ticker.durationSec, 20)
  assert.equal(preset.ticker.speedPxSec, 110)
})

test("watermark bitrate budget targets source-like output size", () => {
  const durationSeconds = 3600
  const sourceBytes = 900 * 1024 * 1024
  const budget = targetEncodeBitrates({ sourceBytes, durationSeconds })
  const sourceKbps = sourceBytes * 8 / durationSeconds / 1000
  assert.ok(budget.targetTotalKbps < sourceKbps)
  assert.ok(budget.targetTotalKbps > sourceKbps * 0.9)
  assert.ok(budget.videoKbps > 100)
  assert.ok(budget.audioKbps >= 64 && budget.audioKbps <= 96)
})

test("drawtext escaping protects FFmpeg separators", () => {
  assert.equal(escapeDrawText("A:B, 50%"), "A\\:B\\, 50\\%")
})

test("native Telegram multipart streams a local video without curl", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ee-telegram-upload-"))
  const file = join(dir, "sample.mp4")
  writeFileSync(file, "video-payload-123")
  let received = ""
  let declaredLength = 0
  const statuses = []
  const server = createServer((request, response) => {
    declaredLength = Number(request.headers["content-length"] || 0)
    request.setEncoding("latin1")
    request.on("data", (chunk) => { received += chunk })
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end('{"ok":true,"result":{"message_id":42}}')
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    const result = await postTelegramVideo({
      url: `http://127.0.0.1:${address.port}/sendVideo`,
      file,
      fields: { chat_id: "-1001", supports_streaming: "true" },
      onStatus: (status) => statuses.push(status),
    })
    assert.equal(result.payload.result.message_id, 42)
    assert.equal(declaredLength, Buffer.byteLength(received, "latin1"))
    assert.ok(statuses.some((status) => status.includes("connected over IPv4")))
    assert.match(received, /filename="sample.mp4"/)
    assert.match(received, /video-payload-123/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
