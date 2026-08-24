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
  getUdvashCourseContent,
  listUdvashCourses,
  loginUdvash,
} from "../server/bot/platforms/udvash.js"

const SESSION_COLLECTION = "botSessions"
const ACCOUNT_COLLECTION = "botPlatformAccounts"
const MAPPING_COLLECTION = "botCourseMappings"
const JOB_COLLECTION = "botJobs"

const PLATFORM_LABELS = { udvash: "Udvash" }
const PLATFORM_IDS = new Set(Object.keys(PLATFORM_LABELS))

const normalizeText = (value) => String(value || "").trim().toLowerCase()
const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const serverNow = () => FieldValue.serverTimestamp()

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
    [prefix, "কি করতে চান?"].filter(Boolean).join("\n\n"),
    mainMenu(),
  )
}

function platformKeyboard(prefix) {
  return keyboard([
    [button("Udvash", `${prefix}:udvash`)],
    [button("⬅️ Main menu", "home")],
  ])
}

async function listAccounts(db, platform = "") {
  let query = db.collection(ACCOUNT_COLLECTION)
  if (platform) query = query.where("platform", "==", platform)
  const snap = await query.get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.label || a.roll || "").localeCompare(String(b.label || b.roll || "")))
}

async function getAccount(db, accountId) {
  const snap = await db.collection(ACCOUNT_COLLECTION).doc(accountId).get()
  if (!snap.exists) throw new Error("Account পাওয়া যায়নি")
  return { id: snap.id, ...snap.data() }
}

async function refreshAccountAuth(db, account) {
  if (account.platform !== "udvash") throw new Error(`Unsupported platform: ${account.platform}`)
  const password = decryptSecret(account.passwordEncrypted)
  const auth = await loginUdvash({ roll: account.roll, password })
  await db.collection(ACCOUNT_COLLECTION).doc(account.id).set({
    cookieEncrypted: auth.cookie ? encryptSecret(auth.cookie) : "",
    tokenEncrypted: auth.token ? encryptSecret(auth.token) : "",
    status: "ready",
    lastLoginAt: serverNow(),
    lastError: "",
    updatedAt: serverNow(),
  }, { merge: true })
  return auth
}

async function platformCourses(db, account) {
  const auth = await refreshAccountAuth(db, account)
  return listUdvashCourses(auth)
}

async function platformContent(db, account, sourceCourseId) {
  const auth = await refreshAccountAuth(db, account)
  return getUdvashCourseContent(auth, sourceCourseId)
}

