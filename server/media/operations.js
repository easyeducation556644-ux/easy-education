import { randomUUID } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { mediaId, validSourceUrl } from "./helpers.js"

const TASKS = "mediaTasks"
const CHANNELS = "mediaChannels"
const PRESETS = "mediaWatermarkPresets"
const WORKERS = "mediaWorkers"
const SETTINGS = "mediaSettings"
const DEDUPE = "mediaDedupe"
const LEASE_MS = 3 * 60 * 1000
const ACTIVE = new Set(["queued", "claimed", "downloading", "processing", "uploading", "paused"])

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max)
}

function plain(doc) {
  if (!doc?.exists) return null
  const value = doc.data()
  return { id: doc.id, ...value }
}

function taskView(doc) {
  const item = plain(doc)
  if (!item) return null
  return {
    ...item,
    source: { ...item.source, headers: undefined, cookies: undefined },
    workerSecret: undefined,
  }
}

async function listCollection(db, name, limit = 100) {
  const snap = await db.collection(name).limit(limit).get()
  return snap.docs.map((doc) => plain(doc))
}

export async function mediaOverview(db) {
  const [settings, channels, presets, workers, tasks] = await Promise.all([
    db.collection(SETTINGS).doc("global").get(),
    listCollection(db, CHANNELS, 100),
    listCollection(db, PRESETS, 100),
    listCollection(db, WORKERS, 20),
    listCollection(db, TASKS, 100),
  ])
  const now = Date.now()
  return {
    settings: plain(settings) || { id: "global", paused: false },
    channels: channels.sort((a, b) => clean(a.name).localeCompare(clean(b.name))),
    presets: presets.sort((a, b) => clean(a.name).localeCompare(clean(b.name))),
    workers: workers.map((worker) => ({ ...worker, online: now - Number(worker.lastSeenAtMs || 0) < 90_000 })),
    tasks: tasks.map((task) => taskView({ exists: true, id: task.id, data: () => task })).sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0)),
    nowMs: now,
  }
}

