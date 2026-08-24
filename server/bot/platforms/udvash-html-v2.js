const ORIGIN = "https://online.udvash-unmesh.com"
const COURSE_INDEX = `${ORIGIN}/Content/Index?id=2`
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function decodeHtml(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
}

function textContent(html = "") {
  return decodeHtml(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
}

function absoluteUrl(href, base = ORIGIN) {
  return new URL(decodeHtml(href), base).toString()
}

function queryValue(url, key, fallback = "") {
  try {
    return new URL(url, ORIGIN).searchParams.get(key) || fallback
  } catch {
    return fallback
  }
}

function normalizeContentTypeTitle(value = "") {
  return textContent(value)
    .replace(/\s*\(\s*\d+\s*\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseCookieHeader(header = "") {
  const jar = new Map()
  String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const index = part.indexOf("=")
      if (index > 0) jar.set(part.slice(0, index), part.slice(index + 1))
    })
  return jar
}

function setCookiePairs(headers) {
  let values = []
  if (typeof headers?.getSetCookie === "function") values = headers.getSetCookie()
  if (!values.length) {
    const combined = headers?.get?.("set-cookie")
    if (combined) values = combined.split(/,(?=\s*[^;,=]+=[^;,]+)/g)
  }
  return values.map((value) => value.split(";")[0]?.trim()).filter(Boolean)
}

function mergeCookies(jar, headers) {
  for (const pair of setCookiePairs(headers)) {
    const index = pair.indexOf("=")
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1))
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
}

function requestHeaders(jar, referer = ORIGIN) {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: referer,
    "User-Agent": process.env.UDVASH_USER_AGENT || USER_AGENT,
  }
  const cookies = cookieHeader(jar)
  if (cookies) headers.Cookie = cookies
  return headers
}

function looksLikeLogin(url, html) {
  const lowerUrl = String(url || "").toLowerCase()
  if (lowerUrl.includes("/account/login") || lowerUrl.includes("/account/password")) return true
  const lower = String(html || "").toLowerCase()
  return lower.includes("registrationnumber")
    && lower.includes("__requestverificationtoken")
    && lower.includes("password")
}

async function fetchWithRetry(url, options, attempts = 5) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) return response
      try { await response.body?.cancel?.() } catch {}
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) throw error
    }
    const delay = (700 * (2 ** attempt)) + Math.floor(Math.random() * 350)
    await sleep(delay)
  }
  throw lastError || new Error("Udvash request failed")
}

async function fetchHtml(url, jar, referer = ORIGIN) {
  let current = absoluteUrl(url, referer)
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchWithRetry(current, {
      method: "GET",
      headers: requestHeaders(jar, referer),
      redirect: "manual",
    })
    mergeCookies(jar, response.headers)
    const body = await response.text()

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`Udvash redirect failed: HTTP ${response.status}`)
      const next = absoluteUrl(location, current)
      if (looksLikeLogin(next, "")) {
        const error = new Error("Udvash session expired")
        error.code = "UDVASH_SESSION_EXPIRED"
        throw error
      }
      referer = current
      current = next
      continue
    }

    if (!response.ok) throw new Error(`Udvash page request failed: HTTP ${response.status}`)
    if (looksLikeLogin(current, body)) {
      const error = new Error("Udvash session expired")
      error.code = "UDVASH_SESSION_EXPIRED"
      throw error
    }
    return { html: body, url: current }
  }
  throw new Error("Udvash page redirected too many times")
}

function anchors(html, hrefNeedle) {
  const output = []
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(String(html)))) {
    const attrs = match[1] || ""
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const href = decodeHtml(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "")
    if (!href || (hrefNeedle && !href.includes(hrefNeedle))) continue
    output.push({ href, innerHtml: match[2] || "", index: match.index })
  }
  return output
}

function headingFromAnchor(anchor) {
  const h3 = anchor.innerHtml.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)
  return textContent(h3?.[1] || anchor.innerHtml)
}

