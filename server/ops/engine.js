import { FieldValue } from "firebase-admin/firestore"
import { decryptSecret, encryptSecret, stableId } from "../bot/crypto.js"
import {
  getUdvashClassMediaBulk,
  getUdvashCourseSnapshot,
  listUdvashCoursesV2,
  loginUdvashV2,
  normalizeContentTypeTitle,
} from "../bot/platforms/udvash-v2.js"
import { persistResourceLinksToDrive } from "../bot/google-drive.js"

const TASKS = "opsTasks"
const PREVIEWS = "opsPreviews"
const ACCOUNTS = "botPlatformAccounts"
const MAPPINGS = "botCourseMappings"
const SNAPSHOTS = "botSourceSnapshots"
const MAX_ATTEMPTS = 3
const BATCH_SIZE = 5
const LEASE_MS = 270_000
const PUBLIC_SYNC_FEED_LIMIT = 1000

function stores(value) {
  if (value?.opsDb && value?.contentDb) return value
  return { opsDb: value, contentDb: value }
}

const now = () => FieldValue.serverTimestamp()
const array = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const text = (value, limit = 500) => {
  const result = String(value || "").replace(/\s+/g, " ").trim()
  return result.length > limit ? `${result.slice(0, limit - 1)}…` : result
}
const sectionKey = (value) => normalizeContentTypeTitle(String(value || "")).toLowerCase()
const plainDate = (value) => {
  if (!value) return null
  if (typeof value.toDate === "function") return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return value
}
const timestampMs = (value) => {
  if (!value) return 0
  if (typeof value.toMillis === "function") return value.toMillis()
  if (Number.isFinite(value?._seconds)) return Number(value._seconds) * 1000
  if (Number.isFinite(value?.seconds)) return Number(value.seconds) * 1000
  return Number(value) || 0
}

function classTitle(item) {
  return text(item?.title || item?.classTitle || item?.sourceClassId || "Untitled class", 120)
}

