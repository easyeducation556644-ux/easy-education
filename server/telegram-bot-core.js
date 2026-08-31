import { FieldValue } from "firebase-admin/firestore"
import { getAdminServices, getOperationsServices } from "./utils/firebase-admin.js"
import { createSignedState, decryptSecret, encryptSecret, stableId, verifySignedState } from "../server/bot/crypto.js"
import {
  answerCallback,
  button,
  clearInlineKeyboard,
  deleteMessage,
  isAllowedTelegramUser,
  keyboard,
  mainMenu,
  sendMessage,
  urlButton,
} from "../server/bot/telegram.js"
import {
  getUdvashClassMediaBulk,
  getUdvashCourseSnapshot,
  listUdvashCoursesV2,
  loginUdvashV2,
  normalizeContentTypeTitle,
} from "../server/bot/platforms/udvash-v2.js"
import {
  connectGoogleDriveAccount,
  googleAuthorizationUrl,
  listGoogleDriveAccounts,
  persistResourceLinksToDrive,
} from "../server/bot/google-drive.js"
import {
  enqueueDueMappings,
  getAutomationSettings,
  setSchedule,
  timeSlots,
  toggleSchedule,
} from "../server/bot/automation.js"

const SESSION_COLLECTION = "botSessions"
const ACCOUNT_COLLECTION = "botPlatformAccounts"
const MAPPING_COLLECTION = "botCourseMappings"
const SNAPSHOT_COLLECTION = "botSourceSnapshots"
const JOB_COLLECTION = "botJobs"
const PLATFORM_LABELS = { udvash: "Udvash" }
const PLATFORM_IDS = new Set(Object.keys(PLATFORM_LABELS))
const SNAPSHOT_CHUNK_SIZE = 150
const MEDIA_CONCURRENCY = 3
const PUBLIC_SYNC_FEED_LIMIT = 1000
const BOT_CLASS_SYNC_SCHEMA = 2
const BOT_CLASS_METADATA_SCHEMA = 1

const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const normalizeText = (value) => String(value || "").trim().toLowerCase()
const serverNow = () => FieldValue.serverTimestamp()

function normalizedSection(value) {
  return normalizeContentTypeTitle(String(value || "")).toLowerCase()
}

function optionByToken(options, token) {
  const values = asArray(options)
  return values.find((item) => String(item.id) === String(token)) || values[Number(token)]
}

function sessionRef(db, chatId) {
  return db.collection(SESSION_COLLECTION).doc(String(chatId))
}

async function getSession(db, chatId) {
  const snap = await sessionRef(db, chatId).get()
  return snap.exists ? snap.data() : {}
}

async function setSession(db, chatId, patch) {
  await sessionRef(db, chatId).set({ ...patch, updatedAt: serverNow() }, { merge: true })
}

async function replaceSession(db, chatId, value = {}) {
  await sessionRef(db, chatId).set({ ...value, updatedAt: serverNow() })
}

async function clearSession(db, chatId) {
  await sessionRef(db, chatId).delete().catch(() => {})
}

