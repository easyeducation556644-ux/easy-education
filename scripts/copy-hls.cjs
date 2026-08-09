const fs = require("fs")
const https = require("https")
const path = require("path")

const VERSION = "1.6.16"
const urls = [
  `https://cdn.jsdelivr.net/npm/hls.js@${VERSION}/dist/hls.min.js`,
  `https://unpkg.com/hls.js@${VERSION}/dist/hls.min.js`,
]
const targets = [
  path.join(process.cwd(), "public", "native-assets", "hls.min.js"),
  path.join(process.cwd(), "public", "offline-assets", "hls.min.js"),
]

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects while downloading hls.js"))

    const request = https.get(url, { headers: { "User-Agent": "EasyEducation-Build" } }, (response) => {
      const status = response.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume()
        const next = new URL(response.headers.location, url).toString()
        return resolve(download(next, redirects + 1))
      }
      if (status !== 200) {
        response.resume()
        return reject(new Error(`hls.js download returned HTTP ${status}`))
      }

      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => {
        const body = Buffer.concat(chunks)
        if (body.length < 100_000) return reject(new Error("Downloaded hls.js runtime looks incomplete"))
        resolve(body)
      })
    })

    request.setTimeout(20_000, () => request.destroy(new Error("hls.js download timed out")))
    request.on("error", reject)
  })
}

async function main() {
  let body = null
  let lastError = null

  for (const url of urls) {
    try {
      body = await download(url)
      console.log(`Downloaded hls.js ${VERSION} from ${new URL(url).hostname}`)
      break
    } catch (error) {
      lastError = error
      console.warn(`Unable to download hls.js from ${url}: ${error.message}`)
    }
  }

  if (!body) throw lastError || new Error("Unable to download hls.js runtime")

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    fs.writeFileSync(temp, body)
    fs.renameSync(temp, target)
  }

  console.log("Prepared HLS runtime for native and offline playback")
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
