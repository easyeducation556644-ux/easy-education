import { FieldValue } from "firebase-admin/firestore"
import { decryptSecret, encryptSecret, stableId } from "./crypto.js"

const ACCOUNTS = "botStorageAccounts"
const DRIVE_API = "https://www.googleapis.com/drive/v3"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const ROOT_FOLDER = "Easy Education Content"
const MIN_FREE_BYTES = 25 * 1024 * 1024
const DOWNLOAD_ATTEMPTS = 3

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function compactErrorBody(value, limit = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

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

async function driveAccount(db, accountId) {
  const snapshot = await db.collection(ACCOUNTS).doc(String(accountId || "")).get()
  if (!snapshot.exists) throw new Error("Google Drive account was not found")
  const account = { id: snapshot.id, ...snapshot.data() }
  if (account.provider !== "google-drive") throw new Error("Storage account is not Google Drive")
  return account
}

export async function browseGoogleDriveFolder(db, accountId, parentId = "") {
  const account = await driveAccount(db, accountId)
  const token = await refreshAccessToken(account)
  const folderId = String(parentId || account.rootFolderId || "")
  if (!folderId) throw new Error("Drive root folder is unavailable")
  const query = encodeURIComponent(`'${folderId.replaceAll("'", "\\'")}' in parents and trashed=false`)
  const fields = encodeURIComponent("nextPageToken,files(id,name,mimeType,size,webViewLink,modifiedTime,iconLink)")
  const payload = await driveJson(token.access_token, `/files?q=${query}&fields=${fields}&pageSize=200&orderBy=folder,name`)
  return {
    accountId: account.id,
    folderId,
    rootFolderId: account.rootFolderId,
    files: (payload.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
      size: Number(file.size || 0),
      webViewLink: file.webViewLink || null,
      modifiedTime: file.modifiedTime || null,
    })),
  }
}

export async function browseGoogleDriveTrash(db, accountId) {
  const account = await driveAccount(db, accountId)
  const token = await refreshAccessToken(account)
  const query = encodeURIComponent("trashed=true")
  const fields = encodeURIComponent("files(id,name,mimeType,size,webViewLink,modifiedTime,trashed)")
  const payload = await driveJson(token.access_token, `/files?q=${query}&fields=${fields}&pageSize=200&orderBy=modifiedTime desc`)
  return {
    accountId: account.id,
    files: (payload.files || []).map((file) => ({
      id: file.id, name: file.name, mimeType: file.mimeType,
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
      size: Number(file.size || 0), webViewLink: file.webViewLink || null,
      modifiedTime: file.modifiedTime || null, trashed: true,
    })),
  }
}

export async function createGoogleDriveFolder(db, accountId, parentId, name) {
  const account = await driveAccount(db, accountId)
  const token = await refreshAccessToken(account)
  const targetParent = String(parentId || account.rootFolderId || "")
  if (!targetParent) throw new Error("Drive root folder is unavailable")
  const folderId = await ensureFolder(token.access_token, name, targetParent)
  return { id: folderId, name: safeName(name), parentId: targetParent }
}

export async function renameGoogleDriveItem(db, accountId, fileId, name) {
  const account = await driveAccount(db, accountId)
  const token = await refreshAccessToken(account)
  const item = await driveJson(token.access_token, `/files/${encodeURIComponent(String(fileId))}?fields=id,name,mimeType,webViewLink`, {
    method: "PATCH",
    body: JSON.stringify({ name: safeName(name) }),
  })
  return { id: item.id, name: item.name, mimeType: item.mimeType, webViewLink: item.webViewLink || null }
}

export async function trashGoogleDriveItem(db, accountId, fileId) {
  const account = await driveAccount(db, accountId)
  if (String(fileId) === String(account.rootFolderId)) throw new Error("The Easy Education root folder cannot be deleted")
  const token = await refreshAccessToken(account)
  await driveJson(token.access_token, `/files/${encodeURIComponent(String(fileId))}?fields=id,trashed`, {
    method: "PATCH",
    body: JSON.stringify({ trashed: true }),
  })
  return { id: String(fileId), trashed: true }
}

export async function restoreGoogleDriveItem(db, accountId, fileId) {
  const account = await driveAccount(db, accountId)
  const token = await refreshAccessToken(account)
  const item = await driveJson(token.access_token, `/files/${encodeURIComponent(String(fileId))}?fields=id,name,mimeType,webViewLink,trashed`, {
    method: "PATCH",
    body: JSON.stringify({ trashed: false }),
  })
  return { id: item.id, name: item.name, mimeType: item.mimeType, webViewLink: item.webViewLink || null, trashed: false }
}

