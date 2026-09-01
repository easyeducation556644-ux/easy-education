import { FieldValue } from "firebase-admin/firestore"
import legacyHandler from "../server/telegram-bot-core.js"
import { getAdminServices, getOperationsServices } from "./utils/firebase-admin.js"
import {
  answerCallback,
  button,
  clearInlineKeyboard,
  isAllowedTelegramUser,
  keyboard,
  sendMessage,
} from "../server/bot/telegram.js"
import { resumeLatestDriveRepair, retryLatestFailedDriveRepair, startManualDriveRepair } from "../server/bot/manual-drive-repair.js"
import { createSignedState, encryptSecret, stableId } from "../server/bot/crypto.js"
import {
  browseGoogleDriveFolder,
  browseGoogleDriveTrash,
  createGoogleDriveFolder,
  disconnectGoogleDriveAccount,
  googleAuthorizationUrl,
  listGoogleDriveAccounts,
  moveGoogleDriveItem,
  permanentlyDeleteGoogleDriveItem,
  renameGoogleDriveItem,
  restoreGoogleDriveItem,
  setDefaultGoogleDriveAccount,
  trashGoogleDriveItem,
} from "../server/bot/google-drive.js"
import { listUdvashCoursesV2, loginUdvashV2 } from "../server/bot/platforms/udvash-v2.js"
import {
  controlOpsTask,
  createOpsPreview,
  createOpsTask,
  OPS_ACTIONS,
  opsTaskDetail,
  opsTaskSummaries,
  opsSourceTree,
  refreshOpsSourceAccount,
  retryOpsFailures,
  runOpsTaskBatch,
  scanOpsSourceCourse,
  sweepOpsTasks,
} from "../server/ops/engine.js"

const SESSION_COLLECTION = "botSessions"
const JOB_COLLECTION = "botJobs"
const CONTROL_COLLECTION = "botManualRepairControls"
const MANUAL_JOB_TYPE = "manual_drive_resource_repair"
const CANCELLED_MANUAL_JOB_TYPE = "manual_drive_resource_repair_cancelled"
const EE_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function plainDate(value) {
  if (!value) return null
  if (typeof value.toDate === "function") return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return value
}

async function eeCatalog(contentDb, opsDb) {
  const cacheRef = opsDb.collection("opsCatalogCache").doc("ee-tree-v1")
  const cached = await cacheRef.get()
  if (cached.exists && Number(cached.data().expiresAtMs || 0) > Date.now() && Array.isArray(cached.data().courses)) return cached.data().courses
  const [coursesSnap, classesSnap, groupsSnap] = await Promise.all([
    contentDb.collection("courses").get(),
    contentDb.collection("classes").get(),
    contentDb.collection("classGroups").get(),
  ])
  const classes = classesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const groups = groupsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const groupIds = new Set(groups.map((item) => item.id))
  const courses = coursesSnap.docs.map((doc) => {
    const item = doc.data(); const rows = classes.filter((row) => String(row.courseId || "") === doc.id)
    const seen = new Map()
    rows.forEach((row) => { const key = [row.sourcePlatform, row.sourceCourseId, row.sourceClassId].filter(Boolean).join(":"); if (key) seen.set(key, (seen.get(key) || 0) + 1) })
    const duplicateCount = [...seen.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0)
    const orphanedCount = rows.filter((row) => row.classGroupId && !groupIds.has(String(row.classGroupId))).length
    const missingResourceCount = rows.filter((row) => !Array.isArray(row.resourceLinks) || row.resourceLinks.length === 0 || row.resourceLinks.some((resource) => resource?.storageStatus === "failed" || resource?.storageError)).length
    const directSourceCount = rows.filter((row) => Array.isArray(row.resourceLinks) && row.resourceLinks.some((resource) => /udvash-unmesh/i.test(String(resource?.url || resource?.link || "")))).length
    return {
      id: doc.id,
      title: item.title || item.name || "Untitled course",
      type: item.type || "subject",
      classCount: rows.length,
      groups: groups.filter((group) => String(group.courseId || "") === doc.id).map((group) => ({ id: group.id, title: group.title || group.name || "Class card" })),
      diagnostics: { duplicateCount, orphanedCount, missingResourceCount, directSourceCount, needsRefactor: duplicateCount + orphanedCount + missingResourceCount + directSourceCount > 0 },
    }
  }).sort((a, b) => a.title.localeCompare(b.title))
  await cacheRef.set({ courses, expiresAtMs: Date.now() + EE_CATALOG_CACHE_TTL_MS, dirtyAtMs: 0, updatedAt: FieldValue.serverTimestamp() })
  return courses
}

