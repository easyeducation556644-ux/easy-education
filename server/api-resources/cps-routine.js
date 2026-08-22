import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const CPS_PROJECT_ID = "secure-sublime-cjkjx"
const CPS_DATABASE_ID = "ai-studio-d5c98c37-dd8b-4acc-a17c-48f4f6244ec1"
const CPS_API_KEY = process.env.CPS_FIREBASE_API_KEY || "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
const CPS_ROOT = `https://firestore.googleapis.com/v1/projects/${CPS_PROJECT_ID}/databases/${CPS_DATABASE_ID}/documents`
const PAGE_SIZE = 100
const MAX_PAGES = 20
const ROUTINE_CACHE_MS = 5 * 60_000

const routineCache = globalThis.__easyEducationCpsRoutineSheetCache || new Map()
globalThis.__easyEducationCpsRoutineSheetCache = routineCache

function decodeValue(value = {}) {
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue)
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue)
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue)
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue)
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeValue(item)]))
  if (value.referenceValue) return value.referenceValue
  return null
}

function decodeDocument(raw) {
  if (!raw?.name) return null
  const id = String(raw.name).split("/").pop() || ""
  const fields = Object.fromEntries(Object.entries(raw.fields || {}).map(([key, value]) => [key, decodeValue(value)]))
  return { id, ...fields }
}

function sourceToken(req) {
  const header = String(req.headers?.["x-cps-firebase-token"] || "").replace(/^Bearer\s+/i, "").trim()
  const env = String(process.env.CPS_FIREBASE_ID_TOKEN || "").replace(/^Bearer\s+/i, "").trim()
  return header || env
}

async function queryCoursesPage(token, offset) {
  const url = new URL(`${CPS_ROOT}:runQuery`)
  url.searchParams.set("key", CPS_API_KEY)
  const headers = { "Content-Type": "application/json", Accept: "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url.toString(), {
    // Firestore documents:runQuery is a read RPC. This endpoint never writes to CPS.
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "courses" }],
        limit: PAGE_SIZE,
        ...(offset ? { offset } : {}),
      },
    }),
    redirect: "follow",
  })
}

async function readCourses(token) {
  const courses = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    let response = await queryCoursesPage(token, offset)
    if (token && (response.status === 401 || response.status === 403)) response = await queryCoursesPage("", offset)
    if (!response.ok) throw Object.assign(new Error("CPS routine source is temporarily unavailable"), { statusCode: 503 })
    const payload = await response.json()
    const batch = Array.isArray(payload) ? payload.map((entry) => decodeDocument(entry?.document)).filter(Boolean) : []
    courses.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return courses
}

function activeEntitlement(data) {
  if (!data || data.status === "revoked") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > Date.now()
}

async function requireCourseAccess(authenticated, courseId) {
  if (isFullAdminProfile(authenticated.userProfile)) return
  const uid = authenticated.decodedToken.uid
  const snapshot = await authenticated.db.collection("cpsEntitlements").doc(`${uid}_${courseId}`).get()
  if (!snapshot.exists || !activeEntitlement(snapshot.data())) {
    throw Object.assign(new Error("This CPS course is locked"), { statusCode: 403 })
  }
}

function sheetIdentity(rawUrl) {
  const value = String(rawUrl || "").trim()
  const match = value.match(/spreadsheets\/d\/([^/]+)/i)
  if (!match) return null
  let gid = ""
  try {
    const parsed = new URL(value)
    gid = parsed.searchParams.get("gid") || ""
    if (!gid && parsed.hash) gid = new URLSearchParams(parsed.hash.replace(/^#/, "")).get("gid") || ""
  } catch (_) {}
  return { id: match[1], gid }
}

function csvExportUrls(identity) {
  const suffix = identity.gid ? `&gid=${encodeURIComponent(identity.gid)}` : ""
  return [
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(identity.id)}/export?format=csv${suffix}`,
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(identity.id)}/gviz/tq?tqx=out:csv${identity.gid ? `&gid=${encodeURIComponent(identity.gid)}` : ""}`,
  ]
}

function parseCsv(input) {
  const rows = []
  let row = []
  let cell = ""
  let quoted = false
  const text = String(input || "").replace(/^\uFEFF/, "")
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (quoted) {
      if (ch === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
      else if (ch === '"') quoted = false
      else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = "" }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = "" }
    else if (ch !== '\r') cell += ch
  }
  row.push(cell)
  if (row.some((value) => String(value).trim())) rows.push(row)
  return rows
}

function cleanRows(rows) {
  return rows
    .slice(0, 600)
    .map((row) => row.slice(0, 30).map((cell) => String(cell || "").replace(/\s+/g, " ").trim().slice(0, 2500)))
    .filter((row) => row.some(Boolean))
}

async function fetchSheetRows(rawUrl) {
  const identity = sheetIdentity(rawUrl)
  if (!identity) return []
  const cacheKey = `${identity.id}:${identity.gid}`
  const cached = routineCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ROUTINE_CACHE_MS) return cached.rows

  let lastError = null
  for (const url of csvExportUrls(identity)) {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "text/csv,text/plain;q=0.9,*/*;q=0.7",
          "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        },
      })
      if (!response.ok) { lastError = new Error(`Routine sheet returned ${response.status}`); continue }
      const body = await response.text()
      if (/^\s*</.test(body) && /<html/i.test(body)) { lastError = new Error("Routine sheet is not public CSV"); continue }
      const rows = cleanRows(parseCsv(body))
      if (rows.length) {
        routineCache.set(cacheKey, { at: Date.now(), rows })
        return rows
      }
    } catch (error) {
      lastError = error
    }
  }
  if (cached?.rows?.length) return cached.rows
  if (lastError) console.warn("CPS routine sheet read failed", lastError.message)
  return []
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CPS-Firebase-Token")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate")
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  try {
    const authenticated = await requireAuthenticatedUser(req)
    const courseId = String(req.query?.courseId || "").trim().replace(/^cps:/, "")
    if (!courseId) return res.status(400).json({ error: "courseId is required" })
    await requireCourseAccess(authenticated, courseId)

    const courses = await readCourses(sourceToken(req))
    const course = courses.find((item) => String(item.id) === courseId && item.isDeleted !== true && item.hidden !== true && item.bin !== true)
    if (!course) return res.status(404).json({ error: "CPS course was not found" })

    const config = course.routineConfig && typeof course.routineConfig === "object" ? course.routineConfig : {}
    const mode = String(config.mode || (course.routines ? "text" : "")).trim().toLowerCase()
    const sourceUrl = String(config.url || "").trim()
    const rows = mode === "sheet" && sourceUrl ? await fetchSheetRows(sourceUrl) : []

    return res.status(200).json({
      courseId: `cps:${courseId}`,
      mode,
      rows,
      text: String(course.routines || ""),
      updatedAtMs: Date.now(),
    })
  } catch (error) {
    console.error("CPS routine bridge error", { message: error?.message })
    return res.status(Number(error?.statusCode) || 500).json({ error: error?.message || "Routine is temporarily unavailable" })
  }
}
