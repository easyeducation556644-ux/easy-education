const DEFAULT_ORIGIN = "https://online.udvash-unmesh.com"
const DEFAULT_LOGIN_URL = `${DEFAULT_ORIGIN}/Account/Login`
const DEFAULT_PREFLIGHT_URL = `${DEFAULT_ORIGIN}/Account/Password`
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"

function cookiePairs(headers) {
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

function parseCookieJar(cookieHeader = "") {
  const jar = new Map()
  String(cookieHeader)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const index = item.indexOf("=")
      if (index <= 0) return
      jar.set(item.slice(0, index), item.slice(index + 1))
    })
  return jar
}

function mergeCookies(jar, headers) {
  for (const pair of cookiePairs(headers)) {
    const index = pair.indexOf("=")
    if (index <= 0) continue
    jar.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return jar
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
}

function htmlDecode(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
}

function hiddenInputValue(html, targetName) {
  const tags = String(html || "").match(/<input\b[^>]*>/gi) || []
  for (const tag of tags) {
    const attrs = {}
    const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
    let match
    while ((match = regex.exec(tag))) {
      attrs[match[1].toLowerCase()] = htmlDecode(match[2] ?? match[3] ?? match[4] ?? "")
    }
    if (attrs.name === targetName) return attrs.value || ""
  }
  return ""
}

function pageLooksLikeLogin(html) {
  const text = String(html || "").toLowerCase()
  return text.includes('name="password"')
    || text.includes("name='password'")
    || text.includes("registrationnumber")
    || text.includes("account/login")
}

function absoluteUrl(location, base) {
  if (!location) return ""
  return new URL(location, base).toString()
}

function requestHeaders({ origin, referer, jar, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }) {
  const headers = {
    Accept: accept,
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": process.env.UDVASH_USER_AGENT || DEFAULT_USER_AGENT,
  }
  if (origin) headers.Origin = origin
  if (referer) headers.Referer = referer
  const cookies = cookieHeader(jar)
  if (cookies) headers.Cookie = cookies
  return headers
}

async function getPage(url, jar, referer = "") {
  const response = await fetch(url, {
    method: "GET",
    headers: requestHeaders({ referer, jar }),
    redirect: "manual",
  })
  mergeCookies(jar, response.headers)
  const text = await response.text()
  return { response, text }
}

async function fetchPreflight(loginUrl, preflightUrl, jar) {
  const candidates = [...new Set([preflightUrl, loginUrl].filter(Boolean))]
  let last = null
  for (const url of candidates) {
    const result = await getPage(url, jar, loginUrl)
    last = { ...result, url }
    if (result.response.status >= 400) continue
    const token = hiddenInputValue(result.text, "__RequestVerificationToken")
    if (token) return { ...result, url, token }
  }
  const status = last?.response?.status
  throw new Error(`Udvash anti-forgery token পাওয়া যায়নি${status ? ` (HTTP ${status})` : ""}`)
}

async function validateRedirect(location, loginUrl, jar) {
  if (!location) return true
  const target = absoluteUrl(location, loginUrl)
  const result = await getPage(target, jar, loginUrl)
  const nextLocation = result.response.headers.get("location") || ""
  if (nextLocation) {
    const next = absoluteUrl(nextLocation, target).toLowerCase()
    if (next.includes("/account/login") || next.includes("/account/password")) return false
  }
  if (result.response.status === 200 && pageLooksLikeLogin(result.text)) return false
  return result.response.status < 400
}

export async function loginUdvashWeb({ roll, password, existingCookie = "" }) {
  const loginUrl = process.env.UDVASH_LOGIN_URL || DEFAULT_LOGIN_URL
  const preflightUrl = process.env.UDVASH_LOGIN_PREFLIGHT_URL || DEFAULT_PREFLIGHT_URL
  const origin = new URL(loginUrl).origin
  const jar = parseCookieJar(existingCookie)

  const preflight = await fetchPreflight(loginUrl, preflightUrl, jar)
  const form = new URLSearchParams()
  form.set("returnUrl", process.env.UDVASH_RETURN_URL || "")
  form.set("RememberMe", process.env.UDVASH_REMEMBER_ME || "true")
  form.set("RegistrationNumber", String(roll))
  form.set("Password", String(password))
  form.set("__RequestVerificationToken", preflight.token)

  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      ...requestHeaders({ origin, referer: preflight.url, jar }),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    redirect: "manual",
  })
  mergeCookies(jar, response.headers)
  const text = await response.text()
  const location = response.headers.get("location") || ""

  if (response.status >= 400) {
    throw new Error(`Udvash login failed: HTTP ${response.status}`)
  }

  let success = false
  if (response.status >= 300 && response.status < 400) {
    const lower = absoluteUrl(location, loginUrl).toLowerCase()
    success = Boolean(location)
      && !lower.includes("/account/login")
      && !lower.includes("/account/password")
    if (success) success = await validateRedirect(location, loginUrl, jar)
  } else if (response.status === 200) {
    success = !pageLooksLikeLogin(text)
  }

  if (!success) {
    const validationText = String(text || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220)
    throw new Error(`Udvash login rejected${validationText ? `: ${validationText}` : ""}`)
  }

  return {
    cookie: cookieHeader(jar),
    token: "",
    raw: {
      mode: "aspnet-form",
      status: response.status,
      redirect: location || null,
      antiForgery: true,
    },
  }
}

export const UDVASH_WEB_DEFAULTS = {
  origin: DEFAULT_ORIGIN,
  loginUrl: DEFAULT_LOGIN_URL,
  preflightUrl: DEFAULT_PREFLIGHT_URL,
}
