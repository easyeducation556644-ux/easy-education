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

export async function getDeviceInfo() {
  const navigator = window.navigator
  const screen = window.screen
  
  const ipAddress = await getUserIP()
  
  return {
    fingerprint: generateDeviceFingerprint(),
    ipAddress: ipAddress,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    language: navigator.language,
    timestamp: new Date().toISOString()
  }
}
