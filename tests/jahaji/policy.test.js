import test from 'node:test'
import assert from 'node:assert/strict'
import {FREE_PLAN, monthKey, reserveUsage, settleUsage, validatePlan} from '../../server/jahaji/policy.js'

test('monthly reset follows Bangladesh time at the year boundary', () => {
  assert.equal(monthKey(new Date('2026-12-31T17:59:59Z')), '2026-12')
  assert.equal(monthKey(new Date('2026-12-31T18:00:00Z')), '2027-01')
})

test('five concurrent reservations exhaust a feature without consuming another feature', () => {
  let usage = {}
  for (let count = 0; count < 5; count++) usage = reserveUsage(usage, FREE_PLAN, ['download'], 'acs')
  assert.throws(() => reserveUsage(usage, FREE_PLAN, ['download'], 'retina'), /limit reached/)
  assert.equal(reserveUsage(usage, FREE_PLAN, ['watermark'], 'acs').watermark.reserved, 1)
  usage = settleUsage(usage, 'download', false)
  assert.equal(reserveUsage(usage, FREE_PLAN, ['download'], 'retina').download.reserved, 5)
})

test('successful jobs consume allowances while failed jobs release reservations', () => {
  const reserved = reserveUsage({}, FREE_PLAN, ['download', 'watermark'], 'retina')
  const downloaded = settleUsage(reserved, 'download', true)
  const failedWatermark = settleUsage(downloaded, 'watermark', false)
  assert.deepEqual(failedWatermark.download, {used: 1, reserved: 0})
  assert.deepEqual(failedWatermark.watermark, {used: 0, reserved: 0})
})

test('plan limits, disabled features and site restrictions are enforced', () => {
  const plan = validatePlan({...FREE_PLAN, name: 'Custom', limits: {...FREE_PLAN.limits, download: -1, youtube: 0}, sites: ['acs']})
  assert.throws(() => reserveUsage({}, plan, ['download'], 'retina'), /does not include/)
  assert.throws(() => reserveUsage({}, plan, ['youtube'], 'acs'), /limit reached/)
  assert.equal(reserveUsage({download: {used: 99, reserved: 50}}, plan, ['download'], 'acs').download.reserved, 51)
  assert.throws(() => validatePlan({...plan, limits: {...plan.limits, download: NaN}}), /whole numbers/)
  assert.throws(() => validatePlan({...plan, sites: ['unknown']}), /supported/)
})
