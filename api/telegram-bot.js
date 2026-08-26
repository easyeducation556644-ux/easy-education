import { FieldValue } from "firebase-admin/firestore"
import legacyHandler from "../server/telegram-bot-core.js"
import { getAdminServices } from "./utils/firebase-admin.js"
import {
  answerCallback,
  button,
  clearInlineKeyboard,
  isAllowedTelegramUser,
  keyboard,
  sendMessage,
} from "../server/bot/telegram.js"
import { startManualDriveRepair } from "../server/bot/manual-drive-repair.js"

const SESSION_COLLECTION = "botSessions"
const JOB_COLLECTION = "botJobs"
const MANUAL_JOB_TYPE = "manual_drive_resource_repair"
const CANCELLED_MANUAL_JOB_TYPE = "manual_drive_resource_repair_cancelled"

function requestAction(req) {
  return String(req.query?.action || "")
}

function validWebhookSecret(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || ""
  if (!expected) return false
  return (req.headers["x-telegram-bot-api-secret-token"] || "") === expected
}

function validAutomationSecret(req) {
  const expected = process.env.AUTOMATION_SECRET || ""
  return Boolean(expected) && String(req.headers.authorization || "") === `Bearer ${expected}`
}

function requestBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim()
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim()
  if (host) return `${proto}://${host}`
  return String(process.env.PUBLIC_APP_URL || process.env.TELEGRAM_WEBHOOK_URL || "")
    .replace(/\/api\/telegram-bot\/?$/, "")
    .replace(/\/$/, "")
}

async function triggerImmediateWorker(req, jobId) {
  const base = requestBaseUrl(req)
  const secret = String(process.env.AUTOMATION_SECRET || "")
  if (!base) throw new Error("Could not determine the public app URL for the manual Drive repair worker")
  if (!secret) throw new Error("AUTOMATION_SECRET is required for immediate Drive repair")

  const response = await fetch(`${base}/api/manual-drive-repair-worker?jobId=${encodeURIComponent(jobId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId }),
  })
  if (!response.ok) {
    const details = await response.text().catch(() => "")
    throw new Error(`Manual Drive repair worker could not start (${response.status})${details ? `: ${details.slice(0, 300)}` : ""}`)
  }
}

async function runContinuationRequest(req, res) {
  if (!validAutomationSecret(req)) return res.status(401).json({ ok: false, error: "Invalid automation secret" })
  const jobId = String(req.query?.jobId || req.body?.jobId || "").trim()
  if (!jobId) return res.status(400).json({ ok: false, error: "Missing Drive repair jobId" })

  try {
    await triggerImmediateWorker(req, jobId)
    return res.status(202).json({ ok: true, manual_drive_repair: true, jobId, worker_started: true })
  } catch (error) {
    console.error("Manual Drive repair continuation trigger failed:", error)
    return res.status(500).json({ ok: false, error: error.message || "Manual Drive repair worker could not start" })
  }
}

async function cancelActiveManualRepairs(db, chatId, telegramUserId) {
  const snapshot = await db.collection(JOB_COLLECTION)
    .where("notificationChatId", "==", String(chatId))
    .get()

  const active = snapshot.docs.filter((doc) => {
    const data = doc.data()
    return data.type === MANUAL_JOB_TYPE && ["queued", "running"].includes(String(data.status || ""))
  })

  if (!active.length) return []

  const batch = db.batch()
  active.forEach((doc) => {
    batch.set(doc.ref, {
      type: CANCELLED_MANUAL_JOB_TYPE,
      status: "cancelled",
      cancelledByTelegramUserId: String(telegramUserId || ""),
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
  await batch.commit()

  return active.map((doc) => ({ id: doc.id, ...doc.data() }))
}

async function handleCancelCommand(req, res, message) {
  const chatId = message.chat?.id
  const userId = message.from?.id
  if (!chatId || !userId) return legacyHandler(req, res)

  if (!validWebhookSecret(req)) return res.status(401).json({ ok: false, error: "Invalid webhook secret" })
  if (message.chat?.type !== "private") return legacyHandler(req, res)
  if (!isAllowedTelegramUser(userId)) return legacyHandler(req, res)

  const { db } = getAdminServices()
  try {
    const cancelled = await cancelActiveManualRepairs(db, chatId, userId)
    if (cancelled.length) {
      const latest = cancelled[0]
      await sendMessage(chatId, [
        "🛑 Current Drive resource repair cancelled",
        `Jobs cancelled: ${cancelled.length}`,
        `Scanned before cancel: ${Number(latest.cursor || 0)}/${Number(latest.total || 0)}`,
        `Repaired before cancel: ${Number(latest.repaired || 0)}`,
        "No new repair batch will start. A network/upload request that was already in flight may finish, but the job will not continue after that batch.",
      ].join("\n")).catch(() => {})
    } else {
      await sendMessage(chatId, "🛑 Cancelled. No active Drive repair job was running.").catch(() => {})
    }
  } catch (error) {
    console.error("Manual Drive repair cancellation failed:", error)
    await sendMessage(chatId, `⚠️ Cancel request could not stop the background job: ${error.message || error}`).catch(() => {})
  }

  return legacyHandler(req, res)
}

async function handleManualRepairCallback(req, res, callback) {
  const chatId = callback.message?.chat?.id
  const userId = callback.from?.id
  if (!chatId || !userId) return res.status(200).json({ ok: true })

  if (!validWebhookSecret(req)) return res.status(401).json({ ok: false, error: "Invalid webhook secret" })
  if (callback.message?.chat?.type !== "private") {
    await sendMessage(chatId, "For security, this bot can only be used in a private chat.").catch(() => {})
    return res.status(200).json({ ok: true })
  }
  if (!isAllowedTelegramUser(userId)) {
    await sendMessage(chatId, `Access denied.\n\nYour Telegram user ID: ${userId}\nAsk an administrator to add this ID to the approved access list.`).catch(() => {})
    return res.status(200).json({ ok: true })
  }

  await answerCallback(callback.id, "Starting Drive resource repair now").catch(() => {})
  await clearInlineKeyboard(chatId, callback.message?.message_id).catch(() => {})

  const { db } = getAdminServices()
  try {
    const sessionSnapshot = await db.collection(SESSION_COLLECTION).doc(String(chatId)).get()
    const session = sessionSnapshot.exists ? sessionSnapshot.data() : {}
    const started = await startManualDriveRepair(db, chatId, userId, session)

    if (started.shouldRun) {
      await triggerImmediateWorker(req, started.manualDriveRepairJobId)
    }

    return res.status(200).json({
      ok: true,
      manual_drive_repair: true,
      jobId: started.manualDriveRepairJobId,
      worker_started: Boolean(started.shouldRun),
    })
  } catch (error) {
    console.error("Manual Drive repair start failed:", error)
    await sendMessage(
      chatId,
      `❌ ${error.message || "Drive resource repair could not start"}`,
      keyboard([[button("‹ Main menu", "home")]]),
    ).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}

export default async function handler(req, res) {
  if (req.method === "POST" && requestAction(req) === "drive-repair-tick") {
    return runContinuationRequest(req, res)
  }

  const message = req.body?.message
  const command = String(message?.text || "").trim().split(/\s+/)[0].toLowerCase()
  if (req.method === "POST" && command === "/cancel") {
    return handleCancelCommand(req, res, message)
  }

  const callback = req.body?.callback_query
  if (req.method === "POST" && String(callback?.data || "") === "resources:repair") {
    return handleManualRepairCallback(req, res, callback)
  }

  return legacyHandler(req, res)
}
