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

export default async function middleware(request, context) {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405)
  if (!authorized(request)) return json({ ok: false, error: "Invalid automation secret" }, 401)

  const url = new URL(request.url)
  const body = await request.json().catch(() => ({}))
  const jobId = String(url.searchParams.get("jobId") || body?.jobId || "").trim()
  if (!jobId) return json({ ok: false, error: "Missing Drive repair jobId" }, 400)
  if (!context?.waitUntil) return json({ ok: false, error: "Background execution context is unavailable" }, 503)

  const { db } = getAdminServices()
  context.waitUntil(
    continueManualDriveRepair(db, jobId).catch((error) => {
      console.error("Manual Drive repair background worker failed:", error)
    }),
  )

  return json({ ok: true, manual_drive_repair: true, jobId, accepted: true }, 202)
}

export const config = {
  matcher: "/api/manual-drive-repair-worker",
  runtime: "nodejs",
}
