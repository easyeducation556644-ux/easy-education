import {resolveAccess} from '../jahaji/access-policy.js'
import {activateJahajiPurchase} from '../jahaji/checkout.js'
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto'
import {getAdminServices, requireAuthenticatedUser, isFullAdminProfile} from '../../api/utils/firebase-admin.js'
import {FREE_PLAN, FEATURES, monthKey, reserveUsage, settleUsage, validatePlan} from '../jahaji/policy.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const fail = (message, statusCode = 400) => {throw Object.assign(new Error(message), {statusCode})}
const cleanId = value => /^[a-zA-Z0-9_-]{8,128}$/.test(value || '') ? value : fail('Invalid identifier')
const sameSecret = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const publicDevice = (id, value) => ({id, name: value.name, email: value.email || '', userName: value.userName || 'Guest',
  uid: value.uid || null, planExpiresAt: value.planExpiresAt || null, banned: !!value.banned, planId: value.planId || null, lastSeen: value.lastSeen, createdAt: value.createdAt})

async function deviceAuth(req, db) {
  const id = cleanId(req.headers['x-jahaji-device'])
  const secret = String(req.headers['x-jahaji-secret'] || '')
  if (!/^[a-f0-9]{64}$/.test(secret)) fail('Device authentication required', 401)
  const ref = db.collection('jahajiDevices').doc(id)
  const snap = await ref.get()
  if (!snap.exists || !sameSecret(snap.data().secretHash, hash(secret))) fail('Device authentication failed', 401)
  return {ref, data: snap.data(), id}
}

async function adminAuth(req, db, authenticate) {
  const session = await authenticate(req)
  const uid = session.decodedToken.uid
  const member = await db.collection('jahajiStaff').doc(uid).get()
  const full = isFullAdminProfile(session.userProfile)
  const role = full ? 'owner' : member.data()?.role
  if (!['owner', 'manager', 'support', 'viewer'].includes(role)) fail('Jahaji admin access required', 403)
  return {...session, role, uid, full}
}

async function policy(tx, db, device) {
  return (await resolveAccess(tx, db, device)).plan
}

async function snapshot(db, device) {
  return db.runTransaction(async tx => {
    const current = (await tx.get(device.ref)).data()
    const {plan, grant} = await resolveAccess(tx, db, current)
    const month = monthKey()
    const usage = (await tx.get(device.ref.collection('months').doc(month))).data()?.usage || {}
    if (Date.now() - current.lastSeen > 300000) tx.update(device.ref, {lastSeen: Date.now()})
    return {device: {...publicDevice(device.id, current), planExpiresAt: grant?.expiresAt || null},
      plan, month, usage, features: FEATURES,
      scheduled: (current.queuedPlans || []).filter(row => row.startsAt > Date.now()).map(row => ({
        name: row.snapshot?.name || 'Jahaji plan', startsAt: row.startsAt, expiresAt: row.expiresAt,
      }))}
  })
}