function classHierarchy(sourceClass, courseType) {
  if ((courseType || "subject") === "batch") {
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

function destinationMatches(item, mapping) {
  if (mapping.destinationType === "archive") return item.isArchived === true
  if (mapping.destinationType === "group") {
    return item.isArchived !== true && String(item.classGroupId || "") === String(mapping.classGroupId || "")
  }
  return item.isArchived !== true && !item.classGroupId
}

function importedMatches(item, mapping) {
  return item.sourcePlatform === mapping.platform
    && String(item.sourceCourseId || "") === String(mapping.sourceCourseId || "")
    && sectionKey(item.sourceSectionKey || item.sourceSection) === sectionKey(mapping.sourceSectionKey || mapping.sourceSectionTitle)
    && destinationMatches(item, mapping)
}

function sourceClassesForMapping(snapshot, mapping) {
  const key = sectionKey(mapping.sourceSectionKey || mapping.sourceSectionTitle)
  return array(snapshot.classes).filter((item) => sectionKey(item.sectionKey || item.sectionTitle) === key)
}

function resourceAudit(item) {
  const links = array(item?.resourceLinks)
  const valid = []
  let broken = 0
  let direct = 0
  let failed = 0
  for (const resource of links) {
    const url = String(resource?.url || resource?.link || "").trim()
    if (resource?.storageStatus === "failed" || resource?.storageError) failed += 1
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (!/^https?:/i.test(url)) broken += 1
      else valid.push(url)
      if (/udvash-unmesh|udvash\.com|storage-r\d+\.udvash/i.test(host)) direct += 1
    } catch { broken += 1 }
  }
  const slideFields = [item?.slideLink, item?.slideUrl, ...array(item?.slides)]
    .map((value) => typeof value === "string" ? value : value?.url)
    .filter(Boolean)
  const missingResource = links.length === 0
  const missingSlide = slideFields.length === 0 && !links.some((resource) => /slide/i.test(String(resource?.label || resource?.title || "")))
  return {
    linkCount: links.length,
    missingResource,
    missingSlide,
    directSourceLinks: direct,
    brokenLinks: broken,
    failedResources: failed,
    readyDriveLinks: valid.length - direct,
    needsRepair: missingResource || direct > 0 || broken > 0 || failed > 0,
  }
}

async function loadSnapshot(db, id) {
  const ref = db.collection(SNAPSHOTS).doc(String(id || ""))
  const [summary, chunks] = await Promise.all([ref.get(), ref.collection("chunks").get()])
  if (!summary.exists) throw new Error("Source snapshot was not found. Refresh the source course first")
  const ordered = chunks.docs.map((doc) => doc.data()).sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
  return { id: summary.id, ...summary.data(), classes: ordered.flatMap((item) => array(item.items)) }
}

async function loadMapping(db, mappingId) {
  const snap = await db.collection(MAPPINGS).doc(String(mappingId || "")).get()
  if (!snap.exists) throw new Error("Mapping was not found")
  return { id: snap.id, ...snap.data() }
}

async function existingClasses(db, courseId) {
  const snap = await db.collection("classes").where("courseId", "==", String(courseId)).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

async function sourceAccount(db, accountId, legacyDb = null) {
  const snap = await db.collection(ACCOUNTS).doc(String(accountId || "")).get()
  if (!snap.exists && legacyDb && legacyDb !== db) {
    const legacy = await legacyDb.collection(ACCOUNTS).doc(String(accountId || "")).get().catch(() => null)
    if (legacy?.exists) {
      const data = legacy.data()
      await db.collection(ACCOUNTS).doc(legacy.id).set({
        ...data,
        migratedFromLegacyDatabase: true,
        migratedAt: now(),
        updatedAt: now(),
      }, { merge: true })
      return { id: legacy.id, ...data }
    }
  }
  if (!snap.exists) {
    const error = new Error("Source account is not connected in the Operations database. Add the Udvash account again from Connections.")
    error.code = "SOURCE_ACCOUNT_NOT_CONNECTED"
    error.statusCode = 409
    throw error
  }
  return { id: snap.id, ...snap.data() }
}

function savedAuth(account) {
  let cookie = ""
  let token = ""
  try { cookie = decryptSecret(account.cookieEncrypted || "") } catch {}
  try { token = decryptSecret(account.tokenEncrypted || "") } catch {}
  return { cookie, token }
}

async function saveAuth(db, account, auth, extra = {}) {
  await db.collection(ACCOUNTS).doc(account.id).set({
    cookieEncrypted: auth.cookie ? encryptSecret(auth.cookie) : account.cookieEncrypted || "",
    tokenEncrypted: auth.token ? encryptSecret(auth.token) : account.tokenEncrypted || "",
    status: "ready",
    lastError: "",
    lastSessionAt: now(),
    updatedAt: now(),
    ...extra,
  }, { merge: true })
}

function expiredSession(error) {
  return error?.code === "UDVASH_SESSION_EXPIRED"
    || /session expired|account\/login|account\/password|login করতে হবে/i.test(String(error?.message || error || ""))
}

async function loginFresh(db, account) {
  const password = decryptSecret(account.passwordEncrypted || "")
  if (!password) throw new Error("Source account password is unavailable. Reconnect the account")
  const auth = await loginUdvashV2({ roll: account.roll, password })
  await saveAuth(db, account, auth, { lastLoginAt: now() })
  return auth
}

async function withAuth(db, account, operation) {
  let auth = savedAuth(account)
  let didLogin = false
  if (!auth.cookie && !auth.token) {
    auth = await loginFresh(db, account)
    didLogin = true
  }
  try {
    const result = await operation(auth)
    await saveAuth(db, account, auth)
    return result
  } catch (error) {
    if (!didLogin && expiredSession(error)) {
      auth = await loginFresh(db, account)
      const result = await operation(auth)
      await saveAuth(db, account, auth)
      return result
    }
    await db.collection(ACCOUNTS).doc(account.id).set({ status: expiredSession(error) ? "login_required" : "error", lastError: text(error?.message || error), updatedAt: now() }, { merge: true }).catch(() => {})
    throw error
  }
}

async function saveSnapshot(db, account, course, snapshot) {
  const id = stableId("udvash-snapshot", account.id, course.id)
  const ref = db.collection(SNAPSHOTS).doc(id)
  const oldChunks = await ref.collection("chunks").get()
  for (let start = 0; start < oldChunks.docs.length; start += 400) {
    const batch = db.batch()
    oldChunks.docs.slice(start, start + 400).forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
  const classes = array(snapshot.classes)
  await ref.set({
    platform: account.platform || "udvash",
    accountId: account.id,
    sourceCourseId: String(course.id),
    sourceCourseTitle: course.title,
    classCount: classes.length,
    sections: array(snapshot.sections),
    cacheVersion: Date.now(),
    scannedAt: now(),
    updatedAt: now(),
  }, { merge: true })
  for (let start = 0; start < classes.length; start += 100) {
    await ref.collection("chunks").doc(String(start / 100).padStart(4, "0")).set({ index: start / 100, items: classes.slice(start, start + 100) })
  }
  return { id, classCount: classes.length, sections: array(snapshot.sections) }
}

export async function refreshOpsSourceAccount(context, accountId) {
  const { opsDb: db, contentDb } = stores(context)
  const account = await sourceAccount(db, accountId, contentDb)
  const courses = await withAuth(db, account, (auth) => listUdvashCoursesV2(auth))
  const compact = courses.map((course) => ({ id: String(course.id), title: text(course.title, 180), type: course.type || "" }))
  await db.collection(ACCOUNTS).doc(account.id).set({ courses: compact, courseCount: compact.length, lastCatalogAt: now(), status: "ready", updatedAt: now() }, { merge: true })
  return { accountId: account.id, courses: compact }
}

export async function scanOpsSourceCourse(context, accountId, courseId) {
  const { opsDb: db, contentDb } = stores(context)
  const account = await sourceAccount(db, accountId, contentDb)
  let courses = array(account.courses)
  if (!courses.length) courses = (await refreshOpsSourceAccount({ opsDb: db, contentDb }, account.id)).courses
  const course = courses.find((item) => String(item.id) === String(courseId))
  if (!course) throw new Error("Course was not found in this source account")
  const snapshot = await withAuth(db, account, (auth) => getUdvashCourseSnapshot(auth, course.id))
  return saveSnapshot(db, account, course, snapshot)
}

export async function opsSourceTree(context, snapshotId) {
  const { opsDb: db } = stores(context)
  const snapshot = await loadSnapshot(db, snapshotId)
  const sections = new Map()
  for (const item of array(snapshot.classes)) {
    const key = sectionKey(item.sectionKey || item.sectionTitle || "other")
    if (!sections.has(key)) sections.set(key, { key, title: item.sectionTitle || "Other", count: 0, subjects: new Map() })
    const section = sections.get(key); section.count += 1
    const subjectKey = String(item.sourceSubjectId || item.subjectTitle || "general")
    if (!section.subjects.has(subjectKey)) section.subjects.set(subjectKey, { id: subjectKey, title: item.subjectTitle || "General", count: 0, chapters: new Map() })
    const subject = section.subjects.get(subjectKey); subject.count += 1
    const chapterKey = String(item.sourceChapterId || item.chapterTitle || "general")
    if (!subject.chapters.has(chapterKey)) subject.chapters.set(chapterKey, { id: chapterKey, title: item.chapterTitle || "General", count: 0, classes: [] })
    const chapter = subject.chapters.get(chapterKey); chapter.count += 1
    chapter.classes.push({ sourceClassId: String(item.sourceClassId || ""), title: classTitle(item), duration: item.duration || "" })
  }
  return {
    snapshot: { id: snapshot.id, sourceCourseId: String(snapshot.sourceCourseId || ""), title: snapshot.sourceCourseTitle || "Untitled course", classCount: Number(snapshot.classCount || snapshot.classes.length) },
    sections: [...sections.values()].map((section) => ({ ...section, subjects: [...section.subjects.values()].map((subject) => ({ ...subject, chapters: [...subject.chapters.values()] })) })),
  }
}

function previewItem(sourceClass, existingForSource, mapping) {
  const duplicates = existingForSource.length > 1
  const destination = existingForSource.find((item) => destinationMatches(item, mapping)) || existingForSource[0] || null
  const audit = resourceAudit(destination)
  const issues = []
  if (!destination) issues.push("NEW_CLASS")
  if (duplicates) issues.push("DUPLICATE_CLASS")
  if (audit.missingSlide) issues.push("MISSING_SLIDE")
  if (audit.missingResource) issues.push("MISSING_RESOURCE")
  if (audit.directSourceLinks) issues.push("DIRECT_SOURCE_LINK")
  if (audit.brokenLinks) issues.push("BROKEN_LINK")
  if (audit.failedResources) issues.push("FAILED_RESOURCE")
  return {
    sourceClassId: String(sourceClass.sourceClassId || ""),
    title: classTitle(sourceClass),
    subjectTitle: sourceClass.subjectTitle || "General",
    chapterTitle: sourceClass.chapterTitle || "General",
    sourceClass,
    destinationClassId: destination?.id || null,
    destinationTitle: destination?.title || null,
    duplicateClassIds: duplicates ? existingForSource.map((item) => item.id) : [],
    issues,
    audit,
  }
}

export async function createOpsPreview(context, mappingId) {
  const { opsDb, contentDb } = stores(context)
  const mapping = await loadMapping(opsDb, mappingId)
  let snapshotId = mapping.sourceSnapshotId || ""
  if (!snapshotId) {
    const candidates = await opsDb.collection(SNAPSHOTS).where("accountId", "==", String(mapping.accountId || "")).get()
    const match = candidates.docs.find((doc) => String(doc.data().sourceCourseId || "") === String(mapping.sourceCourseId || ""))
    snapshotId = match?.id || ""
  }
  const [snapshot, existing, groups] = await Promise.all([
    loadSnapshot(opsDb, snapshotId),
    existingClasses(contentDb, mapping.eeCourseId),
    contentDb.collection("classGroups").where("courseId", "==", String(mapping.eeCourseId)).get(),
  ])
  const source = sourceClassesForMapping(snapshot, mapping)
  const existingBySource = new Map()
  for (const item of existing.filter((row) => importedMatches(row, mapping))) {
    const id = String(item.sourceClassId || "")
    existingBySource.set(id, [...(existingBySource.get(id) || []), item])
  }
  const items = source.map((item) => previewItem(item, existingBySource.get(String(item.sourceClassId || "")) || [], mapping))
  const groupIds = new Set(groups.docs.map((doc) => doc.id))
  const orphaned = existing.filter((item) => item.classGroupId && !groupIds.has(String(item.classGroupId))).length
  const count = (issue) => items.filter((item) => item.issues.includes(issue)).length
  const summary = {
    total: items.length,
    matched: items.filter((item) => item.destinationClassId).length,
    newClasses: count("NEW_CLASS"),
    duplicates: count("DUPLICATE_CLASS"),
    missingSlides: count("MISSING_SLIDE"),
    missingResources: count("MISSING_RESOURCE"),
    directSourceLinks: count("DIRECT_SOURCE_LINK"),
    brokenLinks: count("BROKEN_LINK"),
    failedResources: count("FAILED_RESOURCE"),
    orphaned,
    estimatedReads: items.length * 2 + 10,
    estimatedWrites: items.length * 3 + 20,
    estimatedUploads: items.filter((item) => item.audit.needsRepair).length,
    eligible: {
      audit: items.length,
      sync: items.length,
      resourceRepair: items.filter((item) => item.destinationClassId && item.audit.needsRepair).length,
      directLinkMigration: items.filter((item) => item.destinationClassId && item.issues.includes("DIRECT_SOURCE_LINK")).length,
      duplicateCleanup: items.filter((item) => item.issues.includes("DUPLICATE_CLASS")).length,
    },
  }
  const id = `preview_${stableId(mappingId, Date.now())}`
  await opsDb.collection(PREVIEWS).doc(id).set({
    mappingId,
    mapping: {
      platform: mapping.platform,
      accountId: mapping.accountId,
      sourceCourseId: String(mapping.sourceCourseId || ""),
      sourceCourseTitle: mapping.sourceCourseTitle || "",
      sourceSectionKey: mapping.sourceSectionKey || "",
      sourceSectionTitle: mapping.sourceSectionTitle || "",
      sourceSnapshotId: snapshot.id,
      eeCourseId: mapping.eeCourseId,
      eeCourseTitle: mapping.eeCourseTitle,
      eeCourseType: mapping.eeCourseType || "subject",
      destinationType: mapping.destinationType || "main",
      classGroupId: mapping.classGroupId || null,
      classGroupTitle: mapping.classGroupTitle || "",
    },
    summary,
    items,
    status: "ready",
    createdAt: now(),
    expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
  })
  return { id, mappingId, summary, items: items.map(({ sourceClass, ...item }) => item).slice(0, 200) }
}

function taskItemForType(item, type) {
  if (type === "audit") return true
  if (type === "sync") return true
  if (type === "duplicate-cleanup") return item.issues.includes("DUPLICATE_CLASS")
  if (type === "direct-link-migration") return Boolean(item.destinationClassId) && item.issues.includes("DIRECT_SOURCE_LINK")
  return Boolean(item.destinationClassId) && item.audit.needsRepair
}

export async function createOpsTask(context, { previewId, name, type = "resource-repair" }) {
  const { opsDb } = stores(context)
  const cleanName = text(name, 120)
  if (cleanName.length < 3) throw new Error("Task name must contain at least 3 characters")
  if (!new Set(["audit", "sync", "resource-repair", "direct-link-migration", "duplicate-cleanup"]).has(type)) throw new Error("Unsupported task type")
  const previewSnap = await opsDb.collection(PREVIEWS).doc(String(previewId || "")).get()
  if (!previewSnap.exists) throw new Error("Preview was not found or has expired")
  const preview = previewSnap.data()
  const selected = array(preview.items).filter((item) => taskItemForType(item, type))
  if (type !== "audit" && selected.length === 0) {
    const error = new Error(type === "resource-repair"
      ? "No matched Easy Education classes need repair. Choose Import and sync when the source classes are new."
      : `No classes are eligible for ${type.replaceAll("-", " ")}.`)
    error.code = "NO_ELIGIBLE_ITEMS"
    error.statusCode = 409
    throw error
  }
  if (selected.length > 450) {
    const error = new Error("This task is larger than the safe atomic limit. Select a smaller source section.")
    error.code = "TASK_TOO_LARGE"
    error.statusCode = 409
    throw error
  }
  const id = `task_${stableId(preview.mappingId, type, cleanName, Date.now())}`
  const ref = opsDb.collection(TASKS).doc(id)
  const immediateComplete = type === "audit"
  const taskData = {
    name: cleanName,
    type,
    status: immediateComplete ? "completed" : "queued",
    mappingId: preview.mappingId,
    mapping: preview.mapping,
    previewId: previewSnap.id,
    summary: preview.summary,
    total: selected.length,
    pending: immediateComplete ? 0 : selected.length,
    processed: immediateComplete ? selected.length : 0,
    succeeded: immediateComplete ? selected.length : 0,
    skipped: 0,
    failed: 0,
    current: null,
    recentEvents: [{ at: new Date().toISOString(), level: "info", message: immediateComplete ? "Read-only audit completed" : "Task queued" }],
    requestedBy: "operations-studio",
    createdAt: now(),
    updatedAt: now(),
    ...(immediateComplete ? { completedAt: now() } : {}),
  }
  if (immediateComplete) {
    await ref.set(taskData)
  } else {
    const batch = opsDb.batch()
    batch.set(ref, taskData)
    selected.forEach((item, index) => {
      const itemId = `${String(index).padStart(5, "0")}_${stableId(item.sourceClassId)}`
      batch.set(ref.collection("items").doc(itemId), {
        ...item,
        order: index,
        status: "pending",
        attempts: 0,
        createdAt: now(),
        updatedAt: now(),
      })
    })
    await batch.commit()
  }
  return { id, name: cleanName, type, status: immediateComplete ? "completed" : "queued", total: selected.length }
}

function event(level, message, extra = {}) {
  return { at: new Date().toISOString(), level, message: text(message, 220), ...extra }
}

async function publishClassChanges(db, classIds, opsDb = db) {
  const ids = [...new Set(array(classIds).map(String).filter(Boolean))]
  if (!ids.length) return
  const ref = db.collection("settings").doc("contentSync")
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    const current = snap.exists ? snap.data() : {}
    let seq = Number(current.seq || 0)
    const stamp = Date.now()
    const next = ids.map((docId, index) => ({ eventId: `classes:${docId}:ops-${stamp.toString(36)}-${index}`, collection: "classes", docId, action: "changed", scope: "public", seq: ++seq, createdAt: stamp }))
    transaction.set(ref, { type: "content-sync", seq, events: [...array(current.events), ...next].slice(-PUBLIC_SYNC_FEED_LIMIT), updatedAt: stamp }, { merge: true })
  })
  await opsDb.collection("opsCatalogCache").doc("ee-tree-v1").delete().catch(() => {})
}

async function claimTask(db, taskId) {
  const ref = db.collection(TASKS).doc(String(taskId || ""))
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists) throw new Error("Task was not found")
    const task = snap.data()
    if (["paused", "cancelled", "completed", "completed_with_errors"].includes(task.status)) return { terminal: true, id: snap.id, ...task }
    if (task.status === "running" && Number(task.leaseExpiresAtMs || 0) > Date.now()) return { busy: true, id: snap.id, ...task }
    transaction.set(ref, { status: "running", leaseExpiresAtMs: Date.now() + LEASE_MS, workerRuns: FieldValue.increment(1), startedAt: task.startedAt || now(), updatedAt: now() }, { merge: true })
    return { id: snap.id, ref, ...task, status: "running" }
  })
}

