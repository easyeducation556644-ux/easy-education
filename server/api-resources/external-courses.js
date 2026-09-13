import { requireAuthenticatedUser } from "./utils/firebase-admin.js"

const PROVIDERS = {
  ieducation: {
    id: "ieducation",
    name: "iEducation",
    origin: "https://ieducationbd.com",
    listUrl: "https://ieducationbd.com/api/course/admin/course/all-course/",
    detailUrl: (id) => `https://ieducationbd.com/api/course/admin/course/${encodeURIComponent(id)}/`,
  },
  medilogy: {
    id: "medilogy",
    name: "Medilogy",
    origin: "https://medilogy.com.bd",
    listUrl: "https://medilogy.com.bd/api/course/admin/course/all-course/",
    detailUrl: (id) => `https://medilogy.com.bd/api/course/admin/course/${encodeURIComponent(id)}/`,
  },
  bpschool: {
    id: "bpschool",
    name: "BP School",
    origin: "https://bondipathshalaschool.com.bd",
    listUrl: "https://bondipathshalaschool.com.bd/api/courses",
    detailUrl: (slug) => `https://bondipathshalaschool.com.bd/api/courses/${encodeURIComponent(slug)}`,
  },
}

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

function firstArray(...values) {
  return values.find(Array.isArray) || []
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function absoluteUrl(value, origin) {
  const raw = text(value)
  if (!raw) return ""
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith("//")) return `https:${raw}`
  if (raw.startsWith("/")) return `${origin}${raw}`
  try { return new URL(raw, `${origin}/`).toString() } catch { return raw }
}

function normalizeCourseList(payload) {
  if (Array.isArray(payload)) return payload
  return firstArray(
    payload?.results,
    payload?.result,
    payload?.data,
    payload?.data?.results,
    payload?.data?.result,
    payload?.data?.courses,
    payload?.courses,
  )
}

function providerOrThrow(value) {
  const provider = PROVIDERS[text(value).toLowerCase()]
  if (!provider) {
    const error = new Error("Unknown learning provider")
    error.statusCode = 400
    throw error
  }
  return provider
}

async function upstreamJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "EasyEducation/1.0 LearningProvider",
      },
      redirect: "follow",
      signal: controller.signal,
    })
    const raw = await response.text()
    let payload
    try { payload = JSON.parse(raw) } catch { payload = null }
    if (!response.ok || payload == null) {
      const message = text(payload?.message, payload?.error) || `Provider request failed (${response.status})`
      const error = new Error(message)
      error.statusCode = 502
      throw error
    }
    return payload
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error("Provider request timed out")
      timeout.statusCode = 504
      throw timeout
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function courseIdentity(row, provider) {
  if (provider.id === "bpschool") return text(row?.slug, row?.id, row?._id)
  return text(row?.id, row?._id, row?.slug)
}

function normalizeCourse(row, provider) {
  const id = courseIdentity(row, provider)
  const slug = text(row?.slug, id)
  return {
    id,
    slug,
    title: text(row?.name, row?.title, row?.course_name, row?.courseTitle) || `${provider.name} Course`,
    description: stripHtml(text(row?.short_description, row?.shortDescription, row?.description, row?.about)).slice(0, 600),
    thumbnailUrl: absoluteUrl(text(row?.thumbnail, row?.course_image, row?.image, row?.cover_image, row?.thumb, row?.image_url), provider.origin),
    batch: text(row?.batch, row?.category, row?.slug),
    price: Number(row?.discount ?? row?.price ?? row?.amount ?? 0) || 0,
    provider: provider.id,
    providerName: provider.name,
    courseFormat: "external",
  }
}

function classVideoUrl(classVideo, origin) {
  if (typeof classVideo === "string") return absoluteUrl(classVideo, origin)
  if (!classVideo || typeof classVideo !== "object") return ""
  const recorded = classVideo.recorded_video || classVideo.recordedVideo || {}
  const broadcast = classVideo.broadcast || {}
  const direct = text(
    classVideo.url,
    classVideo.video_url,
    classVideo.videoUrl,
    classVideo.video_link,
    classVideo.videoLink,
    classVideo.playback_url,
    classVideo.playbackUrl,
    classVideo.bunny_video_url,
    classVideo.bunnyVideoUrl,
    recorded.url,
    recorded.video_url,
    recorded.videoUrl,
    recorded.video_link,
    recorded.videoLink,
    recorded.playback_url,
    recorded.playbackUrl,
    recorded.bunny_video_url,
    recorded.bunnyVideoUrl,
    broadcast.bunny_video_url,
    broadcast.bunnyVideoUrl,
    broadcast.url,
    broadcast.video_url,
    broadcast.videoUrl,
    broadcast.playback_url,
    broadcast.playbackUrl,
  )
  if (direct) return absoluteUrl(direct, origin)
  const youtubeId = text(
    recorded.youtube_id,
    recorded.youtubeId,
    recorded.youtube_video_id,
    recorded.youtubeVideoId,
    broadcast.broadcast_id,
    broadcast.broadcastId,
    classVideo.broadcast_id,
    classVideo.broadcastId,
    classVideo.youtube_id,
    classVideo.youtubeId,
    classVideo.youtube_video_id,
    classVideo.youtubeVideoId,
  )
  return youtubeId ? `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}` : ""
}

