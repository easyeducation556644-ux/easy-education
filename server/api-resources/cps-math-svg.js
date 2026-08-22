import crypto from "node:crypto"
import sharp from "sharp"
import { requireAuthenticatedUser } from "./utils/firebase-admin.js"

const MAX_FORMULAS = 12
const MAX_FORMULA_CHARS = 2_000
const MAX_SVG_BYTES = 256 * 1024
const CACHE_LIMIT = 256
const RENDER_BASE = process.env.CPS_MATH_RENDER_URL || "https://latex.codecogs.com/svg.image"
const memoryCache = new Map()

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Cache-Control", "private, no-store")
}

function cleanFormula(value) {
  return String(value || "").trim().slice(0, MAX_FORMULA_CHARS)
}

function formulaHash(formula) {
  return crypto.createHash("sha256").update(formula, "utf8").digest("hex")
}

function cacheGet(hash) {
  const hit = memoryCache.get(hash)
  if (!hit) return null
  memoryCache.delete(hash)
  memoryCache.set(hash, hit)
  return hit
}

function cachePut(hash, value) {
  memoryCache.set(hash, value)
  while (memoryCache.size > CACHE_LIMIT) {
    const first = memoryCache.keys().next().value
    if (!first) break
    memoryCache.delete(first)
  }
}

async function fetchSvg(formula) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const url = `${RENDER_BASE}?${encodeURIComponent(formula)}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "image/svg+xml,text/plain;q=0.8,*/*;q=0.2",
        "User-Agent": "EasyEducation-CPS-Math/1.0",
      },
    })
    if (!response.ok) throw new Error(`Math renderer returned HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) throw new Error("Math renderer returned an empty image")
    if (bytes.length > MAX_SVG_BYTES) throw new Error("Rendered formula is too large")
    const prefix = bytes.subarray(0, Math.min(bytes.length, 512)).toString("utf8").toLowerCase()
    if (!prefix.includes("<svg")) throw new Error("Math renderer did not return SVG")
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

async function renderFormula(formula) {
  const hash = formulaHash(formula)
  const cached = cacheGet(hash)
  if (cached) return { formula, hash, ...cached, cached: true }

  const svg = await fetchSvg(formula)
  const rendered = await sharp(svg, { density: 180 })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true })
  const png = rendered.data
  const width = Number(rendered.info.width) || 1
  const height = Number(rendered.info.height) || 1
  if (png.length > 384 * 1024) throw new Error("Rendered formula PNG is too large")

  const value = {
    pngBase64: png.toString("base64"),
    width,
    height,
  }
  cachePut(hash, value)
  return { formula, hash, ...value, cached: false }
}

async function mapWithConcurrency(values, limit, worker) {
  const output = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= values.length) return
      const value = values[index]
      try {
        output[index] = await worker(value)
      } catch (error) {
        output[index] = {
          formula: value,
          hash: formulaHash(value),
          error: error?.name === "AbortError" ? "Math rendering timed out" : (error?.message || "Math rendering failed"),
        }
      }
    }
  })
  await Promise.all(runners)
  return output
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    await requireAuthenticatedUser(req)
    const raw = Array.isArray(req.body?.formulas) ? req.body.formulas : []
    const formulas = [...new Set(raw.map(cleanFormula).filter(Boolean))].slice(0, MAX_FORMULAS)
    if (!formulas.length) return res.status(200).json({ items: [], renderer: "server-static-png-v1" })
    const items = await mapWithConcurrency(formulas, 4, renderFormula)
    return res.status(200).json({
      items,
      renderer: "server-static-png-v1",
      serverTimeMs: Date.now(),
    })
  } catch (error) {
    console.error("CPS math render error", { message: error?.message, code: error?.code })
    return res.status(Number(error?.statusCode) || 500).json({
      error: error?.message || "Math rendering is temporarily unavailable",
      code: error?.code || "CPS_MATH_RENDER_ERROR",
    })
  }
}
