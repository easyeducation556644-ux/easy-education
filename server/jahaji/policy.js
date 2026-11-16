export const FEATURES = ['download', 'watermark', 'telegram', 'youtube', 'scan', 'import', 'account']
export const SITES = ['acs', 'retina', 'youtube', 'vimeo', 'vidinfra', 'other']
export const FREE_PLAN = Object.freeze({name: 'Free', limits: Object.fromEntries(FEATURES.map(key => [key, 5])), sites: SITES})

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
  return {name, limits, sites: [...new Set(value.sites)]}
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
