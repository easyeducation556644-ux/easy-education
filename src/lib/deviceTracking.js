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
  if (/Win/.test(platform)) {
    return 'Windows'
  }
  if (/Mac/.test(platform) && !ua.includes('iphone') && !ua.includes('ipad')) {
    return 'MacOS'
  }
  if (/Linux/.test(platform)) {
    return 'Linux Desktop'
  }
  if (ua.includes('cros')) {
    return 'Chrome OS'
  }
  
  return platform || 'Unknown'
}

export async function getIPGeolocation(ipAddress) {
  try {
    const response = await fetch(`https://ipapi.co/${ipAddress}/json/`)
    const data = await response.json()
    
    return {
      country: data.country_name || 'Unknown',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      district: data.region_code || data.city || 'Unknown',
      thana: data.postal || null,
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      timezone: data.timezone || 'Unknown',
      org: data.org || 'Unknown'
    }
  } catch (error) {
    console.error('Failed to get IP geolocation:', error)
    return {
      country: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      district: 'Unknown',
      thana: null,
      latitude: 0,
      longitude: 0,
      timezone: 'Unknown',
      org: 'Unknown'
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
