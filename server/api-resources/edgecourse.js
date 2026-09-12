import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const EDGE_API_ORIGIN = "https://api.edgecoursebd.com"
const EDGE_SITE_ORIGIN = "https://edgecoursebd.com"
const CATALOG_URL = `${EDGE_API_ORIGIN}/api/courses/`
const DETAIL_PREFIX = `${EDGE_API_ORIGIN}/api/v2/course-detail/`
const ACCESS_MODE = String(process.env.EDGECOURSE_ACCESS_MODE || "free").trim().toLowerCase() === "premium" ? "premium" : "free"
const ENTITLEMENTS = "edgeCourseEntitlements"
const MY_COURSES = "edgeCourseUserCourses"
const MAX_SEARCH = 120
const MAX_PAGE = 1000

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

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function safeHttpUrl(value, base = EDGE_API_ORIGIN) {
  const raw = text(value)
  if (!raw) return ""
  try {
    const url = new URL(raw, base)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""
    return url.toString()
  } catch {
    return ""
  }
}

function courseIdOf(raw) {
  return text(raw?.id, raw?.course_id, raw?.courseId, raw?.pk)
}

function activeEntitlement(data, now = Date.now()) {
  if (!data || String(data.status || "").toLowerCase() === "revoked") return false
  const expiresAtMs = Number(data.expiresAtMs || 0)
  return !expiresAtMs || expiresAtMs > now
}

async function courseAccess(authenticated, courseId) {
  if (ACCESS_MODE !== "premium") return { active: true, type: "free", expiresAtMs: 0 }
  if (isFullAdminProfile(authenticated.userProfile)) return { active: true, type: "admin", expiresAtMs: 0 }
  const uid = authenticated.decodedToken.uid
  const snap = await authenticated.db.collection(ENTITLEMENTS).doc(`${uid}_${courseId}`).get()
  const data = snap.exists ? snap.data() || {} : null
  if (!activeEntitlement(data)) return { active: false, type: "locked", expiresAtMs: 0 }
  return {
    active: true,
    type: text(data.accessType, data.type) || "premium",
    expiresAtMs: Number(data.expiresAtMs || 0),
  }
}

async function accessMap(authenticated, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (ACCESS_MODE !== "premium") {
    return new Map(uniqueIds.map((id) => [id, { active: true, type: "free", expiresAtMs: 0 }]))
  }
  if (isFullAdminProfile(authenticated.userProfile)) {
    return new Map(uniqueIds.map((id) => [id, { active: true, type: "admin", expiresAtMs: 0 }]))
  }
  const uid = authenticated.decodedToken.uid
  const refs = uniqueIds.map((id) => authenticated.db.collection(ENTITLEMENTS).doc(`${uid}_${id}`))
  const snapshots = refs.length ? await authenticated.db.getAll(...refs) : []
  const now = Date.now()
  const result = new Map()
  snapshots.forEach((snap, index) => {
    const id = uniqueIds[index]
    const data = snap.exists ? snap.data() || {} : null
    result.set(id, activeEntitlement(data, now)
      ? { active: true, type: text(data.accessType, data.type) || "premium", expiresAtMs: Number(data.expiresAtMs || 0) }
      : { active: false, type: "locked", expiresAtMs: 0 })
  })
  return result
}

function normalizeCourse(raw, access = { active: true, type: "free", expiresAtMs: 0 }) {
  const id = courseIdOf(raw)
  return {
    id,
    title: text(raw?.name, raw?.title) || "EdgeCourse",
    description: stripHtml(text(raw?.short_description, raw?.description, raw?.about)).slice(0, 1200),
    thumbnailUrl: safeHttpUrl(text(raw?.thumbnail, raw?.thumb, raw?.image, raw?.image_url), EDGE_SITE_ORIGIN),
    sourcePrice: Number(raw?.price ?? raw?.amount ?? raw?.regular_price ?? 0) || 0,
    price: 0,
    sourceUrl: id ? `${EDGE_SITE_ORIGIN}/courses/${encodeURIComponent(id)}` : EDGE_SITE_ORIGIN,
    source: "edgecourse",
    hasAccess: Boolean(access.active),
    accessType: access.type,
    accessExpiresAtMs: Number(access.expiresAtMs || 0),
    accessMode: ACCESS_MODE,
  }
}

function youtubeUrl(...ids) {
  const id = text(...ids)
  if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return ""
  return `https://www.youtube.com/watch?v=${id}`
}

