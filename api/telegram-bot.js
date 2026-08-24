import { FieldValue } from "firebase-admin/firestore"
import { getAdminServices } from "./utils/firebase-admin.js"
import { decryptSecret, encryptSecret, stableId } from "./bot/crypto.js"
import {
  answerCallback,
  button,
  deleteMessage,
  isAllowedTelegramUser,
  keyboard,
  mainMenu,
  sendMessage,
} from "./bot/telegram.js"
import {
  getUdvashCourseContent,
  listUdvashCourses,
  loginUdvash,
  udvashConfigured,
} from "./bot/platforms/udvash.js"

const SESSION_COLLECTION = "botSessions"
const ACCOUNT_COLLECTION = "botPlatformAccounts"
const MAPPING_COLLECTION = "botCourseMappings"
const JOB_COLLECTION = "botJobs"

const PLATFORM_LABELS = { udvash: "Udvash" }
const PLATFORM_IDS = new Set(Object.keys(PLATFORM_LABELS))

const normalizeText = (value) => String(value || "").trim().toLowerCase()
const arrayValue = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []

function now() {
  return FieldValue.serverTimestamp()
}

function sessionRef(db, chatId) {
  return db.collection(SESSION_COLLECTION).doc(String(chatId))
}

async function getSession(db, chatId) {
  const snapshot = await sessionRef(db, chatId).get()
  return snapshot.exists ? snapshot.data() : {}
}

async function setSession(db, chatId, patch) {
  await sessionRef(db, chatId).set({ ...patch, updatedAt: now() }, { merge: true })
}

async function replaceSession(db, chatId, value = {}) {
  await sessionRef(db, chatId).set({ ...value, updatedAt: now() })
}

async function clearSession(db, chatId) {
  await sessionRef(db, chatId).delete().catch(() => {})
}

async function showMain(chatId, prefix = "") {
  const text = [prefix, "কি করতে চান?"].filter(Boolean).join("\n\n")
  await sendMessage(chatId, text, mainMenu())
}

function platformKeyboard(prefix = "platform") {
  return keyboard([
    [button("Udvash", `${prefix}:udvash`)],
    [button("⬅️ Main menu", "home")],
  ])
}

async function listAccounts(db, platform) {
  const snapshot = await db.collection(ACCOUNT_COLLECTION).where("platform", "==", platform).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.label || a.roll || "").localeCompare(String(b.label || b.roll || "")))
}

async function refreshAccountAuth(db, account) {
  if (account.platform !== "udvash") throw new Error(`Unsupported platform: ${account.platform}`)
  const password = decryptSecret(account.passwordEncrypted)
  const auth = await loginUdvash({ roll: account.roll, password })
  await db.collection(ACCOUNT_COLLECTION).doc(account.id).set({
    cookieEncrypted: auth.cookie ? encryptSecret(auth.cookie) : "",
    tokenEncrypted: auth.token ? encryptSecret(auth.token) : "",
    status: "ready",
    lastLoginAt: now(),
    lastError: "",
    updatedAt: now(),
  }, { merge: true })
  return auth
}

async function getAccount(db, accountId) {
  const snapshot = await db.collection(ACCOUNT_COLLECTION).doc(accountId).get()
  if (!snapshot.exists) throw new Error("Account পাওয়া যায়নি")
  return { id: snapshot.id, ...snapshot.data() }
}

async function platformCourses(db, account) {
  const auth = await refreshAccountAuth(db, account)
  if (account.platform === "udvash") return listUdvashCourses(auth)
  throw new Error(`Unsupported platform: ${account.platform}`)
}

async function platformContent(db, account, sourceCourseId) {
  const auth = await refreshAccountAuth(db, account)
  if (account.platform === "udvash") return getUdvashCourseContent(auth, sourceCourseId)
  throw new Error(`Unsupported platform: ${account.platform}`)
}

function courseScore(course, queryText) {
  const title = normalizeText(course.title || course.name)
  const query = normalizeText(queryText)
  if (!query) return 0
  if (title === query) return 1000
  if (title.startsWith(query)) return 700
  if (title.includes(query)) return 500
  const words = query.split(/\s+/).filter(Boolean)
  return words.reduce((score, word) => score + (title.includes(word) ? 50 : 0), 0)
}

