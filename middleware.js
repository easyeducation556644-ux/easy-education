import { AsyncLocalStorage } from "node:async_hooks"
import { getAdminServices } from "./api/utils/firebase-admin.js"
import { continueManualDriveRepair } from "./server/bot/manual-drive-repair.js"

const continuationScope = new AsyncLocalStorage()
const nativeFetch = globalThis.fetch.bind(globalThis)
const OUTER_WORKER_BUDGET_MS = 245_000

function authorized(request) {
  const expected = String(process.env.AUTOMATION_SECRET || "")
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function requestUrlOf(input) {
  try {
    if (typeof input === "string") return new URL(input)
    if (input instanceof URL) return input
    if (input?.url) return new URL(input.url)
  } catch {}
  return null
}

function isLegacyManualContinuation(input) {
  const url = requestUrlOf(input)
  return Boolean(
    url
      && url.pathname === "/api/telegram-bot"
      && url.searchParams.get("action") === "drive-repair-tick",
  )
}

// The legacy manual repair worker asks /api/telegram-bot?action=drive-repair-tick
// to continue after each internal batch window. Let that request resolve locally
// while this worker invocation still has execution budget instead of creating
// a recursive Vercel HTTP chain. AsyncLocalStorage keeps this interception
// scoped to the current repair job so unrelated fetches remain untouched.
globalThis.fetch = async function scopedFetch(input, init) {
  const state = continuationScope.getStore()
  if (state?.captureContinuation && isLegacyManualContinuation(input)) {
    state.continuationRequested = true
    return json({ ok: true, manual_drive_repair: true, accepted: true, local_continuation: true }, 202)
  }
  return nativeFetch(input, init)
}

async function triggerDirectWorker(request, jobId) {
  const secret = String(process.env.AUTOMATION_SECRET || "")
  const url = new URL("/api/manual-drive-repair-worker", request.url)
  url.searchParams.set("jobId", jobId)
  const response = await nativeFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Direct Drive repair continuation failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ""}`)
  }
}

async function runFlattenedManualRepair(db, jobId, request) {
  const startedAt = Date.now()
  let continuationRequested = false

  do {
    const state = {
      captureContinuation: true,
      continuationRequested: false,
    }

    await continuationScope.run(state, () => continueManualDriveRepair(db, jobId))
    continuationRequested = state.continuationRequested
  } while (continuationRequested && Date.now() - startedAt < OUTER_WORKER_BUDGET_MS)

  // If the job still needs work after this invocation's budget, create only
  // one direct worker hop. This keeps Vercel's recursion depth tiny even for
  // hundreds of classes and large retry queues.
  if (continuationRequested) {
    await triggerDirectWorker(request, jobId)
  }
}

export default async function middleware(request, context) {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405)
  if (!authorized(request)) return json({ ok: false, error: "Invalid automation secret" }, 401)
  if (!context?.waitUntil) return json({ ok: false, error: "Background execution context is unavailable" }, 503)

  const url = new URL(request.url)
  const body = await request.json().catch(() => ({}))
  const jobId = String(url.searchParams.get("jobId") || body?.jobId || "").trim()
  if (!jobId) return json({ ok: false, error: "Missing Drive repair jobId" }, 400)

  const { db } = getAdminServices()
  context.waitUntil(
    runFlattenedManualRepair(db, jobId, request).catch((error) => {
      console.error("Manual Drive repair background worker failed:", error)
    }),
  )

  return json({ ok: true, manual_drive_repair: true, jobId, accepted: true }, 202)
}

export const config = {
  matcher: "/api/manual-drive-repair-worker",
  runtime: "nodejs",
}
