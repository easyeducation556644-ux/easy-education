const fs = require("fs")
const path = require("path")

const source = path.join(process.cwd(), "node_modules", "hls.js", "dist", "hls.min.js")
const targetDir = path.join(process.cwd(), "public", "offline-assets")
const target = path.join(targetDir, "hls.min.js")

if (!fs.existsSync(source)) {
  console.error("hls.js runtime was not installed:", source)
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
console.log("Copied hls.js runtime to public/offline-assets/hls.min.js")
