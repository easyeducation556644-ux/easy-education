import { stableId } from "../crypto.js"

function required(name) {
  const value = process.env[name]
  if (!value) {
    const error = new Error(`${name} is not configured`)
    error.code = "PLATFORM_NOT_CONFIGURED"
    throw error
  }
  return value
}

function template(value, params = {}) {
  return Object.entries(params).reduce(
    (result, [key, replacement]) => result.replaceAll(`{${key}}`, encodeURIComponent(String(replacement))),
    value,
  )
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") return value
  }
  return ""
}

function titleOf(obj) {
  return String(pick(obj, [
    "title", "name", "courseName", "course_name", "batchName", "batch_name",
    "subjectName", "subject_name", "chapterName", "chapter_name", "topicName",
    "topic_name", "className", "class_name", "lectureName", "lecture_name",
  ]) || "").trim()
}

function idOf(obj) {
  return String(pick(obj, [
    "id", "_id", "courseId", "course_id", "batchId", "batch_id", "subjectId",
    "subject_id", "chapterId", "chapter_id", "classId", "class_id", "lectureId",
    "lecture_id", "videoId", "video_id", "contentId", "content_id",
  ]) || "").trim()
}

function parseResponseBody(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error("Udvash endpoint returned non-JSON data. Configure the JSON API endpoint instead of the website page URL.")
    error.code = "PLATFORM_RESPONSE_UNSUPPORTED"
    throw error
  }
}

function getAtPath(value, path) {
  if (!path) return value
  return path.split(".").filter(Boolean).reduce((current, part) => current?.[part], value)
}

function firstArray(value, candidatePaths = []) {
  if (Array.isArray(value)) return value
  for (const path of candidatePaths) {
    const candidate = getAtPath(value, path)
    if (Array.isArray(candidate)) return candidate
  }
  if (!value || typeof value !== "object") return []
  for (const child of Object.values(value)) {
    if (Array.isArray(child) && child.length > 0) return child
  }
  return []
}

function getCookies(headers) {
  let setCookies = []
  if (typeof headers.getSetCookie === "function") setCookies = headers.getSetCookie()
  if (!setCookies.length) {
    const combined = headers.get("set-cookie")
    if (combined) setCookies = combined.split(/,(?=\s*[^;,=]+=[^;,]+)/g)
  }
  return setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ")
}

function tokenFrom(payload) {
  const paths = [
    "token", "access_token", "accessToken", "data.token", "data.access_token",
    "data.accessToken", "result.token", "result.access_token", "result.accessToken",
  ]
  for (const path of paths) {
    const value = getAtPath(payload, path)
    if (value) return String(value)
  }
  return ""
}