async function studioOverview(context) {
  const { contentDb, opsDb } = context
  const [accountsSnap, snapshotsSnap, mappingsSnap, storageSnap, opsTasks, courses] = await Promise.all([
    opsDb.collection("botPlatformAccounts").get(),
    opsDb.collection("botSourceSnapshots").get(),
    opsDb.collection("botCourseMappings").get(),
    opsDb.collection("botStorageAccounts").get(),
    opsTaskSummaries(context),
    eeCatalog(contentDb, opsDb),
  ])
  const accounts = accountsSnap.docs.map((doc) => {
    const item = doc.data()
    return { id: doc.id, platform: item.platform, label: item.label || item.roll || "Source account", roll: item.roll || "", status: item.status || "saved", courseCount: Number(item.courseCount || 0), courses: Array.isArray(item.courses) ? item.courses : [], lastError: item.lastError || "" }
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
    return { id: doc.id, platform: item.platform, accountId: item.accountId, sourceSnapshotId: item.sourceSnapshotId || null, sourceCourseId: String(item.sourceCourseId || ""), sourceCourseTitle: item.sourceCourseTitle, sourceSectionKey: item.sourceSectionKey, sourceSectionTitle: item.sourceSectionTitle, eeCourseId: item.eeCourseId, eeCourseTitle: item.eeCourseTitle, eeCourseType: item.eeCourseType || "subject", destinationType: item.destinationType, classGroupId: item.classGroupId || null, classGroupTitle: item.classGroupTitle || "", selectedCount: Number(item.selectedCount || 0), readyCount: Number(item.readyCount || 0), pendingCount: Number(item.pendingCount || 0), updatedAt: plainDate(item.updatedAt) }
  })
  const storage = storageSnap.docs.map((doc) => { const item = doc.data(); return { id: doc.id, provider: item.provider, email: item.email, displayName: item.displayName || item.email, status: item.status || "ready", isDefault: Boolean(item.isDefault), isFull: Boolean(item.isFull), quotaLimit: Number(item.quotaLimit || 0), quotaUsage: Number(item.quotaUsage || 0), rootFolderId: item.rootFolderId || null } })
  return { courses, accounts, snapshots, mappings, jobs: [], storage, opsTasks, database: { operations: "easy-education-operations", content: "easy-education-real" }, updatedAt: new Date().toISOString() }
}

