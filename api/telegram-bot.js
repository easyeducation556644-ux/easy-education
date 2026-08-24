import { FieldValue } from "firebase-admin/firestore"
import { getAdminServices } from "./utils/firebase-admin.js"
import { decryptSecret, encryptSecret, stableId } from "../server/bot/crypto.js"
import {
  answerCallback,
  button,
  deleteMessage,
  isAllowedTelegramUser,
  keyboard,
  mainMenu,
  sendMessage,
} from "../server/bot/telegram.js"
import {
  getUdvashClassMediaBulk,
  getUdvashCourseSnapshot,
  listUdvashCoursesV2,
  loginUdvashV2,
  normalizeContentTypeTitle,
} from "../server/bot/platforms/udvash-v2.js"

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
const BOT_CLASS_SYNC_SCHEMA = 1

const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const normalizeText = (value) => String(value || "").trim().toLowerCase()
const serverNow = () => FieldValue.serverTimestamp()

function normalizedSection(value) {
  return normalizeContentTypeTitle(String(value || "")).toLowerCase()
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
  await sendMessage(chatId, [prefix, "কি করতে চান?"].filter(Boolean).join("\n\n"), mainMenu())
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
  if (!snap.exists) throw new Error("Account পাওয়া যায়নি")
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
  if (!id) throw new Error("Source snapshot নেই। Source course আবার select করুন।")
  const ref = db.collection(SNAPSHOT_COLLECTION).doc(id)
  const [summarySnap, chunksSnap] = await Promise.all([ref.get(), ref.collection("chunks").get()])
  if (!summarySnap.exists) throw new Error("Source snapshot expire হয়েছে। Source course আবার scan করুন।")
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
  if (!snap.exists) throw new Error("Easy-Education course পাওয়া যায়নি")
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

async function repairImportedClassSync(db, session, existing) {
  const targets = existing
    .filter((item) => importedClassMatches(item, session))
    .filter((item) => Number(item.eeBotSyncSchema || 0) !== BOT_CLASS_SYNC_SCHEMA || (!item.videoURL && hasPlayableMedia(item)))

  let repaired = 0
  for (let start = 0; start < targets.length; start += 150) {
    const chunk = targets.slice(start, start + 150)
    const batch = db.batch()
    const changedIds = []

    chunk.forEach((item) => {
      const videoURL = classVideoUrl(item)
      batch.set(db.collection("classes").doc(item.id), {
        ...(item.videoURL || !videoURL ? {} : { videoURL }),
        eeBotSyncSchema: BOT_CLASS_SYNC_SCHEMA,
        updatedAt: serverNow(),
      }, { merge: true })
      if (!item.videoURL && videoURL) item.videoURL = videoURL
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
    throw new Error("Mapping session incomplete। EE UP থেকে আবার mapping খুলুন।")
  }
  const snapshot = await loadSnapshot(db, session.sourceSnapshotId)
  const sourceClasses = selectedSourceClasses(snapshot, session)
  const existing = await existingEeClasses(db, session.eeCourseId)
  const cacheRepairCount = repairCache ? await repairImportedClassSync(db, session, existing) : 0
  const imported = existing.filter((item) => importedClassMatches(item, session))
  const ready = imported.filter((item) => item.isPublished !== false && hasPlayableMedia(item))
  const readySourceIds = new Set(ready.map((item) => String(item.sourceClassId || "")).filter(Boolean))
  const pending = imported.filter((item) => !readySourceIds.has(String(item.sourceClassId || "")))
  const toSync = sourceClasses.filter((item) => !readySourceIds.has(String(item.sourceClassId)))
  return { snapshot, sourceClasses, existing, imported, ready, pending, toSync, cacheRepairCount }
}

function mappingKeyboard(analysis) {
  const rows = []
  if (analysis.toSync.length) rows.push([button(`🚀 Sync all ${analysis.toSync.length}`, "sync:all")])
  rows.push([button("🔄 Check EE", "mapping:check"), button("♻️ Refresh Udvash", "snapshot:refresh")])
  rows.push([button("🏠 Main", "home")])
  return keyboard(rows)
}

async function showMappingAnalysis(db, chatId, session) {
  const analysis = await inspectMapping(db, session, { repairCache: true })
  await setSession(db, chatId, {
    lastSnapshotCount: analysis.snapshot.classCount,
    lastSelectedCount: analysis.sourceClasses.length,
    lastReadyCount: analysis.ready.length,
    lastPendingCount: analysis.pending.length,
    lastToSyncCount: analysis.toSync.length,
  })

  const text = [
    `Platform: ${PLATFORM_LABELS[session.platform] || session.platform}`,
    `Source course: ${session.sourceCourseTitle}`,
    `Source type: ${session.sourceSectionTitle}`,
    `EE course: ${session.eeCourseTitle} (${session.eeCourseType || "subject"})`,
    `Destination: ${destinationLabel(session)}`,
    "",
    `Udvash snapshot total: ${analysis.snapshot.classCount}`,
    `এই content type-এর class: ${analysis.sourceClasses.length}`,
    `✅ EE ready: ${analysis.ready.length}`,
    `⏳ Pending/old staged: ${analysis.pending.length}`,
    `Sync লাগবে: ${analysis.toSync.length}`,
    analysis.cacheRepairCount ? `🔄 EE cache visibility repaired: ${analysis.cacheRepairCount}` : "",
    "",
    analysis.toSync.length
      ? `একবার Sync all চাপলেই ${analysis.toSync.length}টাই check + media resolve + EE write হবে। 20 করে আর চাপতে হবে না।`
      : "এই mapping পুরো synced আছে ✅",
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
      const media = mediaResult?.media || { youtubeLink: "", directSources: [] }
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
        topic: hierarchy.topic,
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
        resourceLinks: [],
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
        updatedAt: serverNow(),
        createdAt: serverNow(),
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
      }
      nextOrder += 1
    })
    await batch.commit()
    await publishClassSyncEvents(db, changedIds)
  }

  return { published, needsUpload, failed }
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
      `🚀 ${analysisBefore.toSync.length}টা class একবারেই sync করছি।`,
      `Full Udvash snapshot: ${analysisBefore.snapshot.classCount}`,
      "একই saved session/cookie ব্যবহার হবে; session expire না হলে আবার login হবে না।",
      "এখন আর কোনো Next 20 চাপতে হবে না।",
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
    (auth) => getUdvashClassMediaBulk(auth, toResolve, MEDIA_CONCURRENCY),
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
  await db.collection(MAPPING_COLLECTION).doc(mappingId).set({
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
    updatedAt: serverNow(),
    createdAt: serverNow(),
  }, { merge: true })

  await sendMessage(
    chatId,
    [
      "✅ Sync finished",
      `Old wrong staged cleaned: ${removed}`,
      `YouTube পাওয়া + EE published: ${result.published}`,
      `YouTube নেই, upload worker লাগবে: ${result.needsUpload}`,
      `Resolve failed/retry: ${result.failed}`,
      `EE ready total: ${finalAnalysis.ready.length}/${finalAnalysis.sourceClasses.length}`,
      "",
      result.needsUpload || result.failed
        ? "যেগুলো ready হয়নি সেগুলো worker queue-তে আছে; fake synced দেখানো হবে না।"
        : "Selected content type পুরো ready ✅",
    ].join("\n"),
    keyboard([[button("🔄 Check EE", "mapping:check"), button("🏠 Main", "home")]]),
  )
}