function courseScore(course, queryText) {
  const title = normalizeText(course.title || course.name)
  const query = normalizeText(queryText)
  if (!query) return 0
  if (title === query) return 1000
  if (title.startsWith(query)) return 700
  if (title.includes(query)) return 500
  return query.split(/\s+/).filter(Boolean).reduce(
    (score, word) => score + (title.includes(word) ? 50 : 0),
    0,
  )
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

function importedClassMatches(item, session) {
  return item.sourcePlatform === session.platform
    && String(item.sourceCourseId || "") === String(session.sourceCourseId || "")
}

async function inspectMapping(db, session) {
  const account = await getAccount(db, session.accountId)
  const sourceClasses = await platformContent(db, account, session.sourceCourseId)
  const snap = await db.collection("classes").where("courseId", "==", session.eeCourseId).get()
  const existing = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const imported = existing.filter((item) => importedClassMatches(item, session))
  const importedIds = new Set(imported.map((item) => String(item.sourceClassId || "")).filter(Boolean))
  const missing = sourceClasses.filter((item) => !importedIds.has(String(item.sourceClassId)))
  return { sourceClasses, imported, missing, allEeClasses: existing }
}

async function showMappingAnalysis(db, chatId, session) {
  await sendMessage(chatId, "Udvash-এ fresh login করে current class list মিলিয়ে দেখছি…")
  const analysis = await inspectMapping(db, session)
  await setSession(db, chatId, {
    lastSourceCount: analysis.sourceClasses.length,
    lastImportedCount: analysis.imported.length,
    lastMissingCount: analysis.missing.length,
  })

  const sectionCounts = new Map()
  analysis.sourceClasses.forEach((item) => {
    const key = item.sectionTitle || "Regular"
    sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1)
  })
  const sectionText = [...sectionCounts.entries()]
    .map(([title, count]) => `• ${title}: ${count}`)
    .slice(0, 12)

  const text = [
    `Platform: ${PLATFORM_LABELS[session.platform] || session.platform}`,
    `Source course: ${session.sourceCourseTitle}`,
    `EE course: ${session.eeCourseTitle} (${session.eeCourseType || "subject"})`,
    `Destination: ${destinationLabel(session)}`,
    "",
    ...(sectionText.length ? ["Udvash content:", ...sectionText, ""] : []),
    `EE-তে Udvash থেকে আগে add করা: ${analysis.imported.length}`,
    `Udvash-এ current class: ${analysis.sourceClasses.length}`,
    `Missing: ${analysis.missing.length}`,
    "",
    analysis.missing.length
      ? `এই ${analysis.missing.length}টা class EE-তে add করে দিই?`
      : "সব class synced আছে ✅",
  ].join("\n")

  const rows = analysis.missing.length
    ? [
        [button(`✅ Add ${analysis.missing.length} missing`, "import:yes")],
        [button("🔄 Re-check", "mapping:check"), button("❌ Cancel", "home")],
      ]
    : [[button("🔄 Re-check", "mapping:check"), button("🏠 Main", "home")]]
  await sendMessage(chatId, text, keyboard(rows))
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
    chapter: [sourceClass.subjectTitle || sourceClass.chapterTitle || "General"],
    topic: sourceClass.chapterTitle || sourceClass.sectionTitle || "",
  }
}

function classDocumentId(session, sourceClassId) {
  return `bot_${stableId(session.platform, session.sourceCourseId, session.eeCourseId, sourceClassId)}`
}

