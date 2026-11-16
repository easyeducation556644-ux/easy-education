import test from 'node:test'
import assert from 'node:assert/strict'
import {Store} from './store.js'
import {FREE_PLAN, activeDeviceGrant, validatePlan} from '../../server/jahaji/policy.js'
import {resolveAccess} from '../../server/jahaji/access-policy.js'
import {pricedJahajiCart, fulfillJahajiOrder, activateJahajiPurchase} from '../../server/jahaji/checkout.js'

const deviceId = 'test-computer'
const uid = 'test-customer'
const first = 'a'.repeat(64), second = 'b'.repeat(64), third = 'c'.repeat(64)
function fixture() {
  const db = new Store()
  const plan = {...FREE_PLAN, name: 'Gold', limits: {...FREE_PLAN.limits, download: 100}, price: 299, durationDays: 30, published: true, deleted: false}
  db.rows.set('jahajiPlans/gold-plan', plan)
  db.rows.set('jahajiDevices/' + deviceId, {uid, name: 'My PC'})
  db.rows.set('jahajiUsers/' + uid, {name: 'Customer'})
  return {db, plan}
}
function order(db, id, plan, overrides = {}) {
  db.rows.set('ekmivoOrders/' + id, {id, userId: uid, kind: 'jahaji', status: 'pending',
    jahaji: {deviceId, planId: 'gold-plan', name: plan.name, durationDays: plan.durationDays,
      snapshot: {name: plan.name, limits: plan.limits, sites: plan.sites}, ...overrides}})
  return db.collection('ekmivoOrders').doc(id)
}

test('published price and device ownership are checked server side', async () => {
  const {db} = fixture()
  const metadata = {planId: 'gold-plan', deviceId, price: .01}
  const cart = await pricedJahajiCart(db, metadata, {uid})
  assert.equal(cart.amountMinor, 29900)
  await assert.rejects(() => pricedJahajiCart(db, metadata, {uid: 'someone-else'}), /Connect this device/)
  db.rows.get('jahajiPlans/gold-plan').published = false
  await assert.rejects(() => pricedJahajiCart(db, metadata, {uid}), /not available/)
  assert.throws(() => validatePlan({...FREE_PLAN, published: true}), /Set a price/)
})

test('Free upgrade activates once and preserves already used monthly allowance', async () => {
  const {db, plan} = fixture()
  db.rows.set('jahajiDevices/' + deviceId + '/months/2026-11', {usage: {download: {used: 3, reserved: 0}}})
  const ref = order(db, first, plan)
  const result = await fulfillJahajiOrder(db, ref)
  assert.equal(result.state, 'active')
  assert.deepEqual(await fulfillJahajiOrder(db, ref), result)
  assert.equal(db.rows.get('jahajiDevices/' + deviceId).planExpiresAt, result.expiresAt)
  assert.equal(db.rows.get('jahajiDevices/' + deviceId + '/months/2026-11').usage.download.used, 3)
})

test('subscribers choose activation after payment and queued access starts at expiry', async () => {
  const {db, plan} = fixture()
  await fulfillJahajiOrder(db, order(db, first, plan))
  const expires = db.rows.get('jahajiDevices/' + deviceId).planExpiresAt
  assert.equal((await fulfillJahajiOrder(db, order(db, second, plan))).state, 'choice_required')
  assert.equal(db.rows.get('jahajiDevices/' + deviceId).purchaseId, first)
  const scheduled = await activateJahajiPurchase(db, {uid}, second, 'after')
  assert.equal(scheduled.startsAt, expires)
  assert.deepEqual(await activateJahajiPurchase(db, {uid}, second, 'after'), scheduled)
  assert.equal(activeDeviceGrant(db.rows.get('jahajiDevices/' + deviceId), expires + 1).orderId, second)
  await assert.rejects(() => activateJahajiPurchase(db, {uid: 'other-user'}, second, 'now'), /not found/)
})

test('scheduling after a currently active queued plan keeps its access intact', async t => {
  const {db, plan} = fixture()
  await fulfillJahajiOrder(db, order(db, first, plan))
  await fulfillJahajiOrder(db, order(db, second, plan))
  const scheduled = await activateJahajiPurchase(db, {uid}, second, 'after')
  t.mock.method(Date, 'now', () => scheduled.startsAt + 1000)
  await fulfillJahajiOrder(db, order(db, third, plan))
  await activateJahajiPurchase(db, {uid}, third, 'after')
  assert.equal(activeDeviceGrant(db.rows.get('jahajiDevices/' + deviceId)).orderId, second)
})

test('Activate now preserves and reschedules paid future plans', async () => {
  const {db, plan} = fixture()
  await fulfillJahajiOrder(db, order(db, first, plan))
  await fulfillJahajiOrder(db, order(db, second, plan))
  await activateJahajiPurchase(db, {uid}, second, 'after')
  await fulfillJahajiOrder(db, order(db, third, plan))
  const active = await activateJahajiPurchase(db, {uid}, third, 'now')
  const device = db.rows.get('jahajiDevices/' + deviceId)
  assert.equal(device.purchaseId, third)
  assert.equal(device.queuedPlans[0].orderId, second)
  assert.equal(device.queuedPlans[0].startsAt, active.expiresAt)
})

test('paid snapshots survive plan archival until expiry; then access falls back to Free', async () => {
  const {db, plan} = fixture()
  const receipt = await fulfillJahajiOrder(db, order(db, first, plan))
  db.rows.get('jahajiPlans/gold-plan').deleted = true
  const device = db.rows.get('jahajiDevices/' + deviceId)
  const access = await db.runTransaction(tx => resolveAccess(tx, db, device))
  assert.equal(access.plan.id, 'gold-plan')
  device.planExpiresAt = Date.now() - 1
  const expired = await db.runTransaction(tx => resolveAccess(tx, db, device))
  assert.equal(expired.plan.id, 'free')
  assert.ok(receipt.expiresAt > Date.now())
})
