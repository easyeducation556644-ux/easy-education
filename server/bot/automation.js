import { stableId } from "./crypto.js"

export const AUTOMATION_SETTINGS = "botAutomationSettings"
export const AUTOMATION_CONFIG_ID = "schedule"
export const TIMEZONE = "Asia/Dhaka"
const timestamp = () => new Date()

export function timeSlots() {
  return Array.from({ length: 48 }, (_, index) => {
    const minuteOfDay = index * 30
    const hour24 = Math.floor(minuteOfDay / 60)
    const minute = minuteOfDay % 60
    const suffix = hour24 >= 12 ? "PM" : "AM"
    const hour12 = hour24 % 12 || 12
    return { minuteOfDay, label: `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}` }
  })
}

export function dhakaClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export async function getAutomationSettings(db) {
  const snapshot = await db.collection(AUTOMATION_SETTINGS).doc(AUTOMATION_CONFIG_ID).get()
  return snapshot.exists ? snapshot.data() : {
    overall: { enabled: false, minuteOfDay: 480 },
    platforms: {},
    timezone: TIMEZONE,
  }
}

export async function setSchedule(db, scope, minuteOfDay) {
  const safeMinute = Math.max(0, Math.min(1410, Math.floor(Number(minuteOfDay) / 30) * 30))
  await db.collection(AUTOMATION_SETTINGS).doc(AUTOMATION_CONFIG_ID).set({
    ...(scope === "overall"
      ? { overall: { enabled: true, minuteOfDay: safeMinute } }
      : { platforms: { [scope]: { enabled: true, minuteOfDay: safeMinute } } }),
    timezone: TIMEZONE,
    updatedAt: timestamp(),
  }, { merge: true })
}

export async function toggleSchedule(db, scope) {
  const current = await getAutomationSettings(db)
  const value = scope === "overall" ? current.overall : current.platforms?.[scope]
  await db.collection(AUTOMATION_SETTINGS).doc(AUTOMATION_CONFIG_ID).set({
    ...(scope === "overall"
      ? { overall: { enabled: !(value?.enabled), minuteOfDay: Number(value?.minuteOfDay ?? 480) } }
      : { platforms: { [scope]: { enabled: !(value?.enabled), minuteOfDay: Number(value?.minuteOfDay ?? current.overall?.minuteOfDay ?? 480) } } }),
    updatedAt: timestamp(),
  }, { merge: true })
}

function effectiveSchedule(settings, platform) {
  const override = settings.platforms?.[platform]
  return override && typeof override.enabled === "boolean" ? override : settings.overall
}

export async function enqueueDueMappings(db, now = new Date()) {
  const settings = await getAutomationSettings(db)
  const clock = dhakaClock(now)
  const mappings = await db.collection("botCourseMappings").get()
  const enqueued = []
  for (const doc of mappings.docs) {
    const mapping = doc.data()
    const schedule = effectiveSchedule(settings, mapping.platform)
    if (!schedule?.enabled) continue
    const scheduledMinute = Number(schedule.minuteOfDay || 0)
    if (clock.minuteOfDay < scheduledMinute) continue
    const jobId = `scheduled_${stableId(doc.id, clock.dateKey)}`
    const jobRef = db.collection("botJobs").doc(jobId)
    const created = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(jobRef)
      if (existing.exists) return false
      transaction.create(jobRef, {
        type: "scheduled_mapping_sync",
        status: "queued",
        mappingId: doc.id,
        platform: mapping.platform,
        scheduledDate: clock.dateKey,
        scheduledMinute,
        attempts: 0,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      })
      return true
    })
    if (created) enqueued.push({ jobId, mappingId: doc.id })
  }
  return enqueued
}
