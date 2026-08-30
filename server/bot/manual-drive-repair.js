import { FieldValue } from "firebase-admin/firestore"
import { decryptSecret, encryptSecret, stableId } from "./crypto.js"
import { button, keyboard, sendMessage } from "./telegram.js"
import {
  getUdvashClassMediaBulk,
  loginUdvashV2,
  normalizeContentTypeTitle,
} from "./platforms/udvash-v2.js"
import {
  listGoogleDriveAccounts,
  persistResourceLinksToDrive,
} from "./google-drive.js"

const ACCOUNT_COLLECTION = "botPlatformAccounts"
const MAPPING_COLLECTION = "botCourseMappings"
const SNAPSHOT_COLLECTION = "botSourceSnapshots"
const JOB_COLLECTION = "botJobs"
const MANUAL_JOB_TYPE = "manual_drive_resource_repair"
const PUBLIC_SYNC_FEED_LIMIT = 1000
const MEDIA_CONCURRENCY = 3
const BATCH_SIZE = 1
const MAX_CLASS_ATTEMPTS = 3
const MAX_BATCHES_PER_INVOCATION = 1
const WORKER_BUDGET_MS = 90_000
const RUNNING_STALE_MS = 90_000
const RESOURCE_PARSER_VERSION = 2

const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const serverNow = () => FieldValue.serverTimestamp()

function normalizedSection(value) {
  return normalizeContentTypeTitle(String(value || "")).toLowerCase()
}

function sourceSectionOfClass(item) {
  return normalizedSection(item.sourceSectionKey || item.sourceSection || item.sectionTitle || "")
}

function classMatchesDestination(item, mapping) {
  if (mapping.destinationType === "archive") return item.isArchived === true
  if (mapping.destinationType === "group") {
    return item.isArchived !== true && String(item.classGroupId || "") === String(mapping.classGroupId || "")
  }
  return item.isArchived !== true && !item.classGroupId
}

function importedClassMatches(item, mapping) {
  return item.sourcePlatform === mapping.platform
    && String(item.sourceCourseId || "") === String(mapping.sourceCourseId || "")
    && classMatchesDestination(item, mapping)
    && sourceSectionOfClass(item) === normalizedSection(mapping.sourceSectionKey || mapping.sourceSectionTitle)
}

function selectedSourceClasses(snapshot, mapping) {
  const key = normalizedSection(mapping.sourceSectionKey || mapping.sourceSectionTitle)
  return asArray(snapshot.classes).filter((item) => normalizedSection(item.sectionKey || item.sectionTitle) === key)
}

function mappingIdForSession(session) {
  return stableId(
    session.platform,
    session.sourceCourseId,
    session.eeCourseId,
    session.sourceSectionKey,
    session.destinationType,
    session.classGroupId || "",
  )
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === "function") return value.toMillis()
  if (Number.isFinite(value)) return Number(value)
  if (Number.isFinite(value?._seconds)) return Number(value._seconds) * 1000
  if (Number.isFinite(value?.seconds)) return Number(value.seconds) * 1000
  return 0
}

function isStaleRunningJob(job) {
  if (job?.status !== "running") return false
  const stamp = timestampMillis(job.updatedAt) || timestampMillis(job.startedAt)
  return !stamp || Date.now() - stamp > RUNNING_STALE_MS
}

