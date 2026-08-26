import test from "node:test"
import assert from "node:assert/strict"
import { dhakaClock, timeSlots } from "../../server/bot/automation.js"

test("automation exposes every 30-minute selector slot", () => {
  const slots = timeSlots()
  assert.equal(slots.length, 48)
  assert.deepEqual(slots[0], { minuteOfDay: 0, label: "12:00 AM" })
  assert.deepEqual(slots[16], { minuteOfDay: 480, label: "08:00 AM" })
  assert.deepEqual(slots[47], { minuteOfDay: 1410, label: "11:30 PM" })
})

test("scheduler evaluates time in Asia/Dhaka", () => {
  assert.deepEqual(dhakaClock(new Date("2026-08-26T02:15:00.000Z")), {
    dateKey: "2026-08-26",
    minuteOfDay: 495,
  })
})
