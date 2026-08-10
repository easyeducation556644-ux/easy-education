import { useEffect } from "react"
import { toast } from "../hooks/use-toast"
import { hasNativeDownloader } from "../lib/nativeAndroid"

export default function LearningPushFeedbackAgent() {
  useEffect(() => {
    let permissionWarned = false

    const onRegistration = (event) => {
      const detail = event?.detail || {}
      if (!hasNativeDownloader()) return
      if (detail.ok || detail.reason !== "permission" || permissionWarned) return
      permissionWarned = true
      toast({
        variant: "error",
        title: "Notifications are off",
        description: "Easy Education app notification permission Allow করুন, তাহলে নতুন class alert পাবেন।",
      })
    }

    const onDelivery = (event) => {
      const detail = event?.detail || {}
      if (!detail.classId) return
      if (!detail.ok) {
        toast({
          variant: "error",
          title: "Class saved, notification failed",
          description: detail.error || "App notification পাঠানো যায়নি।",
        })
        return
      }

      const eligible = Number(detail.eligibleUsers || 0)
      const devices = Number(detail.registeredDevices || 0)
      const delivered = Number(detail.delivered || 0)
      const failed = Number(detail.failed || 0)
      let description
      if (eligible === 0) description = "Class created. এই course-এ enrolled user পাওয়া যায়নি।"
      else if (devices === 0) description = `${eligible} enrolled user আছে, কিন্তু registered app device নেই।`
      else description = `${delivered}/${devices} app device-এ notification delivered${failed ? `, ${failed} failed` : ""}.`

      toast({
        title: "Class created",
        description,
      })
    }

    window.addEventListener("easy-education-push-registration", onRegistration)
    window.addEventListener("easy-education-learning-push-result", onDelivery)
    return () => {
      window.removeEventListener("easy-education-push-registration", onRegistration)
      window.removeEventListener("easy-education-learning-push-result", onDelivery)
    }
  }, [])

  return null
}
