import {FREE_PLAN, activeDeviceGrant} from './policy.js'

export async function resolveAccess(tx, db, device, {checkBan = true} = {}) {
  const owner = device.uid ? (await tx.get(db.collection('jahajiUsers').doc(device.uid))).data() : null
  if (checkBan && (device.banned || owner?.banned)) {
    throw Object.assign(new Error('This device or account has been banned'), {statusCode: 403})
  }
  const grant = activeDeviceGrant(device) || (owner?.planId ? {planId: owner.planId, expiresAt: null} : null)
  const plan = grant ? await tx.get(db.collection('jahajiPlans').doc(grant.planId)) : null
  if (plan?.exists && !plan.data().deleted) return {plan: {...plan.data(), id: plan.id}, grant}
  if (grant?.orderId && grant.snapshot) return {plan: {...grant.snapshot, id: grant.planId}, grant}
  return {plan: {...FREE_PLAN, id: 'free'}, grant: null}
}