async function adminRequest(req, res, db, action, authenticate) {
  const admin = await adminAuth(req, db, authenticate)
  const body = req.body || {}
  if (req.method === 'GET') {
    if (action === 'access') return res.json({role: admin.role, full: admin.full})
    if (action === 'overview') {
      const [devices, users, plans, banned] = await Promise.all([
        db.collection('jahajiDevices').count().get(),
        db.collection('jahajiUsers').count().get(),
        db.collection('jahajiPlans').where('deleted', '==', false).count().get(),
        db.collection('jahajiDevices').where('banned', '==', true).count().get(),
      ])
      return res.json({devices: devices.data().count, users: users.data().count, plans: plans.data().count, banned: banned.data().count})
    }
    const collections = {devices: 'jahajiDevices', users: 'jahajiUsers', plans: 'jahajiPlans', staff: 'jahajiStaff'}
    if (action === 'staff' && !admin.full) fail('Only full admins can manage staff', 403)
    const name = collections[action]
    if (!name) fail('Unknown admin page')
    const query = db.collection(name).orderBy('__name__').limit(51)
    const docs = await (req.query.after ? query.startAfter(cleanId(req.query.after)) : query).get()
    const page = docs.docs.slice(0, 50)
    const rows = await Promise.all(page.map(async doc => {
      const value = doc.data()
      if (action === 'devices') {
        const usage = (await doc.ref.collection('months').doc(monthKey()).get()).data()?.usage || {}
        return {...publicDevice(doc.id, value), usage}
      }
      if (action === 'plans') return {id: doc.id, ...value}
      return {id: doc.id, name: value.name || value.email || 'Unnamed user', email: value.email || '',
        banned: !!value.banned, planId: value.planId || null, role: value.role || null}
    }))
    return res.json({rows, next: docs.size > 50 ? page.at(-1).id : null, role: admin.role, full: admin.full})
  }
  if (req.method !== 'POST') fail('Method not allowed', 405)
  if (admin.role === 'viewer') fail('Read-only access', 403)
  const audit = {actor: admin.uid, actorName: admin.userProfile.name || admin.decodedToken.email || 'Admin', at: Date.now()}
  if (action === 'plan') {
    if (!['owner', 'manager'].includes(admin.role)) fail('Plan management access required', 403)
    const ref = body.id ? db.collection('jahajiPlans').doc(cleanId(body.id)) : db.collection('jahajiPlans').doc()
    // Archiving preserves assignments and usage history. Assigned users fall back to Free.
    if (body.remove) await ref.set({deleted: true, audit}, {merge: true})
    else await ref.set({...validatePlan(body), deleted: false, audit})
    return res.json({ok: true, id: ref.id})
  }
  if (action === 'user' || action === 'device') {
    const collection = action === 'user' ? 'jahajiUsers' : 'jahajiDevices'
    const ref = db.collection(collection).doc(cleanId(body.id))
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (!snap.exists) fail('User or device not found', 404)
      const patch = {audit}
      if (typeof body.banned === 'boolean') patch.banned = body.banned
      if ('planId' in body) {
        if (!['owner', 'manager'].includes(admin.role)) fail('Plan access required', 403)
        patch.planId = body.planId ? cleanId(body.planId) : null
        if (action === 'device') Object.assign(patch, {planExpiresAt: null, purchaseId: null, planSnapshot: null})
        if (patch.planId) {
          const plan = await tx.get(db.collection('jahajiPlans').doc(patch.planId))
          if (!plan.exists || plan.data().deleted) fail('Plan not found', 404)
        }
      }
      tx.update(ref, patch)
    })
    return res.json({ok: true})
  }
  if (action === 'staff') {
    if (!admin.full) fail('Only full admins can manage staff', 403)
    const email = String(body.email || '').trim().toLowerCase()
    const {auth} = getAdminServices()
    const account = await auth.getUserByEmail(email).catch(() => fail('Easy Education account not found', 404))
    const ref = db.collection('jahajiStaff').doc(account.uid)
    if (body.remove) await ref.delete()
    else {
      if (!['manager', 'support', 'viewer'].includes(body.role)) fail('Invalid role')
      await ref.set({name: account.displayName || email, email, role: body.role, audit})
    }
    return res.json({ok: true})
  }
  fail('Unknown admin action')
}

