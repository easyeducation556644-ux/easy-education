import crypto from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import {
  isFullAdminProfile,
  profileHasAdminPage,
  requireAuthenticatedUser,
} from "./utils/firebase-admin.js"

const UDVASH_ORIGIN = "https://student-api.udvash-unmesh.com"
const ACCOUNTS = "udvashAccounts"
const COURSES = "udvashCourses"
const STRUCTURES = "udvashCourseStructures"
const ENTITLEMENTS = "udvashEntitlements"
const DEFAULT_COURSE_TYPE_ID = 2
const TOKEN_SKEW_MS = 30_000

function text(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if ((typeof value === "number" || typeof value === "bigint") && String(value).trim()) return String(value).trim()
  }
  return ""
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body
  if (typeof req.body === "string" && req.body.trim()) {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return {}
}

function intValue(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function validId(value) {
  const normalized = text(value)
  return /^[A-Za-z0-9_-]{1,160}$/.test(normalized) ? normalized : ""
}

function credentialKey() {
  const source = text(process.env.UDVASH_CREDENTIAL_KEY, process.env.AUTOMATION_SECRET)
  if (!source || source.length < 16) {
    const error = new Error("UDVASH_CREDENTIAL_KEY is not configured")
    error.statusCode = 503
    throw error
  }
  return crypto.createHash("sha256").update(source).digest()
}

function encryptSecret(value) {
  const plain = String(value || "")
  if (!plain) return ""
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`
}

function decryptSecret(value) {
  const raw = text(value)
  if (!raw) return ""
  const [version, ivText, tagText, payloadText] = raw.split(".")
  if (version !== "v1" || !ivText || !tagText || !payloadText) return ""
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(ivText, "base64url"))
    decipher.setAuthTag(Buffer.from(tagText, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(payloadText, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return ""
  }
}

function adminAllowed(authenticated) {
  return isFullAdminProfile(authenticated.userProfile) || profileHasAdminPage(authenticated.userProfile, "udvash")
}

function assertAdmin(authenticated) {
  if (adminAllowed(authenticated)) return
  const error = new Error("Udvash admin permission required")
  error.statusCode = 403
  throw error
}

function accountPublic(id, data = {}) {
  return {
    id,
    label: text(data.label, data.name) || `Udvash ${text(data.registrationNumber)}`,
    name: text(data.name),
    registrationNumber: text(data.registrationNumber),
    courseTypeId: intValue(data.courseTypeId, DEFAULT_COURSE_TYPE_ID),
    status: text(data.status) || "unknown",
    lastLoginAtMs: Number(data.lastLoginAtMs || 0),
    accessTokenExpiresAtMs: Number(data.accessTokenExpiresAtMs || 0),
    refreshTokenExpiresAtMs: Number(data.refreshTokenExpiresAtMs || 0),
    lastCheckedAtMs: Number(data.lastCheckedAtMs || 0),
    courseCount: Number(data.courseCount || 0),
    subjectCount: Number(data.subjectCount || 0),
    chapterCount: Number(data.chapterCount || 0),
    lastError: text(data.lastError),
  }
}

async function rawUdvash(path, { token = "", method = "GET", body } = {}) {
  const url = path.startsWith("http") ? path : `${UDVASH_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`
  const headers = {
    Accept: "application/json",
    "User-Agent": "EasyEducation/1.0 UdvashProvider",
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers["Content-Type"] = "application/json"

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "follow",
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.isSuccess === false) {
    const error = new Error(text(payload?.message, payload?.error) || `Udvash request failed (${response.status})`)
    error.statusCode = response.status === 401 ? 401 : 502
    error.upstreamStatus = response.status
    throw error
  }
  return payload
}

async function loginWithCredentials(registrationNumber, password) {
  const payload = await rawUdvash("/Account/Login/VerifyPassword", {
    method: "POST",
    body: { registrationNumber, password },
  })
  const data = payload?.data || {}
  const accessToken = text(data.accessToken)
  if (!accessToken) {
    const error = new Error("Udvash login succeeded without an access token")
    error.statusCode = 502
    throw error
  }
  const now = Date.now()
  const expiresIn = Math.max(60, intValue(data.expiresIn, 1800))
  const refreshExpiresIn = Math.max(0, intValue(data.refreshExpiresIn, 0))
  return {
    name: text(data.name),
    registrationNumber: text(data.registrationNumber, registrationNumber),
    accessToken,
    refreshToken: text(data.refreshToken),
    accessTokenExpiresAtMs: now + expiresIn * 1000,
    refreshTokenExpiresAtMs: refreshExpiresIn ? now + refreshExpiresIn * 1000 : 0,
  }
}

async function saveSession(accountRef, accountData, session) {
  await accountRef.set({
    name: session.name || text(accountData.name),
    registrationNumber: session.registrationNumber || text(accountData.registrationNumber),
    accessTokenCipher: encryptSecret(session.accessToken),
    refreshTokenCipher: encryptSecret(session.refreshToken),
    accessTokenExpiresAtMs: session.accessTokenExpiresAtMs,
    refreshTokenExpiresAtMs: session.refreshTokenExpiresAtMs,
    lastLoginAtMs: Date.now(),
    status: "active",
    lastError: "",
    updatedAtMs: Date.now(),
  }, { merge: true })
}

async function sessionForAccount(accountId, db, forceLogin = false) {
  const accountRef = db.collection(ACCOUNTS).doc(accountId)
  const snapshot = await accountRef.get()
  if (!snapshot.exists) {
    const error = new Error("Udvash source account was not found")
    error.statusCode = 404
    throw error
  }
  const account = snapshot.data() || {}
  const now = Date.now()
  if (!forceLogin && Number(account.accessTokenExpiresAtMs || 0) - TOKEN_SKEW_MS > now) {
    const accessToken = decryptSecret(account.accessTokenCipher)
    if (accessToken) return { token: accessToken, accountRef, account }
  }

  const password = decryptSecret(account.passwordCipher)
  if (!password) {
    const error = new Error("Stored Udvash password cannot be decrypted. Re-save this account.")
    error.statusCode = 409
    throw error
  }
  const session = await loginWithCredentials(text(account.registrationNumber), password)
  await saveSession(accountRef, account, session)
  return { token: session.accessToken, accountRef, account: { ...account, ...session } }
}

async function accountRequest(accountId, db, path) {
  let session = await sessionForAccount(accountId, db)
  try {
    return await rawUdvash(path, { token: session.token })
  } catch (error) {
    if (error.upstreamStatus !== 401) throw error
    session = await sessionForAccount(accountId, db, true)
    return rawUdvash(path, { token: session.token })
  }
}

function normalizeCourse(row, accountId, courseTypeId) {
  const masterCourseId = intValue(row?.masterCourseId)
  return {
    id: String(masterCourseId),
    masterCourseId,
    masterCourseTypeId: intValue(row?.masterCourseTypeId, courseTypeId),
    name: text(row?.name) || `Udvash Course ${masterCourseId}`,
    rank: intValue(row?.rank),
    iconPath: text(row?.iconPath),
    source: "udvash",
    sourceAccountId: accountId,
  }
}

function normalizeSubject(row) {
  return {
    subjectId: intValue(row?.subjectId),
    masterCourseId: intValue(row?.masterCourseId),
    name: text(row?.name),
    shortName: text(row?.shortName),
    rank: intValue(row?.rank),
    iconPath: text(row?.iconPath),
  }
}

function normalizeChapter(row) {
  return {
    masterChapterId: intValue(row?.masterChapterId),
    subjectId: intValue(row?.subjectId),
    masterCourseId: intValue(row?.masterCourseId),
    name: text(row?.name),
    shortName: text(row?.shortName),
    displayNameBn: text(row?.displayNameBn),
    displayNameEn: text(row?.displayNameEn),
    rank: intValue(row?.rank),
    status: intValue(row?.status, 1),
  }
}

function courseWideContent(row) {
  return {
    id: intValue(row?.masterCourseWiseContentId),
    name: text(row?.contentName),
    contentButtonType: text(row?.contentButtonType),
    inputUrl: text(row?.inputUrl),
    imagePath: text(row?.imagePath),
    rank: intValue(row?.rank),
    hasVideo: Boolean(row?.hasVideo),
    hasNotes: Boolean(row?.hasNotes),
  }
}

async function mapLimit(values, limit, worker) {
  const result = new Array(values.length)
  let cursor = 0
  async function run() {
    while (cursor < values.length) {
      const index = cursor++
      result[index] = await worker(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()))
  return result
}

async function syncAccountStructure(accountId, db) {
  const accountSnap = await db.collection(ACCOUNTS).doc(accountId).get()
  if (!accountSnap.exists) {
    const error = new Error("Udvash account not found")
    error.statusCode = 404
    throw error
  }
  const account = accountSnap.data() || {}
  const courseTypeId = intValue(account.courseTypeId, DEFAULT_COURSE_TYPE_ID)
  const coursePayload = await accountRequest(accountId, db, `/Content/Courses?id=${courseTypeId}`)
  const courseRows = asArray(coursePayload?.data?.masterCourseList)
  const courses = courseRows.map((row) => normalizeCourse(row, accountId, courseTypeId)).filter((row) => row.masterCourseId)
  let subjectCount = 0
  let chapterCount = 0

  const structures = await mapLimit(courses, 3, async (course) => {
    const subjectPayload = await accountRequest(
      accountId,
      db,
      `/Content/Subjects?courseTypeId=${courseTypeId}&masterCourseId=${course.masterCourseId}`,
    )
    const subjects = asArray(subjectPayload?.data?.subjectList).map(normalizeSubject).filter((row) => row.subjectId)
    const courseContents = asArray(subjectPayload?.data?.courseWiseContentViewModelList).map(courseWideContent)
    subjectCount += subjects.length

    const subjectStructures = await mapLimit(subjects, 5, async (subject) => {
      const chapterPayload = await accountRequest(
        accountId,
        db,
        `/Content/Chapters?masterCourseId=${course.masterCourseId}&subjectId=${subject.subjectId}&ln=Bn`,
      )
      const chapters = asArray(chapterPayload?.data?.masterChapterList).map(normalizeChapter).filter((row) => row.masterChapterId)
      chapterCount += chapters.length
      return { ...subject, chapters }
    })

    const structureId = `${accountId}_${course.masterCourseId}`
    await db.collection(STRUCTURES).doc(structureId).set({
      accountId,
      masterCourseId: course.masterCourseId,
      masterCourseTypeId: courseTypeId,
      course,
      subjects: subjectStructures,
      courseContents,
      syncedAtMs: Date.now(),
    }, { merge: false })

    await db.collection(COURSES).doc(String(course.masterCourseId)).set({
      ...course,
      sourceAccountId: FieldValue.delete(),
      sourceAccountIds: FieldValue.arrayUnion(accountId),
      updatedAtMs: Date.now(),
    }, { merge: true })

    return {
      ...course,
      subjectCount: subjectStructures.length,
      chapterCount: subjectStructures.reduce((sum, subject) => sum + subject.chapters.length, 0),
    }
  })

  await db.collection(ACCOUNTS).doc(accountId).set({
    status: "active",
    lastCheckedAtMs: Date.now(),
    courseCount: courses.length,
    subjectCount,
    chapterCount,
    lastError: "",
    updatedAtMs: Date.now(),
  }, { merge: true })

  return { courses: structures, courseCount: courses.length, subjectCount, chapterCount }
}

function entitlementActive(data, now = Date.now()) {
  if (!data) return false
  const status = text(data.status).toLowerCase()
  if (status === "revoked" || status === "inactive") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > now
}

async function courseAccess(authenticated, courseId) {
  if (isFullAdminProfile(authenticated.userProfile)) return { active: true, accessType: "admin", expiresAtMs: 0 }
  const uid = authenticated.decodedToken.uid
  const snap = await authenticated.db.collection(ENTITLEMENTS).doc(`${uid}_${courseId}`).get()
  const data = snap.exists ? snap.data() || {} : null
  if (!entitlementActive(data)) return { active: false, accessType: "locked", expiresAtMs: 0 }
  return {
    active: true,
    accessType: text(data.accessType) || "premium",
    expiresAtMs: Number(data.expiresAtMs || 0),
  }
}

async function assertCourseAccess(authenticated, courseId) {
  const access = await courseAccess(authenticated, courseId)
  if (!access.active) {
    const error = new Error("Udvash course access required")
    error.statusCode = 403
    throw error
  }
  return access
}

async function pickSource(authenticated, courseId) {
  const courseSnap = await authenticated.db.collection(COURSES).doc(String(courseId)).get()
  if (!courseSnap.exists) {
    const error = new Error("Udvash course is not synced yet")
    error.statusCode = 404
    throw error
  }
  const course = courseSnap.data() || {}
  const ids = asArray(course.sourceAccountIds).filter(Boolean)
  if (!ids.length) {
    const error = new Error("No Udvash source account is available for this course")
    error.statusCode = 503
    throw error
  }
  const refs = ids.map((id) => authenticated.db.collection(ACCOUNTS).doc(id))
  const snapshots = await authenticated.db.getAll(...refs)
  const ranked = snapshots
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
    .sort((a, b) => {
      const aHealthy = a.status === "active" ? 1 : 0
      const bHealthy = b.status === "active" ? 1 : 0
      if (aHealthy !== bHealthy) return bHealthy - aHealthy
      return Number(b.lastCheckedAtMs || 0) - Number(a.lastCheckedAtMs || 0)
    })
  if (!ranked.length) {
    const error = new Error("No healthy Udvash source account is available")
    error.statusCode = 503
    throw error
  }
  return { accountId: ranked[0].id, account: ranked[0], course }
}

function normalizeContentType(row) {
  return {
    masterContentTypeId: intValue(row?.masterContentTypeId),
    masterCourseId: intValue(row?.masterCourseId),
    subjectId: intValue(row?.subjectId),
    masterChapterId: intValue(row?.masterChapterId),
    displayName: text(row?.displayName),
    totalContentCount: intValue(row?.totalContentCount),
    rank: intValue(row?.rank),
  }
}

function normalizeCard(row) {
  return {
    masterContentId: intValue(row?.masterContentId),
    masterContentTypeId: intValue(row?.masterContentTypeId),
    masterCourseId: intValue(row?.masterCourseId),
    subjectId: intValue(row?.subjectId),
    masterChapterId: intValue(row?.masterChapterId),
    title: text(row?.displayName),
    description: text(row?.description),
    hasVideo: Boolean(row?.hasVideo),
    hasNotes: Boolean(row?.hasNotes),
    hasQuiz: Boolean(row?.hasQuiz),
    hasQnA: Boolean(row?.hasQnA),
    isBlocked: Boolean(row?.isBlocked),
    rank: intValue(row?.rank),
  }
}

function normalizeCardDetail(payload) {
  const details = payload?.data?.masterContentDetails || {}
  const videos = asArray(details.videoDetails)
  const videoOptions = []
  let youtubeUrl = ""
  videos.forEach((video) => {
    const youtube = text(video?.youtubeVideoPath)
    if (!youtubeUrl && youtube) youtubeUrl = youtube
    asArray(video?.videoList).forEach((variant) => {
      const url = text(variant?.videoPath)
      if (!url) return
      videoOptions.push({
        resolution: intValue(variant?.videoResolution),
        url,
        storageProviderId: intValue(variant?.storageProviderId),
        sizeMBOrGB: Number(variant?.sizeMBOrGB || 0),
        isPrimary: Boolean(variant?.isPrimary),
      })
    })
  })
  videoOptions.sort((a, b) => b.resolution - a.resolution)

  const notes = [
    ...asArray(details.contentFileBnPathList),
    ...asArray(details.contentFileEnPathList),
  ].map((file) => ({
    id: intValue(file?.umsStudyFilesId),
    label: text(file?.fileTypeName, file?.umsStudyFilesTypeName) || "Note",
    url: text(file?.filePath),
    fileOrder: intValue(file?.fileOrder),
    fileSizeKB: Number(file?.fileSizeKB || 0),
    isBanglaVersion: Boolean(file?.isBanglaVersion),
    isEnglishVersion: Boolean(file?.isEnglishVersion),
  })).filter((file) => file.url)

  return {
    masterCourseId: intValue(details.masterCourseId),
    subjectId: intValue(details.subjectId),
    masterChapterId: intValue(details.masterChapterId),
    masterContentId: intValue(details.masterContentId),
    masterContentTypeId: intValue(details.masterContentTypeId),
    courseName: text(details.masterCourseName),
    subjectName: text(details.subjectNameBn, details.subjectNameEn),
    chapterName: text(details.masterChapterNameBn, details.masterChapterNameEn),
    title: text(details.masterContentDisplayNameBn, details.masterContentDisplayNameEn),
    description: text(details.descriptionBn, details.descriptionEn),
    hasVideo: Boolean(details.hasVideo),
    hasNotes: Boolean(details.hasNotes),
    hasQuiz: Boolean(details.isEnableQuiz),
    hasPrevious: Boolean(details.hasPrevious),
    hasNext: Boolean(details.hasNext),
    previousMasterLectureId: intValue(details.previousMasterLectureId),
    nextMasterLectureId: intValue(details.nextMasterLectureId),
    videoOptions,
    youtubeUrl,
    notes,
  }
}

async function adminListAccounts(res, authenticated) {
  assertAdmin(authenticated)
  const snapshot = await authenticated.db.collection(ACCOUNTS).get()
  const accounts = snapshot.docs
    .map((doc) => accountPublic(doc.id, doc.data() || {}))
    .sort((a, b) => a.label.localeCompare(b.label))
  return res.status(200).json({ ok: true, accounts })
}

async function adminAddAccount(req, res, authenticated) {
  assertAdmin(authenticated)
  const body = requestBody(req)
  const registrationNumber = text(body.registrationNumber)
  const password = text(body.password)
  const label = text(body.label)
  const courseTypeId = Math.max(1, intValue(body.courseTypeId, DEFAULT_COURSE_TYPE_ID))
  if (!/^\d{4,20}$/.test(registrationNumber)) return res.status(400).json({ error: "Valid Udvash registration number is required" })
  if (!password) return res.status(400).json({ error: "Udvash password is required" })

  const session = await loginWithCredentials(registrationNumber, password)
  const accountId = `reg_${registrationNumber}`
  const accountRef = authenticated.db.collection(ACCOUNTS).doc(accountId)
  await accountRef.set({
    registrationNumber,
    label: label || session.name || `Udvash ${registrationNumber}`,
    name: session.name,
    courseTypeId,
    passwordCipher: encryptSecret(password),
    createdBy: authenticated.decodedToken.uid,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    status: "active",
    lastError: "",
  }, { merge: true })
  await saveSession(accountRef, { registrationNumber }, session)
  const saved = (await accountRef.get()).data() || {}
  return res.status(200).json({ ok: true, account: accountPublic(accountId, saved) })
}

async function adminCheckAccount(req, res, authenticated) {
  assertAdmin(authenticated)
  const body = requestBody(req)
  const accountId = validId(body.accountId || req.query?.accountId)
  if (!accountId) return res.status(400).json({ error: "accountId is required" })
  try {
    await sessionForAccount(accountId, authenticated.db, true)
    const scan = await syncAccountStructure(accountId, authenticated.db)
    const snapshot = await authenticated.db.collection(ACCOUNTS).doc(accountId).get()
    return res.status(200).json({ ok: true, account: accountPublic(accountId, snapshot.data() || {}), scan })
  } catch (error) {
    await authenticated.db.collection(ACCOUNTS).doc(accountId).set({
      status: "error",
      lastError: text(error.message).slice(0, 500),
      updatedAtMs: Date.now(),
    }, { merge: true }).catch(() => {})
    throw error
  }
}

async function adminDeleteAccount(req, res, authenticated) {
  assertAdmin(authenticated)
  const body = requestBody(req)
  const accountId = validId(body.accountId)
  if (!accountId) return res.status(400).json({ error: "accountId is required" })
  const structures = await authenticated.db.collection(STRUCTURES).where("accountId", "==", accountId).get()
  const batch = authenticated.db.batch()
  structures.docs.forEach((doc) => batch.delete(doc.ref))
  batch.delete(authenticated.db.collection(ACCOUNTS).doc(accountId))
  await batch.commit()
  return res.status(200).json({ ok: true })
}

async function catalog(res, authenticated) {
  // The Android client already paints its route cache first. This request is therefore the
  // live revalidation pass: refresh only the course route, never crawl subjects/chapters.
  const accountSnapshot = await authenticated.db.collection(ACCOUNTS).get()
  const activeAccounts = accountSnapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((account) => text(account.status).toLowerCase() !== "inactive")

  await mapLimit(activeAccounts, 3, async (account) => {
    try {
      const courseTypeId = intValue(account.courseTypeId, DEFAULT_COURSE_TYPE_ID)
      const payload = await accountRequest(account.id, authenticated.db, `/Content/Courses?id=${courseTypeId}`)
      const rows = asArray(payload?.data?.masterCourseList)
        .map((row) => normalizeCourse(row, account.id, courseTypeId))
        .filter((row) => row.masterCourseId)
      await mapLimit(rows, 8, async (course) => {
        await authenticated.db.collection(COURSES).doc(String(course.masterCourseId)).set({
          ...course,
          sourceAccountId: FieldValue.delete(),
          sourceAccountIds: FieldValue.arrayUnion(account.id),
          updatedAtMs: Date.now(),
        }, { merge: true })
      })
      await authenticated.db.collection(ACCOUNTS).doc(account.id).set({
        courseCount: rows.length,
        lastCheckedAtMs: Date.now(),
        lastError: "",
        status: "active",
        updatedAtMs: Date.now(),
      }, { merge: true })
    } catch (error) {
      await authenticated.db.collection(ACCOUNTS).doc(account.id).set({
        lastError: text(error?.message).slice(0, 500),
        updatedAtMs: Date.now(),
      }, { merge: true }).catch(() => {})
    }
  })

  const snapshot = await authenticated.db.collection(COURSES).get()
  const now = Date.now()
  let entitlementMap = new Map()
  if (!isFullAdminProfile(authenticated.userProfile)) {
    const entitlements = await authenticated.db.collection(ENTITLEMENTS)
      .where("userId", "==", authenticated.decodedToken.uid)
      .get()
    entitlementMap = new Map(entitlements.docs
      .map((doc) => doc.data() || {})
      .filter((data) => entitlementActive(data, now))
      .map((data) => [String(data.masterCourseId || data.courseId || ""), data]))
  }

  const courses = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((course) => isFullAdminProfile(authenticated.userProfile) || entitlementMap.has(String(course.masterCourseId || course.id)))
    .map((course) => {
      const entitlement = entitlementMap.get(String(course.masterCourseId || course.id))
      return {
        id: String(course.masterCourseId || course.id),
        masterCourseId: intValue(course.masterCourseId || course.id),
        title: text(course.name) || "Udvash Course",
        iconPath: text(course.iconPath),
        rank: intValue(course.rank),
        source: "udvash",
        hasAccess: true,
        accessType: isFullAdminProfile(authenticated.userProfile) ? "admin" : text(entitlement?.accessType) || "premium",
        accessExpiresAtMs: Number(entitlement?.expiresAtMs || 0),
      }
    })
    .sort((a, b) => (a.rank - b.rank) || a.title.localeCompare(b.title))
  return res.status(200).json({ accessMode: "premium", courses, fetchedAtMs: Date.now() })
}

async function structureForCourse(authenticated, courseId) {
  await assertCourseAccess(authenticated, courseId)
  const source = await pickSource(authenticated, courseId)
  const snapshot = await authenticated.db.collection(STRUCTURES).doc(`${source.accountId}_${courseId}`).get()
  if (!snapshot.exists) {
    const error = new Error("Udvash course structure is not synced yet")
    error.statusCode = 404
    throw error
  }
  return { source, structure: snapshot.data() || {} }
}

async function subjects(req, res, authenticated) {
  const courseId = validId(req.query?.courseId)
  if (!courseId) return res.status(400).json({ error: "courseId is required" })
  const { source, structure } = await structureForCourse(authenticated, courseId)
  const courseTypeId = intValue(source.account?.courseTypeId, structure.masterCourseTypeId || DEFAULT_COURSE_TYPE_ID)
  const payload = await accountRequest(
    source.accountId,
    authenticated.db,
    `/Content/Subjects?courseTypeId=${courseTypeId}&masterCourseId=${courseId}`,
  )
  const cachedSubjects = new Map(asArray(structure.subjects).map((subject) => [intValue(subject?.subjectId), subject]))
  const liveSubjects = asArray(payload?.data?.subjectList)
    .map(normalizeSubject)
    .filter((subject) => subject.subjectId)
    .map((subject) => ({ ...subject, chapters: asArray(cachedSubjects.get(subject.subjectId)?.chapters) }))
  const courseContents = asArray(payload?.data?.courseWiseContentViewModelList).map(courseWideContent)
  const fetchedAtMs = Date.now()
  await authenticated.db.collection(STRUCTURES).doc(`${source.accountId}_${courseId}`).set({
    subjects: liveSubjects,
    courseContents,
    syncedAtMs: fetchedAtMs,
  }, { merge: true })
  const rows = liveSubjects.map(({ chapters, ...subject }) => ({
    ...subject,
    chapterCount: asArray(chapters).length,
  }))
  return res.status(200).json({ course: structure.course || {}, subjects: rows, syncedAtMs: fetchedAtMs })
}

async function chapters(req, res, authenticated) {
  const courseId = validId(req.query?.courseId)
  const subjectId = intValue(req.query?.subjectId)
  if (!courseId || !subjectId) return res.status(400).json({ error: "courseId and subjectId are required" })
  const { source, structure } = await structureForCourse(authenticated, courseId)
  const subjects = asArray(structure.subjects)
  const subject = subjects.find((row) => intValue(row?.subjectId) === subjectId)
  if (!subject) return res.status(404).json({ error: "Subject not found in Udvash structure" })
  const payload = await accountRequest(
    source.accountId,
    authenticated.db,
    `/Content/Chapters?masterCourseId=${courseId}&subjectId=${subjectId}&ln=Bn`,
  )
  const liveChapters = asArray(payload?.data?.masterChapterList)
    .map(normalizeChapter)
    .filter((chapter) => chapter.masterChapterId)
  const fetchedAtMs = Date.now()
  const nextSubjects = subjects.map((row) => intValue(row?.subjectId) === subjectId ? { ...row, chapters: liveChapters } : row)
  await authenticated.db.collection(STRUCTURES).doc(`${source.accountId}_${courseId}`).set({
    subjects: nextSubjects,
    syncedAtMs: fetchedAtMs,
  }, { merge: true })
  return res.status(200).json({
    subject: { ...subject, chapters: undefined },
    chapters: liveChapters,
    syncedAtMs: fetchedAtMs,
  })
}

async function liveContentTypes(req, res, authenticated) {
  const courseId = validId(req.query?.courseId)
  const subjectId = intValue(req.query?.subjectId)
  const chapterId = intValue(req.query?.chapterId)
  if (!courseId || !subjectId || !chapterId) return res.status(400).json({ error: "courseId, subjectId and chapterId are required" })
  await assertCourseAccess(authenticated, courseId)
  const { accountId } = await pickSource(authenticated, courseId)
  const payload = await accountRequest(accountId, authenticated.db, `/Content/ContentTypes?masterCourseId=${courseId}&subjectId=${subjectId}&masterChapterId=${chapterId}&ln=Bn`)
  const contentTypes = asArray(payload?.data?.masterContentTypeDisplayList).map(normalizeContentType).filter((row) => row.masterContentTypeId)
  return res.status(200).json({ contentTypes, isSingleContentType: Boolean(payload?.data?.isSingleContentType), singleContentTypeId: intValue(payload?.data?.singleContentTypeId) })
}

async function liveCards(req, res, authenticated) {
  const courseId = validId(req.query?.courseId)
  const subjectId = intValue(req.query?.subjectId)
  const chapterId = intValue(req.query?.chapterId)
  const contentTypeId = intValue(req.query?.contentTypeId)
  if (!courseId || !subjectId || !chapterId || !contentTypeId) return res.status(400).json({ error: "courseId, subjectId, chapterId and contentTypeId are required" })
  await assertCourseAccess(authenticated, courseId)
  const { accountId } = await pickSource(authenticated, courseId)
  const payload = await accountRequest(accountId, authenticated.db, `/Content/Cards?masterCourseId=${courseId}&subjectId=${subjectId}&masterChapterId=${chapterId}&masterContentTypeId=${contentTypeId}&ln=Bn`)
  const cards = asArray(payload?.data?.masterContentList).map(normalizeCard).filter((row) => row.masterContentId)
  return res.status(200).json({ title: text(payload?.data?.contentTypeText), cards })
}

async function liveCardDetail(req, res, authenticated) {
  const courseId = validId(req.query?.courseId)
  const subjectId = intValue(req.query?.subjectId)
  const chapterId = intValue(req.query?.chapterId)
  const contentTypeId = intValue(req.query?.contentTypeId)
  const contentId = intValue(req.query?.contentId)
  const mode = text(req.query?.mode).toLowerCase() === "notes" ? "notes" : "video"
  if (!courseId || !subjectId || !chapterId || !contentTypeId || !contentId) return res.status(400).json({ error: "courseId, subjectId, chapterId, contentTypeId and contentId are required" })
  await assertCourseAccess(authenticated, courseId)
  const { accountId } = await pickSource(authenticated, courseId)
  const query = new URLSearchParams({
    masterCourseId: courseId,
    subjectId: String(subjectId),
    masterChapterId: String(chapterId),
    masterContentId: String(contentId),
    masterContentTypeId: String(contentTypeId),
    showAnalysisReport: "false",
    ln: "Bn",
    videoId: "0",
    isJson: "false",
    d: "0",
    contentButtonType: mode,
  })
  const payload = await accountRequest(accountId, authenticated.db, `/Content/CardDetails?${query.toString()}`)
  return res.status(200).json({ detail: normalizeCardDetail(payload), fetchedAtMs: Date.now() })
}

async function adminGrantAccess(req, res, authenticated) {
  assertAdmin(authenticated)
  const body = requestBody(req)
  const userId = validId(body.userId)
  const courseId = validId(body.courseId || body.masterCourseId)
  if (!userId || !courseId) return res.status(400).json({ error: "userId and courseId are required" })
  const courseSnap = await authenticated.db.collection(COURSES).doc(courseId).get()
  if (!courseSnap.exists) return res.status(404).json({ error: "Udvash course is not synced yet" })
  const expiresAtMs = Math.max(0, Number(body.expiresAtMs || 0))
  const entitlementId = `${userId}_${courseId}`
  await authenticated.db.collection(ENTITLEMENTS).doc(entitlementId).set({
    userId,
    masterCourseId: intValue(courseId),
    courseId,
    status: "active",
    accessType: text(body.accessType) || "premium",
    expiresAtMs,
    grantedBy: authenticated.decodedToken.uid,
    grantedAtMs: Date.now(),
    updatedAtMs: Date.now(),
  }, { merge: true })
  return res.status(200).json({ ok: true, entitlementId })
}

async function adminRevokeAccess(req, res, authenticated) {
  assertAdmin(authenticated)
  const body = requestBody(req)
  const userId = validId(body.userId)
  const courseId = validId(body.courseId || body.masterCourseId)
  if (!userId || !courseId) return res.status(400).json({ error: "userId and courseId are required" })
  const entitlementId = `${userId}_${courseId}`
  await authenticated.db.collection(ENTITLEMENTS).doc(entitlementId).set({
    userId,
    masterCourseId: intValue(courseId),
    courseId,
    status: "revoked",
    revokedBy: authenticated.decodedToken.uid,
    revokedAtMs: Date.now(),
    updatedAtMs: Date.now(),
  }, { merge: true })
  return res.status(200).json({ ok: true })
}

export default async function udvashHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  res.setHeader("Cache-Control", "no-store")
  if (req.method === "OPTIONS") return res.status(204).end()

  try {
    const authenticated = await requireAuthenticatedUser(req)
    const action = text(req.query?.action, requestBody(req)?.action)

    if (req.method === "GET" && action === "admin-accounts") return adminListAccounts(res, authenticated)
    if (req.method === "POST" && action === "admin-add-account") return adminAddAccount(req, res, authenticated)
    if (req.method === "POST" && action === "admin-check-account") return adminCheckAccount(req, res, authenticated)
    if ((req.method === "POST" || req.method === "DELETE") && action === "admin-delete-account") return adminDeleteAccount(req, res, authenticated)
    if (req.method === "POST" && action === "admin-grant-access") return adminGrantAccess(req, res, authenticated)
    if (req.method === "POST" && action === "admin-revoke-access") return adminRevokeAccess(req, res, authenticated)

    if (req.method === "GET" && action === "catalog") return catalog(res, authenticated)
    if (req.method === "GET" && action === "subjects") return subjects(req, res, authenticated)
    if (req.method === "GET" && action === "chapters") return chapters(req, res, authenticated)
    if (req.method === "GET" && action === "content-types") return liveContentTypes(req, res, authenticated)
    if (req.method === "GET" && action === "cards") return liveCards(req, res, authenticated)
    if (req.method === "GET" && action === "class") return liveCardDetail(req, res, authenticated)

    return res.status(400).json({ error: "Unknown Udvash action" })
  } catch (error) {
    console.error("[udvash]", error)
    const status = Number(error.statusCode || 500)
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: error.message || "Udvash request failed" })
  }
}