async function importMissingClasses(db, chatId, telegramUserId, session) {
  const eeCourse = await getEeCourse(db, session.eeCourseId)
  const analysis = await inspectMapping(db, session)
  if (!analysis.missing.length) {
    await showMain(chatId, "সব class আগেই add করা আছে ✅")
    return
  }

  let nextOrder = analysis.allEeClasses.length
    ? Math.max(...analysis.allEeClasses.map((item) => Number(item.order || 0))) + 1
    : 0

  for (let start = 0; start < analysis.missing.length; start += 180) {
    const chunk = analysis.missing.slice(start, start + 180)
    const batch = db.batch()
    chunk.forEach((sourceClass) => {
      const hierarchy = classHierarchy(sourceClass, eeCourse.type)
      const classId = classDocumentId(session, sourceClass.sourceClassId)
      const classRef = db.collection("classes").doc(classId)
      const jobRef = db.collection(JOB_COLLECTION).doc(`media_${classId}`)
      const isArchived = session.destinationType === "archive"
      const classGroupId = session.destinationType === "group" ? session.classGroupId : null

      batch.set(classRef, {
        courseId: session.eeCourseId,
        title: sourceClass.title || "Untitled class",
        topic: hierarchy.topic,
        chapter: hierarchy.chapter,
        subject: hierarchy.subject,
        order: nextOrder,
        duration: sourceClass.duration || "",
        youtubeLink: "",
        hlsLink: "",
        driveLink: "",
        dailymotionLink: "",
        rumbleLink: "",
        videoURL: "",
        imageURL: "",
        teacherName: asArray(sourceClass.teacherName),
        teacherImageURL: "",
        resourceLinks: [],
        isArchived,
        classGroupId,
        isPublished: false,
        mediaStatus: "waiting_worker",
        importedBy: "telegram-bot",
        importedByTelegramUserId: String(telegramUserId),
        sourcePlatform: session.platform,
        sourceAccountId: session.accountId,
        sourceCourseId: String(session.sourceCourseId),
        sourceCourseTitle: session.sourceCourseTitle,
        sourceClassId: String(sourceClass.sourceClassId),
        sourceContentId: sourceClass.sourceContentId || "",
        sourceContentTypeId: sourceClass.sourceContentTypeId || "",
        sourceSubjectId: sourceClass.sourceSubjectId || "",
        sourceChapterId: sourceClass.sourceChapterId || "",
        sourceSection: sourceClass.sectionTitle || "",
        sourceSubject: sourceClass.subjectTitle || "",
        sourceChapter: sourceClass.chapterTitle || "",
        sourceVideoHint: sourceClass.sourceVideoLocator || "",
        createdAt: serverNow(),
        updatedAt: serverNow(),
      })

      batch.set(jobRef, {
        type: "media_download",
        status: "waiting_worker",
        classId,
        courseId: session.eeCourseId,
        platform: session.platform,
        accountId: session.accountId,
        sourceCourseId: String(session.sourceCourseId),
        sourceClassId: String(sourceClass.sourceClassId),
        attempts: 0,
        createdAt: serverNow(),
        updatedAt: serverNow(),
      })
      nextOrder += 1
    })
    await batch.commit()
  }

  const mappingId = stableId(
    session.platform,
    session.sourceCourseId,
    session.eeCourseId,
    session.destinationType,
    session.classGroupId || "",
  )
  await db.collection(MAPPING_COLLECTION).doc(mappingId).set({
    platform: session.platform,
    accountId: session.accountId,
    sourceCourseId: String(session.sourceCourseId),
    sourceCourseTitle: session.sourceCourseTitle,
    eeCourseId: session.eeCourseId,
    eeCourseTitle: session.eeCourseTitle,
    eeCourseType: eeCourse.type || "subject",
    destinationType: session.destinationType || "regular",
    classGroupId: session.classGroupId || null,
    classGroupTitle: session.classGroupTitle || "",
    sourceCount: analysis.sourceClasses.length,
    importedCount: analysis.imported.length + analysis.missing.length,
    missingCount: 0,
    updatedByTelegramUserId: String(telegramUserId),
    updatedAt: serverNow(),
    createdAt: serverNow(),
  }, { merge: true })

  await setSession(db, chatId, {
    step: "mapping_ready",
    lastSourceCount: analysis.sourceClasses.length,
    lastImportedCount: analysis.imported.length + analysis.missing.length,
    lastMissingCount: 0,
  })

  await sendMessage(
    chatId,
    [
      `✅ ${analysis.missing.length}টা class Easy-Education-এ add হয়েছে।`,
      `Course: ${session.eeCourseTitle}`,
      `Destination: ${destinationLabel(session)}`,
      "",
      "Media job এখন waiting_worker placeholder-এ আছে।",
      "Video ready না হওয়া পর্যন্ত classগুলো isPublished:false থাকবে।",
    ].join("\n"),
    keyboard([[button("🔄 Check mapping", "mapping:check"), button("🏠 Main", "home")]]),
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
  const rows = options.slice(0, 20).map((item, index) => [
    button(`👤 ${item.label} · ${item.roll}`, `acct:${index}`),
  ])
  rows.push([button("➕ Add account", `accountadd:${platform}`), button("🏠 Main", "home")])
  await sendMessage(chatId, `${PLATFORM_LABELS[platform]} — কোন account use হবে?`, keyboard(rows))
}

async function loadSourceCourses(db, chatId, accountId) {
  const account = await getAccount(db, accountId)
  await sendMessage(chatId, `${account.label || account.roll} দিয়ে fresh login করছি…`)
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
  await sendMessage(chatId, `✅ Login successful\nএই account-এ ${options.length}টা course পাওয়া গেছে। কোন course?`, keyboard(rows))
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
  await setSession(db, chatId, {
    sourceCourseId: String(course.id),
    sourceCourseTitle: course.title,
    sourceCourseType: course.type || "",
    step: "ee_search",
  })
  await sendMessage(
    chatId,
    `Source course: ${course.title}\n\nএখন Easy-Education-এর course নামের কিছু অংশ লিখুন।`,
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
  const rows = options.map((course, index) => [
    button(`${course.title} · ${course.type}`, `ee:${index}`),
  ])
  rows.push([button("❌ Cancel", "home")])
  await sendMessage(chatId, `${options.length}টা matching course পেয়েছি:`, keyboard(rows))
}

async function chooseEeCourse(db, chatId, index) {
  const session = await getSession(db, chatId)
  const course = asArray(session.eeCourseOptions)[index]
  if (!course) throw new Error("EE course selection expired")
  await setSession(db, chatId, {
    eeCourseId: course.id,
    eeCourseTitle: course.title,
    eeCourseType: course.type || "subject",
    step: "choose_destination",
  })
  await sendMessage(
    chatId,
    `EE course: ${course.title}\nType: ${course.type || "subject"}\n\nকোথায় classes add হবে?`,
    keyboard([
      [button("📚 Regular", "dest:regular"), button("🗄 Archive", "dest:archive")],
      [button("🧩 Class Card", "dest:groups")],
      [button("❌ Cancel", "home")],
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
  if (!session.eeCourseId) throw new Error("EE course select করা নেই")
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
  const next = { ...session, destinationType: "group", classGroupId: group.id, classGroupTitle: group.title, step: "mapping_ready" }
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
  const next = { ...session, destinationType: "group", classGroupId: group.id, classGroupTitle: group.title, step: "mapping_ready" }
  await setSession(db, chatId, {
    destinationType: "group",
    classGroupId: group.id,
    classGroupTitle: group.title,
    step: "mapping_ready",
  })
  await sendMessage(chatId, `Class Card ready: ${group.title} ✅`)
  await showMappingAnalysis(db, chatId, next)
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

  const text = options.length
    ? `Saved accounts: ${options.length}\n\nAccount-এর পাশের 🗑 চাপলে delete করতে পারবেন।`
    : "কোনো account add করা নেই।"
  await sendMessage(chatId, text, keyboard(rows))
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
    keyboard([[button("🗑 Delete account", `accountdelete:${index}`)], [button("⬅️ Accounts", "account:list")]]),
  )
}

async function confirmDeleteAccount(db, chatId, index) {
  const session = await getSession(db, chatId)
  const option = asArray(session.accountManageOptions)[index]
  if (!option) throw new Error("Account selection expired")
  await sendMessage(
    chatId,
    `⚠️ ${option.label} (${option.roll}) account delete করবেন?\n\nSaved credential/session delete হবে। আগে EE-তে add করা classes delete হবে না।`,
    keyboard([
      [button("🗑 Yes, delete", `accountdeleteconfirm:${index}`)],
      [button("❌ Cancel", "account:list")],
    ]),
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
  let courses = []
  try {
    auth = await loginUdvash({ roll: session.accountRoll, password })
    courses = await listUdvashCourses(auth)
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
    createdByTelegramUserId: String(telegramUserId),
    updatedAt: serverNow(),
    ...(existing ? {} : { createdAt: serverNow() }),
  }, { merge: true })

  await clearSession(db, chatId)
  await showMain(
    chatId,
    `✅ ${session.accountLabel || session.accountRoll} login successful.\n📚 ${courses.length}টা course পাওয়া গেছে।\nCredential encrypted করে save হয়েছে।`,
  )
}

async function showStatus(db, chatId) {
  const [accounts, mappings, jobs] = await Promise.all([
    db.collection(ACCOUNT_COLLECTION).get(),
    db.collection(MAPPING_COLLECTION).get(),
    db.collection(JOB_COLLECTION).get(),
  ])
  const jobCounts = {}
  jobs.docs.forEach((doc) => {
    const status = doc.data().status || "unknown"
    jobCounts[status] = (jobCounts[status] || 0) + 1
  })
  const jobText = Object.entries(jobCounts).length
    ? Object.entries(jobCounts).map(([key, value]) => `${key}: ${value}`).join(" · ")
    : "none"
  await sendMessage(
    chatId,
    `Accounts: ${accounts.size}\nCourse mappings: ${mappings.size}\nMedia jobs: ${jobText}`,
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
    return showMain(chatId, "Easy-Education Upload Bot")
  }
  if (command === "/accounts") return showAccountMenu(db, chatId)
  if (command === "/status") return showStatus(db, chatId)

  const session = await getSession(db, chatId)
  if (session.step === "add_account_label") {
    await setSession(db, chatId, { accountLabel: text.slice(0, 60), step: "add_account_roll" })
    return sendMessage(chatId, "Roll / user ID দিন:")
  }
  if (session.step === "add_account_roll") {
    await setSession(db, chatId, { accountRoll: text.slice(0, 120), step: "add_account_password" })
    return sendMessage(chatId, "Password দিন। Process করার পর password message delete করার চেষ্টা করব।")
  }
  if (session.step === "add_account_password") {
    await deleteMessage(chatId, message.message_id)
    await sendMessage(chatId, "Credential পেয়েছি। Udvash login + course check করছি…")
    return saveAccountPassword(db, chatId, userId, text)
  }
  if (session.step === "ee_search") return handleEeSearch(db, chatId, text)
  if (session.step === "new_group_title") return createClassGroupFromText(db, chatId, text)

  return showMain(chatId, "Command বুঝিনি। নিচের menu ব্যবহার করুন।")
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
      "TG UP রাখা হয়েছে ✅\n\nDownload/upload worker phase এখন placeholder।",
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
  if (data.startsWith("accountinfo:")) return showAccountInfo(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("accountdeleteconfirm:")) return deleteSavedAccount(db, chatId, Number(data.split(":")[1]))
  if (data.startsWith("accountdelete:")) return confirmDeleteAccount(db, chatId, Number(data.split(":")[1]))

  if (data.startsWith("platform:")) {
    const platform = data.split(":")[1]
    if (!PLATFORM_IDS.has(platform)) throw new Error("Unsupported platform")
    return showEeAccounts(db, chatId, platform)
  }
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
  if (data.startsWith("dest:")) return chooseDestination(db, chatId, data.split(":")[1])
  if (data === "grp:new") {
    await setSession(db, chatId, { step: "new_group_title" })
    return sendMessage(chatId, "নতুন Class Card-এর নাম লিখুন। যেমন: Foundation Class")
  }
  if (data.startsWith("grp:")) return chooseGroup(db, chatId, Number(data.split(":")[1]))
  if (data === "mapping:check") return showMappingAnalysis(db, chatId, await getSession(db, chatId))
  if (data === "import:yes") {
    await sendMessage(chatId, "Missing classes import করছি…")
    return importMissingClasses(db, chatId, userId, await getSession(db, chatId))
  }

  return sendMessage(chatId, "এই action expire করেছে। /start দিয়ে আবার শুরু করুন।")
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
    await sendMessage(
      chatId,
      `এই bot-এ আপনার access নেই।\nআপনার Telegram user ID: ${userId}`,
    ).catch(() => {})
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
    const setupHint = error.code === "BOT_SETUP_REQUIRED" ? "\n\nServer environment config complete করতে হবে।" : ""
    await sendMessage(
      chatId,
      `❌ ${error.message || "Unexpected bot error"}${setupHint}`,
      keyboard([[button("🏠 Main", "home")]]),
    ).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}
