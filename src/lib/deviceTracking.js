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
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform
  
  if (ua.includes('android')) {
    return 'Android'
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
    return 'iOS'
  }
  if (ua.includes('windows phone') || ua.includes('wpdesktop')) {
    return 'Windows Phone'
  }
  if (ua.includes('cros')) {
    return 'Chrome OS'
  }
  if (/Win/.test(platform)) {
    return 'Windows'
  }
  if (/Mac/.test(platform) && !ua.includes('iphone') && !ua.includes('ipad')) {
    return 'MacOS'
  }
  if (/Linux/.test(platform) && !ua.includes('android')) {
    return 'Linux Desktop'
  }
  
  return platform || 'Unknown'
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
      organization: 'Unknown'
    }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    
    const response = await fetch(`https://ipapi.co/${ipAddress}/json/`, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      console.warn(`IP geolocation API returned ${response.status} for IP ${ipAddress}`)
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.error) {
      console.warn(`IP geolocation API error for IP ${ipAddress}: ${data.reason || 'Unknown error'}`)
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
      organization: data.org || 'Not available'
    }
  } catch (error) {
    console.error(`Failed to get IP geolocation for ${ipAddress}:`, error.message || error)
    return {
      ip: ipAddress,
      country: 'Unknown (API Error)',
      countryCode: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      district: 'Unknown',
      postalCode: null,
      latitude: 0,
      longitude: 0,
      timezone: 'Unknown',
      isp: 'Not available',
      organization: 'Not available'
    }
  }
}

export async function getDeviceInfo() {
  const navigator = window.navigator
  const screen = window.screen
  
  const ipAddress = await getUserIP()
  const geolocation = ipAddress !== 'unknown' ? await getIPGeolocation(ipAddress) : null
  
  return {
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