async function searchEeCourses(db, queryText) {
  const snapshot = await db.collection("courses").get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((course) => ({ course, score: courseScore(course, queryText) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.course.title || "").localeCompare(String(b.course.title || "")))
    .slice(0, 8)
    .map((item) => item.course)
}

async function getEeCourse(db, courseId) {
  const snapshot = await db.collection("courses").doc(courseId).get()
  if (!snapshot.exists) throw new Error("Easy-Education course পাওয়া যায়নি")
  return { id: snapshot.id, ...snapshot.data() }
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
  const snapshot = await db.collection("classes").where("courseId", "==", session.eeCourseId).get()
  const existing = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const imported = existing.filter((item) => importedClassMatches(item, session))
  const importedIds = new Set(imported.map((item) => String(item.sourceClassId || "")).filter(Boolean))
  const missing = sourceClasses.filter((item) => !importedIds.has(String(item.sourceClassId)))
  return { sourceClasses, imported, missing, allEeClasses: existing }
}

async function showMappingAnalysis(db, chatId, session) {
  await sendMessage(chatId, "Source course আবার login করে current class list মিলিয়ে দেখছি…")
  const analysis = await inspectMapping(db, session)
  await setSession(db, chatId, {
    lastSourceCount: analysis.sourceClasses.length,
    lastImportedCount: analysis.imported.length,
    lastMissingCount: analysis.missing.length,
  })

  const platformName = PLATFORM_LABELS[session.platform] || session.platform
  const text = [
    `Platform: ${platformName}`,
    `Source course: ${session.sourceCourseTitle}`,
    `EE course: ${session.eeCourseTitle} (${session.eeCourseType || "subject"})`,
    `Destination: ${destinationLabel(session)}`,
    "",
    `EE-তে এই ${platformName} course-এর ${analysis.imported.length}টা class আগে থেকেই আছে।`,
    `${platformName}-এ এখন ${analysis.sourceClasses.length}টা class আছে।`,
    analysis.missing.length
      ? `মানে ${analysis.missing.length}টা class বাকি আছে। এগুলো EE-তে add করে দিই?`
      : "কোনো class বাকি নেই — mapping up to date ✅",
  ].join("\n")

  const rows = analysis.missing.length
    ? [[button(`✅ Add ${analysis.missing.length} missing`, "import:yes")], [button("🔄 Re-check", "mapping:check"), button("❌ Cancel", "home")]]
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

function mediaJobId(classId) {
  return `media_${classId}`
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

  const chunks = []
  for (let index = 0; index < analysis.missing.length; index += 180) {
    chunks.push(analysis.missing.slice(index, index + 180))
  }

  for (const chunk of chunks) {
    const batch = db.batch()
    chunk.forEach((sourceClass) => {
      const hierarchy = classHierarchy(sourceClass, eeCourse.type)
      const classId = classDocumentId(session, sourceClass.sourceClassId)
      const classRef = db.collection("classes").doc(classId)
      const jobRef = db.collection(JOB_COLLECTION).doc(mediaJobId(classId))
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
        teacherName: arrayValue(sourceClass.teacherName),
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
        sourceSection: sourceClass.sectionTitle || "",
        sourceSubject: sourceClass.subjectTitle || "",
        sourceChapter: sourceClass.chapterTitle || "",
        sourceVideoHint: sourceClass.sourceVideoLocator || "",
        createdAt: now(),
        updatedAt: now(),
      }, { merge: false })

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
        createdAt: now(),
        updatedAt: now(),
      }, { merge: false })
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
    updatedAt: now(),
    createdAt: now(),
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
      "এখন media download/upload placeholder queue-তে waiting_worker হিসেবে আছে।",
      "Video ready না হওয়া পর্যন্ত class-গুলো isPublished:false, তাই student-রা দেখবে না।",
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
      `${PLATFORM_LABELS[platform]} account এখনো add করা নেই। আগে account add করুন।`,
      keyboard([[button("➕ Add account", `accountadd:${platform}`)], [button("⬅️ Main", "home")]]),
    )
    return
  }
  await replaceSession(db, chatId, {
    mode: "ee",
    platform,
    step: "choose_account",
    accountOptions: accounts.map((item) => ({ id: item.id, label: item.label || item.roll, roll: item.roll })),
  })
  const rows = accounts.slice(0, 20).map((item, index) => [
    button(`👤 ${item.label || item.roll} · ${item.roll}`, `acct:${index}`),
  ])
  rows.push([button("➕ Add account", `accountadd:${platform}`), button("🏠 Main", "home")])
  await sendMessage(chatId, `${PLATFORM_LABELS[platform]} — কোন account use হবে?`, keyboard(rows))
}