function itemPrimaryUrl(item, origin) {
  const raw = text(
    item?.url,
    item?.video_link,
    item?.videoLink,
    item?.video_url,
    item?.videoUrl,
    item?.playback_url,
    item?.playbackUrl,
    item?.stream_url,
    item?.streamUrl,
    item?.hls_url,
    item?.hlsUrl,
    classVideoUrl(item?.class_video ?? item?.classVideo, origin),
    item?.StreamyardLink,
    item?.streamyardLink,
  )
  return absoluteUrl(raw, origin)
}

function looksPlayable(url, item = {}) {
  if (!url) return false
  const type = `${text(item.type)} ${text(item.link_type, item.linkType)} ${text(item.indicator)} ${text(item.content_type, item.contentType)}`.toLowerCase()
  if (/class|video|lecture|recorded|live/.test(type)) return true
  return /(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|player\.vidinfra\.com|mediadelivery\.net|streamyard\.com|facebook\.com|fb\.watch)/i.test(url)
    || /\.m3u8(?:\?|#|$)/i.test(url)
    || /\.(?:mp4|webm|ogg|mov)(?:\?|#|$)/i.test(url)
}

function resourceLinks(item, origin, labelPrefix = "Resource") {
  const candidates = [
    ["Lecture material", item?.lecture_material_link ?? item?.lectureMaterialLink],
    ["Practice", item?.practice_link ?? item?.practiceLink],
    ["Solution", item?.solution_link ?? item?.solutionLink],
    ["Marked sheet", item?.marked_link ?? item?.markedLink],
    ["E-book", item?.ebook_link ?? item?.ebookLink],
    ["PDF", item?.pdf_link ?? item?.pdfLink],
    ["Exam", item?.exam_link ?? item?.examLink],
    ["Resource", item?.redirect_link ?? item?.redirectLink],
    ["Resource", item?.resource_url ?? item?.resourceUrl],
    ["Note", item?.note_url ?? item?.noteUrl],
  ]
  const seen = new Set()
  const result = []
  for (const [label, value] of candidates) {
    const url = absoluteUrl(value, origin)
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push({ label: label || labelPrefix, url })
  }
  return result
}

function resourceFromStandalone(item, origin, index) {
  const url = itemPrimaryUrl(item, origin) || absoluteUrl(text(item?.lecture_material_link, item?.pdf_link, item?.link, item?.href), origin)
  if (!url || looksPlayable(url, item)) return null
  return {
    label: text(item?.title, item?.name) || `Resource ${index + 1}`,
    url,
  }
}

function nodeItems(node) {
  return firstArray(
    node?.items,
    node?.contents,
    node?.content,
    node?.classes,
    node?.lessons,
    node?.videos,
    node?.resources,
  )
}

function nodeChildren(node) {
  return firstArray(
    node?.lectures,
    node?.chapters,
    node?.modules,
    node?.topics,
    node?.sections,
    node?.units,
  )
}

function detailRoot(payload) {
  if (payload?.course && typeof payload.course === "object") return payload.course
  if (payload?.data?.course && typeof payload.data.course === "object") return payload.data.course
  if (payload?.data && !Array.isArray(payload.data) && typeof payload.data === "object") return payload.data
  return payload || {}
}

function uniqueResources(values) {
  const seen = new Set()
  return values.filter((item) => {
    const key = text(item?.url)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeSectionClasses(root, provider, courseId) {
  const sections = firstArray(root?.sections, root?.chapters, root?.modules, root?.course_sections, root?.courseSections)
  const groups = sections.length ? sections : [root]
  const output = []
  let classCounter = 0

  function appendClass(sectionTitle, chapterTitle, item, siblingResources = [], index = 0) {
    const sourceUrl = itemPrimaryUrl(item, provider.origin)
    if (!looksPlayable(sourceUrl, item)) return
    classCounter += 1
    const id = text(item?.id, item?._id, item?.slug) || `${courseId}-${classCounter}`
    const ownResources = resourceLinks(item, provider.origin)
    output.push({
      id: String(id),
      title: text(item?.title, item?.name, item?.topic) || `Class ${classCounter}`,
      topic: text(item?.description, item?.topic),
      sectionTitle: sectionTitle || provider.name,
      chapterTitle: chapterTitle || sectionTitle || "Classes",
      sourceUrl,
      teacherName: text(item?.teacher_name, item?.teacherName, item?.instructor_name, item?.instructorName) || provider.name,
      imageUrl: absoluteUrl(text(item?.thumbnail, item?.image, item?.image_url, item?.imageUrl), provider.origin),
      order: Number(item?.serial ?? item?.order ?? item?.rank ?? index ?? classCounter) || classCounter,
      resourceLinks: uniqueResources([...ownResources, ...siblingResources]),
    })
  }

  groups.forEach((section, sectionIndex) => {
    const sectionTitle = text(section?.title, section?.name) || `Section ${sectionIndex + 1}`
    let children = nodeChildren(section)
    if (!children.length && nodeItems(section).length) children = [section]
    if (!children.length && section === root) children = nodeChildren(root)
    if (!children.length) children = [section]

    children.forEach((child, childIndex) => {
      const chapterTitle = text(child?.title, child?.name) || `Chapter ${childIndex + 1}`
      const items = nodeItems(child)
      const siblingResources = uniqueResources(items
        .map((item, index) => resourceFromStandalone(item, provider.origin, index))
        .filter(Boolean))
      const playableItems = items.filter((item) => looksPlayable(itemPrimaryUrl(item, provider.origin), item))
      if (playableItems.length) {
        playableItems.forEach((item, itemIndex) => appendClass(sectionTitle, chapterTitle, item, siblingResources, itemIndex))
      } else if (looksPlayable(itemPrimaryUrl(child, provider.origin), child)) {
        appendClass(sectionTitle, chapterTitle, child, resourceLinks(child, provider.origin), childIndex)
      } else {
        const grandchildren = nodeChildren(child)
        grandchildren.forEach((grandchild, grandIndex) => {
          const grandTitle = text(grandchild?.title, grandchild?.name) || chapterTitle
          const grandItems = nodeItems(grandchild)
          const grandResources = uniqueResources(grandItems
            .map((item, index) => resourceFromStandalone(item, provider.origin, index))
            .filter(Boolean))
          grandItems
            .filter((item) => looksPlayable(itemPrimaryUrl(item, provider.origin), item))
            .forEach((item, itemIndex) => appendClass(sectionTitle, grandTitle, item, grandResources, itemIndex + grandIndex))
        })
      }
    })
  })

  return output
}

async function catalog(req, res, provider) {
  const payload = await upstreamJson(provider.listUrl)
  const courses = normalizeCourseList(payload)
    .map((row) => normalizeCourse(row, provider))
    .filter((course) => course.id)
  return res.status(200).json({ provider: { id: provider.id, name: provider.name }, courses, fetchedAtMs: Date.now() })
}

async function courseDetail(req, res, provider) {
  const courseId = text(req.query?.courseId)
  if (!courseId || courseId.length > 220) return res.status(400).json({ error: "A valid courseId is required" })
  const payload = await upstreamJson(provider.detailUrl(courseId))
  const root = detailRoot(payload)
  const course = normalizeCourse({ ...root, id: courseIdentity(root, provider) || courseId, slug: text(root?.slug, courseId) }, provider)
  const classes = normalizeSectionClasses(root, provider, course.id)
  return res.status(200).json({
    provider: { id: provider.id, name: provider.name },
    course,
    classes,
    counts: {
      classes: classes.length,
      resources: classes.reduce((sum, item) => sum + item.resourceLinks.length, 0),
    },
    fetchedAtMs: Date.now(),
  })
}

export default async function externalCoursesHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Cache-Control", "no-store")
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  try {
    await requireAuthenticatedUser(req)
    const provider = providerOrThrow(req.query?.provider)
    const action = text(req.query?.action) || "catalog"
    if (action === "catalog") return await catalog(req, res, provider)
    if (action === "course") return await courseDetail(req, res, provider)
    return res.status(400).json({ error: "Unknown provider action" })
  } catch (error) {
    const status = Number(error?.statusCode || 500)
    return res.status(status).json({ error: error?.message || "Provider request failed" })
  }
}