async function showEeAccounts(db, chatId, platform) {
  const accounts = await listAccounts(db, platform)
  if (!accounts.length) {
    await replaceSession(db, chatId, { mode: "ee", platform, step: "choose_account" })
    await sendMessage(
      chatId,
      `${PLATFORM_LABELS[platform]} account add করা নেই।`,
      keyboard([[button("➕ Add account", `accountadd:${platform}`)], [button("🏠 Main", "home")]]),
    )
    return
  }

  const options = accounts.map((item) => ({ id: item.id, label: item.label || item.roll, roll: item.roll }))
  await replaceSession(db, chatId, { mode: "ee", platform, step: "choose_account", accountOptions: options })
  const rows = options.slice(0, 20).map((item, index) => [button(`👤 ${item.label} · ${item.roll}`, `acct:${index}`)])
  rows.push([button("➕ Add account", `accountadd:${platform}`), button("🏠 Main", "home")])
  await sendMessage(chatId, `${PLATFORM_LABELS[platform]} — কোন account use হবে?`, keyboard(rows))
}

async function loadSourceCourses(db, chatId, accountId) {
  const account = await getAccount(db, accountId)
  await sendMessage(chatId, `${account.label || account.roll} account-এর saved session দিয়ে courses load করছি…`)
  const courses = await platformCourses(db, account)
  const options = courses.slice(0, 50).map((course) => ({
    id: String(course.id),
    title: course.title,
    type: course.type || "",
  }))
  await setSession(db, chatId, { accountId, step: "choose_source_course", sourceCourseOptions: options })

  if (!options.length) {
    await sendMessage(chatId, "এই account-এ কোনো course পাওয়া যায়নি।", keyboard([[button("🏠 Main", "home")]]))
    return
  }
  const rows = options.slice(0, 20).map((course, index) => [button(course.title, `src:${index}`)])
  if (options.length > 20) rows.push([button(`আরও ${options.length - 20}টা course`, "source:more")])
  rows.push([button("🏠 Main", "home")])
  await sendMessage(chatId, `${options.length}টা course পাওয়া গেছে। কোন course?`, keyboard(rows))
}

