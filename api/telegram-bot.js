import legacyHandler from "./telegram-bot-core.js"
import { getAdminServices } from "./utils/firebase-admin.js"
import {
  answerCallback,
  button,
  clearInlineKeyboard,
  isAllowedTelegramUser,
  keyboard,
  sendMessage,
} from "../server/bot/telegram.js"
import {
  continueManualDriveRepair,
  startManualDriveRepair,
} from "../server/bot/manual-drive-repair.js"

const SESSION_COLLECTION = "botSessions"

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

async function runContinuationRequest(req, res) {
  if (!validAutomationSecret(req)) return res.status(401).json({ ok: false, error: "Invalid automation secret" })
  const jobId = String(req.query?.jobId || req.body?.jobId || "").trim()
  if (!jobId) return res.status(400).json({ ok: false, error: "Missing Drive repair jobId" })

  const { db } = getAdminServices()
  res.status(202).json({ ok: true, manual_drive_repair: true, jobId })

  try {
    await continueManualDriveRepair(db, jobId)
  } catch (error) {
    console.error("Manual Drive repair continuation failed:", error)
  }
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

    res.status(200).json({
      ok: true,
      manual_drive_repair: true,
      jobId: started.manualDriveRepairJobId,
      running: Boolean(started.shouldRun),
    })

    if (started.shouldRun) {
      try {
        await continueManualDriveRepair(db, started.manualDriveRepairJobId)
      } catch (error) {
        console.error("Manual Drive repair worker failed:", error)
      }
    }
    return
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

  const callback = req.body?.callback_query
  if (req.method === "POST" && String(callback?.data || "") === "resources:repair") {
    return handleManualRepairCallback(req, res, callback)
  }

  return legacyHandler(req, res)
}
