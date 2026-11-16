import {minorUnits, paymentError} from '../payments/ekmivo-contract.js'
import {resolveAccess} from './access-policy.js'

const DAY = 86400000
const idPattern = /^[a-zA-Z0-9_-]{8,128}$/

export async function pricedJahajiCart(db, metadata, user) {
  if (!idPattern.test(metadata?.planId || '') || !idPattern.test(metadata?.deviceId || '')) throw paymentError('Choose a Jahaji plan and device')
  const [planDoc, deviceDoc] = await Promise.all([
    db.collection('jahajiPlans').doc(metadata.planId).get(),
    db.collection('jahajiDevices').doc(metadata.deviceId).get(),
  ])
  const plan = planDoc.data(), device = deviceDoc.data()
  if (!deviceDoc.exists || device.uid !== user.uid) throw paymentError('Connect this device to your Easy Education account before buying', 403)
  const owner = (await db.collection('jahajiUsers').doc(user.uid).get()).data()
  if (device.banned || owner?.banned) throw paymentError('This account or device is banned', 403)
  if (!planDoc.exists || plan.deleted || !plan.published) throw paymentError('This plan is not available for purchase')
  if (!Number.isInteger(plan.durationDays) || plan.durationDays < 1 || plan.durationDays > 3650) throw paymentError('This plan has no valid duration')
  const amountMinor = minorUnits(plan.price)
  if (amountMinor <= 0) throw paymentError('This plan has no purchase price')
  const snapshot = {name: plan.name, limits: plan.limits, sites: plan.sites}
  return {kind: 'jahaji', courses: [], subtotal: amountMinor / 100, discount: 0, couponCode: '', amountMinor,
    jahaji: {planId: metadata.planId, deviceId: metadata.deviceId, deviceName: device.name,
      name: plan.name, durationDays: plan.durationDays, snapshot}}
}

function installNow(device, purchase, orderId, now) {
  return {planId: purchase.planId, planExpiresAt: now + purchase.durationDays * DAY,
    planSnapshot: purchase.snapshot, purchaseId: orderId, queuedPlans: device.queuedPlans || []}
}

async function installWithQueue(tx, db, deviceRef, device, purchase, orderId, now) {
  const future = (device.queuedPlans || []).filter(plan => plan.startsAt > now).sort((a,b) => a.startsAt - b.startsAt)
  const receipts = []
  for (const plan of future) receipts.push(await tx.get(db.collection('ekmivoOrders').doc(plan.orderId)))
  const installed = installNow(device, purchase, orderId, now)
  let startsAt = installed.planExpiresAt
  installed.queuedPlans = future.map((plan, index) => {
    const updated = {...plan, startsAt, expiresAt: startsAt + plan.expiresAt - plan.startsAt}
    startsAt = updated.expiresAt
    if (receipts[index].exists) tx.update(db.collection('ekmivoOrders').doc(plan.orderId), {
      entitlement: {...receipts[index].data().entitlement, startsAt: updated.startsAt, expiresAt: updated.expiresAt},
    })
    return updated
  })
  tx.update(deviceRef, installed)
  return installed
}

export async function fulfillJahajiOrder(db, ref) {
  return db.runTransaction(async tx => {
    const order = (await tx.get(ref)).data()
    if (order.status === 'fulfilled') return order.entitlement
    const deviceRef = db.collection('jahajiDevices').doc(order.jahaji.deviceId)
    const device = (await tx.get(deviceRef)).data()
    if (!device || device.uid !== order.userId) throw paymentError('The purchased device needs account recovery. Contact support.', 409)
    const current = await resolveAccess(tx, db, device, {checkBan: false})
    const now = Date.now()
    const entitlement = {state: current.plan.id === 'free' ? 'active' : 'choice_required',
      name: order.jahaji.name, deviceId: order.jahaji.deviceId, deviceName: device.name,
      durationDays: order.jahaji.durationDays}
    if (entitlement.state === 'active') {
      const installed = await installWithQueue(tx, db, deviceRef, device, order.jahaji, order.id, now)
      Object.assign(entitlement, {startsAt: now, expiresAt: installed.planExpiresAt})
    }
    tx.update(ref, {status: 'fulfilled', fulfilledAt: now, fulfilLeaseUntil: 0, entitlement})
    return entitlement
  })
}

export function jahajiPaymentResult(order, entitlement) {
  return {success: true, verified: true, payment: {transaction_id: order.invoiceId, invoice_id: order.invoiceId,
    amount: order.amountMinor / 100, currency: 'BDT', metadata: {courses: [], jahaji: {...entitlement, orderId: order.id}}}}
}

export async function activateJahajiPurchase(db, user, orderId, timing) {
  if (!/^[a-f0-9]{64}$/.test(orderId || '') || !['now', 'after'].includes(timing)) throw paymentError('Choose a valid activation option')
  const ref = db.collection('ekmivoOrders').doc(orderId)
  return db.runTransaction(async tx => {
    const order = (await tx.get(ref)).data()
    if (!order || order.kind !== 'jahaji' || order.userId !== user.uid) throw paymentError('Purchase not found', 404)
    if (order.status !== 'fulfilled') throw paymentError('Payment must be verified before activation', 409)
    if (order.entitlement.state !== 'choice_required') return order.entitlement
    const deviceRef = db.collection('jahajiDevices').doc(order.jahaji.deviceId)
    const device = (await tx.get(deviceRef)).data()
    if (!device || device.uid !== user.uid) throw paymentError('Device ownership does not match', 403)
    const current = await resolveAccess(tx, db, device, {checkBan: false})
    const now = Date.now()
    const future = (device.queuedPlans || []).filter(plan => plan.startsAt > now).sort((a, b) => a.startsAt - b.startsAt)
    if (timing === 'after' && current.plan.id !== 'free' && !current.grant?.expiresAt) {
      throw paymentError('The current plan has no expiry date. Choose Activate now.')
    }
    const entitlement = {...order.entitlement}
    if (timing === 'after' && current.plan.id !== 'free') {
      const startsAt = Math.max(current.grant.expiresAt, ...future.map(plan => plan.expiresAt))
      const queued = {planId: order.jahaji.planId, snapshot: order.jahaji.snapshot, orderId,
        startsAt, expiresAt: startsAt + order.jahaji.durationDays * DAY}
      tx.update(deviceRef, {queuedPlans: [...(device.queuedPlans || []).filter(plan => plan.expiresAt > now), queued]})
      Object.assign(entitlement, {state: 'scheduled', startsAt, expiresAt: queued.expiresAt})
    } else {
      const installed = await installWithQueue(tx, db, deviceRef, device, order.jahaji, orderId, now)
      Object.assign(entitlement, {state: 'active', startsAt: now, expiresAt: installed.planExpiresAt})
    }
    tx.update(ref, {entitlement})
    return entitlement
  })
}