async function showMoreSourceCourses(db, chatId) {
  const session = await getSession(db, chatId)
  const options = asArray(session.sourceCourseOptions)
  const rows = options.slice(20, 50).map((course, index) => [button(course.title, `src:${index + 20}`)])
  rows.push([button("🏠 Main", "home")])
  await sendMessage(chatId, "বাকি courses:", keyboard(rows))
}

async function chooseSourceCourse(db, chatId, index) {
  const session = await getSession(db, chatId)
  const course = asArray(session.sourceCourseOptions)[index]
  if (!course) throw new Error("Source course selection expired")
  const account = await getAccount(db, session.accountId)

  await sendMessage(
    chatId,
    `📡 ${course.title}\nপুরো course একবার scan করছি—Subject → Chapter → Content Type → সব class। এরপর এই snapshot-ই reuse হবে।`,
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
      `✅ Full snapshot ready: ${snapshot.classCount} classes`,
      ...summary,
      "",
      "এখন Easy-Education-এর course নামের কিছু অংশ লিখুন।",
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
    await sendMessage(chatId, "Matching EE course পাইনি। আরেকটা keyword লিখুন।")
    return
  }
  const rows = options.map((course, index) => [button(`${course.title} · ${course.type}`, `ee:${index}`)])
  rows.push([button("❌ Cancel", "home")])
  await sendMessage(chatId, `${options.length}টা matching course পেয়েছি:`, keyboard(rows))
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
  if (!options.length) throw new Error("Source content type পাওয়া যায়নি")
  const rows = options.slice(0, 20).map((item, index) => [button(`${item.title} · ${item.count}`, `sect:${index}`)])
  rows.push([button("🏠 Main", "home")])
  await sendMessage(
    chatId,
    [
      `EE course: ${session.eeCourseTitle} (${session.eeCourseType || "subject"})`,
      `Udvash snapshot: ${session.sourceSnapshotCount || "?"} classes`,
      "",
      "কোন Udvash content type map করবেন?",
      "প্রতিটা type আলাদা destination-এ map করা যাবে।",
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
      "EE-তে কোথায় যাবে?",
    ].join("\n"),
    keyboard([
      [button("📚 Regular", "dest:regular"), button("🗄 Archive", "dest:archive")],
      [button("🧩 Class Card", "dest:groups")],
      [button("⬅️ Content types", "sections:show"), button("🏠 Main", "home")],
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
  rows.push([button("🏠 Main", "home")])
  await sendMessage(chatId, options.length ? "কোন Class Card?" : "এই course-এ Class Card নেই।", keyboard(rows))
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
  if (!session.eeCourseId) throw new Error("EE course select করা নেই")
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
  await sendMessage(chatId, `Class Card ready: ${group.title} ✅`)
  await showMappingAnalysis(db, chatId, next)
}

async function refreshSnapshotForSession(db, chatId) {
  const session = await getSession(db, chatId)
  if (!session.accountId || !session.sourceCourseId) throw new Error("Source course select করা নেই")
  const account = await getAccount(db, session.accountId)
  const sourceCourse = { id: session.sourceCourseId, title: session.sourceCourseTitle }
  await sendMessage(chatId, "♻️ Udvash source explicitly refresh করছি—পুরো course আবার একবার scan হবে।")
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
  await sendMessage(chatId, `✅ New snapshot ready: ${snapshot.classCount} classes`)
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
  const rows = options.map((item, index) => [
    button(`👤 ${item.label} · ${item.roll}`, `accountinfo:${index}`),
    button("🗑", `accountdelete:${index}`),
  ])
  rows.push([button("➕ Add account", "account:add")])
  rows.push([button("🏠 Main", "home")])
  await sendMessage(
    chatId,
    options.length ? `Saved accounts: ${options.length}\n\nAccount-এর পাশের 🗑 দিয়ে delete করা যাবে।` : "কোনো account add করা নেই।",
    keyboard(rows),
  )
}

async function showAccountInfo(db, chatId, index) {
  const session = await getSession(db, chatId)
  const option = asArray(session.accountManageOptions)[index]
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
      [button("🔄 Check session", `accountrefresh:${index}`)],
      [button("🗑 Delete account", `accountdelete:${index}`)],
      [button("⬅️ Accounts", "account:list")],
    ]),
  )
}