function truncate(value, limit = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function classTitle(item) {
  return truncate(item?.title || item?.classTitle || item?.sourceClassId || "Untitled class", 90)
}

function cleanResourceLinks(value) {
  return asArray(value)
    .map((item, index) => ({
      label: String(item?.label || item?.title || `Class note ${index + 1}`).trim(),
      url: String(item?.url || item?.link || "").trim(),
      ...(item?.driveFileId ? { driveFileId: String(item.driveFileId) } : {}),
      ...(item?.storageStatus ? { storageStatus: String(item.storageStatus) } : {}),
      ...(item?.storageError ? { storageError: String(item.storageError) } : {}),
    }))
    .filter((item) => item.label && item.url)
}

async function loadSnapshot(db, id) {
  if (!id) throw new Error("The source snapshot is unavailable. Open the mapping and start Drive repair again")
  const ref = db.collection(SNAPSHOT_COLLECTION).doc(id)
  const [summarySnap, chunksSnap] = await Promise.all([ref.get(), ref.collection("chunks").get()])
  if (!summarySnap.exists) throw new Error("The source snapshot has expired. Refresh the source course and try again")
  const chunks = chunksSnap.docs
    .map((doc) => doc.data())
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
  return { id, ...summarySnap.data(), classes: chunks.flatMap((chunk) => asArray(chunk.items)) }
}

async function existingEeClasses(db, eeCourseId) {
  const snap = await db.collection("classes").where("courseId", "==", eeCourseId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

async function getAccount(db, accountId) {
  const snap = await db.collection(ACCOUNT_COLLECTION).doc(accountId).get()
  if (!snap.exists) throw new Error("The selected source account could not be found")
  return { id: snap.id, ...snap.data() }
}

function readSavedAuth(account) {
  let cookie = ""
  let token = ""
  try { cookie = decryptSecret(account.cookieEncrypted || "") } catch {}
  try { token = decryptSecret(account.tokenEncrypted || "") } catch {}
  return { cookie, token }
}

async function saveAuthState(db, account, auth, extra = {}) {
  await db.collection(ACCOUNT_COLLECTION).doc(account.id).set({
    cookieEncrypted: auth.cookie ? encryptSecret(auth.cookie) : account.cookieEncrypted || "",
    tokenEncrypted: auth.token ? encryptSecret(auth.token) : account.tokenEncrypted || "",
    status: "ready",
    lastError: "",
    lastSessionAt: serverNow(),
    updatedAt: serverNow(),
    ...extra,
  }, { merge: true })
}

function isSessionExpired(error) {
  return error?.code === "UDVASH_SESSION_EXPIRED"
    || /session expired|login করতে হবে|account\/login|account\/password/i.test(String(error?.message || error || ""))
}

async function freshLogin(db, account) {
  const password = decryptSecret(account.passwordEncrypted)
  const auth = await loginUdvashV2({ roll: account.roll, password })
  await saveAuthState(db, account, auth, { lastLoginAt: serverNow() })
  return auth
}

async function withAccountAuth(db, account, operation) {
  let auth = readSavedAuth(account)
  let didLogin = false
  if (!auth.cookie && !auth.token) {
    auth = await freshLogin(db, account)
    didLogin = true
  }

  try {
    const result = await operation(auth)
    await saveAuthState(db, account, auth)
    return result
  } catch (error) {
    if (!didLogin && isSessionExpired(error)) {
      auth = await freshLogin(db, account)
      const result = await operation(auth)
      await saveAuthState(db, account, auth)
      return result
    }
    await db.collection(ACCOUNT_COLLECTION).doc(account.id).set({
      lastError: truncate(error?.message || error, 500),
      updatedAt: serverNow(),
    }, { merge: true }).catch(() => {})
    throw error
  }
}

async function storeResolvedResources(db, mapping, sourceClasses, mediaResults, sourceCookie) {
  const sourceById = new Map(sourceClasses.map((item) => [String(item.sourceClassId || ""), item]))
  for (const result of mediaResults) {
    const resources = cleanResourceLinks(result?.media?.resourceLinks)
    if (!resources.length) continue
    const sourceClass = sourceById.get(String(result.sourceClassId || "")) || {}
    result.media.resourceLinks = await persistResourceLinksToDrive(db, resources, {
      platform: mapping.platform,
      sourceCourseId: mapping.sourceCourseId,
      sourceCourseTitle: mapping.sourceCourseTitle,
      sourceClassId: result.sourceClassId,
      subjectTitle: sourceClass.subjectTitle,
      chapterTitle: sourceClass.chapterTitle,
      sourceCookie,
    })
  }
  return mediaResults
}

async function publishClassSyncEvents(db, classIds) {
  const ids = [...new Set(asArray(classIds).map((id) => String(id || "").trim()).filter(Boolean))]
  if (!ids.length) return 0
  const ref = db.collection("settings").doc("contentSync")
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const current = snapshot.exists ? snapshot.data() : {}
    let seq = Number(current.seq || 0)
    const previousEvents = Array.isArray(current.events) ? current.events : []
    const stamp = Date.now()
    const nextEvents = ids.map((docId, index) => {
      seq += 1
      return {
        eventId: `classes:${docId}:bot-changed-${stamp.toString(36)}-${index}`.slice(0, 220),
        collection: "classes",
        docId,
        action: "changed",
        scope: "public",
        seq,
        createdAt: stamp,
      }
    })
    transaction.set(ref, {
      type: "content-sync",
      seq,
      events: [...previousEvents, ...nextEvents].slice(-PUBLIC_SYNC_FEED_LIMIT),
      updatedAt: Date.now(),
    }, { merge: true })
  })
  return ids.length
}

function retryEntry(sourceClass, attempts, error) {
  return {
    sourceClassId: String(sourceClass?.sourceClassId || ""),
    title: classTitle(sourceClass),
    attempts: Number(attempts || 0),
    lastError: truncate(error, 500),
  }
}

function finalFailureEntry(sourceClass, attempts, error) {
  return {
    sourceClassId: String(sourceClass?.sourceClassId || ""),
    title: classTitle(sourceClass),
    attempts: Number(attempts || 0),
    error: truncate(error, 500),
  }
}

function sourceErrorForResult(sourceClass, existing, result) {
  if (!existing) return "Imported Easy Education class record was not found for this source class"
  if (!result) return "Udvash did not return a media/resource result for this class"
  if (result.error) return String(result.error)
  const resources = cleanResourceLinks(result.media?.resourceLinks)
  const failedResource = resources.find((item) => item.storageStatus === "failed")
  if (failedResource) {
    return `Drive storage failed for ${failedResource.label}: ${failedResource.storageError || "resource could not be copied to Google Drive"}`
  }
  const permanent = resources.filter((item) => item.driveFileId && item.url)
  if (!permanent.length && (resources.length || asArray(existing.resourceLinks).length)) {
    return "No permanent Google Drive file was produced. The source resource may be expired, blocked, or not downloadable"
  }
  return ""
}

async function sendBatchStarted(chatId, mapping, batchNumber, targets, retryMode) {
  const lines = targets.map((item, index) => `${index + 1}. ${classTitle(item)}\n   ID: ${String(item.sourceClassId || "-")}`)
  await sendMessage(chatId, [
    "☁️ Drive repair working now",
    `Course: ${mapping.eeCourseTitle}`,
    `Batch: ${batchNumber} · ${retryMode ? "retry" : "new classes"}`,
    "",
    "Processing now:",
    ...lines,
  ].join("\n")).catch(() => {})
}

async function sendBatchProgress(chatId, mapping, state) {
  const lines = [
    state.complete ? (state.finalFailures.length ? "⚠️ Drive resource repair completed with errors" : "✅ Drive resource repair completed") : "☁️ Drive resource repair progress",
    `Course: ${mapping.eeCourseTitle}`,
    `Scanned: ${state.cursor}/${state.total}`,
    `Repaired successfully: ${state.repaired}`,
    `Waiting for retry: ${state.retryQueue.length}`,
    `Final failed: ${state.finalFailures.length}`,
    `Remaining unscanned: ${Math.max(0, state.total - state.cursor)}`,
    "",
    "This batch:",
    ...state.batchLines,
  ]
  if (state.complete && state.finalFailures.length) {
    lines.push("", "Final failure details:")
    state.finalFailures.slice(-5).forEach((item) => {
      lines.push(`❌ ${item.title}\nID: ${item.sourceClassId}\nError: ${truncate(item.error, 220)}`)
    })
    if (state.finalFailures.length > 5) lines.push(`…and ${state.finalFailures.length - 5} earlier final failures are saved in the job record.`)
  }
  const replyMarkup = state.complete && state.finalFailures.length
    ? keyboard([
      [button(`🔄 Retry failed only · ${state.finalFailures.length}`, "resources:retry_failed")],
      [button("‹ Main menu", "home")],
    ])
    : undefined
  await sendMessage(chatId, lines.join("\n"), replyMarkup).catch(() => {})
}

async function claimManualJob(db, jobId) {
  const ref = db.collection(JOB_COLLECTION).doc(String(jobId))
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists) return null
    const data = snap.data()
    if (data.type !== MANUAL_JOB_TYPE || data.status !== "queued") return null
    transaction.set(ref, {
      status: "running",
      startedAt: serverNow(),
      updatedAt: serverNow(),
      workerRuns: FieldValue.increment(1),
    }, { merge: true })
    return { id: snap.id, ref, ...data }
  })
}

