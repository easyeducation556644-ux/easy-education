import { createHash } from 'crypto'
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const SHARD_COUNT = 32
const COLLECTION = 'firestoreReadUsageDaily'

function ensureAdminApp() {
  let app = getApps().find((item) => item.name === 'read-usage')
  if (!app) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : null

    app = initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      projectId: serviceAccount?.project_id || 'easy-education-real',
    }, 'read-usage')
  }
  return { db: getFirestore(app), adminAuth: getAuth(app) }
}

function hash(value = '') {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 16)
}

function cleanText(value, fallback = 'unknown', max = 180) {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace(/[\u0000-\u001f]/g, '').trim()
  return (cleaned || fallback).slice(0, max)
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validHour(value) {
  return typeof value === 'string' && /^(0\d|1\d|2[0-3])$/.test(value)
}

function numeric(value, max = 250000) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(Math.round(number), max)
}

async function decodeOptionalUser(req, adminAuth) {
  const authHeader = req.headers?.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return null
  try {
    return await adminAuth.verifyIdToken(authHeader.slice(7))
  } catch (_) {
    return null
  }
}

function addMetric(map, key, metadata, reads, calls, lastSeen) {
  if (!map[key]) map[key] = { ...metadata, reads: 0, calls: 0, lastSeen: null }
  map[key].reads += reads
  map[key].calls += calls
  if (lastSeen && (!map[key].lastSeen || lastSeen > map[key].lastSeen)) map[key].lastSeen = lastSeen
}

function groupEvents(events, actor, sessionId) {
  const grouped = new Map()
  const shard = parseInt(hash(sessionId).slice(0, 8), 16) % SHARD_COUNT
  const actorId = actor?.uid || `anon:${hash(sessionId)}`
  const actorEmail = actor?.email || ''
  const actorName = actor?.name || actor?.displayName || (actor ? 'User' : 'Anonymous')

  for (const raw of events.slice(0, 50)) {
    const usageDay = validDay(raw?.usageDay) ? raw.usageDay : null
    const hour = validHour(raw?.hour) ? raw.hour : null
    const reads = numeric(raw?.reads)
    const calls = numeric(raw?.calls, 10000)
    if (!usageDay || !hour || !reads || !calls) continue

    const page = cleanText(raw.page, '/', 140)
    const operation = cleanText(raw.operation, 'unknown', 60)
    const source = cleanText(raw.source, 'unknown', 180)
    const lastSeen = cleanText(raw.lastSeen, new Date().toISOString(), 40)
    const groupKey = `${usageDay}|${shard}`

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        usageDay,
        shard,
        totalReads: 0,
        totalCalls: 0,
        pages: {},
        sources: {},
        users: {},
        hours: {},
        lastSeen,
      })
    }

    const group = grouped.get(groupKey)
    group.totalReads += reads
    group.totalCalls += calls
    if (lastSeen > group.lastSeen) group.lastSeen = lastSeen

    const pageKey = hash(page)
    addMetric(group.pages, pageKey, { label: page }, reads, calls, lastSeen)

    const sourceKey = hash(`${page}|${operation}|${source}`)
    addMetric(group.sources, sourceKey, { page, operation, source }, reads, calls, lastSeen)

    const userKey = hash(actorId)
    addMetric(
      group.users,
      userKey,
      { uid: actorId, email: actorEmail, name: actorName },
      reads,
      calls,
      lastSeen,
    )

    addMetric(group.hours, `h${hour}`, { hour }, reads, calls, lastSeen)
  }

  return grouped
}

