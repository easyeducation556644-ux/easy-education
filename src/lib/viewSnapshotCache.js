const PREFIX = "ee_view_snapshot_v1:"

export function readViewSnapshot(key) {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`)
    return raw ? JSON.parse(raw) : null
  } catch (_) {
    return null
  }
}

export function writeViewSnapshot(key, value) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value))
  } catch (error) {
    console.warn("Unable to persist instant view snapshot:", key, error)
  }
}

export function removeViewSnapshot(key) {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(`${PREFIX}${key}`)
}