async function runManualBatch(db, job) {
  const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(job.mappingId).get()
  if (!mappingSnapshot.exists) throw new Error("Drive repair mapping no longer exists")
  const mapping = mappingSnapshot.data()
  const [snapshot, account, existing] = await Promise.all([
    loadSnapshot(db, job.sourceSnapshotId),
    getAccount(db, mapping.accountId),
    existingEeClasses(db, mapping.eeCourseId),
  ])
  const sourceClasses = selectedSourceClasses(snapshot, mapping)
  const sourceById = new Map(sourceClasses.map((item) => [String(item.sourceClassId || ""), item]))
  const imported = existing.filter((item) => importedClassMatches(item, mapping))
  const existingBySourceId = new Map(imported.map((item) => [String(item.sourceClassId || ""), item]))
  const cursor = Math.min(Number(job.cursor || 0), sourceClasses.length)
  const currentRetryQueue = asArray(job.retryQueue).map((item) => ({ ...item, sourceClassId: String(item.sourceClassId || "") }))
  const currentFinalFailures = asArray(job.finalFailures)
  const retryMode = cursor >= sourceClasses.length && currentRetryQueue.length > 0

  let targets = retryMode
    ? currentRetryQueue.slice(0, BATCH_SIZE).map((item) => sourceById.get(item.sourceClassId)).filter(Boolean)
    : sourceClasses.slice(cursor, cursor + BATCH_SIZE)

  const missingRetryIds = retryMode
    ? currentRetryQueue.slice(0, BATCH_SIZE).filter((item) => !sourceById.has(item.sourceClassId))
    : []

  const batchNumber = Number(job.batchNumber || 0) + 1
  if (targets.length) await sendBatchStarted(job.notificationChatId, mapping, batchNumber, targets, retryMode)

  let details = []
  if (targets.length) {
    details = await withAccountAuth(db, account, async (auth) => {
      const resolved = await getUdvashClassMediaBulk(auth, targets, MEDIA_CONCURRENCY)
      return storeResolvedResources(db, mapping, targets, resolved, auth.cookie)
    })
  }
  const detailById = new Map(details.map((item) => [String(item.sourceClassId || ""), item]))
  const batch = db.batch()
  const changedIds = []
  const batchLines = []
  let repairedThisBatch = 0
  let retryQueue = retryMode ? currentRetryQueue.slice(BATCH_SIZE) : [...currentRetryQueue]
  let finalFailures = [...currentFinalFailures]

  for (const missing of missingRetryIds) {
    const attempts = Math.max(MAX_CLASS_ATTEMPTS, Number(missing.attempts || 0) + 1)
    const error = "The source class no longer exists in the saved Udvash snapshot"
    finalFailures.push(finalFailureEntry(missing, attempts, error))
    batchLines.push(`❌ ${missing.title || missing.sourceClassId}\n   ID: ${missing.sourceClassId}\n   Error: ${error}`)
  }

  for (const sourceClass of targets) {
    const sourceId = String(sourceClass.sourceClassId || "")
    const existingClass = existingBySourceId.get(sourceId)
    const result = detailById.get(sourceId)
    const previousRetry = currentRetryQueue.find((item) => item.sourceClassId === sourceId)
    const attempts = Number(previousRetry?.attempts || 0) + 1
    const error = sourceErrorForResult(sourceClass, existingClass, result)

    if (error) {
      if (attempts < MAX_CLASS_ATTEMPTS) {
        retryQueue.push(retryEntry(sourceClass, attempts, error))
        batchLines.push(`⚠️ ${classTitle(sourceClass)}\n   ID: ${sourceId}\n   Error: ${truncate(error, 180)}\n   Retry: ${attempts}/${MAX_CLASS_ATTEMPTS}`)
      } else {
        finalFailures.push(finalFailureEntry(sourceClass, attempts, error))
        batchLines.push(`❌ ${classTitle(sourceClass)}\n   ID: ${sourceId}\n   Error: ${truncate(error, 180)}\n   Retry limit reached: ${attempts}/${MAX_CLASS_ATTEMPTS}`)
      }
      continue
    }

    const resources = cleanResourceLinks(result?.media?.resourceLinks)
    const permanent = resources.filter((item) => item.driveFileId && item.url)
    batch.set(db.collection("classes").doc(existingClass.id), {
      resourceLinks: permanent,
      resourceStorage: permanent.length ? "google-drive" : "none",
      resourceStorageUpdatedAt: serverNow(),
      resourceRepairError: "",
      updatedAt: serverNow(),
    }, { merge: true })
    changedIds.push(existingClass.id)
    repairedThisBatch += 1
    batchLines.push(`✅ ${classTitle(sourceClass)}\n   ID: ${sourceId}\n   Drive files: ${permanent.length}`)
  }

  if (changedIds.length) {
    await batch.commit()
    await publishClassSyncEvents(db, changedIds)
  }

  const nextCursor = retryMode ? cursor : cursor + targets.length
  const dedupRetry = [...new Map(retryQueue.map((item) => [item.sourceClassId, item])).values()]
  const dedupFinal = [...new Map(finalFailures.map((item) => [item.sourceClassId, item])).values()]
  const complete = nextCursor >= sourceClasses.length && dedupRetry.length === 0
  const repaired = Number(job.repaired || 0) + repairedThisBatch
  const status = complete ? (dedupFinal.length ? "completed_with_errors" : "completed") : "queued"

  await job.ref.set({
    status,
    cursor: nextCursor,
    total: sourceClasses.length,
    repaired,
    failed: dedupFinal.length,
    retryQueue: dedupRetry,
    finalFailures: dedupFinal,
    lastBatchFailures: batchLines.filter((line) => line.startsWith("⚠️") || line.startsWith("❌")).slice(-10),
    batchNumber,
    workerErrors: 0,
    updatedAt: serverNow(),
    ...(complete ? { completedAt: serverNow() } : {}),
  }, { merge: true })

  const state = {
    complete,
    cursor: nextCursor,
    total: sourceClasses.length,
    repaired,
    retryQueue: dedupRetry,
    finalFailures: dedupFinal,
    batchLines: batchLines.length ? batchLines : ["No processable classes were found in this batch."],
  }
  await sendBatchProgress(job.notificationChatId, mapping, state)
  return state
}