export async function permanentlyDeleteGoogleDriveItem(db, accountId, fileId) {
  const account = await driveAccount(db, accountId)
  if (String(fileId) === String(account.rootFolderId)) throw new Error("The Easy Education root folder cannot be permanently deleted")
  const token = await refreshAccessToken(account)
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(String(fileId))}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  if (!response.ok && response.status !== 404) throw new Error(`Google Drive permanent delete failed (${response.status})`)
  return { id: String(fileId), permanentlyDeleted: true }
}

export async function moveGoogleDriveItem(db, accountId, fileId, parentId) {
  const account = await driveAccount(db, accountId)
  const token = await refreshAccessToken(account)
  const current = await driveJson(token.access_token, `/files/${encodeURIComponent(String(fileId))}?fields=id,name,parents,mimeType,webViewLink`)
  const target = String(parentId || account.rootFolderId || "")
  if (!target) throw new Error("Destination Drive folder is required")
  const removeParents = (current.parents || []).filter((id) => id !== target).join(",")
  const params = new URLSearchParams({ addParents: target, fields: "id,name,parents,mimeType,webViewLink" })
  if (removeParents) params.set("removeParents", removeParents)
  const item = await driveJson(token.access_token, `/files/${encodeURIComponent(String(fileId))}?${params}`, { method: "PATCH" })
  return { id: item.id, name: item.name, parents: item.parents || [], mimeType: item.mimeType, webViewLink: item.webViewLink || null }
}

export async function setDefaultGoogleDriveAccount(db, accountId) {
  const selected = await driveAccount(db, accountId)
  const accounts = await listGoogleDriveAccounts(db)
  await promoteDefault(db, selected, accounts)
  return { id: selected.id, isDefault: true }
}

export async function disconnectGoogleDriveAccount(db, accountId) {
  const selected = await driveAccount(db, accountId)
  const accounts = await listGoogleDriveAccounts(db)
  await db.collection(ACCOUNTS).doc(selected.id).delete()
  const next = accounts.find((account) => account.id !== selected.id && account.status === "ready") || accounts.find((account) => account.id !== selected.id)
  if (selected.isDefault && next) await promoteDefault(db, next, accounts.filter((account) => account.id !== selected.id))
  return { id: selected.id, disconnected: true }
}