function authHeaders(auth) {
  const headers = { Accept: "application/json" }
  if (auth.cookie) headers.Cookie = auth.cookie
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`
  const extra = process.env.UDVASH_EXTRA_HEADERS_JSON
  if (extra) {
    try {
      Object.assign(headers, JSON.parse(extra))
    } catch {
      throw new Error("UDVASH_EXTRA_HEADERS_JSON is not valid JSON")
    }
  }
  return headers
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const payload = parseResponseBody(text)
  if (!response.ok) {
    const reason = payload?.message || payload?.error || `${response.status} ${response.statusText}`
    const error = new Error(`Udvash request failed: ${reason}`)
    error.statusCode = response.status
    throw error
  }
  return { payload, headers: response.headers }
}

export async function loginUdvash({ roll, password }) {
  const url = required("UDVASH_LOGIN_URL")
  const mode = (process.env.UDVASH_LOGIN_MODE || "json").toLowerCase()
  const rollField = process.env.UDVASH_ROLL_FIELD || "roll"
  const passwordField = process.env.UDVASH_PASSWORD_FIELD || "password"
  const bodyObject = { [rollField]: roll, [passwordField]: password }
  const headers = { Accept: "application/json" }
  let body

  if (mode === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    body = new URLSearchParams(bodyObject).toString()
  } else {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(bodyObject)
  }

  const response = await fetch(url, {
    method: process.env.UDVASH_LOGIN_METHOD || "POST",
    headers,
    body,
    redirect: "manual",
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text.slice(0, 500) }
    }
  }
  if (response.status >= 400) {
    const reason = payload?.message || payload?.error || `${response.status} ${response.statusText}`
    throw new Error(`Udvash login failed: ${reason}`)
  }

  const cookie = getCookies(response.headers)
  const token = tokenFrom(payload)
  if (!cookie && !token) {
    const explicitSuccess = payload?.success === true || payload?.status === "success" || payload?.status === true
    if (!explicitSuccess) {
      throw new Error("Udvash login response did not contain a session cookie or access token")
    }
  }
  return { cookie, token, raw: payload }
}

export async function listUdvashCourses(auth) {
  const url = required("UDVASH_COURSES_URL")
  const { payload } = await fetchJson(url, {
    method: process.env.UDVASH_COURSES_METHOD || "GET",
    headers: authHeaders(auth),
  })
  const configuredPath = process.env.UDVASH_COURSES_DATA_PATH || ""
  const rows = configuredPath
    ? firstArray(getAtPath(payload, configuredPath))
    : firstArray(payload, ["courses", "data.courses", "data", "result.courses", "result", "items", "results"])

  return rows
    .map((item, index) => {
      const id = idOf(item) || stableId("udvash-course", titleOf(item), index)
      const title = titleOf(item) || `Course ${index + 1}`
      return {
        id,
        title,
        type: String(pick(item, ["type", "courseType", "course_type", "batchType", "batch_type"]) || "").toLowerCase(),
      }
    })
    .filter((item) => item.id && item.title)
}

function looksLikeClass(node, parentKey) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false
  const key = String(parentKey || "").toLowerCase()
  const id = idOf(node)
  const title = titleOf(node)
  const hasMediaish = Boolean(pick(node, [
    "video", "videoUrl", "videoURL", "video_url", "videoId", "video_id", "playbackUrl",
    "playback_url", "streamUrl", "stream_url", "m3u8", "hls", "youtubeUrl", "youtube_url",
  ]))
  const hasClassId = Boolean(pick(node, ["classId", "class_id", "lectureId", "lecture_id", "videoId", "video_id", "contentId", "content_id"]))
  const parentSuggestsClass = ["classes", "class", "lectures", "lecture", "videos", "video", "contents", "content"].includes(key)
  return Boolean(title && (hasMediaish || hasClassId || (parentSuggestsClass && id)))
}

function mediaLocator(node) {
  return String(pick(node, [
    "videoId", "video_id", "videoUrl", "videoURL", "video_url", "playbackUrl", "playback_url",
    "streamUrl", "stream_url", "m3u8", "hls", "youtubeUrl", "youtube_url", "url",
  ]) || "")
}

function durationOf(node) {
  return String(pick(node, ["duration", "durationText", "duration_text", "length", "videoDuration", "video_duration"]) || "")
}

function teacherOf(node) {
  const value = pick(node, ["teacherName", "teacher_name", "teacher", "instructorName", "instructor_name", "facultyName", "faculty_name"])
  if (typeof value === "object" && value) return titleOf(value)
  return String(value || "")
}

function contextForChild(parentKey, child, context) {
  const key = String(parentKey || "").toLowerCase()
  const title = titleOf(child)
  const next = { ...context }
  if (["sections", "section", "groups", "group", "tabs", "tab", "categories", "category", "segments", "segment"].includes(key) && title) {
    next.sectionTitle = title
  }
  if (["subjects", "subject"].includes(key) && title) next.subjectTitle = title
  if (["chapters", "chapter", "topics", "topic"].includes(key) && title) next.chapterTitle = title
  return next
}

function walkContent(value, context, parentKey, output, seen) {
  if (Array.isArray(value)) {
    value.forEach((child) => {
      const nextContext = contextForChild(parentKey, child, context)
      if (looksLikeClass(child, parentKey)) {
        const title = titleOf(child)
        const rawId = idOf(child)
        const locator = mediaLocator(child)
        const sourceClassId = rawId || stableId("udvash-class", context.sectionTitle, context.subjectTitle, context.chapterTitle, title, locator)
        const dedupeKey = sourceClassId || stableId(title, locator)
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey)
          output.push({
            sourceClassId,
            title,
            sectionTitle: nextContext.sectionTitle || context.sectionTitle || "",
            subjectTitle: nextContext.subjectTitle || context.subjectTitle || "",
            chapterTitle: nextContext.chapterTitle || context.chapterTitle || "",
            duration: durationOf(child),
            teacherName: teacherOf(child),
            sourceVideoLocator: locator,
          })
        }
      }
      walkContent(child, nextContext, parentKey, output, seen)
    })
    return
  }

  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      const nextContext = contextForChild(key, child, context)
      walkContent(child, nextContext, key, output, seen)
    }
  }
}

export async function getUdvashCourseContent(auth, courseId) {
  const url = template(required("UDVASH_COURSE_CONTENT_URL"), { courseId })
  const { payload } = await fetchJson(url, {
    method: process.env.UDVASH_COURSE_CONTENT_METHOD || "GET",
    headers: authHeaders(auth),
  })
  const rootPath = process.env.UDVASH_CONTENT_DATA_PATH || ""
  const root = rootPath ? getAtPath(payload, rootPath) : payload
  const classes = []
  walkContent(root, {}, "root", classes, new Set())
  return classes
}

export function udvashConfigured() {
  return Boolean(process.env.UDVASH_LOGIN_URL && process.env.UDVASH_COURSES_URL && process.env.UDVASH_COURSE_CONTENT_URL)
}
