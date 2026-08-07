import { useEffect } from "react"
import { useAuth } from "../contexts/AuthContext"
import { resumePendingDownloads } from "../lib/offlineDownloadManager"

export default function DownloadResumeAgent() {
  const { currentUser } = useAuth()

  useEffect(() => {
    if (currentUser?.uid) resumePendingDownloads(currentUser)
  }, [currentUser?.uid])

  return null
}