export async function startManualDriveRepair(db, chatId, telegramUserId, session) {
  if (!session?.platform || !session?.sourceCourseId || !session?.sourceSectionKey || !session?.eeCourseId || !session?.destinationType) {
    throw new Error("The import mapping is incomplete. Open the course mapping again and retry")
  }
  if (!session.sourceSnapshotId) throw new Error("The source snapshot is missing. Refresh the source course first")

  const mappingId = mappingIdForSession(session)
  const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(mappingId).get()
  if (!mappingSnapshot.exists) throw new Error("Save this mapping by completing one synchronization check first")
  const mapping = mappingSnapshot.data()
  const [snapshot, accounts, existing] = await Promise.all([
    loadSnapshot(db, session.sourceSnapshotId),
    listGoogleDriveAccounts(db, { refresh: true }),
    existingEeClasses(db, session.eeCourseId),
  ])
  if (!accounts.some((account) => account.status === "ready")) {
    throw new Error("Connect a Google Drive account with available storage before starting resource repair")
  }
  const sourceClasses = selectedSourceClasses(snapshot, session)
  const imported = existing.filter((item) => importedClassMatches(item, session))
  if (!imported.length) throw new Error("No imported classes were found for this mapping")

  // Parser-versioned job IDs prevent an older in-flight worker from writing its
  // stale retry/failure state over a repair started with the new parser.
  const legacyJobRef = db.collection(JOB_COLLECTION).doc(`drive_repair_${mappingId}`)
  const jobRef = db.collection(JOB_COLLECTION).doc(`drive_repair_${mappingId}_p${RESOURCE_PARSER_VERSION}`)
  const legacySnapshot = await legacyJobRef.get()
  if (legacySnapshot.exists && ["queued", "running"].includes(legacySnapshot.data().status)) {
    await legacyJobRef.set({
      type: "manual_drive_resource_repair_cancelled",
      status: "cancelled",
      cancelReason: "Superseded by updated Udvash PDF parser",
      cancelledAt: serverNow(),
      updatedAt: serverNow(),
    }, { merge: true })
  }
  const previousSnapshot = await jobRef.get()
  const previous = previousSnapshot.exists ? previousSnapshot.data() : {}
  const sameManualJob = previous.type === MANUAL_JOB_TYPE
  const parserChanged = (!previousSnapshot.exists && legacySnapshot.exists)
    || (sameManualJob && Number(previous.resourceParserVersion || 0) !== RESOURCE_PARSER_VERSION)
  const activeManual = sameManualJob && !parserChanged && ["queued", "running"].includes(previous.status)
  const staleRunning = activeManual && isStaleRunningJob(previous)

  if (activeManual && !staleRunning) {
    await sendMessage(chatId, [
      "☁️ Drive resource repair is already active",
      `Course: ${mapping.eeCourseTitle}`,
      `Scanned: ${Number(previous.cursor || 0)}/${Number(previous.total || sourceClasses.length)}`,
      `Repaired: ${Number(previous.repaired || 0)}`,
      `Waiting for retry: ${asArray(previous.retryQueue).length}`,
      `Final failed: ${asArray(previous.finalFailures).length}`,
      "Manual worker is running now; the scheduled automation time is not used for this job.",
    ].join("\n"), keyboard([[button("‹ Main menu", "home")]])).catch(() => {})
    return { manualDriveRepairJobId: jobRef.id, shouldRun: previous.status === "queued" }
  }

  const resumeStale = sameManualJob && staleRunning && !parserChanged
  await jobRef.set({
    type: MANUAL_JOB_TYPE,
    executionMode: "manual_immediate",
    status: "queued",
    mappingId,
    sourceSnapshotId: resumeStale ? previous.sourceSnapshotId || session.sourceSnapshotId : session.sourceSnapshotId,
    cursor: resumeStale ? Number(previous.cursor || 0) : 0,
    total: sourceClasses.length,
    repaired: resumeStale ? Number(previous.repaired || 0) : 0,
    failed: resumeStale ? Number(previous.failed || 0) : 0,
    retryQueue: resumeStale ? asArray(previous.retryQueue) : [],
    finalFailures: resumeStale ? asArray(previous.finalFailures) : [],
    batchNumber: resumeStale ? Number(previous.batchNumber || 0) : 0,
    workerErrors: 0,
    requestedByTelegramUserId: String(telegramUserId),
    notificationChatId: String(chatId),
    scheduleExcluded: true,
    resourceParserVersion: RESOURCE_PARSER_VERSION,
    ...(parserChanged ? {
      parserStateResetReason: "Udvash class-note parser updated; stale retries and failures were cleared",
      parserStateResetAt: serverNow(),
    } : {}),
    updatedAt: serverNow(),
    ...(!previousSnapshot.exists ? { createdAt: serverNow() } : {}),
  }, { merge: true })

  await sendMessage(chatId, [
    "☁️ Drive resource repair started NOW",
    "",
    `Course: ${mapping.eeCourseTitle}`,
    `Classes: ${sourceClasses.length}`,
    parserChanged
      ? "The Udvash PDF parser changed, so old retry/failure cache was cleared and every class will be checked again."
      : resumeStale ? "A stale manual worker was recovered and will resume from its saved position." : "A fresh manual repair run has started from the first class.",
    "Course/class listing is read from the saved snapshot for speed; every class page and signed PDF URL is fetched fresh.",
    "This is a manual immediate job. It does NOT wait for the scheduled automation time.",
    "Failed classes will retry up to 3 times, and every failure message will include the class name, source ID, and exact error.",
  ].join("\n"), keyboard([[button("‹ Main menu", "home")]]))

  return { manualDriveRepairJobId: jobRef.id, shouldRun: true }
}

