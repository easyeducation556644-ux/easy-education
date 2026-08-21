import { FieldValue } from "firebase-admin/firestore"
import { isFullAdminProfile, requireAuthenticatedUser } from "./utils/firebase-admin.js"

const CAMPAIGNS = "trialCampaigns"
const RESPONSES = "trialResponses"
const EVENTS = "trialEvents"
const CPS_ENTITLEMENTS = "cpsEntitlements"
const TRIAL_ACCESS = "trialCourseAccess"
const MAX_SELECTED_USERS = 500
const MAX_SELECTED_COURSES = 100

function httpError(statusCode, message, code = "TRIAL_ERROR") {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://easy-education.vercel.app")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Cache-Control", "private, no-store")
}

const text = (value) => String(value || "").trim()
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]

function durationMs(value, unit) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, "A positive trial duration is required", "INVALID_DURATION")
  const normalized = text(unit).toLowerCase()
  const multipliers = {
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
    month: 30 * 86_400_000,
    months: 30 * 86_400_000,
  }
  const multiplier = multipliers[normalized]
  if (!multiplier) throw httpError(400, "Duration unit must be minutes, hours, days or months", "INVALID_DURATION_UNIT")
  return Math.round(amount * multiplier)
}

function epoch(value) {
  if (!value) return 0
  if (typeof value.toMillis === "function") return value.toMillis()
  if (typeof value === "number") return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeTargets(rawTargets) {
  if (!Array.isArray(rawTargets)) return []
  const seen = new Set()
  const result = []
  for (const raw of rawTargets) {
    const source = text(raw?.source).toLowerCase()
    const courseId = text(raw?.courseId).replace(/^cps:/, "")
    if (!courseId || !["cps", "our"].includes(source)) continue
    const key = `${source}:${courseId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ source, courseId, title: text(raw?.title) || "Course" })
  }
  return result
}

function serializeDoc(snapshot) {
  if (!snapshot?.exists) return null
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    ...data,
    createdAtMs: epoch(data.createdAtMs || data.createdAt),
    updatedAtMs: epoch(data.updatedAtMs || data.updatedAt),
    claimedAtMs: epoch(data.claimedAtMs || data.claimedAt),
    cancelledAtMs: epoch(data.cancelledAtMs || data.cancelledAt),
  }
}

function responseId(campaignId, uid) {
  return `${campaignId}_${uid}`
}

function cpsEntitlementId(uid, courseId) {
  return `${uid}_${courseId}`
}

function trialAccessId(uid, source, courseId) {
  return `${uid}_${source}_${courseId}`
}

function isCampaignAudience(campaign, uid, profile) {
  if (!campaign || campaign.status === "cancelled") return false
  if (campaign.allUsers === true) {
    const cutoff = Number(campaign.audienceCutoffMs || 0)
    const joined = epoch(profile?.createdAt || profile?.joinedAt || profile?.registeredAt)
    return !cutoff || !joined || joined <= cutoff
  }
  return Array.isArray(campaign.userIds) && campaign.userIds.includes(uid)
}

function campaignPublic(campaign) {
  return {
    id: campaign.id,
    title: campaign.title || "Free trial",
    courseTargets: campaign.courseTargets || [],
    durationValue: campaign.durationValue,
    durationUnit: campaign.durationUnit,
    durationMs: campaign.durationMs,
    allUsers: campaign.allUsers === true,
    createdAtMs: campaign.createdAtMs || 0,
    status: campaign.status || "active",
  }
}

async function listResponsesForUser(db, uid) {
  const snap = await db.collection(RESPONSES).where("userId", "==", uid).get()
  return new Map(snap.docs.map((doc) => [doc.data()?.campaignId, serializeDoc(doc)]))
}

async function handleMine(authenticated, res) {
  const uid = authenticated.decodedToken.uid
  const [campaignSnap, responseMap] = await Promise.all([
    authenticated.db.collection(CAMPAIGNS).where("status", "==", "active").get(),
    listResponsesForUser(authenticated.db, uid),
  ])
  const now = Date.now()
  const offers = campaignSnap.docs
    .map(serializeDoc)
    .filter((campaign) => isCampaignAudience(campaign, uid, authenticated.userProfile))
    .map((campaign) => {
      const response = responseMap.get(campaign.id)
      const claimedAtMs = Number(response?.claimedAtMs || 0)
      const expiresAtMs = Number(response?.expiresAtMs || 0)
      let status = response?.status || "pending"
      if (status === "claimed" && expiresAtMs > 0 && expiresAtMs <= now) status = "expired"
      return {
        ...campaignPublic(campaign),
        response: {
          status,
          claimedAtMs,
          expiresAtMs,
          cancelledAtMs: Number(response?.cancelledAtMs || 0),
          resendCount: Number(response?.resendCount || 0),
        },
      }
    })
    .filter((item) => item.response.status !== "expired")
  res.status(200).json({ offers, serverTimeMs: now })
}

async function loadCampaignOrThrow(db, campaignId) {
  const snapshot = await db.collection(CAMPAIGNS).doc(campaignId).get()
  const campaign = serializeDoc(snapshot)
  if (!campaign) throw httpError(404, "Trial offer was not found", "TRIAL_NOT_FOUND")
  if (campaign.status !== "active") throw httpError(409, "This trial offer is no longer active", "TRIAL_INACTIVE")
  return campaign
}

async function appendEvent(db, payload) {
  await db.collection(EVENTS).add({ ...payload, atMs: Date.now(), at: FieldValue.serverTimestamp() })
}

async function handleClaim(authenticated, req, res) {
  const uid = authenticated.decodedToken.uid
  const campaignId = text(req.body?.campaignId)
  if (!campaignId) throw httpError(400, "campaignId is required", "INVALID_CAMPAIGN")
  const db = authenticated.db
  const campaign = await loadCampaignOrThrow(db, campaignId)
  if (!isCampaignAudience(campaign, uid, authenticated.userProfile)) throw httpError(403, "This trial was not offered to this account", "NOT_ELIGIBLE")

  const now = Date.now()
  const expiresAtMs = now + Number(campaign.durationMs || 0)
  if (!campaign.durationMs) throw httpError(409, "This trial has an invalid duration", "INVALID_CAMPAIGN_DURATION")
  const responseRef = db.collection(RESPONSES).doc(responseId(campaignId, uid))

  await db.runTransaction(async (transaction) => {
    const responseSnap = await transaction.get(responseRef)
    const existing = responseSnap.exists ? responseSnap.data() : null
    if (existing?.status === "claimed" && Number(existing.expiresAtMs || 0) > now) return
    if (existing?.status === "cancelled") throw httpError(409, "This trial was cancelled. Ask an admin to resend it.", "TRIAL_CANCELLED")

    transaction.set(responseRef, {
      campaignId,
      userId: uid,
      userName: authenticated.userProfile?.name || authenticated.decodedToken.name || "",
      userEmail: authenticated.userProfile?.email || authenticated.decodedToken.email || "",
      status: "claimed",
      claimedAtMs: now,
      expiresAtMs,
      updatedAtMs: now,
      resendCount: Number(existing?.resendCount || 0),
      courseTargets: campaign.courseTargets || [],
    }, { merge: true })

    for (const target of campaign.courseTargets || []) {
      const accessRef = db.collection(TRIAL_ACCESS).doc(trialAccessId(uid, target.source, target.courseId))
      transaction.set(accessRef, {
        userId: uid,
        source: target.source,
        courseId: target.courseId,
        courseTitle: target.title || "Course",
        campaignId,
        status: "active",
        startsAtMs: now,
        expiresAtMs,
        updatedAtMs: now,
      }, { merge: true })
      if (target.source === "cps") {
        const entitlementRef = db.collection(CPS_ENTITLEMENTS).doc(cpsEntitlementId(uid, target.courseId))
        transaction.set(entitlementRef, {
          userId: uid,
          cpsCourseId: target.courseId,
          courseTitle: target.title || "CPS Course",
          source: "cps",
          status: "active",
          accessType: "trial",
          trialCampaignId: campaignId,
          grantedAtMs: now,
          expiresAtMs,
          updatedAtMs: now,
        }, { merge: true })
      }
    }
  })
  await appendEvent(db, { campaignId, userId: uid, action: "claimed", expiresAtMs })
  res.status(200).json({ ok: true, status: "claimed", claimedAtMs: now, expiresAtMs, courseTargets: campaign.courseTargets || [] })
}

async function handleCancel(authenticated, req, res) {
  const uid = authenticated.decodedToken.uid
  const campaignId = text(req.body?.campaignId)
  if (!campaignId) throw httpError(400, "campaignId is required")
  const db = authenticated.db
  const campaign = await loadCampaignOrThrow(db, campaignId)
  if (!isCampaignAudience(campaign, uid, authenticated.userProfile)) throw httpError(403, "This trial was not offered to this account")
  const now = Date.now()
  const responseRef = db.collection(RESPONSES).doc(responseId(campaignId, uid))

  await db.runTransaction(async (transaction) => {
    const responseSnap = await transaction.get(responseRef)
    const existing = responseSnap.exists ? responseSnap.data() : {}
    transaction.set(responseRef, {
      campaignId,
      userId: uid,
      userName: authenticated.userProfile?.name || authenticated.decodedToken.name || "",
      userEmail: authenticated.userProfile?.email || authenticated.decodedToken.email || "",
      status: "cancelled",
      cancelledAtMs: now,
      updatedAtMs: now,
      resendCount: Number(existing?.resendCount || 0),
      courseTargets: campaign.courseTargets || [],
    }, { merge: true })

    if (existing?.status === "claimed") {
      for (const target of campaign.courseTargets || []) {
        transaction.set(db.collection(TRIAL_ACCESS).doc(trialAccessId(uid, target.source, target.courseId)), { status: "revoked", updatedAtMs: now, revokedAtMs: now }, { merge: true })
        if (target.source === "cps") {
          const entitlementRef = db.collection(CPS_ENTITLEMENTS).doc(cpsEntitlementId(uid, target.courseId))
          transaction.set(entitlementRef, { status: "revoked", updatedAtMs: now, revokedAtMs: now }, { merge: true })
        }
      }
    }
  })
  await appendEvent(db, { campaignId, userId: uid, action: "cancelled" })
  res.status(200).json({ ok: true, status: "cancelled" })
}

function requireAdmin(authenticated) {
  if (!isFullAdminProfile(authenticated.userProfile)) throw httpError(403, "Full admin access is required", "ADMIN_REQUIRED")
}

async function handleAdminCreate(authenticated, req, res) {
  requireAdmin(authenticated)
  const allUsers = req.body?.allUsers === true
  const userIds = unique(req.body?.userIds)
  if (!allUsers && userIds.length === 0) throw httpError(400, "Select at least one user or All Users")
  if (userIds.length > MAX_SELECTED_USERS) throw httpError(400, `Select up to ${MAX_SELECTED_USERS} individual users, or use All Users`)
  const courseTargets = normalizeTargets(req.body?.courseTargets)
  if (!courseTargets.length) throw httpError(400, "Select at least one CPS or Easy Education course")
  if (courseTargets.length > MAX_SELECTED_COURSES) throw httpError(400, `A trial can include up to ${MAX_SELECTED_COURSES} courses`)
  const ms = durationMs(req.body?.durationValue, req.body?.durationUnit)
  const now = Date.now()
  const ref = authenticated.db.collection(CAMPAIGNS).doc()
  const payload = {
    title: text(req.body?.title) || "Free trial",
    allUsers,
    userIds: allUsers ? [] : userIds,
    audienceCutoffMs: now,
    courseTargets,
    durationValue: Number(req.body.durationValue),
    durationUnit: text(req.body.durationUnit).toLowerCase(),
    durationMs: ms,
    status: "active",
    createdBy: authenticated.decodedToken.uid,
    createdAtMs: now,
    createdAt: FieldValue.serverTimestamp(),
    updatedAtMs: now,
  }
  await ref.set(payload)
  await appendEvent(authenticated.db, { campaignId: ref.id, userId: "", action: "created", allUsers, userCount: userIds.length })
  res.status(200).json({ ok: true, campaign: { id: ref.id, ...payload } })
}

async function handleAdminList(authenticated, res) {
  requireAdmin(authenticated)
  const [campaignSnap, responseSnap] = await Promise.all([
    authenticated.db.collection(CAMPAIGNS).orderBy("createdAtMs", "desc").limit(100).get(),
    authenticated.db.collection(RESPONSES).orderBy("updatedAtMs", "desc").limit(1000).get(),
  ])
  const campaigns = campaignSnap.docs.map(serializeDoc)
  const responses = responseSnap.docs.map(serializeDoc)
  res.status(200).json({ campaigns, responses, serverTimeMs: Date.now() })
}

async function handleAdminResend(authenticated, req, res) {
  requireAdmin(authenticated)
  const campaignId = text(req.body?.campaignId)
  const userId = text(req.body?.userId)
  if (!campaignId || !userId) throw httpError(400, "campaignId and userId are required")
  const db = authenticated.db
  const campaign = await loadCampaignOrThrow(db, campaignId)
  const ref = db.collection(RESPONSES).doc(responseId(campaignId, userId))
  const snap = await ref.get()
  const existing = snap.exists ? snap.data() : null
  if (!existing || existing.status !== "cancelled") throw httpError(409, "Only cancelled trials can be resent")
  const now = Date.now()
  await ref.set({
    status: "pending",
    claimedAtMs: 0,
    expiresAtMs: 0,
    cancelledAtMs: 0,
    updatedAtMs: now,
    resendCount: Number(existing.resendCount || 0) + 1,
  }, { merge: true })
  for (const target of campaign.courseTargets || []) {
    await db.collection(TRIAL_ACCESS).doc(trialAccessId(userId, target.source, target.courseId)).set({ status: "pending", updatedAtMs: now }, { merge: true })
  }
  await appendEvent(db, { campaignId, userId, action: "reoffered" })
  res.status(200).json({ ok: true, status: "pending" })
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === "OPTIONS") return res.status(204).end()
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" })
  try {
    const authenticated = await requireAuthenticatedUser(req)
    const action = text(req.query?.action || req.body?.action || "mine")
    if (req.method === "GET") {
      if (action === "mine") return await handleMine(authenticated, res)
      if (action === "adminList") return await handleAdminList(authenticated, res)
      throw httpError(400, "Unknown trial read action")
    }
    if (action === "claim") return await handleClaim(authenticated, req, res)
    if (action === "cancel") return await handleCancel(authenticated, req, res)
    if (action === "adminCreate") return await handleAdminCreate(authenticated, req, res)
    if (action === "adminResend") return await handleAdminResend(authenticated, req, res)
    throw httpError(400, "Unknown trial write action")
  } catch (error) {
    console.error("Trial API error", { code: error?.code || "TRIAL_ERROR", message: error?.message })
    res.status(Number(error?.statusCode) || 500).json({ error: error?.message || "Trial service is temporarily unavailable", code: error?.code || "TRIAL_ERROR" })
  }
}