export async function saveMediaChannel(db, body) {
  const name = clean(body.name, 120)
  const chatId = clean(body.chatId, 180)
  if (!name || !chatId) throw new Error("Channel name and Telegram chat ID/@username are required")
  const id = clean(body.id, 80) || mediaId("channel", chatId)
  await db.collection(CHANNELS).doc(id).set({
    name,
    chatId,
    threadId: clean(body.threadId, 40) || null,
    enabled: body.enabled !== false,
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { id, name, chatId }
}

export async function saveMediaPreset(db, body) {
  const name = clean(body.name, 120)
  if (!name) throw new Error("Preset name is required")
  const id = clean(body.id, 80) || mediaId("preset", name, randomUUID())
  const mode = ["none", "permanent", "timed", "ticker", "combined"].includes(body.mode) ? body.mode : "permanent"
  const timed = Array.isArray(body.timed) ? body.timed.slice(0, 10).map((item) => ({
    start: Math.max(0, Number(item.start || 0)),
    duration: Math.max(1, Math.min(120, Number(item.duration || 10))),
  })) : []
  await db.collection(PRESETS).doc(id).set({
    name,
    mode,
    text: clean(body.text, 300),
    tickerText: clean(body.tickerText, 500),
    logoPath: clean(body.logoPath, 500) || null,
    position: ["top-left", "top-right", "bottom-left", "bottom-right", "center"].includes(body.position) ? body.position : "top-right",
    opacity: Math.max(0.05, Math.min(1, Number(body.opacity ?? 0.28))),
    fontSize: Math.max(14, Math.min(120, Number(body.fontSize || 36))),
    tickerSpeed: Math.max(20, Math.min(500, Number(body.tickerSpeed || 110))),
    timed,
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { id, name, mode }
}

export async function deleteMediaConfig(db, body) {
  const kind = body.kind === "channel" ? CHANNELS : body.kind === "preset" ? PRESETS : ""
  const id = clean(body.id, 100)
  if (!kind || !id) throw new Error("Valid config kind and ID are required")
  await db.collection(kind).doc(id).delete()
  return { id, deleted: true }
}

export async function createMediaTasks(db, body) {
  const urls = Array.isArray(body.urls) ? body.urls : String(body.urls || "").split(/\r?\n/)
  const sources = [...new Set(urls.map((url) => clean(url, 3000)).filter(Boolean))]
  if (!sources.length || sources.length > 10) throw new Error("Add between 1 and 10 video links")
  const channelId = clean(body.channelId, 100)
  if (!channelId) throw new Error("Choose a destination channel")
  const [channel, preset] = await Promise.all([
    db.collection(CHANNELS).doc(channelId).get(),
    body.presetId ? db.collection(PRESETS).doc(clean(body.presetId, 100)).get() : Promise.resolve(null),
  ])
  if (!channel.exists || channel.data().enabled === false) throw new Error("Destination channel was not found or is disabled")
  if (body.presetId && !preset?.exists) throw new Error("Watermark preset was not found")

  const normalized = sources.map((rawUrl) => validSourceUrl(rawUrl))
  const fingerprints = normalized.map((url) => mediaId("media", url, channel.data().chatId, channel.data().threadId || ""))
  const duplicateSnaps = await db.getAll(...fingerprints.map((fingerprint) => db.collection(DEDUPE).doc(fingerprint)))
  const duplicates = duplicateSnaps
    .filter((snap) => snap.exists && (ACTIVE.has(String(snap.data().status || "")) || snap.data().status === "completed"))
    .map((snap) => ({ fingerprint: snap.id, taskId: snap.data().taskId, status: snap.data().status }))
  const duplicateIds = new Set(duplicates.map((item) => item.fingerprint))
  if (duplicateIds.size === normalized.length) {
    const error = new Error("Every link is already queued or uploaded to this Telegram destination")
    error.statusCode = 409
    throw error
  }

  const batchId = `media_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const batch = db.batch()
  const tasks = []
  normalized.forEach((url, index) => {
    const fingerprint = fingerprints[index]
    if (duplicateIds.has(fingerprint)) return
    const id = `${batchId}_${String(index + 1).padStart(2, "0")}`
    const ref = db.collection(TASKS).doc(id)
    const task = {
      type: "media-upload",
      batchId,
      fingerprint,
      name: clean(body.name, 140) || `Manual media batch ${new Date().toISOString().slice(0, 10)}`,
      status: "queued",
      source: { url, kind: /(?:youtube\.com|youtu\.be)/i.test(url) ? "youtube" : "direct" },
      channel: { id: channel.id, name: channel.data().name, chatId: channel.data().chatId, threadId: channel.data().threadId || null },
      preset: preset?.exists ? { id: preset.id, ...preset.data() } : { id: null, mode: "none", name: "No watermark" },
      quality: clean(body.quality, 20) || "720",
      caption: clean(body.caption, 900),
      priority: Math.max(0, Math.min(100, Number(body.priority || 50))),
      progress: { stage: "queued", percent: 0, downloadedBytes: 0, totalBytes: 0, speed: "", eta: "" },
      attempts: 0,
      cancelRequested: false,
      pauseRequested: false,
      leaseExpiresAtMs: 0,
      createdAtMs: Date.now() + index,
      updatedAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    batch.set(ref, task)
    batch.set(db.collection(DEDUPE).doc(fingerprint), { taskId: id, batchId, status: "queued", sourceUrl: url, channelId, updatedAtMs: Date.now() })
    tasks.push({ id, ...task, createdAt: undefined, updatedAt: undefined })
  })
  await batch.commit()
  return { batchId, tasks, duplicates }
}

export async function setMediaGlobalState(db, body) {
  const paused = Boolean(body.paused)
  await db.collection(SETTINGS).doc("global").set({
    paused,
    reason: clean(body.reason, 200),
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { paused }
}

export async function controlMediaTask(db, body) {
  const id = clean(body.taskId, 120)
  const command = clean(body.command, 30)
  const ref = db.collection(TASKS).doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error("Media task was not found")
  const patch = { updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }
  if (command === "cancel") Object.assign(patch, { cancelRequested: true, pauseRequested: false, status: "cancelled", leaseExpiresAtMs: 0 })
  else if (command === "pause") Object.assign(patch, { pauseRequested: true, status: "paused", leaseExpiresAtMs: 0 })
  else if (command === "resume") Object.assign(patch, { pauseRequested: false, cancelRequested: false, status: "queued", workerId: null, leaseExpiresAtMs: 0 })
  else if (command === "retry") Object.assign(patch, { pauseRequested: false, cancelRequested: false, status: "queued", error: null, workerId: null, leaseExpiresAtMs: 0 })
  else throw new Error("Unknown media task command")
  await ref.set(patch, { merge: true })
  return { id, command, status: patch.status }
}

export async function registerMediaWorker(db, body) {
  const workerId = clean(body.workerId, 120)
  if (!workerId) throw new Error("workerId is required")
  await db.collection(WORKERS).doc(workerId).set({
    name: clean(body.name, 120) || workerId,
    version: clean(body.version, 40),
    platform: clean(body.platform, 80),
    capabilities: body.capabilities && typeof body.capabilities === "object" ? body.capabilities : {},
    status: "online",
    lastSeenAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { workerId, registered: true }
}

export async function claimMediaTask(db, body) {
  const workerId = clean(body.workerId, 120)
  if (!workerId) throw new Error("workerId is required")
  const settings = await db.collection(SETTINGS).doc("global").get()
  if (settings.exists && settings.data().paused) return { task: null, paused: true }

  const candidates = await db.collection(TASKS).where("status", "in", ["queued", "claimed", "downloading", "processing", "uploading"]).limit(20).get()
  const now = Date.now()
  const candidate = candidates.docs
    .filter((doc) => {
      const task = doc.data()
      return !task.cancelRequested && !task.pauseRequested && (task.status === "queued" || Number(task.leaseExpiresAtMs || 0) < now || task.workerId === workerId)
    })
    .sort((a, b) => Number(a.data().createdAtMs || 0) - Number(b.data().createdAtMs || 0))[0]
  if (!candidate) {
    await registerMediaWorker(db, body)
    return { task: null, paused: false }
  }

  const claimed = await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(candidate.ref)
    if (!fresh.exists) return null
    const task = fresh.data()
    if (task.cancelRequested || task.pauseRequested) return null
    if (task.status !== "queued" && Number(task.leaseExpiresAtMs || 0) >= Date.now() && task.workerId !== workerId) return null
    transaction.set(candidate.ref, {
      status: task.status === "queued" ? "claimed" : task.status,
      workerId,
      workerName: clean(body.name, 120) || workerId,
      attempts: Number(task.attempts || 0) + (task.status === "queued" ? 1 : 0),
      leaseExpiresAtMs: Date.now() + LEASE_MS,
      claimedAtMs: task.claimedAtMs || Date.now(),
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { id: fresh.id, ...task, workerId, leaseExpiresAtMs: Date.now() + LEASE_MS }
  })
  await registerMediaWorker(db, body)
  return { task: claimed ? taskView({ exists: true, id: claimed.id, data: () => claimed }) : null, paused: false }
}

export async function heartbeatMediaTask(db, body) {
  const workerId = clean(body.workerId, 120)
  const taskId = clean(body.taskId, 120)
  if (!workerId || !taskId) throw new Error("workerId and taskId are required")
  const ref = db.collection(TASKS).doc(taskId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error("Media task was not found")
  const task = snap.data()
  if (task.workerId && task.workerId !== workerId && Number(task.leaseExpiresAtMs || 0) >= Date.now()) throw new Error("Task lease belongs to another worker")
  const settings = await db.collection(SETTINGS).doc("global").get()
  const control = { cancelled: Boolean(task.cancelRequested || task.status === "cancelled"), paused: Boolean(task.pauseRequested || task.status === "paused" || settings.data()?.paused) }
  if (!control.cancelled && !control.paused) {
    await ref.set({ leaseExpiresAtMs: Date.now() + LEASE_MS, updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  await db.collection(WORKERS).doc(workerId).set({ status: control.paused ? "paused" : "busy", currentTaskId: taskId, lastSeenAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return control
}

export async function updateMediaProgress(db, body) {
  const workerId = clean(body.workerId, 120)
  const taskId = clean(body.taskId, 120)
  const stage = ["claimed", "downloading", "processing", "uploading", "verifying"].includes(body.stage) ? body.stage : "processing"
  if (!workerId || !taskId) throw new Error("workerId and taskId are required")
  const progress = {
    stage,
    percent: Math.max(0, Math.min(100, Number(body.percent || 0))),
    downloadedBytes: Math.max(0, Number(body.downloadedBytes || 0)),
    totalBytes: Math.max(0, Number(body.totalBytes || 0)),
    speed: clean(body.speed, 60),
    eta: clean(body.eta, 60),
    message: clean(body.message, 500),
  }
  await db.collection(TASKS).doc(taskId).set({
    status: stage,
    workerId,
    progress,
    leaseExpiresAtMs: Date.now() + LEASE_MS,
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { taskId, progress }
}

export async function finishMediaTask(db, body) {
  const workerId = clean(body.workerId, 120)
  const taskId = clean(body.taskId, 120)
  const success = body.success === true
  if (!workerId || !taskId) throw new Error("workerId and taskId are required")
  const status = success ? "completed" : "failed"
  const taskRef = db.collection(TASKS).doc(taskId)
  const taskSnap = await taskRef.get()
  await taskRef.set({
    status,
    workerId,
    progress: { stage: status, percent: success ? 100 : Math.max(0, Number(body.percent || 0)), message: clean(body.message, 500) },
    result: success ? {
      telegramMessageId: body.telegramMessageId || null,
      telegramFileId: clean(body.telegramFileId, 300) || null,
      outputBytes: Number(body.outputBytes || 0),
      title: clean(body.title, 300),
    } : null,
    error: success ? null : clean(body.error, 1200) || "Media worker failed",
    leaseExpiresAtMs: 0,
    completedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  if (taskSnap.exists && taskSnap.data().fingerprint) {
    await db.collection(DEDUPE).doc(taskSnap.data().fingerprint).set({ taskId, status, updatedAtMs: Date.now() }, { merge: true })
  }
  await db.collection(WORKERS).doc(workerId).set({ status: "online", currentTaskId: null, lastSeenAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { taskId, status }
}

export const MEDIA_ACTIONS = new Set([
  "media-overview", "media-save-channel", "media-save-preset", "media-delete-config", "media-create-tasks",
  "media-global-state", "media-control-task", "media-worker-register", "media-worker-claim", "media-worker-heartbeat",
  "media-worker-progress", "media-worker-finish",
])

export async function handleMediaAction(db, action, body = {}) {
  if (action === "media-overview") return mediaOverview(db)
  if (action === "media-save-channel") return saveMediaChannel(db, body)
  if (action === "media-save-preset") return saveMediaPreset(db, body)
  if (action === "media-delete-config") return deleteMediaConfig(db, body)
  if (action === "media-create-tasks") return createMediaTasks(db, body)
  if (action === "media-global-state") return setMediaGlobalState(db, body)
  if (action === "media-control-task") return controlMediaTask(db, body)
  if (action === "media-worker-register") return registerMediaWorker(db, body)
  if (action === "media-worker-claim") return claimMediaTask(db, body)
  if (action === "media-worker-heartbeat") return heartbeatMediaTask(db, body)
  if (action === "media-worker-progress") return updateMediaProgress(db, body)
  if (action === "media-worker-finish") return finishMediaTask(db, body)
  throw new Error("Unknown media action")
}