function pushUniqueLink(target, label, kind, value, base = EDGE_API_ORIGIN) {
  const url = safeHttpUrl(value, base)
  if (!url || target.some((entry) => entry.url === url && entry.kind === kind)) return
  target.push({ label, kind, url, playable: kind === "video" })
}

function collectVideoLinks(target, classVideo) {
  if (!classVideo) return
  if (typeof classVideo === "string") {
    pushUniqueLink(target, "Class video", "video", classVideo)
    return
  }
  if (typeof classVideo !== "object") return

  ;[
    ["Class video", classVideo.url],
    ["Video", classVideo.video_url],
    ["Video", classVideo.video_link],
    ["Playback", classVideo.playback_url],
    ["Bunny video", classVideo.bunny_video_url],
  ].forEach(([label, value]) => pushUniqueLink(target, label, "video", value))

  const recorded = classVideo.recorded_video
  if (recorded && typeof recorded === "object") {
    ;[
      ["Recorded video", recorded.url],
      ["Recorded video", recorded.video_url],
      ["Recorded video", recorded.video_link],
      ["Recorded playback", recorded.playback_url],
      ["Recorded Bunny video", recorded.bunny_video_url],
    ].forEach(([label, value]) => pushUniqueLink(target, label, "video", value))
    pushUniqueLink(target, "Recorded YouTube", "video", youtubeUrl(recorded.youtube_id, recorded.youtube_video_id))
  }

  const broadcast = classVideo.broadcast
  if (broadcast && typeof broadcast === "object") {
    ;[
      ["Broadcast", broadcast.url],
      ["Broadcast video", broadcast.video_url],
      ["Broadcast playback", broadcast.playback_url],
      ["Broadcast Bunny video", broadcast.bunny_video_url],
    ].forEach(([label, value]) => pushUniqueLink(target, label, "video", value))
    pushUniqueLink(target, "Broadcast YouTube", "video", youtubeUrl(broadcast.broadcast_id, broadcast.youtube_id))
  }

  pushUniqueLink(target, "YouTube", "video", youtubeUrl(
    classVideo.youtube_id,
    classVideo.youtube_video_id,
    classVideo.broadcast_id,
  ))
}

function itemLinks(item, allowed) {
  if (!allowed || !item || typeof item !== "object") return []
  const links = []
  pushUniqueLink(links, "Main link", "link", item.url)
  pushUniqueLink(links, "Video", "video", item.video_link)
  collectVideoLinks(links, item.class_video)
  pushUniqueLink(links, "Lecture material", "material", item.lecture_material_link)
  pushUniqueLink(links, "Practice", "practice", item.practice_link)
  pushUniqueLink(links, "Solution", "solution", item.solution_link)
  pushUniqueLink(links, "Marked copy", "marked", item.marked_link)
  pushUniqueLink(links, "E-book", "ebook", item.ebook_link)
  pushUniqueLink(links, "Redirect", "link", item.redirect_link)
  pushUniqueLink(links, "PDF", "pdf", item.pdf_link)
  pushUniqueLink(links, "Exam", "exam", item.exam_link)
  pushUniqueLink(links, "Resource", "material", item.resource_url || item.resource_link)
  pushUniqueLink(links, "Document", "material", item.file_url || item.file_link)
  pushUniqueLink(links, "Open link", "link", item.link || item.href)
  return links
}

function normalizeItem(item, index, access) {
  const links = itemLinks(item, access.active)
  const typeText = text(item?.type, item?.link_type, item?.indicator).toLowerCase()
  const overallKind = links.some((link) => link.kind === "video") || typeText.includes("video") || typeText.includes("class")
    ? "video"
    : (typeText || "material")
  return {
    id: text(item?.id, item?.pk) || `item-${index}`,
    title: text(item?.title, item?.name, item?.topic, item?.label) || `Item ${index + 1}`,
    description: stripHtml(text(item?.description, item?.details, item?.note)).slice(0, 1000),
    kind: overallKind,
    links,
    locked: !access.active,
  }
}

function normalizeModule(module, index, access) {
  const sourceItems = asArray(module?.tutorials).length ? asArray(module.tutorials) : asArray(module?.materials)
  return {
    id: text(module?.id, module?.pk) || `module-${index}`,
    title: text(module?.name, module?.title) || `Module ${index + 1}`,
    items: sourceItems.map((item, itemIndex) => normalizeItem(item, itemIndex, access)),
  }
}

