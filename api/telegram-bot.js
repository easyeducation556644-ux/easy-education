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
import { resumeLatestDriveRepair, retryLatestFailedDriveRepair, startManualDriveRepair } from "../server/bot/manual-drive-repair.js"
import { stableId } from "../server/bot/crypto.js"

const SESSION_COLLECTION = "botSessions"
const JOB_COLLECTION = "botJobs"
const CONTROL_COLLECTION = "botManualRepairControls"
const MANUAL_JOB_TYPE = "manual_drive_resource_repair"
const CANCELLED_MANUAL_JOB_TYPE = "manual_drive_resource_repair_cancelled"

function plainDate(value) {
  if (!value) return null
  if (typeof value.toDate === "function") return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return value
}

async function studioOverview(db) {
  const [accountsSnap, snapshotsSnap, mappingsSnap, jobsSnap, storageSnap] = await Promise.all([
    db.collection("botPlatformAccounts").get(),
    db.collection("botSourceSnapshots").get(),
    db.collection("botCourseMappings").get(),
    db.collection("botJobs").orderBy("updatedAt", "desc").limit(30).get().catch(() => db.collection("botJobs").limit(30).get()),
    db.collection("botStorageAccounts").get(),
  ])
  const accounts = accountsSnap.docs.map((doc) => {
    const item = doc.data()
    return { id: doc.id, platform: item.platform, label: item.label || item.roll || "Source account", status: item.status || "saved", courseCount: Number(item.courseCount || 0) }
  })
  const snapshots = snapshotsSnap.docs.map((doc) => {
    const item = doc.data()
    return {
      id: doc.id, accountId: item.accountId, platform: item.platform, sourceCourseId: String(item.sourceCourseId || ""),
      title: item.sourceCourseTitle || "Untitled source course", classCount: Number(item.classCount || 0),
      sections: Array.isArray(item.sections) ? item.sections.map((section) => ({ key: String(section.key || section.id || section.title || ""), title: section.title || section.name || section.key || "Content", count: Number(section.count || 0) })) : [],
      updatedAt: plainDate(item.updatedAt || item.scannedAt),
    }
  })
  const mappings = mappingsSnap.docs.map((doc) => {
    const item = doc.data()
    return { id: doc.id, platform: item.platform, accountId: item.accountId, sourceCourseId: String(item.sourceCourseId || ""), sourceCourseTitle: item.sourceCourseTitle, sourceSectionKey: item.sourceSectionKey, sourceSectionTitle: item.sourceSectionTitle, eeCourseId: item.eeCourseId, eeCourseTitle: item.eeCourseTitle, destinationType: item.destinationType, classGroupId: item.classGroupId || null, selectedCount: Number(item.selectedCount || 0), readyCount: Number(item.readyCount || 0), pendingCount: Number(item.pendingCount || 0), updatedAt: plainDate(item.updatedAt) }
  })
  const jobs = jobsSnap.docs.map((doc) => { const item = doc.data(); return { id: doc.id, type: item.type, status: item.status, mappingId: item.mappingId || null, attempts: Number(item.attempts || 0), error: item.error || item.lastError || null, updatedAt: plainDate(item.updatedAt || item.createdAt) } })
  const storage = storageSnap.docs.map((doc) => { const item = doc.data(); return { id: doc.id, provider: item.provider, email: item.email, displayName: item.displayName || item.email, status: item.status || "ready", isDefault: Boolean(item.isDefault), isFull: Boolean(item.isFull), quotaLimit: Number(item.quotaLimit || 0), quotaUsage: Number(item.quotaUsage || 0), rootFolderId: item.rootFolderId || null } })
  return { accounts, snapshots, mappings, jobs, storage, updatedAt: new Date().toISOString() }
}

