import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mediaId, validSourceUrl } from "../../server/media/helpers.js"
import { escapeDrawText, postTelegramVideo, watermarkFilter } from "../../media-worker/worker.mjs"

test("media fingerprints are stable and destination-sensitive", () => {
  assert.equal(mediaId("video", "a", "channel-1"), mediaId("video", "a", "channel-1"))
  assert.notEqual(mediaId("video", "a", "channel-1"), mediaId("video", "a", "channel-2"))
})

test("manual media tasks accept only HTTP video links", () => {
  assert.equal(validSourceUrl("https://youtu.be/dQw4w9WgXcQ"), "https://youtu.be/dQw4w9WgXcQ")
  assert.throws(() => validSourceUrl("file:///C:/secret.mp4"), /Only HTTP or HTTPS/)
})

test("combined watermark builds permanent, timed and ticker filters", () => {
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

test("drawtext escaping protects FFmpeg separators", () => {
  assert.equal(escapeDrawText("A:B, 50%"), "A\\:B\\, 50\\%")
})

test("native Telegram multipart streams a local video without curl", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ee-telegram-upload-"))
  const file = join(dir, "sample.mp4")
  writeFileSync(file, "video-payload-123")
  let received = ""
  let declaredLength = 0
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
    })
    assert.equal(result.payload.result.message_id, 42)
    assert.equal(declaredLength, Buffer.byteLength(received, "latin1"))
    assert.match(received, /filename="sample.mp4"/)
    assert.match(received, /video-payload-123/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
