export function validateRelease(value) {
  const fail = message => {throw Object.assign(new Error(message), {statusCode: 400})}
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.version || '')) fail('Use a version such as 3.0.8')
  let url
  try {url = new URL(value.url)} catch {fail('Enter the HTTPS installer download URL')}
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('Use an HTTPS download URL without credentials or fragments')
  if (url.hostname !== 'github.com' || url.search || !/^\/easyeducation556644-ux\/easy-education\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.exe$/.test(url.pathname)) fail('Use the installer asset URL from the official Easy Education GitHub releases')
  if (!/^[a-f0-9]{64}$/i.test(value.sha256 || '')) fail('Enter the installer SHA-256 checksum')
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > 1073741824) fail('Enter the installer size in bytes (up to 1 GB)')
  return {version: value.version, url: url.href, sha256: value.sha256.toLowerCase(), size: value.size,
    notes: String(value.notes || '').slice(0, 4000), published: value.published === true}
}