async function handleStudioRequest(req, res) {
  if (!validAutomationSecret(req)) return res.status(401).json({ ok: false, error: "Invalid studio secret" })
  const { db } = getAdminServices()
  const action = requestAction(req)
  try {
    if (action === "studio-overview") return res.status(200).json({ ok: true, ...(await studioOverview(db)) })
    if (action === "studio-map") {
      const source = req.body?.source || {}; const destination = req.body?.destination || {}
      if (!source.snapshotId || !source.sectionKey || !destination.courseId || !destination.courseTitle) return res.status(400).json({ ok: false, error: "Source section and destination course are required" })
      const snapshotDoc = await db.collection("botSourceSnapshots").doc(String(source.snapshotId)).get()
      if (!snapshotDoc.exists) return res.status(404).json({ ok: false, error: "Source snapshot was not found" })
      const snapshot = snapshotDoc.data()
      const id = stableId(snapshot.platform, snapshot.sourceCourseId, destination.courseId, source.sectionKey, "main")
      await db.collection("botCourseMappings").doc(id).set({
        platform: snapshot.platform, accountId: snapshot.accountId, sourceCourseId: String(snapshot.sourceCourseId), sourceCourseTitle: snapshot.sourceCourseTitle,
        sourceSectionKey: String(source.sectionKey), sourceSectionTitle: source.sectionTitle || source.sectionKey,
        eeCourseId: String(destination.courseId), eeCourseTitle: destination.courseTitle, eeCourseType: destination.courseType || "subject",
        destinationType: "main", classGroupId: null, classGroupTitle: "", snapshotCount: Number(snapshot.classCount || 0),
        updatedBy: "content-studio", updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return res.status(200).json({ ok: true, mappingId: id })
    }
    if (action === "studio-sync") {
      const mappingId = String(req.body?.mappingId || "")
      if (!mappingId || !(await db.collection("botCourseMappings").doc(mappingId).get()).exists) return res.status(404).json({ ok: false, error: "Mapping was not found" })
      const jobRef = db.collection("botJobs").doc(`studio_${stableId(mappingId, Date.now())}`)
      await jobRef.set({ type: "scheduled_mapping_sync", status: "queued", mappingId, attempts: 0, requestedBy: "content-studio", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return res.status(202).json({ ok: true, jobId: jobRef.id, status: "queued" })
    }
    return res.status(404).json({ ok: false, error: "Unknown studio action" })
  } catch (error) {
    console.error("Content Studio request failed:", error)
    return res.status(500).json({ ok: false, error: error.message || "Content Studio request failed" })
  }
}

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

function controlRef(db, chatId) {
  return db.collection(CONTROL_COLLECTION).doc(String(chatId))
}

function isQuotaError(error) {
  return Number(error?.code) === 8 || /resource_exhausted|quota exceeded/i.test(String(error?.message || error || ""))
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

async function persistCancelMarker(db, chatId, telegramUserId) {
  const cancelEpochMs = Date.now()
  const batch = db.batch()
  batch.set(controlRef(db, chatId), {
    cancelRequested: true,
    cancelEpochMs,
    cancelledByTelegramUserId: String(telegramUserId || ""),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  // /cancel also exits any in-progress Telegram wizard, without needing a read.
  batch.delete(db.collection(SESSION_COLLECTION).doc(String(chatId)))
  await batch.commit()
  return cancelEpochMs
}

async function cancelActiveManualRepairsBestEffort(db, chatId, telegramUserId) {
  const snapshot = await db.collection(JOB_COLLECTION)
    .where("notificationChatId", "==", String(chatId))
    .limit(20)
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
    // Important: save cancellation first. This uses writes only, so an exhausted
    // Firestore read quota cannot prevent the stop request from being persisted.
    await persistCancelMarker(db, chatId, userId)

    let cancelled = []
    let readQuotaUnavailable = false
    try {
      cancelled = await cancelActiveManualRepairsBestEffort(db, chatId, userId)
    } catch (error) {
      if (!isQuotaError(error)) throw error
      readQuotaUnavailable = true
      console.warn("Manual Drive repair active-job lookup skipped because Firestore read quota is exhausted")
    }

    const lines = ["🛑 Cancel request saved"]
    if (cancelled.length) {
      const latest = cancelled[0]
      lines.push(
        `Jobs stopped now: ${cancelled.length}`,
        `Scanned before cancel: ${Number(latest.cursor || 0)}/${Number(latest.total || 0)}`,
        `Repaired before cancel: ${Number(latest.repaired || 0)}`,
      )
    } else if (readQuotaUnavailable) {
      lines.push("Firestore read quota is currently exhausted, so the exact running-job count cannot be read.")
    } else {
      lines.push("No active Drive repair job was found.")
    }
    lines.push("No new repair batch will continue from this cancelled run. A network/upload request already in flight may finish first.")

    await sendMessage(chatId, lines.join("\n")).catch(() => {})
    return res.status(200).json({ ok: true, cancelled: true, jobsStopped: cancelled.length, readQuotaUnavailable })
  } catch (error) {
    console.error("Manual Drive repair cancellation failed:", error)
    const quota = isQuotaError(error)
    await sendMessage(
      chatId,
      quota
        ? "⚠️ Firestore write quota is exhausted, so the cancel marker could not be saved. The background worker is also unable to make database progress until quota becomes available."
        : `⚠️ Cancel request could not be saved: ${error.message || error}`,
    ).catch(() => {})
    return res.status(200).json({ ok: true, cancel_failed: true })
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
    // A deliberate new repair run supersedes any older /cancel marker.
    await controlRef(db, chatId).delete().catch((error) => {
      if (!isQuotaError(error)) console.warn("Could not clear old manual repair cancel marker:", error)
    })

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

async function handleRetryFailedCallback(req, res, callback) {
  const chatId = callback.message?.chat?.id
  const userId = callback.from?.id
  if (!chatId || !userId) return res.status(200).json({ ok: true })
  if (!validWebhookSecret(req)) return res.status(401).json({ ok: false, error: "Invalid webhook secret" })
  if (callback.message?.chat?.type !== "private" || !isAllowedTelegramUser(userId)) return legacyHandler(req, res)

  await answerCallback(callback.id, "Retrying failed classes only").catch(() => {})
  await clearInlineKeyboard(chatId, callback.message?.message_id).catch(() => {})
  const { db } = getAdminServices()
  try {
    await controlRef(db, chatId).delete().catch(() => {})
    const retry = await retryLatestFailedDriveRepair(db, chatId, userId)
    await triggerImmediateWorker(req, retry.jobId)
    return res.status(200).json({ ok: true, failed_only_retry: true, ...retry })
  } catch (error) {
    await sendMessage(chatId, `❌ ${error.message || "Failed classes could not be retried"}`).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}

async function handleResumeCommand(req, res, message) {
  const chatId = message.chat?.id
  const userId = message.from?.id
  if (!chatId || !userId) return legacyHandler(req, res)
  if (!validWebhookSecret(req)) return res.status(401).json({ ok: false, error: "Invalid webhook secret" })
  if (message.chat?.type !== "private" || !isAllowedTelegramUser(userId)) return legacyHandler(req, res)
  const { db } = getAdminServices()
  try {
    await controlRef(db, chatId).delete().catch(() => {})
    const resumed = await resumeLatestDriveRepair(db, chatId, userId)
    await triggerImmediateWorker(req, resumed.jobId)
    return res.status(200).json({ ok: true, resumed: true, ...resumed })
  } catch (error) {
    await sendMessage(chatId, `❌ ${error.message || "Drive repair could not be resumed"}`).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}

export default async function handler(req, res) {
  if (["studio-overview", "studio-map", "studio-sync"].includes(requestAction(req))) return handleStudioRequest(req, res)
  if (req.method === "POST" && requestAction(req) === "drive-repair-tick") {
    return runContinuationRequest(req, res)
  }

  const message = req.body?.message
  const command = String(message?.text || "").trim().split(/\s+/)[0].toLowerCase()
  if (req.method === "POST" && command === "/resume") {
    return handleResumeCommand(req, res, message)
  }
  if (req.method === "POST" && command === "/cancel") {
    return handleCancelCommand(req, res, message)
  }

  const callback = req.body?.callback_query
  if (req.method === "POST" && String(callback?.data || "") === "resources:retry_failed") {
    return handleRetryFailedCallback(req, res, callback)
  }
  if (req.method === "POST" && String(callback?.data || "") === "resources:repair") {
    return handleManualRepairCallback(req, res, callback)
  }

  return legacyHandler(req, res)
}
