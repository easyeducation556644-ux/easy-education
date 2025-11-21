export function generateDeviceID() {
  return 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15)
}

export function generateDeviceFingerprint() {
  const navigator = window.navigator
  const screen = window.screen
  
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    navigator.platform,
    navigator.hardwareConcurrency || 'unknown'
  ]
  
  const fingerprint = components.join('|')
  
  let hash = 0
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  
  return Math.abs(hash).toString(36)
}

export async function getUserIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json()
    return data.ip
  } catch (error) {
    console.error('Failed to get IP address:', error)
    return 'unknown'
  }
}

export function getDeviceName() {
  const ua = navigator.userAgent
  const platform = navigator.platform
  
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    const uaPlatform = navigator.userAgentData.platform.toLowerCase()
    if (uaPlatform === 'android') return 'Android'
    if (uaPlatform === 'ios') return 'iOS'
    if (uaPlatform.includes('win')) return 'Windows'
    if (uaPlatform.includes('mac')) return 'MacOS'
    if (uaPlatform.includes('linux')) {
      if (navigator.userAgentData.mobile) return 'Android'
      return 'Linux Desktop'
    }
  }
  
  if (/Android|Adr|Silk|Kindle|KF[A-Z]+/i.test(ua)) {
    return 'Android'
  }
  if (/iPad|iPhone|iPod/i.test(ua) && !window.MSStream) {
    return 'iOS'
  }
  if (/windows phone|wpdesktop/i.test(ua)) {
    return 'Windows Phone'
  }
  if (/cros/i.test(ua)) {
    return 'Chrome OS'
  }
  if (/Win/i.test(platform)) {
    return 'Windows'
  }
  if (/Mac/i.test(platform) && !/iphone|ipad/i.test(ua)) {
    return 'MacOS'
  }
  if (/Linux/i.test(platform)) {
    if (/mobile|tablet/i.test(ua)) {
      return 'Android'
    }
    
    if (/arm64|aarch64|armv8l|armv7l|arm/i.test(ua + platform)) {
      return 'Android'
    }
    
    if (/(wv|\.0\.0\.0)/.test(ua)) {
      return 'Android'
    }
    
    if (/X11|Ubuntu|Fedora|Debian|GNOME|KDE|x86_64|i686/i.test(ua + platform)) {
      return 'Linux Desktop'
    }
    
    return 'Android'
  }
  
  return 'Unknown'
}

async function tryFreeIPAPI(ipAddress) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  
  try {
    const response = await fetch(`https://freeipapi.com/api/json/${ipAddress}`, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    
    const data = await response.json()
    
    return {
      ip: ipAddress,
      country: data.countryName || 'Unknown',
      countryCode: data.countryCode || 'Unknown',
      region: data.regionName || 'Unknown',
      city: data.cityName || 'Unknown',
      district: data.regionName || 'Unknown',
      postalCode: data.zipCode || null,
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      timezone: data.timeZone || 'Unknown',
      isp: 'Not available',
      organization: 'Not available',
      source: 'freeipapi.com'
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn(`freeipapi.com failed for ${ipAddress}:`, error.message)
    throw error
  }
}

async function tryIPWhois(ipAddress) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  
  try {
    const response = await fetch(`https://ipwho.is/${ipAddress}`, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    
    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.message || 'API returned success:false')
    }
    
    return {
      ip: data.ip || ipAddress,
      country: data.country || 'Unknown',
      countryCode: data.country_code || 'Unknown',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      district: data.region || 'Unknown',
      postalCode: data.postal || null,
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      timezone: data.timezone?.id || 'Unknown',
      isp: data.connection?.isp || 'Not available',
      organization: data.connection?.org || data.connection?.isp || 'Not available',
      source: 'ipwho.is'
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn(`ipwho.is failed for ${ipAddress}:`, error.message)
    throw error
  }
}

async function tryIPApiCo(ipAddress) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  
  try {
    const response = await fetch(`https://ipapi.co/${ipAddress}/json/`, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    
    const data = await response.json()
    
    if (data.error) {
      throw new Error(data.reason || 'API Error')
    }
    
    return {
      ip: ipAddress,
      country: data.country_name || 'Unknown',
      countryCode: data.country_code || 'Unknown',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      district: data.region || 'Unknown',
      postalCode: data.postal || null,
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      timezone: data.timezone || 'Unknown',
      isp: data.org || 'Not available',
      organization: data.org || 'Not available',
      source: 'ipapi.co'
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn(`ipapi.co failed for ${ipAddress}:`, error.message)
    throw error
  }
}

export async function getIPGeolocation(ipAddress) {
  if (!ipAddress || ipAddress === 'unknown') {
    return {
      ip: ipAddress || 'Unknown',
      country: 'Unknown',
      countryCode: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      district: 'Unknown',
      postalCode: null,
      latitude: 0,
      longitude: 0,
      timezone: 'Unknown',
      isp: 'Unknown',
      organization: 'Unknown',
      source: 'none'
    }
  }

  const apis = [
    { name: 'ipwho.is', fn: tryIPWhois },
    { name: 'freeipapi.com', fn: tryFreeIPAPI },
    { name: 'ipapi.co', fn: tryIPApiCo }
  ]

  for (const api of apis) {
    try {
      console.log(`Trying ${api.name} for IP ${ipAddress}...`)
      const result = await api.fn(ipAddress)
      console.log(`✓ Successfully got geolocation from ${api.name}`)
      return result
    } catch (error) {
      console.warn(`✗ ${api.name} failed, trying next API...`)
      continue
    }
  }

  console.error(`All IP geolocation APIs failed for ${ipAddress}`)
  return {
    ip: ipAddress,
    country: 'Unknown (All APIs Failed)',
    countryCode: 'Unknown',
    region: 'Unknown',
    city: 'Unknown',
    district: 'Unknown',
    postalCode: null,
    latitude: 0,
    longitude: 0,
    timezone: 'Unknown',
    isp: 'Not available',
    organization: 'Not available',
    source: 'fallback'
  }
}

export async function getDeviceInfo(existingDeviceID = null) {
  const navigator = window.navigator
  const screen = window.screen
  
  const ipAddress = await getUserIP()
  const geolocation = ipAddress !== 'unknown' ? await getIPGeolocation(ipAddress) : null
  
  const deviceID = existingDeviceID || localStorage.getItem('deviceID') || generateDeviceID()
  
  if (!existingDeviceID && !localStorage.getItem('deviceID')) {
    localStorage.setItem('deviceID', deviceID)
  }
  
  return {
    id: deviceID,
    fingerprint: generateDeviceFingerprint(),
    ipAddress: ipAddress,
    geolocation: geolocation,
    userAgent: navigator.userAgent,
    platform: getDeviceName(),
    screenResolution: `${screen.width}x${screen.height}`,
    language: navigator.language,
    timestamp: new Date().toISOString()
  }
}