export async function continueManualDriveRepair(db, jobId) {
  const startedAt = Date.now()
  let batches = 0

  while (batches < MAX_BATCHES_PER_INVOCATION && Date.now() - startedAt < WORKER_BUDGET_MS) {
    const job = await claimManualJob(db, jobId)
    if (!job) return { continuationRequired: false }
    try {
      const state = await runManualBatch(db, job)
      batches += 1
      if (state.complete) return { continuationRequired: false }
    } catch (error) {
      const message = truncate(error?.message || error, 500)
      const latest = await job.ref.get().catch(() => null)
      const latestData = latest?.exists ? latest.data() : job
      const workerErrors = Number(latestData.workerErrors || 0) + 1
      const terminal = workerErrors >= 3
      await job.ref.set({
        status: terminal ? "failed" : "queued",
        workerErrors,
        lastError: message,
        updatedAt: serverNow(),
        ...(terminal ? { failedAt: serverNow() } : {}),
      }, { merge: true }).catch(() => {})
      await sendMessage(job.notificationChatId, [
        terminal ? "❌ Manual Drive repair worker stopped" : "⚠️ Manual Drive repair worker error — retrying now",
        `Job: ${job.id}`,
        `Error: ${message}`,
        `Worker retry: ${workerErrors}/3`,
        terminal ? "Open the mapping and run Drive repair again after fixing the error." : "This retry is immediate and does not wait for the scheduler.",
      ].join("\n")).catch(() => {})
      if (terminal) return { continuationRequired: false }
      batches += 1
    }
  }

  const latest = await db.collection(JOB_COLLECTION).doc(String(jobId)).get()
  if (!latest.exists || latest.data().type !== MANUAL_JOB_TYPE || !["queued", "running"].includes(latest.data().status)) return { continuationRequired: false }
  if (latest.data().status === "running") {
    await latest.ref.set({ status: "queued", updatedAt: serverNow() }, { merge: true }).catch(() => {})
  }

  return { continuationRequired: true }
}