async function refreshSavedAccount(db, chatId, index) {
  const session = await getSession(db, chatId)
  const option = asArray(session.accountManageOptions)[index]
  if (!option) throw new Error("Account selection expired")
  const account = await getAccount(db, option.id)
  await sendMessage(chatId, `${account.label || account.roll} saved session check করছি…`)
  const courses = await platformCourses(db, account)
  await sendMessage(
    chatId,
    `✅ Session/account valid\n📚 ${courses.length}টা course পাওয়া গেছে।`,
    keyboard([[button("⬅️ Accounts", "account:list"), button("🏠 Main", "home")]]),
  )
}

async function confirmDeleteAccount(db, chatId, index) {
  const session = await getSession(db, chatId)
  const option = asArray(session.accountManageOptions)[index]
  if (!option) throw new Error("Account selection expired")
  await sendMessage(
    chatId,
    `⚠️ ${option.label} (${option.roll}) account delete করবেন?\n\nSaved credential/session delete হবে। EE classes delete হবে না।`,
    keyboard([[button("🗑 Yes, delete", `accountdeleteconfirm:${index}`)], [button("❌ Cancel", "account:list")]]),
  )
}

async function deleteSavedAccount(db, chatId, index) {
  const session = await getSession(db, chatId)
  const option = asArray(session.accountManageOptions)[index]
  if (!option) throw new Error("Account selection expired")
  await db.collection(ACCOUNT_COLLECTION).doc(option.id).delete()
  await sendMessage(chatId, `✅ ${option.label} account delete হয়েছে।`)
  await showAccountMenu(db, chatId)
}

async function startAccountAdd(db, chatId, platform) {
  if (!PLATFORM_IDS.has(platform)) throw new Error("Unsupported platform")
  await replaceSession(db, chatId, { mode: "account_add", platform, step: "add_account_label" })
  await sendMessage(chatId, `${PLATFORM_LABELS[platform]} account-এর একটা নাম দিন। যেমন: UDVASH-1`)
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
    await showMain(chatId, `❌ Udvash login failed:\n${error.message || "Unknown error"}\n\nAccount save করা হয়নি।`)
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
  await showMain(chatId, `✅ Login successful\n📚 ${courses.length}টা course পাওয়া গেছে।\nCredential encrypted করে save হয়েছে।`)
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
    `Accounts: ${accounts.size}\nSource snapshots: ${snapshots.size}\nCourse mappings: ${mappings.size}\nWorker jobs: ${jobsText}`,
    keyboard([[button("🏠 Main", "home")]]),
  )
}

async function handleText(db, message) {
  const chatId = message.chat.id
  const userId = message.from?.id
  const text = String(message.text || "").trim()
  const command = text.split(/\s+/)[0].toLowerCase()

  if (["/start", "/menu", "/cancel"].includes(command)) {
    await clearSession(db, chatId)
    await showMain(chatId, "Easy-Education Upload Bot")
    return
  }
  if (command === "/accounts") return showAccountMenu(db, chatId)
  if (command === "/status") return showStatus(db, chatId)

  const session = await getSession(db, chatId)
  if (session.step === "add_account_label") {
    await setSession(db, chatId, { accountLabel: text.slice(0, 60), step: "add_account_roll" })
    await sendMessage(chatId, "Roll / user ID দিন:")
    return
  }
  if (session.step === "add_account_roll") {
    await setSession(db, chatId, { accountRoll: text.slice(0, 120), step: "add_account_password" })
    await sendMessage(chatId, "Password দিন। Process হওয়ার পর password message delete করার চেষ্টা করব।")
    return
  }
  if (session.step === "add_account_password") {
    await deleteMessage(chatId, message.message_id)
    await sendMessage(chatId, "Credential পেয়েছি। Login verify করছি…")
    await saveAccountPassword(db, chatId, userId, text)
    return
  }
  if (session.step === "ee_search") return handleEeSearch(db, chatId, text)
  if (session.step === "new_group_title") return createClassGroupFromText(db, chatId, text)

  await showMain(chatId, "Command বুঝিনি। নিচের menu ব্যবহার করুন।")
}

