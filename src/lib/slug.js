export const generateSlug = (title, uniqueId = null) => {
  if (!title) return uniqueId || "";
  
  let slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  if (uniqueId) {
    const shortId = uniqueId.substring(0, 8);
    slug = `${slug}-${shortId}`;
  }
  
  return slug;
}

export const isFirebaseId = (str) => {
  return /^[a-zA-Z0-9]{20,}$/.test(str)
}