async function claimItems(db, task) {
  const pending = await task.ref.collection("items").where("status", "==", "pending").limit(BATCH_SIZE).get()
  let docs = pending.docs
  if (!docs.length) docs = (await task.ref.collection("items").where("status", "==", "retry").limit(BATCH_SIZE).get()).docs
  const claimed = []
  for (const doc of docs) {
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(doc.ref)
      if (!snap.exists || !["pending", "retry"].includes(snap.data().status)) return null
      transaction.set(doc.ref, { status: "running", attempts: FieldValue.increment(1), startedAt: now(), updatedAt: now() }, { merge: true })
      return { id: snap.id, ref: doc.ref, ...snap.data(), attempts: Number(snap.data().attempts || 0) + 1 }
    })
    if (result) claimed.push(result)
  }
  return claimed
}

function cleanResources(value) {
  return array(value).map((item, index) => ({
    label: text(item?.label || item?.title || `Resource ${index + 1}`, 160),
    url: String(item?.url || item?.link || "").trim(),
    ...(item?.driveFileId ? { driveFileId: String(item.driveFileId) } : {}),
    ...(item?.storageStatus ? { storageStatus: String(item.storageStatus) } : {}),
    ...(item?.storageError ? { storageError: text(item.storageError) } : {}),
  })).filter((item) => item.label && item.url)
}