async function handleCallback(db, callback) {
  const chatId = callback.message?.chat?.id
  const userId = callback.from?.id
  const data = String(callback.data || "")
  if (!chatId) return
  await answerCallback(callback.id).catch(() => {})

  if (data === "home") {
    await clearSession(db, chatId)
    return showMain(chatId, "Main menu")
  }
  if (data === "mode:ee") {
    await replaceSession(db, chatId, { mode: "ee", step: "choose_platform" })
    return sendMessage(chatId, "কোন platform থেকে EE UP করবেন?", platformKeyboard("platform"))
  }
  if (data === "mode:tg") {
    return sendMessage(
      chatId,
      "TG UP এখন media worker phase placeholder। EE UP source/mapping engine আলাদা রাখা হয়েছে।",
      keyboard([[button("🏠 Main", "home")]]),
    )
  }
  if (data === "account:list") return showAccountMenu(db, chatId)
  if (data === "account:add") {
    await replaceSession(db, chatId, { mode: "account_add", step: "choose_platform" })
    return sendMessage(chatId, "কোন platform-এর account add করবেন?", platformKeyboard("accountadd"))
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
    return sendMessage(chatId, "নতুন Class Card-এর নাম লিখুন। যেমন: Foundation classes")
  }
  if (data.startsWith("grp:")) return chooseGroup(db, chatId, Number(data.split(":")[1]))
  if (data === "mapping:check") return showMappingAnalysis(db, chatId, await getSession(db, chatId))
  if (data === "snapshot:refresh") return refreshSnapshotForSession(db, chatId)
  if (data === "sync:all") return syncAllSelected(db, chatId, userId, await getSession(db, chatId))
  if (data.startsWith("accountinfo:")) return showAccountInfo(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("accountrefresh:")) return refreshSavedAccount(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("accountdeleteconfirm:")) return deleteSavedAccount(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("accountdelete:")) return confirmDeleteAccount(db, chatId, Number(data.split(":")[1]))

  await sendMessage(chatId, "এই action expire করেছে। /start দিয়ে আবার শুরু করুন।")
}

function validWebhookSecret(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || ""
  if (!expected) return true
  return (req.headers["x-telegram-bot-api-secret-token"] || "") === expected
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"])
    return res.status(405).json({ ok: false, error: "Method Not Allowed" })
  }
  if (!validWebhookSecret(req)) return res.status(401).json({ ok: false, error: "Invalid webhook secret" })

  const update = req.body || {}
  const incoming = update.message || update.callback_query?.message
  const from = update.message?.from || update.callback_query?.from
  const chatId = incoming?.chat?.id
  const userId = from?.id
  if (!chatId || !userId) return res.status(200).json({ ok: true })

  if (incoming.chat?.type !== "private") {
    await sendMessage(chatId, "Security-এর জন্য bot-টা private chat-এ ব্যবহার করুন।").catch(() => {})
    return res.status(200).json({ ok: true })
  }
  if (!isAllowedTelegramUser(userId)) {
    await sendMessage(chatId, `এই bot-এ আপনার access নেই।\nTelegram user ID: ${userId}`).catch(() => {})
    return res.status(200).json({ ok: true })
  }

  const { db } = getAdminServices()
  try {
    if (update.callback_query) await handleCallback(db, update.callback_query)
    else if (update.message?.text) await handleText(db, update.message)
    else await sendMessage(chatId, "এখন text/button input support করছি। /start দিন।")
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error("Telegram bot error:", error)
    await sendMessage(
      chatId,
      `❌ ${error.message || "Unexpected bot error"}`,
      keyboard([[button("🏠 Main", "home")]]),
    ).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}
