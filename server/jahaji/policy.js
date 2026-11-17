export const FEATURES = ['download', 'watermark', 'telegram', 'youtube', 'scan', 'import', 'account']
export const SITES = ['acs', 'retina', 'youtube', 'vimeo', 'vidinfra', 'other']
export const FREE_PLAN = Object.freeze({name: 'Free', deviceLimit: 1, limits: Object.fromEntries(FEATURES.map(key => [key, 5])), sites: SITES})

export function monthKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit'}).format(now)
}

export function validatePlan(value) {
  const name = String(value.name || '').trim()
  if (!name || name.length > 80) throw Object.assign(new Error('Enter a plan name, up to 80 characters'), {statusCode: 400})
  const limits = {}
  for (const key of FEATURES) {
    const limit = value.limits?.[key]
    if (!Number.isSafeInteger(limit) || limit < -1 || limit > 1000000) {
      throw Object.assign(new Error('Limits must be whole numbers. Choose Unlimited or enter a value from 0 to 1,000,000.'), {statusCode: 400})
    }
    limits[key] = limit
  }
  if (!Array.isArray(value.sites) || value.sites.some(site => !SITES.includes(site))) {
    throw Object.assign(new Error('Choose supported download sites'), {statusCode: 400})
  }
  const price = value.price ?? 0
  const durationDays = value.durationDays ?? 30
  const published = value.published === true
  if (!Number.isFinite(price) || price < 0 || price > 1000000 || Math.round(price * 100) / 100 !== price) {
    throw Object.assign(new Error('Enter a valid BDT price with up to two decimal places'), {statusCode: 400})
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw Object.assign(new Error('Plan duration must be between 1 and 3650 days'), {statusCode: 400})
  }
  if (published && price <= 0) throw Object.assign(new Error('Set a price before publishing this plan'), {statusCode: 400})
  const deviceLimit = value.deviceLimit ?? 1
  if (!Number.isSafeInteger(deviceLimit) || (deviceLimit !== -1 && (deviceLimit < 1 || deviceLimit > 1000))) {
    throw Object.assign(new Error('Device limit must be 1–1000, or choose Unlimited'), {statusCode: 400})
  }
  return {name, limits, sites: [...new Set(value.sites)], price, durationDays, published, deviceLimit}
}

export function activeDeviceGrant(device, now = Date.now()) {
  const scheduled = (device.queuedPlans || []).find(plan => plan.startsAt <= now && plan.expiresAt > now)
  if (scheduled) return scheduled
  if (device.planId && (!device.planExpiresAt || device.planExpiresAt > now)) {
    return {planId: device.planId, expiresAt: device.planExpiresAt || null,
      orderId: device.purchaseId || null, snapshot: device.planSnapshot || null}
  }
  return null
}

export function reserveUsage(usage, plan, features, site) {
  if (!features.length || features.some(key => !FEATURES.includes(key))) {
    throw Object.assign(new Error('Unknown feature'), {statusCode: 400})
  }
  if (features.includes('download') && !plan.sites.includes(site)) {
    throw Object.assign(new Error('Your plan does not include downloads from this site'), {statusCode: 403})
  }
  const next = structuredClone(usage || {})
  for (const key of [...new Set(features)]) {
    const counter = next[key] || {used: 0, reserved: 0}
    if (plan.limits[key] !== -1 && counter.used + counter.reserved >= plan.limits[key]) {
      throw Object.assign(new Error('Monthly ' + key + ' limit reached'), {statusCode: 429})
    }
    next[key] = {...counter, reserved: counter.reserved + 1}
  }
  return next
}

export function settleUsage(usage, key, success) {
  const next = structuredClone(usage)
  const counter = next[key] || {used: 0, reserved: 0}
  next[key] = {used: counter.used + (success ? 1 : 0), reserved: Math.max(0, counter.reserved - 1)}
  return next
}