async function loadSourceCourses(db, chatId, accountId) {
  const account = await getAccount(db, accountId)
  await sendMessage(chatId, `${account.label || account.roll} দিয়ে login করে courses আনছি…`)
  const courses = await platformCourses(db, account)
  await setSession(db, chatId, {
    accountId,
    step: "choose_source_course",
    sourceCourseOptions: courses.slice(0, 50),
  })

  if (!courses.length) {
    await sendMessage(chatId, "এই account-এ কোনো course পাওয়া যায়নি।", keyboard([[button("🏠 Main", "home")]]))
    return
  }
  const rows = courses.slice(0, 20).map((course, index) => [button(course.title, `src:${index}`)])
  if (courses.length > 20) rows.push([button(`আরও ${courses.length - 20}টা course (/courses)`, "source:more")])
  rows.push([button("⬅️ Accounts", `platform:${account.platform}`), button("🏠 Main", "home")])
  await sendMessage(chatId, `এই account-এ ${courses.length}টা course পাওয়া গেছে। কোন course?`, keyboard(rows))
}

async function showMoreSourceCourses(db, chatId) {
  const session = await getSession(db, chatId)
  const courses = arrayValue(session.sourceCourseOptions)
  const rows = courses.slice(20, 50).map((course, index) => [button(course.title, `src:${index + 20}`)])
  rows.push([button("🏠 Main", "home")])
  await sendMessage(chatId, `বাকি course (${Math.max(0, courses.length - 20)}):`, keyboard(rows))
}

async function chooseSourceCourse(db, chatId, index) {
  const session = await getSession(db, chatId)
  const course = arrayValue(session.sourceCourseOptions)[index]
  if (!course) throw new Error("Source course selection expired. আবার শুরু করুন।")
  await setSession(db, chatId, {
    sourceCourseId: String(course.id),
    sourceCourseTitle: course.title,
    sourceCourseType: course.type || "",
    step: "ee_search",
  })
  await sendMessage(chatId, `Source course: ${course.title}\n\nএখন Easy-Education-এর course নাম লিখুন। আমি realtime search করে matching course দেখাব।`)
}

async function handleEeSearch(db, chatId, text) {
  const matches = await searchEeCourses(db, text)
  await setSession(db, chatId, {
    eeSearchQuery: text,
    eeCourseOptions: matches.map((course) => ({
      id: course.id,
      title: course.title || course.name || "Untitled",
      type: course.type || "subject",
    })),
  })
  if (!matches.length) {
    await sendMessage(chatId, "কোনো matching EE course পাইনি। আরেকটা keyword লিখুন।")
    return
  }
  const rows = matches.map((course, index) => [
    button(`${course.title || course.name} · ${course.type || "subject"}`, `ee:${index}`),
  ])
  rows.push([button("❌ Cancel", "home")])
  await sendMessage(chatId, `${matches.length}টা matching course পেয়েছি:`, keyboard(rows))
}

async function chooseEeCourse(db, chatId, index) {
  const session = await getSession(db, chatId)
  const course = arrayValue(session.eeCourseOptions)[index]
  if (!course) throw new Error("EE course selection expired. আবার search করুন।")
  await setSession(db, chatId, {
    eeCourseId: course.id,
    eeCourseTitle: course.title,
    eeCourseType: course.type || "subject",
    step: "choose_destination",
  })
  await sendMessage(
    chatId,
    [
      `EE course: ${course.title}`,
      `Type: ${course.type || "subject"}`,
      "",
      "কোথায় classes add হবে?",
    ].join("\n"),
    keyboard([
      [button("📚 Regular", "dest:regular"), button("🗄 Archive", "dest:archive")],
      [button("🧩 Class Card", "dest:groups")],
      [button("❌ Cancel", "home")],
    ]),
  )
}