function toFirestorePayload(group) {
  const convertMetricMap = (map) => Object.fromEntries(
    Object.entries(map).map(([key, item]) => [
      key,
      {
        ...item,
        reads: FieldValue.increment(item.reads),
        calls: FieldValue.increment(item.calls),
      },
    ]),
  )

  return {
    usageDay: group.usageDay,
    shard: group.shard,
    totalReads: FieldValue.increment(group.totalReads),
    totalCalls: FieldValue.increment(group.totalCalls),
    pages: convertMetricMap(group.pages),
    sources: convertMetricMap(group.sources),
    users: convertMetricMap(group.users),
    hours: convertMetricMap(group.hours),
    lastSeen: group.lastSeen,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

async function handlePost(req, res) {
  const { db, adminAuth } = ensureAdminApp()
  const sessionId = cleanText(req.body?.sessionId, '', 100)
  const events = Array.isArray(req.body?.events) ? req.body.events : []
  if (!sessionId || events.length === 0) return res.status(204).end()

  const actor = await decodeOptionalUser(req, adminAuth)
  const grouped = groupEvents(events, actor, sessionId)
  if (grouped.size === 0) return res.status(204).end()

  const batch = db.batch()
  for (const group of grouped.values()) {
    const id = `${group.usageDay}-${String(group.shard).padStart(2, '0')}`
    batch.set(db.collection(COLLECTION).doc(id), toFirestorePayload(group), { merge: true })
  }
  await batch.commit()
  return res.status(204).end()
}

function mergeMetric(target, source) {
  for (const [key, item] of Object.entries(source || {})) {
    if (!target[key]) target[key] = { ...item, reads: 0, calls: 0 }
    target[key].reads += Number(item.reads || 0)
    target[key].calls += Number(item.calls || 0)
    if (item.lastSeen && (!target[key].lastSeen || item.lastSeen > target[key].lastSeen)) {
      target[key].lastSeen = item.lastSeen
    }
  }
}

async function requireAdmin(req, adminAuth, db) {
  const decoded = await decodeOptionalUser(req, adminAuth)
  if (!decoded?.uid) return null
  const userDoc = await db.collection('users').doc(decoded.uid).get()
  if (!userDoc.exists) return null
  const profile = userDoc.data()
  if (profile?.role !== 'admin' || profile?.adminAccess?.mode === 'limited') return null
  return decoded
}

async function handleGet(req, res) {
  const { db, adminAuth } = ensureAdminApp()
  const admin = await requireAdmin(req, adminAuth, db)
  if (!admin) return res.status(403).json({ error: 'Admin access required' })

  const usageDay = validDay(req.query?.day) ? req.query.day : null
  if (!usageDay) return res.status(400).json({ error: 'Valid day is required' })

  const snapshot = await db.collection(COLLECTION).where('usageDay', '==', usageDay).get()
  const combined = { totalReads: 0, totalCalls: 0, pages: {}, sources: {}, users: {}, hours: {}, lastSeen: null }

  snapshot.docs.forEach((doc) => {
    const data = doc.data()
    combined.totalReads += Number(data.totalReads || 0)
    combined.totalCalls += Number(data.totalCalls || 0)
    mergeMetric(combined.pages, data.pages)
    mergeMetric(combined.sources, data.sources)
    mergeMetric(combined.users, data.users)
    mergeMetric(combined.hours, data.hours)
    if (data.lastSeen && (!combined.lastSeen || data.lastSeen > combined.lastSeen)) combined.lastSeen = data.lastSeen
  })

  const sortReads = (items) => items.sort((a, b) => b.reads - a.reads)
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const key = `h${String(hour).padStart(2, '0')}`
    return combined.hours[key] || { hour: String(hour).padStart(2, '0'), reads: 0, calls: 0 }
  })

  return res.status(200).json({
    usageDay,
    boundary: '14:00 Asia/Dhaka',
    totalReads: combined.totalReads,
    totalCalls: combined.totalCalls,
    pages: sortReads(Object.values(combined.pages)),
    sources: sortReads(Object.values(combined.sources)),
    users: sortReads(Object.values(combined.users)),
    hours,
    lastSeen: combined.lastSeen,
    shards: snapshot.size,
    note: 'App-attributed Firestore document-read meter. Query index-entry billing and uninstrumented server-side Admin SDK reads are not included.',
  })
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') return await handlePost(req, res)
    if (req.method === 'GET') return await handleGet(req, res)
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (error) {
    console.error('Firestore read usage controller error:', error)
    return res.status(500).json({ error: 'Failed to process Firestore read usage' })
  }
}
