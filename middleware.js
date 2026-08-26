import { getAdminServices } from "./api/utils/firebase-admin.js"
import { continueManualDriveRepair } from "./server/bot/manual-drive-repair.js"

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

function jobIdFrom(url, body = {}) {
  return String(url.searchParams.get("jobId") || body?.jobId || "").trim()
}

async function acceptManualWorker(request, context) {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405)
  if (!authorized(request)) return json({ ok: false, error: "Invalid automation secret" }, 401)
  if (!context?.waitUntil) return json({ ok: false, error: "Background execution context is unavailable" }, 503)

  const url = new URL(request.url)
  const body = await request.json().catch(() => ({}))
  const jobId = jobIdFrom(url, body)
  if (!jobId) return json({ ok: false, error: "Missing Drive repair jobId" }, 400)

  const { db } = getAdminServices()
  context.waitUntil(
    continueManualDriveRepair(db, jobId).catch((error) => {
      console.error("Manual Drive repair background worker failed:", error)
    }),
  )

  return json({ ok: true, manual_drive_repair: true, jobId, accepted: true }, 202)
}

export default async function middleware(request, context) {
  const url = new URL(request.url)

  if (url.pathname === "/api/manual-drive-repair-worker") {
    return acceptManualWorker(request, context)
  }

  // Manual continuation used to enter api/telegram-bot.js, which then called
  // /api/manual-drive-repair-worker again. Repeating that two-hop cycle caused
  // Vercel's recursion guard to return 508 INFINITE_LOOP_DETECTED. Intercept
  // the continuation here and run the persisted job directly in waitUntil.
  if (url.pathname === "/api/telegram-bot" && url.searchParams.get("action") === "drive-repair-tick") {
    return acceptManualWorker(request, context)
  }

  // Returning no response lets ordinary Telegram webhook traffic continue to
  // api/telegram-bot.js unchanged.
  return undefined
}

export const config = {
  matcher: ["/api/manual-drive-repair-worker", "/api/telegram-bot"],
  runtime: "nodejs",
}
