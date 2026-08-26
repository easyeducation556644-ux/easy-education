const ORIGIN = "https://online.udvash-unmesh.com"
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"

function decodeHtml(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
}

function cookieJar(header = "") {
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

function looksLikeLogin(url, html = "") {
  const lowerUrl = String(url || "").toLowerCase()
  if (lowerUrl.includes("/account/login") || lowerUrl.includes("/account/password")) return true
  const lower = String(html || "").toLowerCase()
  return lower.includes("registrationnumber")
    && lower.includes("__requestverificationtoken")
    && lower.includes("password")
}

function sessionExpiredError() {
  const error = new Error("Udvash session expired")
  error.code = "UDVASH_SESSION_EXPIRED"
  return error
}

function isRoutineClassDetails(url) {
  try {
    const parsed = new URL(String(url || ""), ORIGIN)
    return parsed.origin === ORIGIN && parsed.pathname.toLowerCase() === "/routine/classdetails"
  } catch {
    return false
  }
}

function notesUrlFor(value) {
  const url = new URL(String(value || ""), ORIGIN)
  url.searchParams.set("isNotes", "true")
  url.hash = ""
  return url.toString()
}

async function fetchUdvashHtml(url, jar, referer = ORIGIN) {
  let current = new URL(url, referer).toString()
  let currentReferer = referer
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: currentReferer,
        "User-Agent": process.env.UDVASH_USER_AGENT || USER_AGENT,
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      },
      redirect: "manual",
    })
    mergeCookies(jar, response.headers)

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`Udvash notes redirect failed: HTTP ${response.status}`)
      const next = new URL(location, current).toString()
      if (looksLikeLogin(next)) throw sessionExpiredError()
      currentReferer = current
      current = next
      continue
    }

    const body = await response.text()
    if (!response.ok) throw new Error(`Udvash notes page request failed: HTTP ${response.status}`)
    if (looksLikeLogin(current, body)) throw sessionExpiredError()
    return { html: body, url: current }
  }
  throw new Error("Udvash notes page redirected too many times")
}

function cleanPdfUrl(value) {
  try {
    const url = new URL(decodeHtml(value))
    if (!/^https?:$/i.test(url.protocol) || !/\.pdf$/i.test(url.pathname)) return ""
    url.hash = ""
    return url.toString()
  } catch {
    return ""
  }
}

function extractSignedPdfUrls(html) {
  const source = decodeHtml(html)
  const output = []
  const seen = new Set()
  const add = (value) => {
    const url = cleanPdfUrl(value)
    if (!url || seen.has(url)) return
    seen.add(url)
    output.push(url)
  }

  const forceDownload = /forceDownload\(\s*(['"])(https?:\/\/.+?)\1\s*,/gi
  let match
  while ((match = forceDownload.exec(source))) add(match[2])

  const embed = /<embed\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi
  while ((match = embed.exec(source))) add(match[1] || match[2])

  return output
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
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, () => worker()))
  return results
}

async function resolveResource(resource, jar) {
  if (!isRoutineClassDetails(resource?.url)) return [resource]

  const notesUrl = notesUrlFor(resource.url)
  const page = await fetchUdvashHtml(notesUrl, jar, resource.url)
  const pdfUrls = extractSignedPdfUrls(page.html)
  if (!pdfUrls.length) {
    const routineId = new URL(notesUrl).searchParams.get("routineId") || "unknown"
    throw new Error(`Udvash ClassDetails notes page did not return a downloadable PDF (routineId ${routineId})`)
  }

  const baseLabel = String(resource?.label || "Class Note").trim() || "Class Note"
  return pdfUrls.map((url, index) => ({
    ...resource,
    label: pdfUrls.length > 1 ? `${baseLabel} ${index + 1}` : baseLabel,
    url,
  }))
}

export async function resolveUdvashRoutineNoteResources(auth, results, concurrency = 3) {
  const jar = cookieJar(auth?.cookie || "")
  const resolved = await mapLimit(Array.isArray(results) ? results : [], Math.max(1, Math.min(5, Number(concurrency) || 3)), async (result) => {
    if (!result || result.error) return result
    const resources = Array.isArray(result.media?.resourceLinks) ? result.media.resourceLinks : []
    if (!resources.some((resource) => isRoutineClassDetails(resource?.url))) return result

    try {
      const groups = []
      for (const resource of resources) groups.push(...await resolveResource(resource, jar))
      return {
        ...result,
        media: {
          ...(result.media || {}),
          resourceLinks: groups,
        },
      }
    } catch (error) {
      if (error?.code === "UDVASH_SESSION_EXPIRED") throw error
      return {
        ...result,
        error: String(error?.message || error).slice(0, 500),
      }
    }
  })
  if (auth) auth.cookie = cookieHeader(jar)
  return resolved
}