export async function retryLatestFailedDriveRepair(db, chatId, telegramUserId) {
  const snapshot = await db.collection(JOB_COLLECTION)
    .where("notificationChatId", "==", String(chatId))
    .limit(30)
    .get()
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter((job) => job.type === MANUAL_JOB_TYPE && ["completed_with_errors", "failed"].includes(job.status))
    .filter((job) => asArray(job.finalFailures).length)
    .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt))
  const job = candidates[0]
  if (!job) throw new Error("No failed Drive repair classes are available to retry")

  const retryQueue = asArray(job.finalFailures).map((item) => ({
    sourceClassId: String(item.sourceClassId || ""),
    title: item.title || item.sourceClassId || "Untitled class",
    attempts: 0,
    lastError: item.error || "Previous repair failed",
  })).filter((item) => item.sourceClassId)
  await job.ref.set({
    status: "queued",
    cursor: Number(job.total || job.cursor || 0),
    retryQueue,
    finalFailures: [],
    failed: 0,
    workerErrors: 0,
    requestedByTelegramUserId: String(telegramUserId || ""),
    retryFailedOnlyAt: serverNow(),
    updatedAt: serverNow(),
  }, { merge: true })
  await sendMessage(chatId, [
    "🔄 Failed-only Drive retry started NOW",
    `Classes requeued: ${retryQueue.length}`,
    "Previously successful/scanned classes will not run again.",
    "You do not need to reopen the mapping or course page.",
  ].join("\n")).catch(() => {})
  return { jobId: job.id, retryCount: retryQueue.length }
}