function normalizeSection(section, index, access) {
  return {
    id: text(section?.id, section?.pk) || `section-${index}`,
    title: text(section?.name, section?.title) || `Section ${index + 1}`,
    modules: asArray(section?.modules).map((module, moduleIndex) => normalizeModule(module, moduleIndex, access)),
    materials: asArray(section?.materials).map((item, itemIndex) => normalizeItem(item, itemIndex, access)),
  }
}

function normalizeHeader(header, index, access) {
  return {
    id: text(header?.id, header?.pk) || `header-${index}`,
    title: text(header?.name, header?.title) || `Part ${index + 1}`,
    sections: asArray(header?.sections).map((section, sectionIndex) => normalizeSection(section, sectionIndex, access)),
  }
}

function detailCounts(headers) {
  let sections = 0
  let modules = 0
  let items = 0
  let videos = 0
  let materials = 0
  headers.forEach((header) => header.sections.forEach((section) => {
    sections += 1
    modules += section.modules.length
    const sectionItems = [
      ...section.materials,
      ...section.modules.flatMap((module) => module.items),
    ]
    items += sectionItems.length
    sectionItems.forEach((item) => {
      if (item.links.some((link) => link.kind === "video")) videos += 1
      if (item.links.some((link) => link.kind !== "video")) materials += 1
    })
  }))
  return { headers: headers.length, sections, modules, items, videos, materials }
}

async function edgeFetch(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "EasyEducation/1.0 EdgeCourseProvider",
      Referer: `${EDGE_SITE_ORIGIN}/`,
    },
    redirect: "follow",
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    const error = new Error(`EdgeCourse is temporarily unavailable (${response.status})${detail ? `: ${detail.slice(0, 140)}` : ""}`)
    error.statusCode = response.status === 404 ? 404 : 502
    throw error
  }
  return response.json()
}