function lastClassTitleBefore(html, beforeIndex, fallback) {
  const start = Math.max(0, beforeIndex - 12000)
  const segment = String(html).slice(start, beforeIndex)
  const regex = /<h2\b[^>]*class\s*=\s*(?:"[^"]*uuu-wrap-title[^"]*"|'[^']*uuu-wrap-title[^']*')[^>]*>([\s\S]*?)<\/h2>/gi
  let match
  let title = ""
  while ((match = regex.exec(segment))) title = textContent(match[1])
  return title || fallback
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function uniqueBy(items, keyFn) {
  const seen = new Set()
  return items.filter((item) => {
    const key = keyFn(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseCourses(html, baseUrl) {
  return uniqueBy(
    anchors(html, "/Content/ContentSubject?")
      .map((anchor) => {
        const url = absoluteUrl(anchor.href, baseUrl)
        return {
          id: queryValue(url, "masterCourseId"),
          title: headingFromAnchor(anchor),
          courseTypeId: queryValue(url, "CourseTypeId", queryValue(url, "masterCourseTypeId", "2")),
          url,
          type: "",
        }
      })
      .filter((course) => course.id && course.title),
    (course) => `${course.courseTypeId}:${course.id}`,
  )
}

function parseSubjects(html, baseUrl, course) {
  return uniqueBy(
    anchors(html, "/Content/ContentChapter?")
      .map((anchor) => {
        const url = absoluteUrl(anchor.href, baseUrl)
        return {
          id: queryValue(url, "subjectId"),
          title: headingFromAnchor(anchor),
          courseId: queryValue(url, "masterCourseId", course.id),
          courseTypeId: queryValue(url, "masterCourseTypeId", course.courseTypeId || "2"),
          url,
        }
      })
      .filter((subject) => subject.id && subject.title),
    (subject) => subject.id,
  )
}

function parseChapters(html, baseUrl, subject) {
  return uniqueBy(
    anchors(html, "/Content/DisplayContentType?")
      .map((anchor) => {
        const url = absoluteUrl(anchor.href, baseUrl)
        return {
          id: queryValue(url, "masterChapterId"),
          title: headingFromAnchor(anchor),
          subjectId: queryValue(url, "subjectId", subject.id),
          courseId: queryValue(url, "masterCourseId", subject.courseId),
          courseTypeId: queryValue(url, "masterCourseTypeId", subject.courseTypeId || "2"),
          url,
        }
      })
      .filter((chapter) => chapter.id && chapter.title),
    (chapter) => chapter.id,
  )
}

function parseContentTypes(html, baseUrl, chapter) {
  return uniqueBy(
    anchors(html, "/Content/DisplayContentCard?")
      .map((anchor) => {
        const url = absoluteUrl(anchor.href, baseUrl)
        const rawTitle = headingFromAnchor(anchor)
        return {
          id: queryValue(url, "masterContentTypeId"),
          title: normalizeContentTypeTitle(rawTitle),
          rawTitle,
          chapterId: queryValue(url, "masterChapterId", chapter.id),
          subjectId: queryValue(url, "subjectId", chapter.subjectId),
          courseId: queryValue(url, "masterCourseId", chapter.courseId),
          courseTypeId: queryValue(url, "masterCourseTypeId", chapter.courseTypeId || "2"),
          url,
        }
      })
      .filter((type) => type.id && type.title),
    (type) => type.id,
  )
}

function parseClasses(html, baseUrl, context) {
  const videoAnchors = anchors(html, "/Content/DisplayContentCardDetails?")
    .filter((anchor) => {
      const url = absoluteUrl(anchor.href, baseUrl)
      return queryValue(url, "contentButtonType") === "video"
    })

  return uniqueBy(
    videoAnchors.map((anchor) => {
      const detailsUrl = absoluteUrl(anchor.href, baseUrl)
      const contentId = queryValue(detailsUrl, "masterContentId")
      const contentTypeId = queryValue(detailsUrl, "masterContentTypeId", context.contentType.id)
      const title = lastClassTitleBefore(html, anchor.index, `Class ${contentId}`)
      return {
        sourceClassId: `${contentTypeId}:${contentId}`,
        sourceContentId: contentId,
        sourceContentTypeId: contentTypeId,
        sourceSubjectId: context.subject.id,
        sourceChapterId: context.chapter.id,
        title,
        sectionTitle: context.contentType.title,
        sectionKey: normalizeContentTypeTitle(context.contentType.title).toLowerCase(),
        subjectTitle: context.subject.title,
        chapterTitle: context.chapter.title,
        duration: "",
        teacherName: "",
        sourceVideoLocator: detailsUrl,
      }
    }).filter((item) => item.sourceContentId && item.title),
    (item) => item.sourceClassId,
  )
}

function attributeValue(html, name) {
  const doubleQuoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(String(html || ""))
  if (doubleQuoted) return decodeHtml(doubleQuoted[1] || "")
  const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(String(html || ""))
  return decodeHtml(singleQuoted?.[1] || "")
}

function parseClassMedia(html) {
  const youtubeId = attributeValue(html, "data-youtube-video").trim()
  const directSources = attributeValue(html, "data-all-video-source")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    youtubeId,
    youtubeLink: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : "",
    directSources,
  }
}

export async function listUdvashCoursesHtmlV2(auth) {
  const jar = parseCookieHeader(auth?.cookie || "")
  const page = await fetchHtml(COURSE_INDEX, jar, ORIGIN)
  auth.cookie = cookieHeader(jar)
  return parseCourses(page.html, page.url)
}

export async function getUdvashCourseSnapshotHtml(auth, courseId) {
  const jar = parseCookieHeader(auth?.cookie || "")
  const indexPage = await fetchHtml(COURSE_INDEX, jar, ORIGIN)
  const courses = parseCourses(indexPage.html, indexPage.url)
  const course = courses.find((item) => String(item.id) === String(courseId))
  if (!course) throw new Error(`Udvash course ${courseId} এই account-এ পাওয়া যায়নি`)

  const subjectPage = await fetchHtml(course.url, jar, indexPage.url)
  const subjects = parseSubjects(subjectPage.html, subjectPage.url, course)

  const subjectResults = await mapLimit(subjects, 2, async (subject) => {
    const page = await fetchHtml(subject.url, jar, subjectPage.url)
    const chapters = parseChapters(page.html, page.url, subject)
    const chapterResults = await mapLimit(chapters, 2, async (chapter) => {
      const chapterPage = await fetchHtml(chapter.url, jar, page.url)
      const contentTypes = parseContentTypes(chapterPage.html, chapterPage.url, chapter)
      const typeResults = await mapLimit(contentTypes, 1, async (contentType) => {
        const contentPage = await fetchHtml(contentType.url, jar, chapterPage.url)
        return parseClasses(contentPage.html, contentPage.url, { subject, chapter, contentType })
      })
      return typeResults.flat()
    })
    return chapterResults.flat()
  })

  auth.cookie = cookieHeader(jar)
  const classes = uniqueBy(subjectResults.flat(), (item) => item.sourceClassId)
  const counts = new Map()
  classes.forEach((item) => {
    const key = item.sectionKey || normalizeContentTypeTitle(item.sectionTitle).toLowerCase()
    const current = counts.get(key) || { key, title: item.sectionTitle || "Other", count: 0 }
    current.count += 1
    counts.set(key, current)
  })
  return {
    course,
    classes,
    sections: [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
  }
}

export async function getUdvashClassMediaBulkHtml(auth, classes, concurrency = 3) {
  const jar = parseCookieHeader(auth?.cookie || "")
  const results = await mapLimit(classes, Math.max(1, Math.min(5, Number(concurrency) || 3)), async (item) => {
    try {
      if (!item?.sourceVideoLocator) throw new Error("Class details URL missing")
      const page = await fetchHtml(item.sourceVideoLocator, jar, ORIGIN)
      return { sourceClassId: item.sourceClassId, media: parseClassMedia(page.html), error: "" }
    } catch (error) {
      if (error?.code === "UDVASH_SESSION_EXPIRED") throw error
      return {
        sourceClassId: item?.sourceClassId || "",
        media: { youtubeId: "", youtubeLink: "", directSources: [] },
        error: String(error?.message || error).slice(0, 500),
      }
    }
  })
  auth.cookie = cookieHeader(jar)
  return results
}

export { normalizeContentTypeTitle }

export const UDVASH_HTML_V2_DEFAULTS = {
  origin: ORIGIN,
  courseIndex: COURSE_INDEX,
}
