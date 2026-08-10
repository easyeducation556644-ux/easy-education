export async function notifyNewClass(currentUser, classId) {
  if (!currentUser || !classId) throw new Error("Missing authenticated user or class id")
  const token = await currentUser.getIdToken()
  const response = await fetch("/api/learning-push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "class-created", classId }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    throw new Error(body?.error || `Notification request failed: ${response.status}`)
  }
  return body
}

export function describeClassPushResult(result) {
  const eligible = Number(result?.eligibleUsers || 0)
  const devices = Number(result?.registeredDevices || 0)
  const delivered = Number(result?.delivered || 0)
  const failed = Number(result?.failed || 0)
  if (eligible === 0) return "Class created. No enrolled user found for this course."
  if (devices === 0) return `Class created. ${eligible} enrolled user${eligible === 1 ? "" : "s"}, but no registered app device yet.`
  if (delivered > 0 && failed === 0) return `Class created. Notification delivered to ${delivered} app device${delivered === 1 ? "" : "s"}.`
  return `Class created. ${delivered}/${devices} app notifications delivered${failed ? `, ${failed} failed` : ""}.`
}
