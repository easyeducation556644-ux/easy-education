import test from "node:test"
import assert from "node:assert/strict"

import { pickProgressive, progressiveFormats, youtubeVideoId } from "../../media-worker/youtube-android-resolver.mjs"

test("Android resolver accepts normal, short and shorts YouTube URLs", () => {
  assert.equal(youtubeVideoId("https://youtu.be/Ugz3iGg02ok"), "Ugz3iGg02ok")
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=Ugz3iGg02ok"), "Ugz3iGg02ok")
  assert.equal(youtubeVideoId("https://youtube.com/shorts/Ugz3iGg02ok"), "Ugz3iGg02ok")
})

test("Android resolver keeps safe progressive MP4 and picks requested/lower quality", () => {
  const profile = { name: "ANDROID", userAgent: "android" }
  const formats = progressiveFormats({ streamingData: { formats: [
    { url: "https://r1.googlevideo.com/videoplayback?a=1", mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', height: 360, bitrate: 500, contentLength: "100" },
    { url: "https://r2.googlevideo.com/videoplayback?a=2", mimeType: 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"', height: 720, bitrate: 900, contentLength: "200" },
    { url: "https://evil.example/video", mimeType: 'video/mp4; codecs="avc1, mp4a"', height: 1080 },
  ] } }, profile)
  assert.deepEqual(formats.map((item) => item.height), [360, 720])
  assert.equal(pickProgressive(formats, 720).height, 720)
  assert.equal(pickProgressive(formats, 480).height, 360)
})