async function uploadResumable(accessToken, { name, mimeType = "application/octet-stream", bytes, parentId }) {
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
  if (!session.ok) {
    const details = compactErrorBody(await session.text().catch(() => ""))
    // A small number of Drive accounts reject resumable-session initiation
    // even though a normal multipart files.create succeeds with the same
    // metadata. The resource is already buffered, so this is a safe fallback.
    if (session.status === 400) return uploadMultipart(accessToken, { name, mimeType, bytes, parentId }, details)
    throw new Error(`Google Drive upload session failed (${session.status})${details ? `: ${details}` : ""}`)
  }
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

async function uploadMultipart(accessToken, { name, mimeType = "application/octet-stream", bytes, parentId }, sessionError = "") {
  const boundary = `ee_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  const metadata = Buffer.from(JSON.stringify({ name: safeName(name, "Class resource"), parents: [parentId] }))
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.byteLength),
    },
    body,
  })
  const payload = await response.json().catch(async () => ({ raw: compactErrorBody(await response.text().catch(() => "")) }))
  if (!response.ok) {
    const details = compactErrorBody(payload?.error?.message || payload?.raw || sessionError)
    throw new Error(`Google Drive upload failed (${response.status})${details ? `: ${details}` : ""}`)
  }
  await driveJson(accessToken, `/files/${payload.id}/permissions`, {
    method: "POST",
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  })
  return { ...payload, webViewLink: payload.webViewLink || `https://drive.google.com/file/d/${payload.id}/view` }
}

async function downloadResource(resource, sourceCookie = "") {
  const url = String(resource?.url || "")
  if (!/^https?:\/\//i.test(url)) throw new Error("Resource URL is invalid")
  const sameUdvashOrigin = new URL(url).origin === "https://online.udvash-unmesh.com"
  let response
  let lastNetworkError
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/pdf,application/octet-stream,*/*",
          ...(sameUdvashOrigin && sourceCookie ? { Cookie: sourceCookie } : {}),
        },
        redirect: "follow",
      })
      break
    } catch (error) {
      lastNetworkError = error
      if (attempt < DOWNLOAD_ATTEMPTS) await delay(250 * attempt)
    }
  }
  if (!response) throw new Error(`Resource download network failed after ${DOWNLOAD_ATTEMPTS} attempts: ${lastNetworkError?.message || "fetch failed"}`)
  if (!response.ok) throw new Error(`Resource download failed (${response.status})`)
  const declaredSize = Number(response.headers.get("content-length") || 0)
  const maxBytes = Number(process.env.GOOGLE_DRIVE_MAX_RESOURCE_BYTES || 50 * 1024 * 1024)
  if (declaredSize > maxBytes) throw new Error(`Resource exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`)
  const declaredType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
  if (/^text\/html$/i.test(declaredType)) throw new Error("The source returned an HTML page instead of a downloadable resource")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("Downloaded resource is empty")
  if (bytes.byteLength > maxBytes) throw new Error(`Resource exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`)
  const head = bytes.subarray(0, Math.min(bytes.length, 512)).toString("utf8").trimStart().toLowerCase()
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<head")) {
    throw new Error("The source returned HTML content instead of a downloadable file")
  }
  const isPdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-"
  const contentType = isPdf
    ? "application/pdf"
    : declaredType && declaredType !== "undefined" && declaredType !== "null"
      ? declaredType
      : "application/octet-stream"
  const disposition = response.headers.get("content-disposition") || ""
  const dispositionName = /filename\*?=(?:UTF-8''|\")?([^";]+)/i.exec(disposition)?.[1]
  let urlName = ""
  try { urlName = decodeURIComponent(new URL(response.url).pathname.split("/").filter(Boolean).pop() || "") } catch {}
  const baseName = safeName(dispositionName || resource.label || urlName || "Class resource")
  const name = isPdf && !/\.pdf$/i.test(baseName) ? `${baseName}.pdf` : baseName
  return { bytes, contentType, name }
}

export async function persistResourceLinksToDrive(db, resources, context = {}) {
  const output = []
  for (const resource of Array.isArray(resources) ? resources : []) {
    const sourceUrl = String(resource?.url || "")
    // Udvash signed URLs change on every class-page refresh. A URL-based key
    // defeated the cache and uploaded the same note repeatedly.
    const resourceIdentity = String(resource?.label || "Class resource").trim().toLowerCase()
    const assetId = stableId("drive-resource-v2", context.platform, context.sourceCourseId, context.sourceClassId, resourceIdentity)
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
      const uploaded = await uploadResumable(token.access_token, {
        name: downloaded.name,
        mimeType: downloaded.contentType || "application/octet-stream",
        bytes: downloaded.bytes,
        parentId: folderId,
      })
      const verified = await driveJson(token.access_token, `/files/${encodeURIComponent(uploaded.id)}?fields=id,name,size,mimeType,md5Checksum,webViewLink,trashed`)
      if (verified.trashed) throw new Error("Uploaded Drive file was unexpectedly placed in trash")
      if (Number(verified.size || 0) !== downloaded.bytes.byteLength) throw new Error("Uploaded Drive file size verification failed")
      await assetRef.set({
        status: "ready",
        platform: context.platform || "",
        sourceCourseId: String(context.sourceCourseId || ""),
        sourceClassId: String(context.sourceClassId || ""),
        sourceUrl,
        label: resource.label || downloaded.name,
        driveAccountId: account.id,
        driveFileId: uploaded.id,
        webViewLink: verified.webViewLink || uploaded.webViewLink,
        size: downloaded.bytes.byteLength,
        mimeType: verified.mimeType || downloaded.contentType,
        md5Checksum: verified.md5Checksum || "",
        updatedAt: FieldValue.serverTimestamp(),
        ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true })
      output.push({ label: resource.label || downloaded.name, url: verified.webViewLink || uploaded.webViewLink, driveFileId: uploaded.id, mimeType: verified.mimeType || downloaded.contentType, size: Number(verified.size || downloaded.bytes.byteLength) })
    } catch (error) {
      const storageError = String(error.message || error).slice(0, 500)
      await assetRef.set({
        status: "failed",
        platform: context.platform || "",
        sourceCourseId: String(context.sourceCourseId || ""),
        sourceClassId: String(context.sourceClassId || ""),
        sourceUrl,
        label: resource?.label || "Class resource",
        lastError: storageError,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      output.push({ ...resource, storageStatus: "failed", storageError })
    }
  }
  return output
}

export const GOOGLE_DRIVE_COLLECTION = ACCOUNTS