async function processDuplicateCleanup(db, opsDb, task, item) {
  const ids = array(item.duplicateClassIds)
  if (ids.length < 2) return { kind: "skipped", message: "No duplicate records remain" }
  const canonical = item.destinationClassId || ids[0]
  const quarantined = ids.filter((id) => id !== canonical)
  const batch = db.batch()
  quarantined.forEach((id) => batch.set(db.collection("classes").doc(id), {
    isPublished: false,
    opsQuarantined: true,
    opsQuarantineReason: "duplicate-source-identity",
    opsCanonicalClassId: canonical,
    updatedAt: now(),
  }, { merge: true }))
  await batch.commit()
  await publishClassChanges(db, quarantined, opsDb)
  return { kind: "success", message: `${quarantined.length} duplicate class record(s) quarantined`, classId: canonical, quarantined }
}

async function processMediaItem(db, opsDb, task, item, mediaResult, mapping) {
  if (mediaResult?.error) throw new Error(mediaResult.error)
  const media = mediaResult?.media || {}
  const resources = cleanResources(media.resourceLinks)
  const failed = resources.find((resource) => resource.storageStatus === "failed")
  if (failed) throw new Error(`Drive storage failed for ${failed.label}: ${failed.storageError || "upload failed"}`)
  const permanent = resources.filter((resource) => resource.driveFileId && resource.url)
  if (task.type !== "sync" && !permanent.length) throw new Error("No verified Google Drive resource was produced")
  let classId = item.destinationClassId
  if (!classId && task.type !== "sync") return { kind: "skipped", message: "Destination class does not exist" }
  if (!classId) classId = `ops_${stableId(mapping.platform, mapping.sourceCourseId, mapping.eeCourseId, mapping.destinationType, mapping.classGroupId || "", mapping.sourceSectionKey, item.sourceClassId)}`
  const sourceClass = item.sourceClass || {}
  const hierarchy = classHierarchy(sourceClass, mapping.eeCourseType)
  const ref = db.collection("classes").doc(classId)
  const before = await ref.get()
  const beforeData = before.exists ? before.data() : {}
  const patch = task.type === "sync" ? {
    courseId: mapping.eeCourseId,
    title: sourceClass.title || item.title || "Untitled class",
    topic: String(media.topic || hierarchy.topic || "").trim(),
    chapter: hierarchy.chapter,
    subject: hierarchy.subject,
    order: Number(beforeData.order || item.order || 0),
    duration: sourceClass.duration || beforeData.duration || "",
    youtubeLink: media.youtubeLink || beforeData.youtubeLink || "",
    videoURL: media.youtubeLink || beforeData.videoURL || "",
    teacherName: array(sourceClass.teacherName),
    resourceLinks: permanent,
    resourceStorage: permanent.length ? "google-drive" : "none",
    isArchived: mapping.destinationType === "archive",
    classGroupId: mapping.destinationType === "group" ? mapping.classGroupId : null,
    isPublished: Boolean(media.youtubeLink || beforeData.youtubeLink || beforeData.videoURL),
    mediaStatus: media.youtubeLink || beforeData.youtubeLink || beforeData.videoURL ? "ee_ready" : "needs_video",
    importedBy: "operations-studio",
    sourcePlatform: mapping.platform,
    sourceAccountId: mapping.accountId,
    sourceCourseId: String(mapping.sourceCourseId || ""),
    sourceCourseTitle: mapping.sourceCourseTitle || "",
    sourceSection: sourceClass.sectionTitle || mapping.sourceSectionTitle || "",
    sourceSectionKey: mapping.sourceSectionKey || "",
    sourceClassId: String(item.sourceClassId || ""),
    sourceSubject: sourceClass.subjectTitle || "",
    sourceChapter: sourceClass.chapterTitle || "",
    resourceRepairError: "",
    resourceStorageUpdatedAt: now(),
    updatedAt: now(),
    ...(!before.exists ? { createdAt: now() } : {}),
  } : {
    resourceLinks: permanent,
    resourceStorage: "google-drive",
    resourceRepairError: "",
    resourceStorageUpdatedAt: now(),
    updatedAt: now(),
  }
  await ref.set(patch, { merge: true })
  await publishClassChanges(db, [classId], opsDb)
  return {
    kind: "success",
    message: before.exists ? `${permanent.length} resource link(s) updated` : `Class created with ${permanent.length} Drive resource(s)`,
    classId,
    driveFiles: permanent.map((resource) => ({ label: resource.label, driveFileId: resource.driveFileId, url: resource.url })),
    before: { title: beforeData.title || null, resourceLinks: cleanResources(beforeData.resourceLinks) },
    after: { title: patch.title || beforeData.title || item.title, resourceLinks: permanent },
  }
}

