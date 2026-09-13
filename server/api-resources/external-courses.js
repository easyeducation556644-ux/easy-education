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

function firstArray(...values) {
  return values.find(Array.isArray) || []
}

function numberOr(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
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
        "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
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

async function upstreamJsonFirst(urls) {
  let lastError = null
  for (const url of urls) {
    try {
      return { payload: await upstreamJson(url), url }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("Provider request failed")
}

function providerCatalogUrls(provider) {
  if (provider.id === "bpschool") return [
    "https://bondipathshalaschool.com.bd/api/courses",
    "https://bondipathshalaschool.com.bd/api/course/course/all-courses?page=1",
  ]
  return [provider.listUrl]
}

function providerDetailUrls(provider, courseId) {
  if (provider.id === "bpschool") return [
    `https://bondipathshalaschool.com.bd/api/courses/${encodeURIComponent(courseId)}`,
    `https://bondipathshalaschool.com.bd/api/course/course/${encodeURIComponent(courseId)}/`,
  ]
  return [provider.detailUrl(courseId)]
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
    description: stripHtml(text(row?.short_description, row?.shortDescription, row?.description, row?.about)).slice(0, 900),
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
    item?.lecture_material_link,
    item?.lectureMaterialLink,
    item?.practice_link,
    item?.practiceLink,
    item?.solution_link,
    item?.solutionLink,
    item?.marked_link,
    item?.markedLink,
    item?.ebook_link,
    item?.ebookLink,
    item?.pdf_link,
    item?.pdfLink,
    item?.exam_link,
    item?.examLink,
    item?.redirect_link,
    item?.redirectLink,
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

function resourceLinks(item, origin, includePrimary = false) {
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
  if (includePrimary) candidates.unshift([text(item?.type, item?.link_type) || "Resource", itemPrimaryUrl(item, origin)])

  const seen = new Set()
  const result = []
  for (const [label, value] of candidates) {
    const url = absoluteUrl(value, origin)
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push({ label: label || "Resource", url })
  }
  return result
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

function normalizeCourseStructure(root, provider, courseId) {
  const rawSections = firstArray(root?.sections, root?.chapters, root?.modules, root?.course_sections, root?.courseSections)
  const sectionNodes = rawSections.length ? rawSections : [root]
  const flatClasses = []
  let generatedItem = 0

  const sections = sectionNodes.map((section, sectionIndex) => {
    const sectionRawId = text(section?.id, section?._id, section?.slug) || `${sectionIndex + 1}`
    const sectionId = `${courseId}:section:${sectionRawId}`
    const sectionTitle = text(section?.title, section?.name, section?.subjectName) || `Section ${sectionIndex + 1}`
    const sectionDescription = stripHtml(text(section?.description, section?.short_description, section?.about)).slice(0, 500)
    let rawLectures = nodeChildren(section)
    if (!rawLectures.length && nodeItems(section).length) rawLectures = [section]
    if (!rawLectures.length && section === root) rawLectures = nodeChildren(root)
    if (!rawLectures.length) rawLectures = [section]

    const lectures = rawLectures.map((lecture, lectureIndex) => {
      const lectureRawId = text(lecture?.id, lecture?._id, lecture?.slug) || `${lectureIndex + 1}`
      const lectureId = `${sectionId}:lecture:${lectureRawId}`
      const lectureTitle = text(lecture?.title, lecture?.name, lecture?.chapterName) || `Lecture ${lectureIndex + 1}`
      const lectureDescription = stripHtml(text(lecture?.description, lecture?.topic, lecture?.notice, lecture?.lecture_notice)).slice(0, 500)
      let rawItems = nodeItems(lecture)
      if (!rawItems.length && lecture !== section && looksPlayable(itemPrimaryUrl(lecture, provider.origin), lecture)) rawItems = [lecture]

      const siblingResources = uniqueResources(rawItems.flatMap((item) => {
        const url = itemPrimaryUrl(item, provider.origin)
        return looksPlayable(url, item) ? [] : resourceLinks(item, provider.origin, true)
      }))

      const items = rawItems.map((item, itemIndex) => {
        generatedItem += 1
        const rawItemId = text(item?.id, item?._id, item?.slug) || `${generatedItem}`
        const id = `${lectureId}:item:${rawItemId}`
        const sourceUrl = itemPrimaryUrl(item, provider.origin)
        const playable = looksPlayable(sourceUrl, item)
        const ownResources = resourceLinks(item, provider.origin, !playable)
        const resources = playable ? uniqueResources([...ownResources, ...siblingResources]) : ownResources
        const normalized = {
          id,
          rawId: rawItemId,
          title: text(item?.title, item?.name, item?.topic) || `Content ${itemIndex + 1}`,
          topic: stripHtml(text(item?.description, item?.topic, item?.lecture_notice, item?.lectureNotice)).slice(0, 700),
          type: text(item?.type, item?.content_type, item?.contentType) || (playable ? "Class" : "Resource"),
          linkType: text(item?.link_type, item?.linkType),
          sourceUrl,
          playable,
          teacherName: text(item?.teacher_name, item?.teacherName, item?.instructor_name, item?.instructorName) || provider.name,
          imageUrl: absoluteUrl(text(item?.thumbnail, item?.image, item?.image_url, item?.imageUrl), provider.origin),
          order: numberOr(item?.serial ?? item?.order ?? item?.rank, itemIndex + 1),
          resourceLinks: resources,
        }
        if (playable) {
          flatClasses.push({
            id,
            rawId: rawItemId,
            title: normalized.title,
            topic: normalized.topic,
            sectionId,
            lectureId,
            sectionTitle,
            chapterTitle: lectureTitle,
            sourceUrl,
            teacherName: normalized.teacherName,
            imageUrl: normalized.imageUrl,
            order: normalized.order,
            resourceLinks: resources,
          })
        }
        return normalized
      }).sort((a, b) => a.order - b.order)

      return {
        id: lectureId,
        rawId: lectureRawId,
        title: lectureTitle,
        description: lectureDescription,
        order: numberOr(lecture?.serial ?? lecture?.order ?? lecture?.rank, lectureIndex + 1),
        items,
      }
    }).sort((a, b) => a.order - b.order)

    return {
      id: sectionId,
      rawId: sectionRawId,
      title: sectionTitle,
      description: sectionDescription,
      order: numberOr(section?.serial ?? section?.order ?? section?.rank, sectionIndex + 1),
      lectures,
    }
  }).sort((a, b) => a.order - b.order)

  flatClasses.sort((a, b) => a.order - b.order)
  return { sections, classes: flatClasses }
}

async function catalog(req, res, provider) {
  const { payload, url } = await upstreamJsonFirst(providerCatalogUrls(provider))
  const courses = normalizeCourseList(payload)
    .map((row) => normalizeCourse(row, provider))
    .filter((course) => course.id)
  return res.status(200).json({
    provider: { id: provider.id, name: provider.name },
    courses,
    sourceEndpoint: url,
    fetchedAtMs: Date.now(),
  })
}

async function courseDetail(req, res, provider) {
  const courseId = text(req.query?.courseId)
  if (!courseId || courseId.length > 220) return res.status(400).json({ error: "A valid courseId is required" })
  const { payload, url } = await upstreamJsonFirst(providerDetailUrls(provider, courseId))
  const root = detailRoot(payload)
  const course = normalizeCourse({ ...root, id: courseIdentity(root, provider) || courseId, slug: text(root?.slug, courseId) }, provider)
  const structure = normalizeCourseStructure(root, provider, course.id)
  const lectureCount = structure.sections.reduce((sum, section) => sum + section.lectures.length, 0)
  const itemCount = structure.sections.reduce((sum, section) => sum + section.lectures.reduce((inner, lecture) => inner + lecture.items.length, 0), 0)
  return res.status(200).json({
    provider: { id: provider.id, name: provider.name },
    course,
    sections: structure.sections,
    classes: structure.classes,
    counts: {
      sections: structure.sections.length,
      lectures: lectureCount,
      items: itemCount,
      classes: structure.classes.length,
      resources: structure.classes.reduce((sum, item) => sum + item.resourceLinks.length, 0),
    },
    sourceEndpoint: url,
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