async function showClassGroups(db, chatId, session) {
  const snapshot = await db.collection("classGroups").where("courseId", "==", session.eeCourseId).get()
  const groups = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  await setSession(db, chatId, {
    classGroupOptions: groups.map((group) => ({ id: group.id, title: group.title })),
    step: "choose_group",
  })
  const rows = groups.slice(0, 20).map((group, index) => [button(`🧩 ${group.title}`, `grp:${index}`)])
  rows.push([button("➕ Create new card", "grp:new")])
  rows.push([button("⬅️ Destination", "dest:back"), button("🏠 Main", "home")])
  await sendMessage(chatId, groups.length ? "কোন Class Card?" : "এই course-এ Class Card নেই। চাইলে এখনই create করুন।", keyboard(rows))
}

async function chooseDestination(db, chatId, type) {
  const session = await getSession(db, chatId)
  if (!session.eeCourseId) throw new Error("EE course select করা নেই")
  if (type === "groups") {
    await showClassGroups(db, chatId, session)
    return
  }
  if (type === "back") {
    await chooseEeCourse(db, chatId, arrayValue(session.eeCourseOptions).findIndex((item) => item.id === session.eeCourseId))
    return
  }
  await setSession(db, chatId, {
    destinationType: type,
    classGroupId: null,
    classGroupTitle: "",
    step: "mapping_ready",
  })
  await showMappingAnalysis(db, chatId, { ...session, destinationType: type, classGroupId: null, classGroupTitle: "" })
}