async function handleStudioRequest(req, res) {
  if (!validAutomationSecret(req)) return res.status(401).json({ ok: false, error: "Invalid studio secret" })
  const { db: contentDb } = getAdminServices()
  const { db: opsDb } = getOperationsServices()
  const context = { contentDb, opsDb }
  const action = requestAction(req)
  try {
    if (action === "studio-overview") return res.status(200).json({ ok: true, ...(await studioOverview(context)) })
    if (action === "studio-map") {
      const source = req.body?.source || {}; const destination = req.body?.destination || {}
      if (!source.snapshotId || !source.sectionKey || !destination.courseId || !destination.courseTitle) return res.status(400).json({ ok: false, error: "Source section and destination course are required" })
      const snapshotDoc = await opsDb.collection("botSourceSnapshots").doc(String(source.snapshotId)).get()
      if (!snapshotDoc.exists) return res.status(404).json({ ok: false, error: "Source snapshot was not found" })
      const snapshot = snapshotDoc.data()
      const destinationType = destination.groupId ? "group" : "main"
      const id = stableId(snapshot.platform, snapshot.sourceCourseId, destination.courseId, source.sectionKey, destinationType, destination.groupId || "")
      await opsDb.collection("botCourseMappings").doc(id).set({
        platform: snapshot.platform, accountId: snapshot.accountId, sourceSnapshotId: snapshotDoc.id, sourceCourseId: String(snapshot.sourceCourseId), sourceCourseTitle: snapshot.sourceCourseTitle,
        sourceSectionKey: String(source.sectionKey), sourceSectionTitle: source.sectionTitle || source.sectionKey,
        eeCourseId: String(destination.courseId), eeCourseTitle: destination.courseTitle, eeCourseType: destination.courseType || "subject",
        destinationType, classGroupId: destination.groupId || null, classGroupTitle: destination.groupTitle || "", snapshotCount: Number(snapshot.classCount || 0),
        updatedBy: "content-studio", updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return res.status(200).json({ ok: true, mappingId: id })
    }
    if (action === "studio-sync") {
      const mappingId = String(req.body?.mappingId || "")
      if (!mappingId || !(await opsDb.collection("botCourseMappings").doc(mappingId).get()).exists) return res.status(404).json({ ok: false, error: "Mapping was not found" })
      const jobRef = opsDb.collection("botJobs").doc(`studio_${stableId(mappingId, Date.now())}`)
      await jobRef.set({ type: "scheduled_mapping_sync", status: "queued", mappingId, attempts: 0, requestedBy: "content-studio", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return res.status(202).json({ ok: true, jobId: jobRef.id, status: "queued" })
    }
    if (action === "studio-cancel-job") {
      const jobId = String(req.body?.jobId || "")
      const ref = opsDb.collection("botJobs").doc(jobId); const snap = await ref.get()
      if (!snap.exists) return res.status(404).json({ ok: false, error: "Job was not found" })
      if (!["queued", "running"].includes(String(snap.data().status || ""))) return res.status(409).json({ ok: false, error: "Only queued or running jobs can be cancelled" })
      await ref.set({ status: "cancelled", cancelledBy: "content-studio", cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return res.status(200).json({ ok: true, jobId, status: "cancelled" })
    }
    if (action === "studio-retry-job") {
      const oldId = String(req.body?.jobId || ""); const old = await opsDb.collection("botJobs").doc(oldId).get()
      if (!old.exists) return res.status(404).json({ ok: false, error: "Job was not found" })
      const previous = old.data(); if (!previous.mappingId) return res.status(400).json({ ok: false, error: "This job has no course mapping" })
      const ref = opsDb.collection("botJobs").doc(`studio_retry_${stableId(oldId, Date.now())}`)
      await ref.set({ type: "scheduled_mapping_sync", status: "queued", mappingId: previous.mappingId, platform: previous.platform || null, attempts: 0, retriedFrom: oldId, requestedBy: "content-studio", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return res.status(202).json({ ok: true, jobId: ref.id, status: "queued" })
    }
    if (action === "studio-delete-mapping") {
      const mappingId = String(req.body?.mappingId || "")
      if (!mappingId) return res.status(400).json({ ok: false, error: "Mapping is required" })
      const active = await opsDb.collection("botJobs").where("mappingId", "==", mappingId).limit(30).get()
      if (active.docs.some((doc) => ["queued", "running"].includes(String(doc.data().status || "")))) return res.status(409).json({ ok: false, error: "Cancel the active job before deleting this mapping" })
      await opsDb.collection("botCourseMappings").doc(mappingId).delete()
      return res.status(200).json({ ok: true, mappingId, deleted: true })
    }
    if (action === "studio-drive-browse") return res.status(200).json({ ok: true, ...(await browseGoogleDriveFolder(opsDb, req.body?.accountId, req.body?.parentId)) })
    if (action === "studio-drive-trash") return res.status(200).json({ ok: true, ...(await browseGoogleDriveTrash(opsDb, req.body?.accountId)) })
    if (action === "studio-drive-folder") return res.status(200).json({ ok: true, folder: await createGoogleDriveFolder(opsDb, req.body?.accountId, req.body?.parentId, req.body?.name) })
    if (action === "studio-drive-connect-url") {
      const telegramUserId = String(process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((item) => item.trim()).find(Boolean)
      if (!telegramUserId || !isAllowedTelegramUser(telegramUserId)) return res.status(500).json({ ok: false, error: "No approved owner identity is configured for Drive OAuth" })
      const state = createSignedState({ purpose: "google-drive", telegramUserId, requestedBy: "content-studio" })
      return res.status(200).json({ ok: true, url: googleAuthorizationUrl(state) })
    }
    if (action === "studio-drive-rename") return res.status(200).json({ ok: true, item: await renameGoogleDriveItem(opsDb, req.body?.accountId, req.body?.fileId, req.body?.name) })
    if (action === "studio-drive-delete") return res.status(200).json({ ok: true, item: await trashGoogleDriveItem(opsDb, req.body?.accountId, req.body?.fileId) })
    if (action === "studio-drive-restore") return res.status(200).json({ ok: true, item: await restoreGoogleDriveItem(opsDb, req.body?.accountId, req.body?.fileId) })
    if (action === "studio-drive-permanent-delete") return res.status(200).json({ ok: true, item: await permanentlyDeleteGoogleDriveItem(opsDb, req.body?.accountId, req.body?.fileId) })
    if (action === "studio-drive-move") return res.status(200).json({ ok: true, item: await moveGoogleDriveItem(opsDb, req.body?.accountId, req.body?.fileId, req.body?.parentId) })
    if (action === "studio-drive-default") return res.status(200).json({ ok: true, account: await setDefaultGoogleDriveAccount(opsDb, req.body?.accountId) })
    if (action === "studio-drive-disconnect") return res.status(200).json({ ok: true, account: await disconnectGoogleDriveAccount(opsDb, req.body?.accountId) })
    if (action === "studio-refresh-storage") {
      const accounts = await listGoogleDriveAccounts(opsDb, { refresh: true })
      return res.status(200).json({ ok: true, count: accounts.length })
    }
    if (action === "studio-add-udvash") {
      const label = String(req.body?.label || "").trim(); const roll = String(req.body?.roll || "").trim(); const password = String(req.body?.password || "")
      if (!label || !roll || !password) return res.status(400).json({ ok: false, error: "Account name, registration number and password are required" })
      const auth = await loginUdvashV2({ roll, password })
      const courses = await listUdvashCoursesV2(auth)
      const id = stableId("udvash-account", roll)
      const compactCourses = courses.map((course) => ({ id: String(course.id), title: String(course.title || "Untitled course").slice(0, 180), type: course.type || "" }))
      await opsDb.collection("botPlatformAccounts").doc(id).set({
        platform: "udvash", label, roll, passwordEncrypted: encryptSecret(password), cookieEncrypted: encryptSecret(auth.cookie || ""), tokenEncrypted: encryptSecret(auth.token || ""),
        status: "ready", courseCount: compactCourses.length, courses: compactCourses, lastError: "", connectedBy: "content-studio", lastLoginAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return res.status(200).json({ ok: true, account: { id, label, roll, status: "ready", courseCount: courses.length } })
    }
    if (action === "studio-source-toggle") {
      const id = String(req.body?.accountId || ""); const enabled = Boolean(req.body?.enabled)
      if (!id) return res.status(400).json({ ok: false, error: "Source account is required" })
      await opsDb.collection("botPlatformAccounts").doc(id).set({ disabled: !enabled, status: enabled ? "ready" : "disabled", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return res.status(200).json({ ok: true, accountId: id, status: enabled ? "ready" : "disabled" })
    }
    if (action === "studio-source-delete") {
      const id = String(req.body?.accountId || "")
      if (!id) return res.status(400).json({ ok: false, error: "Source account is required" })
      const activeTasks = await opsDb.collection("opsTasks").where("mapping.accountId", "==", id).limit(20).get().catch(() => ({ docs: [] }))
      if (activeTasks.docs.some((doc) => ["queued", "running", "paused"].includes(String(doc.data().status || "")))) return res.status(409).json({ ok: false, error: "Cancel or finish this account's active tasks before deleting it" })
      await opsDb.collection("botPlatformAccounts").doc(id).delete()
      return res.status(200).json({ ok: true, accountId: id, deleted: true })
    }
    if (action === "studio-stop-all") {
      const jobs = await contentDb.collection("botJobs").limit(500).get(); const active = jobs.docs.filter((doc) => ["queued", "running"].includes(String(doc.data().status || "")))
      for (let start = 0; start < active.length; start += 400) { const batch = contentDb.batch(); active.slice(start, start + 400).forEach((doc) => batch.set(doc.ref, { status: "cancelled", cancelRequested: true, cancelledBy: "content-studio-stop-all", cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })); await batch.commit() }
      const controls = await contentDb.collection("botManualRepairControls").limit(100).get();
      for (const doc of controls.docs) await doc.ref.set({ cancelRequested: true, cancelEpochMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      const ops = await opsDb.collection("opsTasks").limit(500).get(); const activeOps = ops.docs.filter((doc) => ["queued", "running", "paused"].includes(String(doc.data().status || "")))
      for (let start = 0; start < activeOps.length; start += 400) { const batch = opsDb.batch(); activeOps.slice(start, start + 400).forEach((doc) => batch.set(doc.ref, { status: "cancelled", cancelRequested: true, leaseExpiresAtMs: 0, current: null, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })); await batch.commit() }
      await contentDb.collection("botAutomationSettings").doc("schedule").set({ overall: { enabled: false }, platforms: { udvash: { enabled: false } }, pausedBy: "content-studio-stop-all", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return res.status(200).json({ ok: true, stoppedJobs: active.length + activeOps.length, schedulerPaused: true })
    }
    if (action === "ops-preview") return res.status(200).json({ ok: true, preview: await createOpsPreview(context, req.body?.mappingId) })
    if (action === "ops-create-task") return res.status(201).json({ ok: true, task: await createOpsTask(context, req.body || {}) })
    if (action === "ops-worker") return res.status(200).json({ ok: true, task: await runOpsTaskBatch(context, req.body?.taskId || req.query?.taskId) })
    if (action === "ops-control-task") return res.status(200).json({ ok: true, task: await controlOpsTask(context, req.body || {}) })
    if (action === "ops-retry-failures") return res.status(201).json({ ok: true, task: await retryOpsFailures(context, req.body?.taskId, req.body?.name) })
    if (action === "ops-task-detail") return res.status(200).json({ ok: true, ...(await opsTaskDetail(context, req.body?.taskId, req.body?.limit)) })
    if (action === "ops-refresh-account") return res.status(200).json({ ok: true, ...(await refreshOpsSourceAccount(context, req.body?.accountId)) })
    if (action === "ops-scan-course") return res.status(200).json({ ok: true, snapshot: await scanOpsSourceCourse(context, req.body?.accountId, req.body?.courseId) })
    if (action === "ops-source-tree") return res.status(200).json({ ok: true, tree: await opsSourceTree(context, req.body?.snapshotId) })
    if (action === "ops-sweep") return res.status(200).json({ ok: true, ...(await sweepOpsTasks(context, req.body?.limit || 2)) })
    return res.status(404).json({ ok: false, error: "Unknown studio action" })
  } catch (error) {
    console.error("Content Studio request failed:", error)
    const quota = error?.code === 8 || error?.code === "RESOURCE_EXHAUSTED" || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(error?.message || ""))
    const status = quota ? 429 : Number(error?.statusCode || 500)
    return res.status(status).json({ ok: false, code: quota ? "DATABASE_QUOTA_EXHAUSTED" : error?.code || "STUDIO_ERROR", error: quota ? "Database quota is temporarily exhausted. No task was created; cached data is still safe." : error.message || "Content Studio request failed" })
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
  if (["studio-overview", "studio-map", "studio-sync", "studio-cancel-job", "studio-retry-job", "studio-delete-mapping", "studio-drive-browse", "studio-drive-trash", "studio-drive-folder", "studio-drive-connect-url", "studio-drive-rename", "studio-drive-delete", "studio-drive-restore", "studio-drive-permanent-delete", "studio-drive-move", "studio-drive-default", "studio-drive-disconnect", "studio-refresh-storage", "studio-add-udvash", "studio-source-toggle", "studio-source-delete", "studio-stop-all"].includes(requestAction(req)) || OPS_ACTIONS.has(requestAction(req))) return handleStudioRequest(req, res)
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