async function ensureFoundationCardDestination(db, job) {
  const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(String(job.mappingId)).get()
  if (!mappingSnapshot.exists) return { job, migrated: false }
  const mapping = mappingSnapshot.data()
  const foundation = /foundation|ফাউন্ডেশন/iu.test(`${mapping.sourceSectionTitle || ""} ${mapping.sourceSectionKey || ""}`)
  if (!foundation || (mapping.destinationType === "group" && mapping.classGroupId)) return { job, migrated: false }

  const groups = await db.collection("classGroups").where("courseId", "==", mapping.eeCourseId).get()
  const existingGroup = groups.docs.find((doc) => /foundation|ফাউন্ডেশন/iu.test(String(doc.data().title || "")))
  let groupId = existingGroup?.id
  let groupTitle = existingGroup?.data()?.title || "Foundation Classes"
  if (!groupId) {
    const groupRef = await db.collection("classGroups").add({
      courseId: mapping.eeCourseId,
      title: groupTitle,
      description: "",
      order: groups.size,
      isVisible: true,
      createdBy: "telegram-bot",
      createdAt: serverNow(),
      updatedAt: serverNow(),
    })
    groupId = groupRef.id
  }

  const classes = await existingEeClasses(db, mapping.eeCourseId)
  const targets = classes.filter((item) => item.sourcePlatform === mapping.platform
    && String(item.sourceCourseId || "") === String(mapping.sourceCourseId || "")
    && sourceSectionOfClass(item) === normalizedSection(mapping.sourceSectionKey || mapping.sourceSectionTitle)
    && item.isArchived !== true)
  for (let index = 0; index < targets.length; index += 400) {
    const batch = db.batch()
    targets.slice(index, index + 400).forEach((item) => batch.set(
      db.collection("classes").doc(item.id),
      { classGroupId: groupId, updatedAt: serverNow() },
      { merge: true },
    ))
    await batch.commit()
  }

  const nextMapping = { ...mapping, destinationType: "group", classGroupId: groupId, classGroupTitle: groupTitle }
  const nextMappingId = mappingIdForSession(nextMapping)
  await db.collection(MAPPING_COLLECTION).doc(nextMappingId).set({
    ...nextMapping,
    updatedAt: serverNow(),
    foundationCardMigratedAt: serverNow(),
  }, { merge: true })
  await job.ref.set({ mappingId: nextMappingId, updatedAt: serverNow() }, { merge: true })
  return { job: { ...job, mappingId: nextMappingId }, migrated: true, groupTitle, assigned: targets.length }
}

