import test from "node:test"
import assert from "node:assert/strict"
import { mediaId, validSourceUrl } from "../../server/media/helpers.js"
import { escapeDrawText, watermarkFilter } from "../../media-worker/worker.mjs"

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