export default async function jahajiHandler(req, res, services) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const {db} = services?.db ? services : getAdminServices()
    const authenticate = services?.db && services?.authenticate ? services.authenticate : requireAuthenticatedUser
    const action = String(req.query?.action || 'status')
    if (action === 'catalog' && req.method === 'GET') {
      const plans = await db.collection('jahajiPlans').where('published', '==', true).get()
      return res.json({plans: plans.docs.filter(doc => !doc.data().deleted).map(doc => {
        const plan = doc.data()
        return {id: doc.id, name: plan.name, price: plan.price, durationDays: plan.durationDays,
          limits: plan.limits, sites: plan.sites}
      })})
    }
    if (action === 'mine' && req.method === 'GET') {
      const session = await authenticate(req)
      const devices = await db.collection('jahajiDevices').where('uid', '==', session.decodedToken.uid).get()
      const orders = await db.collection('ekmivoOrders').where('userId', '==', session.decodedToken.uid).get()
      return res.json({
        devices: await Promise.all(devices.docs.map(async doc => {
          try {return await snapshot(db, {id: doc.id, ref: doc.ref})}
          catch (error) {
            if (error.statusCode !== 403) throw error
            return {device: publicDevice(doc.id, doc.data()), plan: {...FREE_PLAN, id: 'free'}, blocked: true, scheduled: []}
          }
        })),
        purchases: orders.docs.filter(doc => doc.data().kind === 'jahaji').map(doc => {
          const row = doc.data()
          return {id: doc.id, name: row.jahaji.name, deviceName: row.jahaji.deviceName,
            amount: row.amountMinor / 100, status: row.status, createdAt: row.createdAt, entitlement: row.entitlement || null}
        }).sort((a,b) => b.createdAt - a.createdAt),
      })
    }
    if (action === 'activate' && req.method === 'POST') {
      const session = await authenticate(req)
      const entitlement = await activateJahajiPurchase(db, session.decodedToken, req.body?.orderId, req.body?.timing)
      return res.json({ok: true, entitlement})
    }
    if (action.startsWith('admin-')) return await adminRequest(req, res, db, action.slice(6), authenticate)
    if (action === 'register' && req.method === 'POST') {
      const body = req.body || {}
      const id = cleanId(body.id)
      if (!/^[a-f0-9]{64}$/.test(body.secret || '')) fail('Invalid device proof')
      const ref = db.collection('jahajiDevices').doc(id)
      await db.runTransaction(async tx => {
        const existing = await tx.get(ref)
        if (existing.exists) {
          if (!sameSecret(existing.data().secretHash, hash(body.secret))) fail('Device proof changed. Contact support to recover this device.', 409)
          tx.update(ref, {lastSeen: Date.now()})
        } else tx.create(ref, {secretHash: hash(body.secret), name: String(body.name || 'Windows PC').slice(0, 80), createdAt: Date.now(), lastSeen: Date.now(), banned: false})
      })
      return res.json({ok: true})
    }
    if (action === 'link' && req.method === 'POST') {
      const session = await authenticate(req)
      const code = String(req.body?.code || '')
      if (!/^[a-f0-9]{64}$/.test(code)) fail('Invalid connection code')
      const ref = db.collection('jahajiPairings').doc(hash(code))
      await db.runTransaction(async tx => {
        const pairing = await tx.get(ref)
        if (!pairing.exists || pairing.data().expires < Date.now() || pairing.data().used) fail('Connection expired. Start sign in again.', 410)
        const uid = session.decodedToken.uid
        const owner = db.collection('jahajiUsers').doc(uid)
        const previous = await tx.get(owner)
        const deviceRef = db.collection('jahajiDevices').doc(pairing.data().deviceId)
        const device = await tx.get(deviceRef)
        if (device.data()?.uid && device.data().uid !== uid) fail('This device is linked to another account. Contact support.', 409)
        if (device.data()?.banned || previous.data()?.banned) fail('Account or device is banned', 403)
        const email = session.decodedToken.email || ''
        const name = session.userProfile.name || session.decodedToken.name || email
        tx.set(owner, {name, email, lastSeen: Date.now(), ...(!previous.exists ? {createdAt: Date.now(), banned: false} : {})}, {merge: true})
        tx.update(deviceRef, {uid, email, userName: name, linkedAt: Date.now()})
        tx.update(ref, {used: true})
      })
      return res.json({ok: true, deviceId: (await ref.get()).data().deviceId})
    }
    const device = await deviceAuth(req, db)
    if (action === 'status' && req.method === 'GET') return res.json(await snapshot(db, device))
    if (action === 'reconcile' && req.method === 'POST') {
      const events = req.body?.events
      if (!Array.isArray(events) || events.length > 25) fail('Invalid usage history')
      for (const event of events) {
        cleanId(event.operation)
        if (!FEATURES.includes(event.feature) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(event.month || '') || event.month > monthKey()) fail('Invalid usage event')
      }
      // Each completed operation is imported once. Removing local rows never subtracts usage.
      for (const event of events) {
        const ref = device.ref.collection('operations').doc(event.operation)
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref)
          const previous = snap.data()
          if (previous && !previous.features.includes(event.feature)) fail('Usage operation does not match', 409)
          if (previous?.states[event.feature] === 'complete') return
          const period = previous?.month || event.month
          const monthRef = device.ref.collection('months').doc(period)
          const month = await tx.get(monthRef)
          const usage = month.data()?.usage || {}
          const count = usage[event.feature] || {used: 0, reserved: 0}
          const wasReserved = previous?.states[event.feature] === 'reserved'
          tx.set(monthRef, {usage: {...usage, [event.feature]: {
            used: count.used + 1, reserved: Math.max(0, count.reserved - (wasReserved ? 1 : 0)),
          }}}, {merge: true})
          tx.set(ref, {...(previous || {features: [event.feature], site: 'legacy', month: period}),
            states: {...previous?.states, [event.feature]: 'complete'}, updatedAt: Date.now()})
        })
      }
      return res.json({ok: true})
    }
    if (action === 'pair' && req.method === 'POST') {
      if (device.data.uid) return res.json({linked: true})
      const code = randomBytes(32).toString('hex')
      await db.collection('jahajiPairings').doc(hash(code)).create({deviceId: device.id, expires: Date.now() + 300000, used: false})
      return res.json({code})
    }
    if (action === 'reserve' && req.method === 'POST') {
      const operation = cleanId(req.body?.operation)
      if (!Array.isArray(req.body?.features) || !req.body.features.length || req.body.features.length > FEATURES.length || req.body.features.some(key => !FEATURES.includes(key))) fail('Invalid features')
      const features = [...new Set(req.body.features)]
      const site = req.body?.site
      const ref = device.ref.collection('operations').doc(operation)
      const result = await db.runTransaction(async tx => {
        const current = (await tx.get(device.ref)).data()
        const plan = await policy(tx, db, current)
        const previous = await tx.get(ref)
        const period = previous.data()?.states && Object.values(previous.data().states).some(state => ['complete', 'reserved'].includes(state)) ? previous.data().month : monthKey()
        const monthRef = device.ref.collection('months').doc(period)
        const month = await tx.get(monthRef)
        const saved = previous.data()
        if (saved && (JSON.stringify(saved.features) !== JSON.stringify(features) || saved.site !== site && saved.site !== 'legacy')) fail('Operation does not match its reservation', 409)
        const states = saved?.states || {}
        const pending = features.filter(key => states[key] !== 'complete' && states[key] !== 'reserved')
        const usage = pending.length ? reserveUsage(month.data()?.usage, plan, pending, site) : month.data()?.usage || {}
        for (const key of pending) states[key] = 'reserved'
        tx.set(monthRef, {usage}, {merge: true})
        tx.set(ref, {features, states, site, month: period, updatedAt: Date.now()})
        return {ok: true, states, month: period}
      })
      return res.json(result)
    }
    if (action === 'settle' && req.method === 'POST') {
      const operation = cleanId(req.body?.operation)
      const feature = req.body?.feature
      if (!FEATURES.includes(feature) || typeof req.body?.success !== 'boolean') fail('Invalid result')
      const ref = device.ref.collection('operations').doc(operation)
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists) return
        const record = snap.data()
        if (record.states[feature] !== 'reserved') return
        const monthRef = device.ref.collection('months').doc(record.month)
        const month = await tx.get(monthRef)
        tx.set(monthRef, {usage: settleUsage(month.data()?.usage || {}, feature, req.body.success)}, {merge: true})
        tx.update(ref, {states: {...record.states, [feature]: req.body.success ? 'complete' : 'released'}, updatedAt: Date.now()})
      })
      return res.json({ok: true})
    }
    fail('Unknown action or method', 405)
  } catch (error) {
    const status = error.statusCode || 503
    return res.status(status).json({ok: false, message: status < 500 ? error.message : 'Jahaji service is temporarily unavailable'})
  }
}
