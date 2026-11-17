import {activeDeviceGrant} from './policy.js'

// Reads happen before callers write. The owner document serializes slot changes.
export async function accountSlots(tx, db, uid, owner, candidate = null) {
  const query = await tx.get(db.collection('jahajiDevices').where('uid', '==', uid))
  const devices = query.docs.map(doc => ({...doc.data(), id: doc.id}))
  if (candidate) {
    const index = devices.findIndex(row => row.id === candidate.id)
    if (index < 0) devices.push(candidate)
    else devices[index] = {...devices[index], ...candidate}
  }
  let limit = 1
  const plans = new Map()
  const grants = [owner?.planId ? {planId: owner.planId} : null, ...devices.map(row => activeDeviceGrant(row))].filter(Boolean)
  for (const grant of grants) {
    if (!plans.has(grant.planId)) plans.set(grant.planId, await tx.get(db.collection('jahajiPlans').doc(grant.planId)))
    const doc = plans.get(grant.planId)
    const plan = doc.exists && !doc.data().deleted ? doc.data() : grant.orderId ? grant.snapshot : null
    const count = plan?.deviceLimit ?? 1
    if (count === -1) limit = -1
    else if (limit !== -1) limit = Math.max(limit, count)
  }
  const enabled = devices.filter(row => !row.accountDisabled).sort((a,b) =>
    Number(!!activeDeviceGrant(b)) - Number(!!activeDeviceGrant(a)) ||
    (a.linkedAt || a.createdAt || 0) - (b.linkedAt || b.createdAt || 0) || a.id.localeCompare(b.id))
  return {limit, used: enabled.length, allowed: (limit === -1 ? enabled : enabled.slice(0, limit)).map(row => row.id)}
}

export function requireDeviceSlot(slots, id, connecting = false) {
  if (!slots.allowed.includes(id) || (connecting && slots.limit !== -1 && slots.used > slots.limit)) throw Object.assign(new Error('Account device limit reached or this device is disabled. Manage devices in Jahaji plans.'), {statusCode: 403})
}