async function finishItem(task, item, result, error) {
  if (error) {
    const terminal = item.attempts >= MAX_ATTEMPTS
    await item.ref.set({
      status: terminal ? "failed" : "retry",
      lastError: text(error?.message || error),
      stage: expiredSession(error) ? "source-authentication" : "resource-processing",
      retryable: !terminal,
      updatedAt: now(),
      ...(terminal ? { completedAt: now() } : {}),
    }, { merge: true })
    if (terminal) await task.ref.set({ processed: FieldValue.increment(1), failed: FieldValue.increment(1), pending: FieldValue.increment(-1) }, { merge: true })
    return event(terminal ? "error" : "warning", `${item.title}: ${text(error?.message || error, 140)}`, { itemId: item.id, classId: item.destinationClassId || null })
  }
  const skipped = result.kind === "skipped"
  await item.ref.set({ status: skipped ? "skipped" : "completed", result, lastError: "", retryable: false, completedAt: now(), updatedAt: now() }, { merge: true })
  await task.ref.set({ processed: FieldValue.increment(1), pending: FieldValue.increment(-1), [skipped ? "skipped" : "succeeded"]: FieldValue.increment(1) }, { merge: true })
  return event(skipped ? "info" : "success", `${item.title}: ${result.message}`, { itemId: item.id, classId: result.classId || item.destinationClassId || null })
}