async function catalog(req, res, authenticated) {
  const page = Math.max(1, Math.min(MAX_PAGE, Number.parseInt(String(req.query?.page || "1"), 10) || 1))
  const search = text(req.query?.search).slice(0, MAX_SEARCH)
  const url = new URL(CATALOG_URL)
  url.searchParams.set("page", String(page))
  if (search) url.searchParams.set("search", search)
  const payload = await edgeFetch(url.toString())
  const rows = Array.isArray(payload) ? payload : asArray(payload?.results)
  const ids = rows.map(courseIdOf)
  const accesses = await accessMap(authenticated, ids)
  const courses = rows
    .map((row) => normalizeCourse(row, accesses.get(courseIdOf(row))))
    .filter((course) => course.id)
  const count = Number(payload?.count || courses.length || 0)
  const pageSize = courses.length || 10
  const totalPages = count ? Math.max(1, Math.ceil(count / Math.max(1, pageSize))) : page
  return res.status(200).json({
    accessMode: ACCESS_MODE,
    page,
    count,
    totalPages,
    next: text(payload?.next),
    previous: text(payload?.previous),
    courses,
  })
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body
  if (typeof req.body === "string" && req.body.trim()) {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return {}
}

function validCourseId(value) {
  const courseId = text(value)
  return /^[A-Za-z0-9_-]{1,120}$/.test(courseId) ? courseId : ""
}

async function membershipSnapshot(authenticated, courseId) {
  const uid = authenticated.decodedToken.uid
  return authenticated.db.collection(MY_COURSES).doc(`${uid}_${courseId}`).get()
}

function membershipActive(snapshot) {
  if (!snapshot?.exists) return false
  const data = snapshot.data() || {}
  return String(data.status || "active").toLowerCase() === "active"
}

async function courseDetail(req, res, authenticated) {
  const courseId = validCourseId(req.query?.courseId)
  if (!courseId) {
    return res.status(400).json({ error: "A valid EdgeCourse courseId is required" })
  }
  const payload = await edgeFetch(`${DETAIL_PREFIX}${encodeURIComponent(courseId)}/`)
  const rawCourse = payload?.course && typeof payload.course === "object" ? payload.course : payload
  const [access, membership] = await Promise.all([
    courseAccess(authenticated, courseId),
    membershipSnapshot(authenticated, courseId),
  ])
  const headers = asArray(rawCourse?.section_headers).map((header, index) => normalizeHeader(header, index, access))
  return res.status(200).json({
    accessMode: ACCESS_MODE,
    course: { ...normalizeCourse({ ...rawCourse, id: courseId }, access), inMyCourses: membershipActive(membership) },
    headers,
    counts: detailCounts(headers),
  })
}

async function myCourses(req, res, authenticated) {
  const uid = authenticated.decodedToken.uid
  const snapshot = await authenticated.db.collection(MY_COURSES)
    .where("userId", "==", uid)
    .get()
  const memberships = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((item) => String(item.status || "active").toLowerCase() === "active")
    .filter((item) => validCourseId(item.courseId))
    .sort((a, b) => Number(b.addedAtMs || 0) - Number(a.addedAtMs || 0))
    .slice(0, 60)

  const courses = await Promise.all(memberships.map(async (membership) => {
    const courseId = validCourseId(membership.courseId)
    const access = await courseAccess(authenticated, courseId)
    try {
      const payload = await edgeFetch(`${DETAIL_PREFIX}${encodeURIComponent(courseId)}/`)
      const rawCourse = payload?.course && typeof payload.course === "object" ? payload.course : payload
      return {
        ...normalizeCourse({ ...rawCourse, id: courseId }, access),
        inMyCourses: true,
        addedAtMs: Number(membership.addedAtMs || 0),
      }
    } catch {
      return {
        id: courseId,
        title: text(membership.title) || "EdgeCourse",
        description: text(membership.description),
        thumbnailUrl: safeHttpUrl(membership.thumbnailUrl, EDGE_SITE_ORIGIN),
        sourcePrice: Number(membership.sourcePrice || 0),
        price: 0,
        sourceUrl: text(membership.sourceUrl) || `${EDGE_SITE_ORIGIN}/courses/${encodeURIComponent(courseId)}`,
        source: "edgecourse",
        hasAccess: Boolean(access.active),
        accessType: access.type,
        accessExpiresAtMs: Number(access.expiresAtMs || 0),
        accessMode: ACCESS_MODE,
        inMyCourses: true,
        addedAtMs: Number(membership.addedAtMs || 0),
      }
    }
  }))

  return res.status(200).json({ courses })
}

async function addToMyCourses(req, res, authenticated) {
  const body = requestBody(req)
  const courseId = validCourseId(body.courseId || req.query?.courseId)
  if (!courseId) return res.status(400).json({ error: "A valid EdgeCourse courseId is required" })

  const payload = await edgeFetch(`${DETAIL_PREFIX}${encodeURIComponent(courseId)}/`)
  const rawCourse = payload?.course && typeof payload.course === "object" ? payload.course : payload
  const access = await courseAccess(authenticated, courseId)
  const course = normalizeCourse({ ...rawCourse, id: courseId }, access)
  const uid = authenticated.decodedToken.uid
  const ref = authenticated.db.collection(MY_COURSES).doc(`${uid}_${courseId}`)
  const previous = await ref.get()
  const previousData = previous.exists ? previous.data() || {} : {}
  const now = Date.now()
  const alreadyActive = previous.exists && String(previousData.status || "active").toLowerCase() === "active"
  const addedAtMs = alreadyActive && Number(previousData.addedAtMs || 0) > 0
    ? Number(previousData.addedAtMs)
    : now

  await ref.set({
    userId: uid,
    courseId,
    provider: "edgecourse",
    status: "active",
    addedAtMs,
    updatedAtMs: now,
    title: course.title,
    description: course.description,
    thumbnailUrl: course.thumbnailUrl,
    sourceUrl: course.sourceUrl,
    sourcePrice: course.sourcePrice,
  }, { merge: true })

  return res.status(alreadyActive ? 200 : 201).json({
    added: true,
    alreadyAdded: alreadyActive,
    course: { ...course, inMyCourses: true, addedAtMs },
  })
}

export default async function edgeCourseHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  if (req.method === "OPTIONS") return res.status(204).end()

  try {
    const authenticated = await requireAuthenticatedUser(req)
    const action = text(req.query?.action) || "catalog"
    if (req.method === "POST") {
      if (action === "add-to-my-courses") return await addToMyCourses(req, res, authenticated)
      return res.status(400).json({ error: "Unknown EdgeCourse action" })
    }
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
    if (action === "catalog") return await catalog(req, res, authenticated)
    if (action === "course") return await courseDetail(req, res, authenticated)
    if (action === "my-courses") return await myCourses(req, res, authenticated)
    return res.status(400).json({ error: "Unknown EdgeCourse action" })
  } catch (error) {
    console.error("EdgeCourse API error", error)
    return res.status(Number(error?.statusCode || 500)).json({ error: error?.message || "EdgeCourse could not be loaded" })
  }
}