async function chooseGroup(db, chatId, index) {
  const session = await getSession(db, chatId)
  const group = arrayValue(session.classGroupOptions)[index]
  if (!group) throw new Error("Class Card selection expired")
  const nextSession = {
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
  await showMappingAnalysis(db, chatId, nextSession)
}

async function createClassGroupFromText(db, chatId, title) {
  const session = await getSession(db, chatId)
  if (!session.eeCourseId) throw new Error("EE course select করা নেই")
  const snapshot = await db.collection("classGroups").where("courseId", "==", session.eeCourseId).get()
  const existing = snapshot.docs.find((doc) => normalizeText(doc.data().title) === normalizeText(title))
  let group
  if (existing) {
    group = { id: existing.id, ...existing.data() }
  } else {
    const ref = await db.collection("classGroups").add({
      courseId: session.eeCourseId,
      title: String(title).trim(),
      description: "",
      order: snapshot.size,
      isVisible: true,
      createdBy: "telegram-bot",
      createdAt: now(),
      updatedAt: now(),
    })
    group = { id: ref.id, title: String(title).trim() }
  }
  const nextSession = {
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
  await showMappingAnalysis(db, chatId, nextSession)
}

async function showAccountMenu(db, chatId) {
  const snapshot = await db.collection(ACCOUNT_COLLECTION).get()
  const accounts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const lines = accounts.length
    ? accounts.map((item, index) => `${index + 1}. ${PLATFORM_LABELS[item.platform] || item.platform} · ${item.label || item.roll} · ${item.roll} · ${item.status || "saved"}`)
    : ["কোনো account add করা নেই।"]
  await sendMessage(
    chatId,
    ["Saved source accounts:", ...lines].join("\n"),
    keyboard([[button("➕ Add account", "account:add")], [button("🏠 Main", "home")]]),
  )
}

async function startAccountAdd(db, chatId, platform) {
  if (!PLATFORM_IDS.has(platform)) throw new Error("Unsupported platform")
  await replaceSession(db, chatId, { mode: "account_add", platform, step: "add_account_label" })
  await sendMessage(chatId, `${PLATFORM_LABELS[platform]} account-এর একটা নাম দিন। যেমন: UDVASH-1`)
}

async function saveAccountPassword(db, chatId, telegramUserId, password) {
  const session = await getSession(db, chatId)
  if (!session.platform || !session.accountRoll) throw new Error("Account add session expired")
  const passwordEncrypted = encryptSecret(password)
  const base = {
    platform: session.platform,
    label: session.accountLabel || session.accountRoll,
    roll: session.accountRoll,
    passwordEncrypted,
    createdByTelegramUserId: String(telegramUserId),
    updatedAt: now(),
  }

  let auth = null
  let status = "saved"
  let lastError = ""
  if (session.platform === "udvash" && !udvashConfigured()) {
    status = "needs_platform_config"
    lastError = "Udvash endpoint environment variables are not configured"
  } else {
    try {
      auth = await loginUdvash({ roll: session.accountRoll, password })
      status = "ready"
    } catch (error) {
      status = "login_failed"
      lastError = error.message || "Login failed"
    }
  }

  const existingSnapshot = await db.collection(ACCOUNT_COLLECTION)
    .where("platform", "==", session.platform)
    .get()
  const existing = existingSnapshot.docs.find((doc) => String(doc.data().roll) === String(session.accountRoll))
  const ref = existing ? existing.ref : db.collection(ACCOUNT_COLLECTION).doc()
  await ref.set({
    ...base,
    status,
    lastError,
    cookieEncrypted: auth?.cookie ? encryptSecret(auth.cookie) : existing?.data()?.cookieEncrypted || "",
    tokenEncrypted: auth?.token ? encryptSecret(auth.token) : existing?.data()?.tokenEncrypted || "",
    ...(auth ? { lastLoginAt: now() } : {}),
    ...(existing ? {} : { createdAt: now() }),
  }, { merge: true })

  await clearSession(db, chatId)
  if (status === "ready") {
    await showMain(chatId, `✅ ${session.accountLabel || session.accountRoll} login successful. Cookie/token securely encrypted করে save হয়েছে।`)
  } else if (status === "needs_platform_config") {
    await showMain(chatId, "Account save হয়েছে, কিন্তু Udvash endpoint config না থাকায় এখন login test হয়নি।")
  } else {
    await showMain(chatId, `Account save হয়েছে, কিন্তু login test fail করেছে:\n${lastError}`)
  }
}

async function showStatus(db, chatId) {
  const [accountSnap, mappingSnap, jobsSnap] = await Promise.all([
    db.collection(ACCOUNT_COLLECTION).get(),
    db.collection(MAPPING_COLLECTION).get(),
    db.collection(JOB_COLLECTION).get(),
  ])
  const jobCounts = {}
  jobsSnap.docs.forEach((doc) => {
    const status = doc.data().status || "unknown"
    jobCounts[status] = (jobCounts[status] || 0) + 1
  })
  const jobText = Object.entries(jobCounts).length
    ? Object.entries(jobCounts).map(([key, value]) => `${key}: ${value}`).join(" · ")
    : "none"
  await sendMessage(
    chatId,
    `Accounts: ${accountSnap.size}\nCourse mappings: ${mappingSnap.size}\nMedia jobs: ${jobText}`,
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
  if (command === "/accounts") {
    await showAccountMenu(db, chatId)
    return
  }
  if (command === "/status") {
    await showStatus(db, chatId)
    return
  }

  const session = await getSession(db, chatId)
  if (session.step === "add_account_label") {
    await setSession(db, chatId, { accountLabel: text.slice(0, 60), step: "add_account_roll" })
    await sendMessage(chatId, "Roll / user ID দিন:")
    return
  }
  if (session.step === "add_account_roll") {
    await setSession(db, chatId, { accountRoll: text.slice(0, 120), step: "add_account_password" })
    await sendMessage(chatId, "Password দিন। Security-এর জন্য password message process করার পর bot delete করার চেষ্টা করবে।")
    return
  }
  if (session.step === "add_account_password") {
    await deleteMessage(chatId, message.message_id)
    await sendMessage(chatId, "Credential পেয়েছি। Login test করছি…")
    await saveAccountPassword(db, chatId, userId, text)
    return
  }
  if (session.step === "ee_search") {
    await handleEeSearch(db, chatId, text)
    return
  }
  if (session.step === "new_group_title") {
    await createClassGroupFromText(db, chatId, text)
    return
  }

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
    await showMain(chatId, "Main menu")
    return
  }
  if (data === "mode:ee") {
    await replaceSession(db, chatId, { mode: "ee", step: "choose_platform" })
    await sendMessage(chatId, "কোন platform থেকে EE UP করবেন?", platformKeyboard("platform"))
    return
  }
  if (data === "mode:tg") {
    await sendMessage(
      chatId,
      "TG UP option রাখা হয়েছে ✅\n\nDownload/upload worker phase এখন placeholder। EE UP complete করার পর এই একই bot-এ queue + phone/PC worker connect হবে।",
      keyboard([[button("🏠 Main", "home")]]),
    )
    return
  }
  if (data === "account:list") {
    await showAccountMenu(db, chatId)
    return
  }
  if (data === "account:add") {
    await replaceSession(db, chatId, { mode: "account_add", step: "choose_platform" })
    await sendMessage(chatId, "কোন platform-এর account add করবেন?", platformKeyboard("accountadd"))
    return
  }
  if (data === "status") {
    await showStatus(db, chatId)
    return
  }
  if (data.startsWith("accountadd:")) {
    await startAccountAdd(db, chatId, data.split(":")[1])
    return
  }
  if (data.startsWith("platform:")) {
    const platform = data.split(":")[1]
    if (!PLATFORM_IDS.has(platform)) throw new Error("Unsupported platform")
    await showEeAccounts(db, chatId, platform)
    return
  }
  if (data.startsWith("acct:")) {
    const session = await getSession(db, chatId)
    const option = arrayValue(session.accountOptions)[Number(data.split(":")[1])]
    if (!option) throw new Error("Account selection expired")
    await setSession(db, chatId, { accountId: option.id })
    await loadSourceCourses(db, chatId, option.id)
    return
  }
  if (data === "source:more") {
    await showMoreSourceCourses(db, chatId)
    return
  }
  if (data.startsWith("src:")) {
    await chooseSourceCourse(db, chatId, Number(data.split(":")[1]))
    return
  }
  if (data.startsWith("ee:")) {
    await chooseEeCourse(db, chatId, Number(data.split(":")[1]))
    return
  }
  if (data.startsWith("dest:")) {
    await chooseDestination(db, chatId, data.split(":")[1])
    return
  }
  if (data === "grp:new") {
    await setSession(db, chatId, { step: "new_group_title" })
    await sendMessage(chatId, "নতুন Class Card-এর নাম লিখুন। যেমন: Foundation Class")
    return
  }
  if (data.startsWith("grp:")) {
    await chooseGroup(db, chatId, Number(data.split(":")[1]))
    return
  }
  if (data === "mapping:check") {
    const session = await getSession(db, chatId)
    await showMappingAnalysis(db, chatId, session)
    return
  }
  if (data === "import:yes") {
    const session = await getSession(db, chatId)
    await sendMessage(chatId, "Missing classes import করছি…")
    await importMissingClasses(db, chatId, userId, session)
    return
  }

  await sendMessage(chatId, "এই action expire করেছে। /start দিয়ে আবার শুরু করুন।")
}

function validWebhookSecret(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || ""
  if (!expected) return true
  const actual = req.headers["x-telegram-bot-api-secret-token"] || ""
  return actual === expected
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
      `এই bot-এ আপনার access নেই।\nআপনার Telegram user ID: ${userId}\n\nVercel TELEGRAM_ADMIN_IDS-এ এই ID add করলে access পাবেন।`,
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
    const setupHint = error.code === "PLATFORM_NOT_CONFIGURED" || error.code === "BOT_SETUP_REQUIRED"
      ? "\n\nServer environment config complete করতে হবে।"
      : ""
    await sendMessage(chatId, `❌ ${error.message || "Unexpected bot error"}${setupHint}`, keyboard([[button("🏠 Main", "home")]])).catch(() => {})
    return res.status(200).json({ ok: true, handled_error: true })
  }
}