export async function runOpsTaskBatch(context, taskId) {
  const { opsDb, contentDb } = stores(context)
  const task = await claimTask(opsDb, taskId)
  if (task.terminal || task.busy) return { id: task.id, status: task.status, terminal: Boolean(task.terminal), busy: Boolean(task.busy) }
  const items = await claimItems(opsDb, task)
  if (!items.length) {
    const fresh = await task.ref.get()
    const data = fresh.data()
    const complete = Number(data.processed || 0) >= Number(data.total || 0)
    const status = complete ? (Number(data.failed || 0) ? "completed_with_errors" : "completed") : "queued"
    await task.ref.set({ status, leaseExpiresAtMs: 0, current: null, updatedAt: now(), ...(complete ? { completedAt: now() } : {}) }, { merge: true })
    return { id: task.id, status, terminal: complete }
  }
  const mapping = task.mapping || (await loadMapping(opsDb, task.mappingId))
  const current = items.map((item) => ({ itemId: item.id, title: item.title, sourceClassId: item.sourceClassId, subject: item.subjectTitle, chapter: item.chapterTitle }))
  await task.ref.set({ current, updatedAt: now() }, { merge: true })
  let events = []
  if (task.type === "duplicate-cleanup") {
    for (const item of items) {
      try { events.push(await finishItem(task, item, await processDuplicateCleanup(contentDb, opsDb, task, item), null)) }
      catch (error) { events.push(await finishItem(task, item, null, error)) }
    }
  } else {
    const account = await sourceAccount(opsDb, mapping.accountId, contentDb)
    let mediaById = new Map()
    let batchError = null
    try {
      const results = await withAuth(opsDb, account, async (auth) => {
        const media = await getUdvashClassMediaBulk(auth, items.map((item) => item.sourceClass), 3)
        const stored = await Promise.all(media.map(async (result) => {
          if (!result?.media || result.error) return result
          const sourceClass = items.find((item) => String(item.sourceClassId) === String(result.sourceClassId))?.sourceClass || {}
          return {
            ...result,
            media: {
              ...result.media,
              resourceLinks: await persistResourceLinksToDrive(opsDb, cleanResources(result.media.resourceLinks), {
                platform: mapping.platform,
                sourceCourseId: mapping.sourceCourseId,
                sourceCourseTitle: mapping.sourceCourseTitle,
                sourceClassId: result.sourceClassId,
                subjectTitle: sourceClass.subjectTitle,
                chapterTitle: sourceClass.chapterTitle,
                sourceCookie: auth.cookie,
              }),
            },
          }
        }))
        return stored
      })
      mediaById = new Map(results.map((result) => [String(result.sourceClassId || ""), result]))
    } catch (error) { batchError = error }
    for (const item of items) {
      try {
        if (batchError) throw batchError
        const result = await processMediaItem(contentDb, opsDb, task, item, mediaById.get(String(item.sourceClassId || "")), mapping)
        events.push(await finishItem(task, item, result, null))
      } catch (error) { events.push(await finishItem(task, item, null, error)) }
    }
  }
  const fresh = await task.ref.get()
  const data = fresh.data()
  const complete = Number(data.processed || 0) >= Number(data.total || 0)
  const status = complete ? (Number(data.failed || 0) ? "completed_with_errors" : "completed") : "queued"
  const recentEvents = [...array(data.recentEvents), ...events].slice(-25)
  await task.ref.set({ status, leaseExpiresAtMs: 0, current: null, recentEvents, lastHeartbeatAt: now(), updatedAt: now(), ...(complete ? { completedAt: now() } : {}) }, { merge: true })
  return { id: task.id, status, terminal: complete, processed: Number(data.processed || 0), total: Number(data.total || 0), events }
}

