import { FieldValue } from "firebase-admin/firestore"
import { decryptSecret, encryptSecret, stableId } from "./crypto.js"

const ACCOUNTS = "botStorageAccounts"
const DRIVE_API = "https://www.googleapis.com/drive/v3"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const ROOT_FOLDER = "Easy Education Content"
const MIN_FREE_BYTES = 25 * 1024 * 1024

function oauthConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || ""
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || ""
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || ""
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google Drive OAuth is not configured")
  return { clientId, clientSecret, redirectUri }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || payload.error_description || `Google Drive request failed (${response.status})`)
  return payload
}

export function googleAuthorizationUrl(state) {
  const { clientId, redirectUri } = oauthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: "https://www.googleapis.com/auth/drive.file",
    state,
  })
  return `${AUTH_URL}?${params}`
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = oauthConfig()
  return jsonRequest(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  })
}

async function refreshAccessToken(account) {
  const { clientId, clientSecret } = oauthConfig()
  const refreshToken = decryptSecret(account.refreshTokenEncrypted || "")
  if (!refreshToken) throw new Error("Google Drive account requires reconnection")
  return jsonRequest(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }),
  })
}

async function driveJson(accessToken, path, options = {}) {
  return jsonRequest(`${DRIVE_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
  })
}

async function accountProfile(accessToken) {
  return driveJson(accessToken, "/about?fields=user,storageQuota")
}

async function ensureRootFolder(accessToken) {
  const query = encodeURIComponent(`name='${ROOT_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const found = await driveJson(accessToken, `/files?q=${query}&fields=files(id,name)&pageSize=1`)
  if (found.files?.[0]?.id) return found.files[0].id
  const created = await driveJson(accessToken, "/files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name: ROOT_FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  })
  return created.id
}

export async function connectGoogleDriveAccount(db, code, telegramUserId) {
  const token = await exchangeCode(code)
  const profile = await accountProfile(token.access_token)
  const email = profile.user?.emailAddress || "Unknown account"
  const existing = await db.collection(ACCOUNTS).where("provider", "==", "google-drive").get()
  const matched = existing.docs.find((doc) => doc.data().email === email)
  const ref = matched?.ref || db.collection(ACCOUNTS).doc()
  const rootFolderId = await ensureRootFolder(token.access_token)
  const hasDefault = existing.docs.some((doc) => doc.data().isDefault && doc.id !== ref.id)
  await ref.set({
    provider: "google-drive",
    email,
    displayName: profile.user?.displayName || email,
    refreshTokenEncrypted: token.refresh_token ? encryptSecret(token.refresh_token) : matched?.data()?.refreshTokenEncrypted || "",
    rootFolderId,
    status: "ready",
    isFull: false,
    isDefault: !hasDefault,
    priority: matched?.data()?.priority ?? existing.size,
    quotaLimit: Number(profile.storageQuota?.limit || 0),
    quotaUsage: Number(profile.storageQuota?.usage || 0),
    connectedByTelegramUserId: String(telegramUserId),
    updatedAt: FieldValue.serverTimestamp(),
    ...(matched ? {} : { createdAt: FieldValue.serverTimestamp() }),
  }, { merge: true })
  return { id: ref.id, email, rootFolderId }
}

export async function listGoogleDriveAccounts(db, { refresh = false } = {}) {
  const snapshot = await db.collection(ACCOUNTS).where("provider", "==", "google-drive").get()
  const accounts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.priority || 0) - Number(b.priority || 0))
  if (!refresh) return accounts
  for (const account of accounts) {
    try {
      const token = await refreshAccessToken(account)
      const profile = await accountProfile(token.access_token)
      account.quotaLimit = Number(profile.storageQuota?.limit || 0)
      account.quotaUsage = Number(profile.storageQuota?.usage || 0)
      account.isFull = account.quotaLimit > 0 && account.quotaLimit - account.quotaUsage < MIN_FREE_BYTES
      account.status = account.isFull ? "full" : "ready"
      await snapshot.docs.find((doc) => doc.id === account.id).ref.set({
        quotaLimit: account.quotaLimit,
        quotaUsage: account.quotaUsage,
        isFull: account.isFull,
        status: account.status,
        checkedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      account.status = "error"
      account.lastError = String(error.message || error).slice(0, 300)
      await db.collection(ACCOUNTS).doc(account.id).set({
        status: "error",
        lastError: account.lastError,
        checkedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {})
    }
  }
  return accounts
}

async function promoteDefault(db, selected, accounts) {
  if (selected.isDefault) return
  const batch = db.batch()
  accounts.forEach((account) => batch.set(db.collection(ACCOUNTS).doc(account.id), { isDefault: account.id === selected.id }, { merge: true }))
  await batch.commit()
}

export async function selectDriveAccount(db, requiredBytes = 0) {
  const accounts = await listGoogleDriveAccounts(db, { refresh: true })
  if (!accounts.length) throw new Error("No Google Drive storage account is connected")
  const selected = accounts.find((account) => account.status === "ready" && (!account.quotaLimit || account.quotaLimit - account.quotaUsage >= requiredBytes + MIN_FREE_BYTES))
  if (!selected) throw new Error("All connected Google Drive accounts are full or unavailable")
  await promoteDefault(db, selected, accounts)
  return selected
}

function safeName(value, fallback = "Untitled") {
  return String(value || fallback).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 160) || fallback
}

async function ensureFolder(accessToken, name, parentId) {
  const escapedName = safeName(name).replaceAll("'", "\\'")
  const query = encodeURIComponent(`name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const found = await driveJson(accessToken, `/files?q=${query}&fields=files(id,name)&pageSize=1`)
  if (found.files?.[0]?.id) return found.files[0].id
  const created = await driveJson(accessToken, "/files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name: safeName(name), parents: [parentId], mimeType: "application/vnd.google-apps.folder" }),
  })
  return created.id
}

async function ensureFolderPath(accessToken, rootFolderId, parts) {
  let parentId = rootFolderId
  for (const part of parts.filter(Boolean)) parentId = await ensureFolder(accessToken, part, parentId)
  return parentId
}

async function uploadResumable(accessToken, { name, mimeType, bytes, parentId }) {
  const session = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(bytes.byteLength),
    },
    body: JSON.stringify({ name: safeName(name, "Class resource"), parents: [parentId] }),
  })
  if (!session.ok) throw new Error(`Google Drive upload session failed (${session.status})`)
  const location = session.headers.get("location")
  if (!location) throw new Error("Google Drive did not return an upload session")
  const uploaded = await jsonRequest(location, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "Content-Length": String(bytes.byteLength) },
    body: bytes,
  })
  await driveJson(accessToken, `/files/${uploaded.id}/permissions`, {
    method: "POST",
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  })
  return { ...uploaded, webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view` }
}

async function downloadResource(resource, sourceCookie = "") {
  const url = String(resource?.url || "")
  if (!/^https?:\/\//i.test(url)) throw new Error("Resource URL is invalid")
  const sameUdvashOrigin = new URL(url).origin === "https://online.udvash-unmesh.com"
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf,application/octet-stream,*/*",
      ...(sameUdvashOrigin && sourceCookie ? { Cookie: sourceCookie } : {}),
    },
    redirect: "follow",
  })
  if (!response.ok) throw new Error(`Resource download failed (${response.status})`)
  const declaredSize = Number(response.headers.get("content-length") || 0)
  const maxBytes = Number(process.env.GOOGLE_DRIVE_MAX_RESOURCE_BYTES || 50 * 1024 * 1024)
  if (declaredSize > maxBytes) throw new Error(`Resource exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`)
  const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream"
  if (/^text\/html$/i.test(contentType)) throw new Error("The source returned an HTML page instead of a downloadable resource")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("Downloaded resource is empty")
  if (bytes.byteLength > maxBytes) throw new Error(`Resource exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`)
  const disposition = response.headers.get("content-disposition") || ""
  const dispositionName = /filename\*?=(?:UTF-8''|\")?([^";]+)/i.exec(disposition)?.[1]
  let urlName = ""
  try { urlName = decodeURIComponent(new URL(response.url).pathname.split("/").filter(Boolean).pop() || "") } catch {}
  return { bytes, contentType, name: safeName(dispositionName || resource.label || urlName || "Class resource") }
}

export async function persistResourceLinksToDrive(db, resources, context = {}) {
  const output = []
  for (const resource of Array.isArray(resources) ? resources : []) {
    const sourceUrl = String(resource?.url || "")
    const assetId = stableId("drive-resource", context.platform, context.sourceCourseId, context.sourceClassId, sourceUrl)
    const assetRef = db.collection("botStoredAssets").doc(assetId)
    const existing = await assetRef.get()
    if (existing.exists && existing.data().status === "ready" && existing.data().webViewLink) {
      output.push({ label: resource.label, url: existing.data().webViewLink, driveFileId: existing.data().driveFileId })
      continue
    }

    try {
      const downloaded = await downloadResource(resource, context.sourceCookie)
      const account = await selectDriveAccount(db, downloaded.bytes.byteLength)
      const token = await refreshAccessToken(account)
      const folderId = await ensureFolderPath(token.access_token, account.rootFolderId, [
        context.platform || "Source",
        context.sourceCourseTitle || context.sourceCourseId,
        context.subjectTitle,
        context.chapterTitle,
      ])
      const uploaded = await uploadResumable(token.access_token, { ...downloaded, parentId: folderId })
      await assetRef.set({
        status: "ready",
        platform: context.platform || "",
        sourceCourseId: String(context.sourceCourseId || ""),
        sourceClassId: String(context.sourceClassId || ""),
        sourceUrl,
        label: resource.label || downloaded.name,
        driveAccountId: account.id,
        driveFileId: uploaded.id,
        webViewLink: uploaded.webViewLink,
        size: downloaded.bytes.byteLength,
        mimeType: downloaded.contentType,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true })
      output.push({ label: resource.label || downloaded.name, url: uploaded.webViewLink, driveFileId: uploaded.id })
    } catch (error) {
      await assetRef.set({
        status: "failed",
        platform: context.platform || "",
        sourceCourseId: String(context.sourceCourseId || ""),
        sourceClassId: String(context.sourceClassId || ""),
        sourceUrl,
        label: resource?.label || "Class resource",
        lastError: String(error.message || error).slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      output.push({ ...resource, storageStatus: "failed" })
    }
  }
  return output
}

export const GOOGLE_DRIVE_COLLECTION = ACCOUNTS
