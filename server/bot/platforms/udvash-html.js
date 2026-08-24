const ORIGIN = "https://online.udvash-unmesh.com"
const COURSE_INDEX = `${ORIGIN}/Content/Index?id=2`
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"

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
  return values
    .map((value) => value.split(";")[0]?.trim())
    .filter(Boolean)
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
  return lower.includes("registrationnumber") && lower.includes("__requestverificationtoken") && lower.includes("password")
}

async function fetchHtml(url, jar, referer = ORIGIN) {
  let current = absoluteUrl(url, referer)
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, {
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
      if (looksLikeLogin(next, "")) throw new Error("Udvash session expired. আবার login করতে হবে।")
      referer = current
      current = next
      continue
    }
    if (!response.ok) throw new Error(`Udvash page request failed: HTTP ${response.status}`)
    if (looksLikeLogin(current, body)) throw new Error("Udvash session expired. আবার login করতে হবে।")
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
    output.push({ href, innerHtml: match[2] || "", text: textContent(match[2] || ""), index: match.index })
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
        return {
          id: queryValue(url, "masterContentTypeId"),
          title: headingFromAnchor(anchor),
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

  return uniqueBy(videoAnchors.map((anchor) => {
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
      subjectTitle: context.subject.title,
      chapterTitle: context.chapter.title,
      duration: "",
      teacherName: "",
      sourceVideoLocator: detailsUrl,
    }
  }).filter((item) => item.sourceContentId && item.title), (item) => item.sourceClassId)
}

export async function listUdvashCoursesHtml(auth) {
  const jar = parseCookieHeader(auth?.cookie || "")
  const page = await fetchHtml(COURSE_INDEX, jar, ORIGIN)
  auth.cookie = cookieHeader(jar)
  return parseCourses(page.html, page.url)
}

export async function getUdvashCourseContentHtml(auth, courseId) {
  const jar = parseCookieHeader(auth?.cookie || "")
  const indexPage = await fetchHtml(COURSE_INDEX, jar, ORIGIN)
  const courses = parseCourses(indexPage.html, indexPage.url)
  const course = courses.find((item) => String(item.id) === String(courseId))
  if (!course) throw new Error(`Udvash course ${courseId} এই account-এ পাওয়া যায়নি`)

  const subjectPage = await fetchHtml(course.url, jar, indexPage.url)
  const subjects = parseSubjects(subjectPage.html, subjectPage.url, course)

  const subjectResults = await mapLimit(subjects, 6, async (subject) => {
    const page = await fetchHtml(subject.url, jar, subjectPage.url)
    const chapters = parseChapters(page.html, page.url, subject)
    const chapterResults = await mapLimit(chapters, 6, async (chapter) => {
      const chapterPage = await fetchHtml(chapter.url, jar, page.url)
      const contentTypes = parseContentTypes(chapterPage.html, chapterPage.url, chapter)
      const typeResults = await mapLimit(contentTypes, 6, async (contentType) => {
        const contentPage = await fetchHtml(contentType.url, jar, chapterPage.url)
        return parseClasses(contentPage.html, contentPage.url, { subject, chapter, contentType })
      })
      return typeResults.flat()
    })
    return chapterResults.flat()
  })

  auth.cookie = cookieHeader(jar)
  return uniqueBy(subjectResults.flat(), (item) => item.sourceClassId)
}

export const UDVASH_HTML_DEFAULTS = {
  origin: ORIGIN,
  courseIndex: COURSE_INDEX,
}