export async function sweepOpsTasks(context, limit = 2) {
  const { opsDb } = stores(context)
  const snap = await opsDb.collection(TASKS).limit(40).get()
  const candidates = snap.docs
    .filter((doc) => {
      const item = doc.data()
      return item.status === "queued" || (item.status === "running" && Number(item.leaseExpiresAtMs || 0) < Date.now())
    })
    .sort((a, b) => timestampMs(a.data().updatedAt) - timestampMs(b.data().updatedAt))
    .slice(0, Math.max(1, Math.min(3, Number(limit) || 2)))
  const results = await Promise.all(candidates.map((doc) => runOpsTaskBatch(context, doc.id).catch((error) => ({ id: doc.id, error: text(error?.message || error) }))))
  return { found: candidates.length, results }
}

export async function controlOpsTask(context, { taskId, command }) {
  const { opsDb: db } = stores(context)
  const ref = db.collection(TASKS).doc(String(taskId || ""))
  const snap = await ref.get()
  if (!snap.exists) throw new Error("Task was not found")
  const task = snap.data()
  if (command === "cancel") {
    await ref.set({ status: "cancelled", cancelRequested: true, leaseExpiresAtMs: 0, current: null, cancelledAt: now(), updatedAt: now(), recentEvents: [...array(task.recentEvents), event("warning", "Task cancelled by admin")].slice(-25) }, { merge: true })
  } else if (command === "pause") {
    await ref.set({ status: "paused", leaseExpiresAtMs: 0, current: null, pausedAt: now(), updatedAt: now(), recentEvents: [...array(task.recentEvents), event("info", "Task paused by admin")].slice(-25) }, { merge: true })
  } else if (command === "resume") {
    if (!["paused", "cancelled"].includes(task.status)) throw new Error("Only paused or cancelled tasks can be resumed; use Retry failed for completed tasks")
    await ref.set({ status: "queued", cancelRequested: false, leaseExpiresAtMs: 0, resumedAt: now(), updatedAt: now(), recentEvents: [...array(task.recentEvents), event("info", "Task resumed by admin")].slice(-25) }, { merge: true })
  } else throw new Error("Unsupported task command")
  return { id: snap.id, status: command === "resume" ? "queued" : command === "pause" ? "paused" : "cancelled" }
}