export async function resumeLatestDriveRepair(db, chatId, telegramUserId) {
  const snapshot = await db.collection(JOB_COLLECTION)
    .where("notificationChatId", "==", String(chatId))
    .limit(30)
    .get()
  const jobs = snapshot.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter((job) => job.type === MANUAL_JOB_TYPE)
    .filter((job) => ["queued", "running"].includes(job.status))
    .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt))
  let job = jobs[0]
  if (!job) throw new Error("No paused or queued Drive repair job was found")
  if (job.status === "running" && !isStaleRunningJob(job)) {
    throw new Error("The latest Drive repair worker is still active. Try /resume again after a few minutes if progress stops")
  }
  const foundation = await ensureFoundationCardDestination(db, job)
  job = foundation.job
  await job.ref.set({
    status: "queued",
    workerErrors: 0,
    resumedByTelegramUserId: String(telegramUserId || ""),
    resumedAt: serverNow(),
    updatedAt: serverNow(),
  }, { merge: true })
  await sendMessage(chatId, [
    "▶ Drive repair resumed NOW",
    `Scanned cursor: ${Number(job.cursor || 0)}/${Number(job.total || 0)}`,
    `Waiting for retry: ${asArray(job.retryQueue).length}`,
    "The saved cursor and retry queue were kept; processing will not restart from class 1.",
    ...(foundation.migrated ? [`Foundation card: ${foundation.groupTitle}`, `Classes assigned to card: ${foundation.assigned}`] : []),
  ].join("\n")).catch(() => {})
  return { jobId: job.id }
}

export const MANUAL_DRIVE_REPAIR_JOB_TYPE = MANUAL_JOB_TYPE
