export function generateSlug(title, uniqueId = null) {
  if (!title) return uniqueId || "";
  
  let slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  if (uniqueId) {
    slug = `${slug}-${uniqueId}`;
  }
  
  return slug;
}

export function isFirebaseId(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[a-zA-Z0-9]{20,}$/.test(str) && !str.includes('-');
}