async function showMain(chatId, prefix = "") {
  await sendMessage(
    chatId,
    [prefix, "Select an operation to continue."].filter(Boolean).join("\n\n"),
    mainMenu(),
  )
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.TELEGRAM_WEBHOOK_URL || "")
    .replace(/\/api\/telegram-bot\/?$/, "")
    .replace(/\/$/, "")
}

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (!bytes) return "Not reported"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 1 : 0)} ${units[index]}`
}

function scheduleLabel(minuteOfDay) {
  return timeSlots().find((slot) => slot.minuteOfDay === Number(minuteOfDay))?.label || "08:00 AM"
}

async function showStorageAccounts(db, chatId, telegramUserId, { refresh = false } = {}) {
  const accounts = await listGoogleDriveAccounts(db, { refresh })
  const state = createSignedState({ purpose: "google-drive", telegramUserId: String(telegramUserId) })
  const baseUrl = publicBaseUrl()
  const connectUrl = baseUrl ? `${baseUrl}/api/telegram-bot?action=drive-connect&state=${encodeURIComponent(state)}` : ""
  const details = accounts.map((account, index) => {
    const free = account.quotaLimit ? Math.max(0, account.quotaLimit - account.quotaUsage) : 0
    return [
      `${account.isDefault ? "⭐" : "☁️"} ${index + 1}. ${account.email}`,
      `Status: ${account.status || "ready"}${account.isFull ? " (storage full)" : ""}`,
      `Available: ${formatBytes(free)}${account.quotaLimit ? ` of ${formatBytes(account.quotaLimit)}` : ""}`,
    ].join("\n")
  })
  const rows = []
  if (connectUrl) rows.push([urlButton("➕ Connect Google Drive", connectUrl)])
  rows.push([button("↻ Refresh storage", "storage:refresh")])
  rows.push([button("‹ Main menu", "home")])
  await sendMessage(
    chatId,
    [
      "☁️ Storage accounts",
      "",
      accounts.length ? details.join("\n\n") : "No Google Drive account is connected.",
      "",
      "The default account is used first. If it has insufficient storage, the next available account is promoted automatically.",
      !connectUrl ? "\nConfiguration required: set PUBLIC_APP_URL or TELEGRAM_WEBHOOK_URL." : "",
    ].filter(Boolean).join("\n"),
    keyboard(rows),
  )
}

async function showAutomationMenu(db, chatId) {
  const settings = await getAutomationSettings(db)
  const overall = settings.overall || { enabled: false, minuteOfDay: 480 }
  const udvash = settings.platforms?.udvash
  await sendMessage(
    chatId,
    [
      "🔄 Automated synchronization",
      "",
      `Overall schedule: ${overall.enabled ? `Enabled · ${scheduleLabel(overall.minuteOfDay)}` : "Disabled"}`,
      `Udvash override: ${udvash ? `${udvash.enabled ? "Enabled" : "Disabled"} · ${scheduleLabel(udvash.minuteOfDay)}` : "Uses overall schedule"}`,
      "Timezone: Asia/Dhaka",
      "",
      "GitHub calls the automatic Udvash check once daily at 08:30 AM. Manual Drive repair starts immediately and is independent of this schedule.",
    ].join("\n"),
    keyboard([
      [button("🕒 Overall schedule", "automation:scope:overall")],
      [button("🕒 Udvash schedule", "automation:scope:udvash")],
      [button(overall.enabled ? "⏸ Disable overall" : "▶ Enable overall", "automation:toggle:overall")],
      [button(udvash?.enabled ? "⏸ Disable Udvash override" : "▶ Enable Udvash override", "automation:toggle:udvash")],
      [button("‹ Main menu", "home")],
    ]),
  )
}

async function showTimeSelector(db, chatId, scope, page = 0) {
  const slots = timeSlots()
  const pageSize = 16
  const lastPage = Math.ceil(slots.length / pageSize) - 1
  const safePage = Math.max(0, Math.min(lastPage, Number(page) || 0))
  const visible = slots.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const rows = []
  for (let index = 0; index < visible.length; index += 2) {
    rows.push(visible.slice(index, index + 2).map((slot) => button(slot.label, `automation:set:${scope}:${slot.minuteOfDay}`)))
  }
  rows.push([
    ...(safePage > 0 ? [button("‹ Earlier", `automation:times:${scope}:${safePage - 1}`)] : []),
    ...(safePage < lastPage ? [button("Later ›", `automation:times:${scope}:${safePage + 1}`)] : []),
  ])
  rows.push([button("‹ Automation", "automation:menu")])
  await sendMessage(chatId, `Select the daily synchronization time for ${scope === "overall" ? "all platforms" : PLATFORM_LABELS[scope] || scope}.\n\nTimezone: Asia/Dhaka`, keyboard(rows))
}

function platformKeyboard(prefix) {
  return keyboard([
    [button("Udvash", `${prefix}:udvash`)],
    [button("⬅️ Main menu", "home")],
  ])
}

async function listAccounts(db, platform = "") {
  let ref = db.collection(ACCOUNT_COLLECTION)
  if (platform) ref = ref.where("platform", "==", platform)
  const snap = await ref.get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.label || a.roll || "").localeCompare(String(b.label || b.roll || "")))
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
      lastError: String(error?.message || error).slice(0, 500),
      updatedAt: serverNow(),
    }, { merge: true }).catch(() => {})
    throw error
  }
}

async function platformCourses(db, account) {
  const courses = await withAccountAuth(db, account, (auth) => listUdvashCoursesV2(auth))
  await db.collection(ACCOUNT_COLLECTION).doc(account.id).set({ courseCount: courses.length, updatedAt: serverNow() }, { merge: true })
  return courses
}

function snapshotId(accountId, sourceCourseId) {
  return stableId("udvash-snapshot", accountId, sourceCourseId)
}

async function deleteSnapshotChunks(db, snapshotRef) {
  const old = await snapshotRef.collection("chunks").get()
  for (let start = 0; start < old.docs.length; start += 400) {
    const batch = db.batch()
    old.docs.slice(start, start + 400).forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
}

async function saveSnapshot(db, account, sourceCourse, snapshot) {
  const id = snapshotId(account.id, sourceCourse.id)
  const ref = db.collection(SNAPSHOT_COLLECTION).doc(id)
  await deleteSnapshotChunks(db, ref)

  const chunks = []
  for (let start = 0; start < snapshot.classes.length; start += SNAPSHOT_CHUNK_SIZE) {
    chunks.push(snapshot.classes.slice(start, start + SNAPSHOT_CHUNK_SIZE))
  }

  const batch = db.batch()
  chunks.forEach((items, index) => {
    batch.set(ref.collection("chunks").doc(String(index).padStart(4, "0")), { index, items })
  })
  batch.set(ref, {
    platform: "udvash",
    accountId: account.id,
    sourceCourseId: String(sourceCourse.id),
    sourceCourseTitle: sourceCourse.title,
    classCount: snapshot.classes.length,
    chunkCount: chunks.length,
    sections: snapshot.sections,
    scannedAt: serverNow(),
    updatedAt: serverNow(),
  }, { merge: true })
  await batch.commit()
  return { id, classCount: snapshot.classes.length, sections: snapshot.sections }
}

async function loadSnapshot(db, id) {
  if (!id) throw new Error("The source snapshot is unavailable. Select the source course again")
  const ref = db.collection(SNAPSHOT_COLLECTION).doc(id)
  const [summarySnap, chunksSnap] = await Promise.all([ref.get(), ref.collection("chunks").get()])
  if (!summarySnap.exists) throw new Error("The source snapshot has expired. Scan the source course again")
  const chunks = chunksSnap.docs
    .map((doc) => doc.data())
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
  return { id, ...summarySnap.data(), classes: chunks.flatMap((chunk) => asArray(chunk.items)) }
}

async function scanSourceCourse(db, account, sourceCourse) {
  const snapshot = await withAccountAuth(db, account, (auth) => getUdvashCourseSnapshot(auth, sourceCourse.id))
  return saveSnapshot(db, account, sourceCourse, snapshot)
}

function courseScore(course, queryText) {
  const title = normalizeText(course.title || course.name)
  const query = normalizeText(queryText)
  if (!query) return 0
  if (title === query) return 1000
  if (title.startsWith(query)) return 700
  if (title.includes(query)) return 500
  return query.split(/\s+/).filter(Boolean).reduce((score, word) => score + (title.includes(word) ? 50 : 0), 0)
}

async function searchEeCourses(db, queryText) {
  const snap = await db.collection("courses").get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((course) => ({ course, score: courseScore(course, queryText) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.course.title || "").localeCompare(String(b.course.title || "")))
    .slice(0, 8)
    .map(({ course }) => course)
}

async function getEeCourse(db, courseId) {
  const snap = await db.collection("courses").doc(courseId).get()
  if (!snap.exists) throw new Error("The selected Easy Education course could not be found")
  return { id: snap.id, ...snap.data() }
}

function destinationLabel(session) {
  if (session.destinationType === "archive") return "Archive"
  if (session.destinationType === "group") return session.classGroupTitle || "Class Card"
  return "Regular"
}

function classMatchesDestination(item, session) {
  if (session.destinationType === "archive") return item.isArchived === true
  if (session.destinationType === "group") {
    return item.isArchived !== true && String(item.classGroupId || "") === String(session.classGroupId || "")
  }
  return item.isArchived !== true && !item.classGroupId
}

function sourceSectionOfClass(item) {
  return normalizedSection(item.sourceSectionKey || item.sourceSection || item.sectionTitle || "")
}

function importedClassMatches(item, session) {
  return item.sourcePlatform === session.platform
    && String(item.sourceCourseId || "") === String(session.sourceCourseId || "")
    && classMatchesDestination(item, session)
    && sourceSectionOfClass(item) === normalizedSection(session.sourceSectionKey || session.sourceSectionTitle)
}

function hasPlayableMedia(item) {
  return Boolean(item.youtubeLink || item.hlsLink || item.driveLink || item.dailymotionLink || item.rumbleLink || item.videoURL)
}

function classVideoUrl(item) {
  return String(
    item.videoURL
    || item.youtubeLink
    || item.driveLink
    || item.dailymotionLink
    || item.rumbleLink
    || item.hlsLink
    || "",
  )
}

async function publishClassSyncEvents(db, classIds, action = "changed") {
  const ids = [...new Set(asArray(classIds).map((id) => String(id || "").trim()).filter(Boolean))]
  if (!ids.length) return 0

  const normalizedAction = action === "deleted" ? "deleted" : "changed"
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
        eventId: `classes:${docId}:bot-${normalizedAction}-${stamp.toString(36)}-${index}`.slice(0, 220),
        collection: "classes",
        docId,
        action: normalizedAction,
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

async function existingEeClasses(db, eeCourseId) {
  const snap = await db.collection("classes").where("courseId", "==", eeCourseId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

function comparableArray(value) {
  return asArray(value).map((item) => String(item || "").trim()).filter(Boolean)
}

function sameArray(left, right) {
  const a = comparableArray(left)
  const b = comparableArray(right)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function metadataRepairNeeded(item, sourceClass, eeCourseType) {
  if (!sourceClass) return false
  const hierarchy = classHierarchy(sourceClass, eeCourseType)
  return Number(item.eeBotMetadataSchema || 0) !== BOT_CLASS_METADATA_SCHEMA
    || !sameArray(item.subject, hierarchy.subject)
    || !sameArray(item.chapter, hierarchy.chapter)
}

function cleanResourceLinks(value) {
  return asArray(value)
    .map((item, index) => ({
      label: String(item?.label || item?.title || `Class note ${index + 1}`).trim(),
      url: String(item?.url || item?.link || "").trim(),
      ...(item?.driveFileId ? { driveFileId: String(item.driveFileId) } : {}),
      ...(item?.storageStatus ? { storageStatus: String(item.storageStatus) } : {}),
    }))
    .filter((item) => item.label && item.url)
}

async function storeResolvedResources(db, session, sourceClasses, mediaResults, sourceCookie) {
  const sourceById = new Map(sourceClasses.map((item) => [String(item.sourceClassId || ""), item]))
  for (const result of mediaResults) {
    const resources = cleanResourceLinks(result?.media?.resourceLinks)
    if (!resources.length) continue
    const sourceClass = sourceById.get(String(result.sourceClassId || "")) || {}
    result.media.resourceLinks = await persistResourceLinksToDrive(db, resources, {
      platform: session.platform,
      sourceCourseId: session.sourceCourseId,
      sourceCourseTitle: session.sourceCourseTitle,
      sourceClassId: result.sourceClassId,
      subjectTitle: sourceClass.subjectTitle,
      chapterTitle: sourceClass.chapterTitle,
      sourceCookie,
    })
  }
  return mediaResults
}

async function repairImportedClassSync(db, session, existing, sourceClasses, eeCourseType) {
  const sourceById = new Map(sourceClasses.map((item) => [String(item.sourceClassId || ""), item]))
  const targets = existing
    .filter((item) => importedClassMatches(item, session))
    .map((item) => ({ item, sourceClass: sourceById.get(String(item.sourceClassId || "")) }))
    .filter(({ item, sourceClass }) => {
      const hierarchy = sourceClass ? classHierarchy(sourceClass, eeCourseType) : null
      return Number(item.eeBotSyncSchema || 0) !== BOT_CLASS_SYNC_SCHEMA
        || (!item.videoURL && hasPlayableMedia(item))
        || (hierarchy && (!sameArray(item.subject, hierarchy.subject) || !sameArray(item.chapter, hierarchy.chapter)))
    })

  let repaired = 0
  for (let start = 0; start < targets.length; start += 150) {
    const chunk = targets.slice(start, start + 150)
    const batch = db.batch()
    const changedIds = []

    chunk.forEach(({ item, sourceClass }) => {
      const videoURL = classVideoUrl(item)
      const hierarchy = sourceClass ? classHierarchy(sourceClass, eeCourseType) : null
      const patch = {
        ...(item.videoURL || !videoURL ? {} : { videoURL }),
        ...(hierarchy ? {
          subject: hierarchy.subject,
          chapter: hierarchy.chapter,
          sourceSubject: sourceClass.subjectTitle || item.sourceSubject || "",
          sourceChapter: sourceClass.chapterTitle || item.sourceChapter || "",
        } : {}),
        eeBotSyncSchema: BOT_CLASS_SYNC_SCHEMA,
        updatedAt: serverNow(),
      }
      batch.set(db.collection("classes").doc(item.id), patch, { merge: true })
      if (!item.videoURL && videoURL) item.videoURL = videoURL
      if (hierarchy) {
        item.subject = hierarchy.subject
        item.chapter = hierarchy.chapter
        item.sourceSubject = sourceClass.subjectTitle || item.sourceSubject || ""
        item.sourceChapter = sourceClass.chapterTitle || item.sourceChapter || ""
      }
      item.eeBotSyncSchema = BOT_CLASS_SYNC_SCHEMA
      changedIds.push(item.id)
    })

    await batch.commit()
    await publishClassSyncEvents(db, changedIds)
    repaired += changedIds.length
  }
  return repaired
}

function selectedSourceClasses(snapshot, session) {
  const key = normalizedSection(session.sourceSectionKey || session.sourceSectionTitle)
  return snapshot.classes.filter((item) => normalizedSection(item.sectionKey || item.sectionTitle) === key)
}

async function inspectMapping(db, session, { repairCache = false } = {}) {
  if (!session.eeCourseId || !session.sourceSnapshotId || !session.sourceSectionKey) {
    throw new Error("The import mapping is incomplete. Start the content import again")
  }
  const [snapshot, eeCourse] = await Promise.all([
    loadSnapshot(db, session.sourceSnapshotId),
    getEeCourse(db, session.eeCourseId),
  ])
  const sourceClasses = selectedSourceClasses(snapshot, session)
  const existing = await existingEeClasses(db, session.eeCourseId)
  const eeCourseType = eeCourse.type || "subject"
  const cacheRepairCount = repairCache
    ? await repairImportedClassSync(db, session, existing, sourceClasses, eeCourseType)
    : 0
  const imported = existing.filter((item) => importedClassMatches(item, session))
  const ready = imported.filter((item) => item.isPublished !== false && hasPlayableMedia(item))
  const readySourceIds = new Set(ready.map((item) => String(item.sourceClassId || "")).filter(Boolean))
  const pending = imported.filter((item) => !readySourceIds.has(String(item.sourceClassId || "")))
  const toSync = sourceClasses.filter((item) => !readySourceIds.has(String(item.sourceClassId)))
  const sourceById = new Map(sourceClasses.map((item) => [String(item.sourceClassId || ""), item]))
  const metadataRepair = imported.filter((item) => metadataRepairNeeded(
    item,
    sourceById.get(String(item.sourceClassId || "")),
    eeCourseType,
  ))
  return {
    snapshot,
    sourceClasses,
    existing,
    imported,
    ready,
    pending,
    toSync,
    metadataRepair,
    resourceRepairCount: imported.length,
    cacheRepairCount,
    eeCourse,
    eeCourseType,
  }
}

function mappingKeyboard(analysis) {
  const rows = []
  if (analysis.toSync.length) rows.push([button(`🚀 Import ${analysis.toSync.length} classes`, "sync:confirm")])
  if (analysis.metadataRepair.length) {
    rows.push([button(`🧭 Repair metadata · ${analysis.metadataRepair.length}`, "metadata:repair")])
  }
  if (analysis.resourceRepairCount) {
    rows.push([button(`☁️ Repair Drive resources · ${analysis.resourceRepairCount}`, "resources:repair")])
  }
  rows.push([button("↻ Check destination", "mapping:check"), button("↻ Refresh source", "snapshot:refresh")])
  rows.push([button("‹ Main menu", "home")])
  return keyboard(rows)
}

async function showMappingAnalysis(db, chatId, session) {
  const analysis = await inspectMapping(db, session, { repairCache: true })
  await setSession(db, chatId, {
    eeCourseType: analysis.eeCourseType,
    lastSnapshotCount: analysis.snapshot.classCount,
    lastSelectedCount: analysis.sourceClasses.length,
    lastReadyCount: analysis.ready.length,
    lastPendingCount: analysis.pending.length,
    lastToSyncCount: analysis.toSync.length,
    lastMetadataRepairCount: analysis.metadataRepair.length,
  })

  const text = [
    "📋 Import analysis",
    "",
    `Platform: ${PLATFORM_LABELS[session.platform] || session.platform}`,
    `Source course: ${session.sourceCourseTitle}`,
    `Source type: ${session.sourceSectionTitle}`,
    `EE course: ${session.eeCourseTitle} (${analysis.eeCourseType})`,
    `Destination: ${destinationLabel(session)}`,
    "",
    `Source snapshot: ${analysis.snapshot.classCount} classes`,
    `Selected content type: ${analysis.sourceClasses.length} classes`,
    `Ready in Easy Education: ${analysis.ready.length}`,
    `Pending: ${analysis.pending.length}`,
    `New classes: ${analysis.toSync.length}`,
    `Metadata repairs: ${analysis.metadataRepair.length}`,
    `Drive resource repair scope: ${analysis.resourceRepairCount}`,
    analysis.cacheRepairCount ? `Cached records repaired: ${analysis.cacheRepairCount}` : "",
    "",
    analysis.toSync.length
      ? `${analysis.toSync.length} new classes are ready to import.`
      : analysis.metadataRepair.length
        ? "Videos are available. Metadata and class resources still require repair."
        : "This mapping is fully synchronized.",
  ].filter((line) => line !== "").join("\n")

  await sendMessage(chatId, text, mappingKeyboard(analysis))
}

function classHierarchy(sourceClass, eeCourseType) {
  if ((eeCourseType || "subject") === "batch") {
    return {
      subject: [sourceClass.subjectTitle || "General"],
      chapter: [sourceClass.chapterTitle || "General"],
      topic: sourceClass.sectionTitle || "",
    }
  }
  return {
    subject: [],
    chapter: [sourceClass.subjectTitle || "General"],
    topic: sourceClass.chapterTitle || "",
  }
}

function classDocumentId(session, sourceClassId) {
  return `bot_${stableId(
    session.platform,
    session.sourceCourseId,
    session.eeCourseId,
    session.destinationType,
    session.classGroupId || "",
    session.sourceSectionKey,
    sourceClassId,
  )}`
}

async function cleanupLegacyStaged(db, session) {
  const all = await existingEeClasses(db, session.eeCourseId)
  const candidates = all.filter((item) => {
    if (item.importedBy !== "telegram-bot") return false
    if (item.sourcePlatform !== session.platform) return false
    if (String(item.sourceCourseId || "") !== String(session.sourceCourseId || "")) return false
    if (sourceSectionOfClass(item) !== normalizedSection(session.sourceSectionKey || session.sourceSectionTitle)) return false
    if (!classMatchesDestination(item, session)) return false
    return item.isPublished === false && !hasPlayableMedia(item)
  })

  let removed = 0
  for (let start = 0; start < candidates.length; start += 150) {
    const batch = db.batch()
    const deletedIds = []
    candidates.slice(start, start + 150).forEach((item) => {
      batch.delete(db.collection("classes").doc(item.id))
      batch.delete(db.collection(JOB_COLLECTION).doc(`media_${item.id}`))
      batch.delete(db.collection(JOB_COLLECTION).doc(`ee_media_${item.id}`))
      deletedIds.push(item.id)
      removed += 1
    })
    await batch.commit()
    await publishClassSyncEvents(db, deletedIds, "deleted")
  }
  return removed
}

async function writeSyncResults(db, telegramUserId, session, eeCourse, sourceClasses, mediaResults, existingReady) {
  const mediaById = new Map(mediaResults.map((result) => [String(result.sourceClassId), result]))
  const readySourceIds = new Set(existingReady.map((item) => String(item.sourceClassId || "")).filter(Boolean))
  const allExisting = await existingEeClasses(db, session.eeCourseId)
  const existingIds = new Set(allExisting.map((item) => item.id))
  let nextOrder = allExisting.length
    ? Math.max(...allExisting.map((item) => Number(item.order || 0))) + 1
    : 0

  let published = 0
  let needsUpload = 0
  let failed = 0

  for (let start = 0; start < sourceClasses.length; start += 150) {
    const batch = db.batch()
    const chunk = sourceClasses.slice(start, start + 150)
    const changedIds = []
    chunk.forEach((sourceClass) => {
      if (readySourceIds.has(String(sourceClass.sourceClassId))) return
      const hierarchy = classHierarchy(sourceClass, eeCourse.type)
      const classId = classDocumentId(session, sourceClass.sourceClassId)
      const classRef = db.collection("classes").doc(classId)
      const mediaResult = mediaById.get(String(sourceClass.sourceClassId))
      const media = mediaResult?.media || { youtubeLink: "", directSources: [], topic: "", resourceLinks: [] }
      const error = String(mediaResult?.error || "")
      const hasYoutube = Boolean(media.youtubeLink)
      const hasDirect = asArray(media.directSources).length > 0
      const isArchived = session.destinationType === "archive"
      const classGroupId = session.destinationType === "group" ? session.classGroupId : null

      let mediaStatus = "ee_ready"
      if (error) {
        mediaStatus = "media_resolve_failed"
        failed += 1
      } else if (!hasYoutube) {
        mediaStatus = "needs_youtube_upload"
        needsUpload += 1
      } else {
        published += 1
      }

      batch.set(classRef, {
        courseId: session.eeCourseId,
        title: sourceClass.title || "Untitled class",
        topic: String(media.topic || hierarchy.topic || "").trim(),
        chapter: hierarchy.chapter,
        subject: hierarchy.subject,
        order: nextOrder,
        duration: sourceClass.duration || "",
        youtubeLink: media.youtubeLink || "",
        hlsLink: "",
        driveLink: "",
        dailymotionLink: "",
        rumbleLink: "",
        videoURL: media.youtubeLink || "",
        imageURL: "",
        teacherName: asArray(sourceClass.teacherName),
        teacherImageURL: "",
        resourceLinks: cleanResourceLinks(media.resourceLinks),
        isArchived,
        classGroupId,
        isPublished: hasYoutube && !error,
        mediaStatus,
        mediaResolveError: error,
        sourceHasDirectVideo: hasDirect,
        importedBy: "telegram-bot",
        importedByTelegramUserId: String(telegramUserId),
        sourcePlatform: session.platform,
        sourceAccountId: session.accountId,
        sourceCourseId: String(session.sourceCourseId),
        sourceCourseTitle: session.sourceCourseTitle,
        sourceSection: sourceClass.sectionTitle || session.sourceSectionTitle,
        sourceSectionKey: session.sourceSectionKey,
        sourceClassId: String(sourceClass.sourceClassId),
        sourceContentId: sourceClass.sourceContentId || "",
        sourceContentTypeId: sourceClass.sourceContentTypeId || "",
        sourceSubjectId: sourceClass.sourceSubjectId || "",
        sourceChapterId: sourceClass.sourceChapterId || "",
        sourceSubject: sourceClass.subjectTitle || "",
        sourceChapter: sourceClass.chapterTitle || "",
        sourceVideoHint: sourceClass.sourceVideoLocator || "",
        eeBotSyncSchema: BOT_CLASS_SYNC_SCHEMA,
        eeBotMetadataSchema: error ? 0 : BOT_CLASS_METADATA_SCHEMA,
        updatedAt: serverNow(),
        ...(existingIds.has(classId) ? {} : { createdAt: serverNow() }),
      }, { merge: true })
      changedIds.push(classId)

      if (!hasYoutube || error) {
        batch.set(db.collection(JOB_COLLECTION).doc(`ee_media_${classId}`), {
          type: error ? "media_resolve_retry" : "youtube_upload_for_ee",
          status: "waiting_worker",
          classId,
          courseId: session.eeCourseId,
          platform: session.platform,
          accountId: session.accountId,
          sourceCourseId: String(session.sourceCourseId),
          sourceClassId: String(sourceClass.sourceClassId),
          sourceVideoHint: sourceClass.sourceVideoLocator || "",
          attempts: 0,
          createdAt: serverNow(),
          updatedAt: serverNow(),
        }, { merge: true })
      } else {
        batch.delete(db.collection(JOB_COLLECTION).doc(`ee_media_${classId}`))
      }
      nextOrder += 1
    })
    await batch.commit()
    await publishClassSyncEvents(db, changedIds)
  }

  return { published, needsUpload, failed }
}

async function repairSelectedMetadata(db, chatId, telegramUserId, session) {
  const analysis = await inspectMapping(db, session, { repairCache: true })
  if (!analysis.metadataRepair.length) {
    await showMappingAnalysis(db, chatId, session)
    return
  }

  const account = await getAccount(db, session.accountId)
  const sourceById = new Map(analysis.sourceClasses.map((item) => [String(item.sourceClassId || ""), item]))
  const targetBySourceId = new Map(analysis.metadataRepair.map((item) => [String(item.sourceClassId || ""), item]))
  const sourceTargets = analysis.metadataRepair
    .map((item) => sourceById.get(String(item.sourceClassId || "")))
    .filter(Boolean)

  await sendMessage(
    chatId,
    [
      "🧭 Metadata repair started",
      "",
      `Classes: ${sourceTargets.length}`,
      `Destination course type: ${analysis.eeCourseType}`,
      analysis.eeCourseType === "batch"
        ? "Mapping rule: Udvash subject → EE subject; Udvash chapter → EE chapter."
        : "Mapping rule: Udvash subject → EE chapter.",
      "Topics and class resources will be refreshed from the source.",
    ].join("\n"),
  )

  const detailResults = await withAccountAuth(
    db,
    account,
    async (auth) => {
      const results = await getUdvashClassMediaBulk(auth, sourceTargets, MEDIA_CONCURRENCY)
      return storeResolvedResources(db, session, sourceTargets, results, auth.cookie)
    },
  )
  const detailById = new Map(detailResults.map((result) => [String(result.sourceClassId || ""), result]))

  let repaired = 0
  let topicCount = 0
  let noteCount = 0
  let failed = 0

  for (let start = 0; start < sourceTargets.length; start += 150) {
    const chunk = sourceTargets.slice(start, start + 150)
    const batch = db.batch()
    const changedIds = []

    chunk.forEach((sourceClass) => {
      const sourceId = String(sourceClass.sourceClassId || "")
      const item = targetBySourceId.get(sourceId)
      if (!item) return
      const hierarchy = classHierarchy(sourceClass, analysis.eeCourseType)
      const result = detailById.get(sourceId)
      const media = result?.media || { topic: "", resourceLinks: [] }
      const topic = String(media.topic || "").trim()
      const resources = cleanResourceLinks(media.resourceLinks)
      const error = String(result?.error || "")

      const patch = {
        title: sourceClass.title || item.title || "Untitled class",
        subject: hierarchy.subject,
        chapter: hierarchy.chapter,
        sourceSubject: sourceClass.subjectTitle || item.sourceSubject || "",
        sourceChapter: sourceClass.chapterTitle || item.sourceChapter || "",
        eeBotSyncSchema: BOT_CLASS_SYNC_SCHEMA,
        metadataUpdatedByTelegramUserId: String(telegramUserId),
        updatedAt: serverNow(),
      }
      if (topic) {
        patch.topic = topic
        topicCount += 1
      } else if (!item.topic) {
        patch.topic = hierarchy.topic
      }
      if (resources.length) {
        patch.resourceLinks = resources
        noteCount += resources.length
      }
      if (!error) patch.eeBotMetadataSchema = BOT_CLASS_METADATA_SCHEMA
      else failed += 1

      batch.set(db.collection("classes").doc(item.id), patch, { merge: true })
      changedIds.push(item.id)
      repaired += 1
    })

    await batch.commit()
    await publishClassSyncEvents(db, changedIds)
  }

  await sendMessage(
    chatId,
    [
      "✅ Metadata repair finished",
      `Classes updated: ${repaired}`,
      `Topics found: ${topicCount}`,
      `Note/resource URLs found: ${noteCount}`,
      `Detail fetch failed/retry: ${failed}`,
      analysis.eeCourseType === "batch"
        ? "The Subject → Chapter hierarchy has been applied."
        : "The subject-course hierarchy has been applied.",
    ].join("\n"),
  )
  await showMappingAnalysis(db, chatId, { ...session, eeCourseType: analysis.eeCourseType })
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

async function enqueueResourceRepair(db, chatId, telegramUserId, session) {
  const analysis = await inspectMapping(db, session)
  if (!analysis.imported.length) throw new Error("No imported classes were found for this mapping")
  const accounts = await listGoogleDriveAccounts(db, { refresh: true })
  if (!accounts.some((account) => account.status === "ready")) {
    throw new Error("Connect a Google Drive account with available storage before starting resource repair")
  }
  const mappingId = mappingIdForSession(session)
  const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(mappingId).get()
  if (!mappingSnapshot.exists) throw new Error("Save this mapping by completing one synchronization check first")
  const jobRef = db.collection(JOB_COLLECTION).doc(`drive_repair_${mappingId}`)
  const previousSnapshot = await jobRef.get()
  const previous = previousSnapshot.exists ? previousSnapshot.data() : {}
  if (previous.status === "running") {
    await sendMessage(chatId, "☁️ Drive resource repair is already running. Progress will be reported automatically.")
    return
  }
  const resumeExisting = previousSnapshot.exists && ["queued", "running"].includes(previous.status)
  await jobRef.set({
    type: "drive_resource_repair",
    status: "queued",
    mappingId,
    cursor: resumeExisting ? Number(previous.cursor || 0) : 0,
    total: analysis.sourceClasses.length,
    repaired: resumeExisting ? Number(previous.repaired || 0) : 0,
    failed: resumeExisting ? Number(previous.failed || 0) : 0,
    ...(resumeExisting && previous.sourceSnapshotId ? { sourceSnapshotId: previous.sourceSnapshotId } : {}),
    requestedByTelegramUserId: String(telegramUserId),
    notificationChatId: String(chatId),
    updatedAt: serverNow(),
    ...(!previousSnapshot.exists ? { createdAt: serverNow() } : {}),
  }, { merge: true })
  await sendMessage(chatId, [
    "☁️ Drive resource repair started",
    "",
    `Classes queued: ${analysis.sourceClasses.length}`,
    "Fresh Udvash resource links will be retrieved and copied to the first Google Drive account with sufficient storage.",
    "The first safe batch is processing now. Any remaining classes will continue automatically in the background.",
  ].join("\n"), keyboard([[button("‹ Main menu", "home")]]))

  const immediateJob = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(jobRef)
    if (!current.exists) return null
    transaction.set(jobRef, {
      status: "running",
      attempts: FieldValue.increment(1),
      startedAt: serverNow(),
      updatedAt: serverNow(),
    }, { merge: true })
    return { id: jobRef.id, ref: jobRef, ...current.data() }
  })
  if (!immediateJob) return
  try {
    await runDriveRepairJob(db, immediateJob)
  } catch (error) {
    await jobRef.set({
      status: "queued",
      lastError: String(error.message || error).slice(0, 500),
      updatedAt: serverNow(),
    }, { merge: true }).catch(() => {})
    await sendMessage(chatId, "The immediate batch could not finish. It remains queued and will retry automatically.").catch(() => {})
  }
}

async function syncAllSelected(db, chatId, telegramUserId, session) {
  const analysisBefore = await inspectMapping(db, session)
  if (!analysisBefore.toSync.length) {
    await showMappingAnalysis(db, chatId, session)
    return
  }

  const account = await getAccount(db, session.accountId)
  const eeCourse = await getEeCourse(db, session.eeCourseId)
  await sendMessage(
    chatId,
    [
      "🚀 Content import started",
      "",
      `Classes to import: ${analysisBefore.toSync.length}`,
      `Source snapshot: ${analysisBefore.snapshot.classCount}`,
      "The saved source session will be reused securely.",
    ].join("\n"),
  )

  const removed = await cleanupLegacyStaged(db, session)
  const existingAfterCleanup = await existingEeClasses(db, session.eeCourseId)
  const readyAfterCleanup = existingAfterCleanup
    .filter((item) => importedClassMatches(item, session))
    .filter((item) => item.isPublished !== false && hasPlayableMedia(item))
  const readyIds = new Set(readyAfterCleanup.map((item) => String(item.sourceClassId || "")).filter(Boolean))
  const toResolve = analysisBefore.sourceClasses.filter((item) => !readyIds.has(String(item.sourceClassId)))

  const mediaResults = await withAccountAuth(
    db,
    account,
    async (auth) => {
      const results = await getUdvashClassMediaBulk(auth, toResolve, MEDIA_CONCURRENCY)
      return storeResolvedResources(db, session, toResolve, results, auth.cookie)
    },
  )

  const result = await writeSyncResults(
    db,
    telegramUserId,
    session,
    eeCourse,
    toResolve,
    mediaResults,
    readyAfterCleanup,
  )

  const finalAnalysis = await inspectMapping(db, session)
  const mappingId = stableId(
    session.platform,
    session.sourceCourseId,
    session.eeCourseId,
    session.sourceSectionKey,
    session.destinationType,
    session.classGroupId || "",
  )
  const mappingRef = db.collection(MAPPING_COLLECTION).doc(mappingId)
  const mappingExists = (await mappingRef.get()).exists
  await mappingRef.set({
    platform: session.platform,
    accountId: session.accountId,
    sourceCourseId: String(session.sourceCourseId),
    sourceCourseTitle: session.sourceCourseTitle,
    sourceSectionTitle: session.sourceSectionTitle,
    sourceSectionKey: session.sourceSectionKey,
    eeCourseId: session.eeCourseId,
    eeCourseTitle: session.eeCourseTitle,
    eeCourseType: eeCourse.type || "subject",
    destinationType: session.destinationType,
    classGroupId: session.classGroupId || null,
    classGroupTitle: session.classGroupTitle || "",
    snapshotCount: finalAnalysis.snapshot.classCount,
    selectedCount: finalAnalysis.sourceClasses.length,
    readyCount: finalAnalysis.ready.length,
    pendingCount: finalAnalysis.pending.length,
    updatedByTelegramUserId: String(telegramUserId),
    notificationChatId: String(chatId),
    updatedAt: serverNow(),
    ...(!mappingExists ? { createdAt: serverNow() } : {}),
  }, { merge: true })

  await sendMessage(
    chatId,
    [
      "✅ Sync finished",
      `Obsolete staged records removed: ${removed}`,
      `Published: ${result.published}`,
      `Pending media processing: ${result.needsUpload}`,
      `Failed: ${result.failed}`,
      `Ready in Easy Education: ${finalAnalysis.ready.length}/${finalAnalysis.sourceClasses.length}`,
      "",
      result.needsUpload || result.failed
        ? "Incomplete items remain in the processing queue and have not been published."
        : "The selected content type is fully synchronized.",
    ].join("\n"),
    keyboard([[button("↻ Check destination", "mapping:check"), button("‹ Main menu", "home")]]),
  )
}

async function showEeAccounts(db, chatId, platform) {
  const accounts = await listAccounts(db, platform)
  if (!accounts.length) {
    await replaceSession(db, chatId, { mode: "ee", platform, step: "choose_account" })
    await sendMessage(
      chatId,
      `No ${PLATFORM_LABELS[platform]} source account is connected.`,
      keyboard([[button("➕ Connect account", `accountadd:${platform}`)], [button("‹ Main menu", "home")]]),
    )
    return
  }

  const options = accounts.map((item) => ({ id: item.id, label: item.label || item.roll, roll: item.roll }))
  await replaceSession(db, chatId, { mode: "ee", platform, step: "choose_account", accountOptions: options })
  const rows = options.slice(0, 20).map((item, index) => [button(`👤 ${item.label} · ${item.roll}`, `acct:${index}`)])
  rows.push([button("➕ Connect account", `accountadd:${platform}`), button("‹ Main menu", "home")])
  await sendMessage(chatId, `Select the ${PLATFORM_LABELS[platform]} account to use.`, keyboard(rows))
}

async function loadSourceCourses(db, chatId, accountId) {
  const account = await getAccount(db, accountId)
  await sendMessage(chatId, `Loading available courses from ${account.label || account.roll}…`)
  const courses = await platformCourses(db, account)
  const options = courses.slice(0, 50).map((course) => ({
    id: String(course.id),
    title: course.title,
    type: course.type || "",
  }))
  await setSession(db, chatId, { accountId, step: "choose_source_course", sourceCourseOptions: options })

  if (!options.length) {
    await sendMessage(chatId, "No courses are available for this account.", keyboard([[button("‹ Main menu", "home")]]))
    return
  }
  const rows = options.slice(0, 20).map((course, index) => [button(course.title, `src:${index}`)])
  if (options.length > 20) rows.push([button(`View ${options.length - 20} more`, "source:more")])
  rows.push([button("‹ Main menu", "home")])
  await sendMessage(chatId, `${options.length} courses found. Select a source course.`, keyboard(rows))
}

async function showMoreSourceCourses(db, chatId) {
  const session = await getSession(db, chatId)
  const options = asArray(session.sourceCourseOptions)
  const rows = options.slice(20, 50).map((course, index) => [button(course.title, `src:${index + 20}`)])
  rows.push([button("‹ Main menu", "home")])
  await sendMessage(chatId, "Additional source courses", keyboard(rows))
}

async function chooseSourceCourse(db, chatId, index) {
  const session = await getSession(db, chatId)
  const course = asArray(session.sourceCourseOptions)[index]
  if (!course) throw new Error("Source course selection expired")
  const account = await getAccount(db, session.accountId)

  await sendMessage(
    chatId,
    `📡 Source scan started\n\nCourse: ${course.title}\nRetrieving subjects, chapters, content types, and classes. The completed snapshot will be reused for this import.`,
  )
  const snapshot = await scanSourceCourse(db, account, course)
  const sectionOptions = asArray(snapshot.sections).map((item) => ({
    key: normalizedSection(item.key || item.title),
    title: item.title,
    count: Number(item.count || 0),
  }))

  await setSession(db, chatId, {
    sourceCourseId: String(course.id),
    sourceCourseTitle: course.title,
    sourceCourseType: course.type || "",
    sourceSnapshotId: snapshot.id,
    sourceSnapshotCount: snapshot.classCount,
    sourceSectionOptions: sectionOptions,
    sourceSectionKey: "",
    sourceSectionTitle: "",
    step: "ee_search",
  })

  const summary = sectionOptions.slice(0, 12).map((item) => `• ${item.title}: ${item.count}`)
  await sendMessage(
    chatId,
    [
      `✅ Source scan completed: ${snapshot.classCount} classes`,
      ...summary,
      "",
      "Enter part of the destination course name in Easy Education.",
    ].join("\n"),
  )
}

async function handleEeSearch(db, chatId, text) {
  const matches = await searchEeCourses(db, text)
  const options = matches.map((course) => ({
    id: course.id,
    title: course.title || course.name || "Untitled",
    type: course.type || "subject",
  }))
  await setSession(db, chatId, { eeSearchQuery: text, eeCourseOptions: options })
  if (!options.length) {
    await sendMessage(chatId, "No matching Easy Education course was found. Try a different keyword.")
    return
  }
  const rows = options.map((course, index) => [button(`${course.title} · ${course.type}`, `ee:${index}`)])
  rows.push([button("Cancel", "home")])
  await sendMessage(chatId, `${options.length} matching courses found. Select the destination course.`, keyboard(rows))
}

async function showSourceSections(db, chatId, session) {
  let options = asArray(session.sourceSectionOptions)
  if (!options.length && session.sourceSnapshotId) {
    const snapshot = await loadSnapshot(db, session.sourceSnapshotId)
    options = asArray(snapshot.sections).map((item) => ({
      key: normalizedSection(item.key || item.title),
      title: item.title,
      count: Number(item.count || 0),
    }))
    await setSession(db, chatId, { sourceSectionOptions: options })
  }
  if (!options.length) throw new Error("No content types were found in the source snapshot")
  const rows = options.slice(0, 20).map((item, index) => [button(`${item.title} · ${item.count}`, `sect:${index}`)])
  rows.push([button("‹ Main menu", "home")])
  await sendMessage(
    chatId,
    [
      `EE course: ${session.eeCourseTitle} (${session.eeCourseType || "subject"})`,
      `Udvash snapshot: ${session.sourceSnapshotCount || "?"} classes`,
      "",
      "Select the Udvash content type to import.",
      "Each content type can be mapped to a separate destination.",
    ].join("\n"),
    keyboard(rows),
  )
}

async function chooseEeCourse(db, chatId, index) {
  const session = await getSession(db, chatId)
  const course = asArray(session.eeCourseOptions)[index]
  if (!course) throw new Error("EE course selection expired")
  const next = {
    ...session,
    eeCourseId: course.id,
    eeCourseTitle: course.title,
    eeCourseType: course.type || "subject",
    step: "choose_source_section",
  }
  await setSession(db, chatId, {
    eeCourseId: course.id,
    eeCourseTitle: course.title,
    eeCourseType: course.type || "subject",
    step: "choose_source_section",
  })
  await showSourceSections(db, chatId, next)
}

async function chooseSourceSection(db, chatId, index) {
  const session = await getSession(db, chatId)
  const option = asArray(session.sourceSectionOptions)[index]
  if (!option) throw new Error("Content type selection expired")
  await setSession(db, chatId, {
    sourceSectionKey: normalizedSection(option.key || option.title),
    sourceSectionTitle: option.title,
    step: "choose_destination",
  })
  await sendMessage(
    chatId,
    [
      `Source type: ${option.title}`,
      `Classes: ${option.count}`,
      "",
      "Select the destination in Easy Education.",
    ].join("\n"),
    keyboard([
      [button("📚 Regular", "dest:regular"), button("🗄 Archive", "dest:archive")],
      [button("🧩 Class Card", "dest:groups")],
      [button("‹ Content types", "sections:show"), button("Main menu", "home")],
    ]),
  )
}

async function showClassGroups(db, chatId, session) {
  const snap = await db.collection("classGroups").where("courseId", "==", session.eeCourseId).get()
  const groups = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  const options = groups.map((group) => ({ id: group.id, title: group.title }))
  await setSession(db, chatId, { classGroupOptions: options, step: "choose_group" })
  const rows = options.slice(0, 20).map((group, index) => [button(`🧩 ${group.title}`, `grp:${index}`)])
  rows.push([button("➕ Create new card", "grp:new")])
  rows.push([button("‹ Main menu", "home")])
  await sendMessage(chatId, options.length ? "Select a Class Card." : "No Class Cards exist for this course.", keyboard(rows))
}

async function chooseDestination(db, chatId, type) {
  const session = await getSession(db, chatId)
  if (!session.eeCourseId || !session.sourceSectionKey) throw new Error("Mapping incomplete")
  if (type === "groups") return showClassGroups(db, chatId, session)
  const next = { ...session, destinationType: type, classGroupId: null, classGroupTitle: "", step: "mapping_ready" }
  await setSession(db, chatId, {
    destinationType: type,
    classGroupId: null,
    classGroupTitle: "",
    step: "mapping_ready",
  })
  await showMappingAnalysis(db, chatId, next)
}

async function chooseGroup(db, chatId, index) {
  const session = await getSession(db, chatId)
  const group = asArray(session.classGroupOptions)[index]
  if (!group) throw new Error("Class Card selection expired")
  const next = {
    ...session,
    destinationType: "group",
    classGroupId: group.id,
    classGroupTitle: group.title,
    step: "mapping_ready",
  }
  await setSession(db, chatId, {
    destinationType: "group",
    classGroupId: group.id,
    classGroupTitle: group.title,
    step: "mapping_ready",
  })
  await showMappingAnalysis(db, chatId, next)
}

async function createClassGroupFromText(db, chatId, title) {
  const session = await getSession(db, chatId)
  if (!session.eeCourseId) throw new Error("No Easy Education course is selected")
  const snap = await db.collection("classGroups").where("courseId", "==", session.eeCourseId).get()
  const existing = snap.docs.find((doc) => normalizeText(doc.data().title) === normalizeText(title))
  let group
  if (existing) {
    group = { id: existing.id, title: existing.data().title }
  } else {
    const ref = await db.collection("classGroups").add({
      courseId: session.eeCourseId,
      title: String(title).trim(),
      description: "",
      order: snap.size,
      isVisible: true,
      createdBy: "telegram-bot",
      createdAt: serverNow(),
      updatedAt: serverNow(),
    })
    group = { id: ref.id, title: String(title).trim() }
  }
  const next = {
    ...session,
    destinationType: "group",
    classGroupId: group.id,
    classGroupTitle: group.title,
    step: "mapping_ready",
  }
  await setSession(db, chatId, {
    destinationType: "group",
    classGroupId: group.id,
    classGroupTitle: group.title,
    step: "mapping_ready",
  })
  await sendMessage(chatId, `✅ Class Card ready\n${group.title}`)
  await showMappingAnalysis(db, chatId, next)
}

async function refreshSnapshotForSession(db, chatId) {
  const session = await getSession(db, chatId)
  if (!session.accountId || !session.sourceCourseId) throw new Error("No source course is selected")
  const account = await getAccount(db, session.accountId)
  const sourceCourse = { id: session.sourceCourseId, title: session.sourceCourseTitle }
  await sendMessage(chatId, "↻ Refreshing the Udvash source snapshot. The complete course will be scanned again.")
  const snapshot = await scanSourceCourse(db, account, sourceCourse)
  const sectionOptions = asArray(snapshot.sections).map((item) => ({
    key: normalizedSection(item.key || item.title),
    title: item.title,
    count: Number(item.count || 0),
  }))
  const selectedStillExists = sectionOptions.some((item) => item.key === normalizedSection(session.sourceSectionKey))
  await setSession(db, chatId, {
    sourceSnapshotId: snapshot.id,
    sourceSnapshotCount: snapshot.classCount,
    sourceSectionOptions: sectionOptions,
    ...(selectedStillExists ? {} : { sourceSectionKey: "", sourceSectionTitle: "", step: "choose_source_section" }),
  })
  await sendMessage(chatId, `✅ Source snapshot refreshed\nClasses found: ${snapshot.classCount}`)
  if (selectedStillExists && session.destinationType) {
    await showMappingAnalysis(db, chatId, { ...session, sourceSnapshotId: snapshot.id, sourceSnapshotCount: snapshot.classCount, sourceSectionOptions: sectionOptions })
  } else {
    await showSourceSections(db, chatId, { ...session, sourceSnapshotId: snapshot.id, sourceSnapshotCount: snapshot.classCount, sourceSectionOptions: sectionOptions })
  }
}

async function showAccountMenu(db, chatId) {
  const accounts = await listAccounts(db)
  const options = accounts.slice(0, 30).map((item) => ({
    id: item.id,
    platform: item.platform,
    label: item.label || item.roll,
    roll: item.roll,
    status: item.status || "saved",
  }))
  await replaceSession(db, chatId, { mode: "account_manage", step: "account_list", accountManageOptions: options })
  const rows = options.map((item) => [
    button(`👤 ${item.label} · ${item.roll}`, `accountinfo:${item.id}`),
    button("🗑", `accountdelete:${item.id}`),
  ])
  rows.push([button("➕ Connect source account", "account:add")])
  rows.push([button("‹ Main menu", "home")])
  await sendMessage(
    chatId,
    options.length ? `🔐 Source accounts\n\nConnected accounts: ${options.length}\nSelect an account to inspect its status or remove it.` : "🔐 Source accounts\n\nNo source account is connected.",
    keyboard(rows),
  )
}

async function showAccountInfo(db, chatId, token) {
  const session = await getSession(db, chatId)
  const option = optionByToken(session.accountManageOptions, token)
  if (!option) throw new Error("Account selection expired")
  const account = await getAccount(db, option.id)
  await sendMessage(
    chatId,
    [
      `Platform: ${PLATFORM_LABELS[account.platform] || account.platform}`,
      `Name: ${account.label || account.roll}`,
      `Roll: ${account.roll}`,
      `Status: ${account.status || "saved"}`,
      account.courseCount !== undefined ? `Courses: ${account.courseCount}` : "",
      account.lastError ? `Last error: ${account.lastError}` : "",
    ].filter(Boolean).join("\n"),
    keyboard([
      [button("↻ Verify connection", `accountrefresh:${option.id}`)],
      [button("🗑 Delete account", `accountdelete:${option.id}`)],
      [button("‹ Source accounts", "account:list")],
    ]),
  )
}

async function refreshSavedAccount(db, chatId, token) {
  const session = await getSession(db, chatId)
  const option = optionByToken(session.accountManageOptions, token)
  if (!option) throw new Error("Account selection expired")
  const account = await getAccount(db, option.id)
  await sendMessage(chatId, `Verifying the saved session for ${account.label || account.roll}…`)
  const courses = await platformCourses(db, account)
  await sendMessage(
    chatId,
    `✅ Source account verified\nAvailable courses: ${courses.length}`,
    keyboard([[button("‹ Source accounts", "account:list"), button("Main menu", "home")]]),
  )
}

async function confirmDeleteAccount(db, chatId, token) {
  const session = await getSession(db, chatId)
  const option = optionByToken(session.accountManageOptions, token)
  if (!option) throw new Error("Account selection expired")
  await sendMessage(
    chatId,
    `⚠️ Remove source account?\n\nAccount: ${option.label}\nUser ID: ${option.roll}\n\nSaved credentials and sessions will be removed. Existing Easy Education classes will not be deleted.`,
    keyboard([[button("🗑 Confirm removal", `accountdeleteconfirm:${option.id}`)], [button("Cancel", "account:list")]]),
  )
}

async function deleteSavedAccount(db, chatId, token) {
  const session = await getSession(db, chatId)
  const option = optionByToken(session.accountManageOptions, token)
  if (!option) throw new Error("Account selection expired")
  await db.collection(ACCOUNT_COLLECTION).doc(option.id).delete()
  await sendMessage(chatId, `✅ Source account removed\n${option.label}`)
  await showAccountMenu(db, chatId)
}

async function startAccountAdd(db, chatId, platform) {
  if (!PLATFORM_IDS.has(platform)) throw new Error("Unsupported platform")
  await replaceSession(db, chatId, { mode: "account_add", platform, step: "add_account_label" })
  await sendMessage(chatId, `Enter a recognizable name for this ${PLATFORM_LABELS[platform]} account.\nExample: Udvash Primary`)
}

async function saveAccountPassword(db, chatId, telegramUserId, password) {
  const session = await getSession(db, chatId)
  if (!session.platform || !session.accountRoll) throw new Error("Account add session expired")

  let auth
  let courses
  try {
    auth = await loginUdvashV2({ roll: session.accountRoll, password })
    courses = await listUdvashCoursesV2(auth)
  } catch (error) {
    await clearSession(db, chatId)
    await showMain(chatId, `❌ Account verification failed\n${error.message || "Unknown error"}\n\nNo credentials were saved.`)
    return
  }

  const existingSnap = await db.collection(ACCOUNT_COLLECTION).where("platform", "==", session.platform).get()
  const existing = existingSnap.docs.find((doc) => String(doc.data().roll) === String(session.accountRoll))
  const ref = existing ? existing.ref : db.collection(ACCOUNT_COLLECTION).doc()
  await ref.set({
    platform: session.platform,
    label: session.accountLabel || session.accountRoll,
    roll: session.accountRoll,
    passwordEncrypted: encryptSecret(password),
    cookieEncrypted: auth.cookie ? encryptSecret(auth.cookie) : "",
    tokenEncrypted: auth.token ? encryptSecret(auth.token) : "",
    status: "ready",
    courseCount: courses.length,
    lastError: "",
    lastLoginAt: serverNow(),
    updatedAt: serverNow(),
    createdByTelegramUserId: String(telegramUserId),
    ...(existing ? {} : { createdAt: serverNow() }),
  }, { merge: true })

  await clearSession(db, chatId)
  await showMain(chatId, `✅ Source account connected\nAvailable courses: ${courses.length}\nCredentials were encrypted and stored securely.`)
}

async function showStatus(db, chatId) {
  const [accounts, mappings, jobs, snapshots] = await Promise.all([
    db.collection(ACCOUNT_COLLECTION).get(),
    db.collection(MAPPING_COLLECTION).get(),
    db.collection(JOB_COLLECTION).get(),
    db.collection(SNAPSHOT_COLLECTION).get(),
  ])
  const jobCounts = {}
  jobs.docs.forEach((doc) => {
    const status = doc.data().status || "unknown"
    jobCounts[status] = (jobCounts[status] || 0) + 1
  })
  const jobsText = Object.entries(jobCounts).length
    ? Object.entries(jobCounts).map(([status, count]) => `${status}: ${count}`).join(" · ")
    : "none"
  await sendMessage(
    chatId,
    `📊 Operations overview\n\nSource accounts: ${accounts.size}\nSource snapshots: ${snapshots.size}\nCourse mappings: ${mappings.size}\nProcessing jobs: ${jobsText}`,
    keyboard([[button("‹ Main menu", "home")]]),
  )
}

async function claimScheduledJob(db) {
  const snapshot = await db.collection(JOB_COLLECTION).where("status", "==", "queued").limit(20).get()
  const supported = new Set(["drive_resource_repair", "scheduled_mapping_sync"])
  const candidate = snapshot.docs.find((doc) => supported.has(doc.data().type))
  if (!candidate) return null
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(candidate.ref)
    if (!current.exists || current.data().status !== "queued") return null
    transaction.update(candidate.ref, {
      status: "running",
      attempts: FieldValue.increment(1),
      startedAt: serverNow(),
      updatedAt: serverNow(),
    })
    return { id: candidate.id, ref: candidate.ref, ...current.data() }
  })
}

async function runDriveRepairJob(db, job) {
  const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(job.mappingId).get()
  if (!mappingSnapshot.exists) throw new Error("Resource repair mapping no longer exists")
  const mapping = mappingSnapshot.data()
  const account = await getAccount(db, mapping.accountId)
  const sourceSnapshot = job.sourceSnapshotId
    ? await loadSnapshot(db, job.sourceSnapshotId)
    : await scanSourceCourse(db, account, { id: mapping.sourceCourseId, title: mapping.sourceCourseTitle })
  const session = { ...mapping, sourceSnapshotId: sourceSnapshot.id, sourceSnapshotCount: sourceSnapshot.classCount }
  const analysis = await inspectMapping(db, session)
  const cursor = Number(job.cursor || 0)
  const targets = analysis.sourceClasses.slice(cursor, cursor + 10)
  const existingBySourceId = new Map(analysis.imported.map((item) => [String(item.sourceClassId || ""), item]))
  let repaired = 0
  let failed = 0

  if (targets.length) {
    const details = await withAccountAuth(db, account, async (auth) => {
      const resolved = await getUdvashClassMediaBulk(auth, targets, MEDIA_CONCURRENCY)
      return storeResolvedResources(db, session, targets, resolved, auth.cookie)
    })
    const batch = db.batch()
    const changedIds = []
    details.forEach((result) => {
      const existing = existingBySourceId.get(String(result.sourceClassId || ""))
      if (!existing || result.error) {
        failed += 1
        return
      }
      const resources = cleanResourceLinks(result.media?.resourceLinks)
      const permanent = resources.filter((item) => item.driveFileId && item.url)
      if (!permanent.length && (resources.length || asArray(existing.resourceLinks).length)) {
        failed += 1
        return
      }
      batch.set(db.collection("classes").doc(existing.id), {
        resourceLinks: permanent,
        resourceStorage: permanent.length ? "google-drive" : "none",
        resourceStorageUpdatedAt: serverNow(),
        updatedAt: serverNow(),
      }, { merge: true })
      changedIds.push(existing.id)
      repaired += 1
    })
    await batch.commit()
    await publishClassSyncEvents(db, changedIds)
  }

  const nextCursor = cursor + targets.length
  const complete = nextCursor >= analysis.sourceClasses.length
  await job.ref.set({
    status: complete ? "completed" : "queued",
    cursor: nextCursor,
    total: analysis.sourceClasses.length,
    repaired: Number(job.repaired || 0) + repaired,
    failed: Number(job.failed || 0) + failed,
    sourceSnapshotId: sourceSnapshot.id,
    updatedAt: serverNow(),
    ...(complete ? { completedAt: serverNow() } : {}),
  }, { merge: true })
  if (job.notificationChatId) {
    await sendMessage(job.notificationChatId, [
      complete ? "✅ Drive resource repair completed" : "☁️ Drive resource repair progress",
      `Course: ${mapping.eeCourseTitle}`,
      `Processed: ${nextCursor}/${analysis.sourceClasses.length}`,
      `Updated in this batch: ${repaired}`,
      `Requires retry: ${failed}`,
    ].join("\n")).catch(() => {})
  }
  return { jobId: job.id, complete, cursor: nextCursor, total: analysis.sourceClasses.length, repaired, failed }
}

async function runScheduledJob(db, job) {
  const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(job.mappingId).get()
  if (!mappingSnapshot.exists) throw new Error("Automation mapping no longer exists")
  const mapping = mappingSnapshot.data()
  if (mapping.platform !== "udvash") throw new Error(`Automation adapter is not available for ${mapping.platform}`)

  const account = await getAccount(db, mapping.accountId)
  const sourceCourse = { id: mapping.sourceCourseId, title: mapping.sourceCourseTitle }
  const snapshot = await scanSourceCourse(db, account, sourceCourse)
  const session = {
    ...mapping,
    sourceSnapshotId: snapshot.id,
    sourceSnapshotCount: snapshot.classCount,
  }
  const analysis = await inspectMapping(db, session, { repairCache: true })
  let result = { published: 0, needsUpload: 0, failed: 0 }

  if (analysis.toSync.length) {
    const mediaResults = await withAccountAuth(db, account, async (auth) => {
      const resolved = await getUdvashClassMediaBulk(auth, analysis.toSync, MEDIA_CONCURRENCY)
      return storeResolvedResources(db, session, analysis.toSync, resolved, auth.cookie)
    })
    result = await writeSyncResults(
      db,
      mapping.updatedByTelegramUserId || "automation",
      session,
      analysis.eeCourse,
      analysis.toSync,
      mediaResults,
      analysis.ready,
    )
  }

  const finalAnalysis = await inspectMapping(db, session)
  await mappingSnapshot.ref.set({
    snapshotCount: finalAnalysis.snapshot.classCount,
    selectedCount: finalAnalysis.sourceClasses.length,
    readyCount: finalAnalysis.ready.length,
    pendingCount: finalAnalysis.pending.length,
    lastAutomatedRunAt: serverNow(),
    lastAutomationStatus: "completed",
    updatedAt: serverNow(),
  }, { merge: true })
  await job.ref.set({
    status: "completed",
    discoveredCount: analysis.toSync.length,
    publishedCount: result.published,
    pendingCount: result.needsUpload,
    failedCount: result.failed,
    completedAt: serverNow(),
    updatedAt: serverNow(),
  }, { merge: true })

  // An automatic run must always leave an operator-visible audit result, even
  // when no new content was found. Silent successful checks made it impossible
  // to tell whether the configured daily schedule actually ran.
  if (mapping.notificationChatId) {
    await sendMessage(mapping.notificationChatId, [
      "✅ Automated synchronization completed",
      `Platform: ${PLATFORM_LABELS[mapping.platform] || mapping.platform}`,
      `Source: ${mapping.sourceCourseTitle}`,
      `Destination: ${mapping.eeCourseTitle}`,
      "",
      `New classes discovered: ${analysis.toSync.length}`,
      `Published: ${result.published}`,
      `Pending storage/media: ${result.needsUpload}`,
      `Failed: ${result.failed}`,
    ].join("\n")).catch(() => {})
  }
  return { jobId: job.id, discovered: analysis.toSync.length, ...result }
}

async function runAutomationTick(db) {
  const enqueued = await enqueueDueMappings(db)
  const job = await claimScheduledJob(db)
  if (!job) return { enqueued: enqueued.length, processed: null }
  try {
    const processed = job.type === "drive_resource_repair"
      ? await runDriveRepairJob(db, job)
      : await runScheduledJob(db, job)
    return { enqueued: enqueued.length, processed }
  } catch (error) {
    const retry = Number(job.attempts || 0) + 1 < 3
    await job.ref.set({
      status: retry ? "queued" : "failed",
      lastError: String(error.message || error).slice(0, 500),
      ...(retry ? {} : { failedAt: serverNow() }),
      updatedAt: serverNow(),
    }, { merge: true }).catch(() => {})
    const mappingSnapshot = await db.collection(MAPPING_COLLECTION).doc(job.mappingId).get().catch(() => null)
    const mapping = mappingSnapshot?.exists ? mappingSnapshot.data() : null
    const chatId = mapping?.notificationChatId || job.notificationChatId
    if (chatId) {
      await sendMessage(chatId, [
        retry ? "⚠️ Automated synchronization failed — retry pending" : "❌ Automated synchronization failed",
        `Platform: ${PLATFORM_LABELS[mapping?.platform || job.platform] || mapping?.platform || job.platform || "unknown"}`,
        `Source: ${mapping?.sourceCourseTitle || job.mappingId}`,
        `Error: ${String(error.message || error).slice(0, 500)}`,
        `Attempt: ${Number(job.attempts || 0) + 1}/3`,
        retry ? "The next scheduler heartbeat will retry this job." : "Retry limit reached. Open the mapping and run a manual check after fixing the error.",
      ].join("\n")).catch(() => {})
    }
    throw error
  }
}

async function handleText(db, message) {
  const chatId = message.chat.id
  const userId = message.from?.id
  const text = String(message.text || "").trim()
  const command = text.split(/\s+/)[0].toLowerCase()

  if (["/start", "/menu", "/cancel"].includes(command)) {
    await clearSession(db, chatId)
    await showMain(chatId, "Easy Education · Content Operations")
    return
  }
  if (command === "/accounts") return showAccountMenu(db, chatId)
  if (command === "/status") return showStatus(db, chatId)

  const session = await getSession(db, chatId)
  if (session.step === "add_account_label") {
    await setSession(db, chatId, { accountLabel: text.slice(0, 60), step: "add_account_roll" })
    await sendMessage(chatId, "Enter the account roll or user ID.")
    return
  }
  if (session.step === "add_account_roll") {
    await setSession(db, chatId, { accountRoll: text.slice(0, 120), step: "add_account_password" })
    await sendMessage(chatId, "Enter the account password. The message will be removed immediately after it is received.")
    return
  }
  if (session.step === "add_account_password") {
    await deleteMessage(chatId, message.message_id)
    await sendMessage(chatId, "Credentials received. Verifying the account securely…")
    await saveAccountPassword(db, chatId, userId, text)
    return
  }
  if (session.step === "ee_search") return handleEeSearch(db, chatId, text)
  if (session.step === "new_group_title") return createClassGroupFromText(db, chatId, text)

  await showMain(chatId, "That command is not available. Please use the menu below.")
}

function callbackNotice(data) {
  if (data === "home") return "Opening main menu"
  if (data === "mode:ee") return "Opening content import"
  if (data === "account:list") return "Opening source accounts"
  if (data === "account:add") return "Starting account connection"
  if (data === "status") return "Loading operation status"
  if (data === "storage:list") return "Opening storage accounts"
  if (data === "storage:refresh") return "Checking Drive storage"
  if (data === "automation:menu") return "Opening automation settings"
  if (data.startsWith("automation:set:")) return "Saving schedule"
  if (data.startsWith("automation:toggle:")) return "Updating automation"
  if (data.startsWith("automation:")) return "Opening schedule selector"
  if (data.startsWith("platform:")) return "Loading connected accounts"
  if (data.startsWith("acct:")) return "Loading source courses"
  if (data.startsWith("src:")) return "Starting course scan"
  if (data.startsWith("ee:")) return "Selecting destination course"
  if (data.startsWith("sect:")) return "Selecting content type"
  if (data.startsWith("dest:")) return "Preparing import analysis"
  if (data.startsWith("grp:")) return "Selecting class card"
  if (data === "mapping:check") return "Checking synchronization status"
  if (data === "metadata:repair") return "Starting resource repair"
  if (data === "resources:repair") return "Scheduling Drive resource repair"
  if (data === "snapshot:refresh") return "Refreshing source snapshot"
  if (data === "sync:all") return "Starting content import"
  if (data === "sync:confirm") return "Opening import confirmation"
  if (data.startsWith("accountrefresh:")) return "Checking account session"
  if (data.startsWith("accountdeleteconfirm:")) return "Deleting source account"
  if (data.startsWith("accountdelete:")) return "Opening deletion confirmation"
  return "Request received"
}

async function handleCallback(db, callback) {
  const chatId = callback.message?.chat?.id
  const userId = callback.from?.id
  const data = String(callback.data || "")
  if (!chatId) return
  await answerCallback(callback.id, callbackNotice(data)).catch(() => {})
  await clearInlineKeyboard(chatId, callback.message?.message_id).catch(() => {})

  if (data === "home") {
    await clearSession(db, chatId)
    return showMain(chatId, "Main menu")
  }
  if (data === "mode:ee") {
    await replaceSession(db, chatId, { mode: "ee", step: "choose_platform" })
    return sendMessage(chatId, "Select the platform from which content will be imported.", platformKeyboard("platform"))
  }
  if (data === "storage:list") return showStorageAccounts(db, chatId, userId)
  if (data === "storage:refresh") return showStorageAccounts(db, chatId, userId, { refresh: true })
  if (data === "automation:menu") return showAutomationMenu(db, chatId)
  if (data.startsWith("automation:scope:")) return showTimeSelector(db, chatId, data.split(":")[2], 0)
  if (data.startsWith("automation:times:")) {
    const [, , scope, page] = data.split(":")
    return showTimeSelector(db, chatId, scope, Number(page))
  }
  if (data.startsWith("automation:set:")) {
    const [, , scope, minute] = data.split(":")
    await setSchedule(db, scope, Number(minute))
    await sendMessage(chatId, `✅ Schedule saved\n${scope === "overall" ? "All platforms" : PLATFORM_LABELS[scope] || scope}: ${scheduleLabel(Number(minute))}\nTimezone: Asia/Dhaka`)
    return showAutomationMenu(db, chatId)
  }
  if (data.startsWith("automation:toggle:")) {
    await toggleSchedule(db, data.split(":")[2])
    return showAutomationMenu(db, chatId)
  }
  if (data === "mode:tg") {
    return sendMessage(
      chatId,
      "This legacy action is no longer available. Use Content Import or Storage from the main menu.",
      keyboard([[button("‹ Main menu", "home")]]),
    )
  }
  if (data === "account:list") return showAccountMenu(db, chatId)
  if (data === "account:add") {
    await replaceSession(db, chatId, { mode: "account_add", step: "choose_platform" })
    return sendMessage(chatId, "Select the platform account you want to connect.", platformKeyboard("accountadd"))
  }
  if (data === "status") return showStatus(db, chatId)
  if (data.startsWith("accountadd:")) return startAccountAdd(db, chatId, data.split(":")[1])
  if (data.startsWith("platform:")) return showEeAccounts(db, chatId, data.split(":")[1])
  if (data.startsWith("acct:")) {
    const session = await getSession(db, chatId)
    const option = asArray(session.accountOptions)[Number(data.split(":")[1])]
    if (!option) throw new Error("Account selection expired")
    await setSession(db, chatId, { accountId: option.id })
    return loadSourceCourses(db, chatId, option.id)
  }
  if (data === "source:more") return showMoreSourceCourses(db, chatId)
  if (data.startsWith("src:")) return chooseSourceCourse(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("ee:")) return chooseEeCourse(db, chatId, Number(data.split(":")[1]))
  if (data === "sections:show") return showSourceSections(db, chatId, await getSession(db, chatId))
  if (data.startsWith("sect:")) return chooseSourceSection(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("dest:")) return chooseDestination(db, chatId, data.split(":")[1])
  if (data === "grp:new") {
    await setSession(db, chatId, { step: "new_group_title" })
    return sendMessage(chatId, "Enter a name for the new Class Card.\nExample: Foundation Classes")
  }
  if (data.startsWith("grp:")) return chooseGroup(db, chatId, Number(data.split(":")[1]))
  if (data === "mapping:check") return showMappingAnalysis(db, chatId, await getSession(db, chatId))
  if (data === "metadata:repair") return repairSelectedMetadata(db, chatId, userId, await getSession(db, chatId))
  if (data === "resources:repair") return enqueueResourceRepair(db, chatId, userId, await getSession(db, chatId))
  if (data === "snapshot:refresh") return refreshSnapshotForSession(db, chatId)
  if (data === "sync:confirm") {
    const session = await getSession(db, chatId)
    const analysis = await inspectMapping(db, session)
    return sendMessage(chatId, [
      "⚠️ Confirm content import",
      "",
      `Source: ${session.sourceCourseTitle}`,
      `Destination: ${session.eeCourseTitle}`,
      `Classes to import: ${analysis.toSync.length}`,
      `Location: ${destinationLabel(session)}`,
      "",
      "Only verified media will be published. Existing ready classes will not be duplicated.",
    ].join("\n"), keyboard([
      [button("Confirm import", "sync:all")],
      [button("Cancel", "mapping:check")],
    ]))
  }
  if (data === "sync:all") return syncAllSelected(db, chatId, userId, await getSession(db, chatId))
  if (data.startsWith("accountinfo:")) return showAccountInfo(db, chatId, data.split(":")[1])
  if (data.startsWith("accountrefresh:")) return refreshSavedAccount(db, chatId, data.split(":")[1])
  if (data.startsWith("accountdeleteconfirm:")) return deleteSavedAccount(db, chatId, data.split(":")[1])
  if (data.startsWith("accountdelete:")) return confirmDeleteAccount(db, chatId, data.split(":")[1])

  await sendMessage(chatId, "This action is no longer available. Open the latest menu with /start.")
}

function validWebhookSecret(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || ""
  if (!expected) return false
  return (req.headers["x-telegram-bot-api-secret-token"] || "") === expected
}

function requestAction(req) {
  return String(req.query?.action || "")
}

async function handleGoogleDriveRequest(req, res) {
  try {
    const action = requestAction(req)
    const state = String(req.query?.state || "")
    const stateData = verifySignedState(state)
    if (stateData.purpose !== "google-drive" || !isAllowedTelegramUser(stateData.telegramUserId)) {
      throw new Error("This Google Drive connection request is not authorized")
    }
    if (action === "drive-connect") return res.redirect(302, googleAuthorizationUrl(state))
    if (action !== "drive-callback") return res.status(404).send("Not found")
    if (req.query?.error) throw new Error(`Google authorization was declined: ${req.query.error}`)
    const code = String(req.query?.code || "")
    if (!code) throw new Error("Google did not return an authorization code")
    const db = stateData.requestedBy === "content-studio" ? getOperationsServices().db : getAdminServices().db
    const account = await connectGoogleDriveAccount(db, code, stateData.telegramUserId)
    await sendMessage(stateData.telegramUserId, `✅ Google Drive connected\nAccount: ${account.email}\nStorage folder: Easy Education Content`).catch(() => {})
    return res.status(200).send(stateData.requestedBy === "content-studio"
      ? "Google Drive connected successfully. You may close this window and return to Operations Studio."
      : "Google Drive connected successfully. You may close this window and return to Telegram.")
  } catch (error) {
    return res.status(400).send(`Google Drive connection failed: ${error.message || "Unknown error"}`)
  }
}

function validAutomationSecret(req) {
  const expected = process.env.AUTOMATION_SECRET || ""
  return Boolean(expected) && String(req.headers.authorization || "") === `Bearer ${expected}`
}

export default async function handler(req, res) {
  if (req.method === "GET" && ["drive-connect", "drive-callback"].includes(requestAction(req))) {
    return handleGoogleDriveRequest(req, res)
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"])
    return res.status(405).json({ ok: false, error: "Method Not Allowed" })
  }
  if (requestAction(req) === "automation-tick") {
    if (!validAutomationSecret(req)) return res.status(401).json({ ok: false, error: "Invalid automation secret" })
    const { db } = getAdminServices()
    try {
      const result = await runAutomationTick(db)
      return res.status(200).json({ ok: true, ...result })
    } catch (error) {
      console.error("Automation tick failed:", error)
      return res.status(500).json({ ok: false, error: error.message || "Automation tick failed" })
    }
  }
  if (!validWebhookSecret(req)) return res.status(401).json({ ok: false, error: "Invalid webhook secret" })

  const update = req.body || {}
  const incoming = update.message || update.callback_query?.message
  const from = update.message?.from || update.callback_query?.from
  const chatId = incoming?.chat?.id
  const userId = from?.id
  if (!chatId || !userId) return res.status(200).json({ ok: true })

  if (incoming.chat?.type !== "private") {
    await sendMessage(chatId, "For security, this bot can only be used in a private chat.").catch(() => {})
    return res.status(200).json({ ok: true })
  }
  if (!isAllowedTelegramUser(userId)) {
    await sendMessage(chatId, `Access denied.\n\nYour Telegram user ID: ${userId}\nAsk an administrator to add this ID to the approved access list.`).catch(() => {})
    return res.status(200).json({ ok: true })
  }

  const { db } = getAdminServices()
  try {
    if (update.callback_query) await handleCallback(db, update.callback_query)
    else if (update.message?.text) await handleText(db, update.message)
    else await sendMessage(chatId, "This message type is not supported. Use /start to open the operations menu.")
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error("Telegram bot error:", error)
    await sendMessage(
      chatId,
      `❌ ${error.message || "Unexpected bot error"}`,
      keyboard([[button("‹ Main menu", "home")]]),
    ).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}