export async function retryOpsFailures(context, taskId, name = "") {
  const { opsDb: db } = stores(context)
  const source = await db.collection(TASKS).doc(String(taskId || "")).get()
  if (!source.exists) throw new Error("Task was not found")
  const failed = await source.ref.collection("items").where("status", "==", "failed").get()
  if (!failed.size) throw new Error("This task has no failed items")
  const old = source.data()
  const id = `task_${stableId(source.id, "retry", Date.now())}`
  const ref = db.collection(TASKS).doc(id)
  await ref.set({
    ...old,
    name: text(name || `${old.name} — retry failed`, 120),
    status: "queued",
    retriedFrom: source.id,
    total: failed.size,
    pending: failed.size,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    current: null,
    recentEvents: [event("info", `Retry task created from ${source.id}`)],
    createdAt: now(),
    updatedAt: now(),
    completedAt: FieldValue.delete(),
  })
  const batch = db.batch()
  failed.docs.forEach((doc, index) => batch.set(ref.collection("items").doc(`${String(index).padStart(5, "0")}_${stableId(doc.data().sourceClassId)}`), { ...doc.data(), status: "pending", attempts: 0, lastError: "", createdAt: now(), updatedAt: now() }))
  await batch.commit()
  return { id, status: "queued", total: failed.size }
}

export async function opsTaskDetail(context, taskId, limit = 100) {
  const { opsDb: db } = stores(context)
  const snap = await db.collection(TASKS).doc(String(taskId || "")).get()
  if (!snap.exists) throw new Error("Task was not found")
  const items = await snap.ref.collection("items").orderBy("order", "asc").limit(Math.max(1, Math.min(200, Number(limit) || 100))).get()
  return {
    task: { id: snap.id, ...snap.data(), createdAt: plainDate(snap.data().createdAt), updatedAt: plainDate(snap.data().updatedAt), completedAt: plainDate(snap.data().completedAt) },
    items: items.docs.map((doc) => ({ id: doc.id, ...doc.data(), sourceClass: undefined, createdAt: plainDate(doc.data().createdAt), updatedAt: plainDate(doc.data().updatedAt), completedAt: plainDate(doc.data().completedAt) })),
  }
}

export async function opsTaskSummaries(context) {
  const { opsDb: db } = stores(context)
  const snap = await db.collection(TASKS).orderBy("updatedAt", "desc").limit(80).get().catch(() => db.collection(TASKS).limit(80).get())
  return snap.docs.filter((doc) => !(doc.data().type !== "audit" && Number(doc.data().total || 0) === 0 && doc.data().status === "completed")).map((doc) => {
    const item = doc.data()
    return {
      id: doc.id,
      name: item.name,
      type: item.type,
      status: item.status,
      mappingId: item.mappingId,
      mapping: item.mapping,
      summary: item.summary,
      total: Number(item.total || 0),
      pending: Number(item.pending || 0),
      processed: Number(item.processed || 0),
      succeeded: Number(item.succeeded || 0),
      skipped: Number(item.skipped || 0),
      failed: Number(item.failed || 0),
      current: array(item.current),
      recentEvents: array(item.recentEvents).slice(-10),
      createdAt: plainDate(item.createdAt),
      updatedAt: plainDate(item.updatedAt),
      completedAt: plainDate(item.completedAt),
      stale: item.status === "running" && timestampMs(item.updatedAt) && Date.now() - timestampMs(item.updatedAt) > LEASE_MS,
    }
  })
}

export const OPS_ACTIONS = new Set([
  "ops-preview",
  "ops-create-task",
  "ops-worker",
  "ops-control-task",
  "ops-retry-failures",
  "ops-task-detail",
  "ops-refresh-account",
  "ops-scan-course",
  "ops-source-tree",
  "ops-sweep",
])
