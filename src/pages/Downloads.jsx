import { useEffect, useMemo, useState } from "react"
import {
  Download,
  Pause,
  Play,
  RotateCw,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { useAuth } from "../contexts/AuthContext"
import CustomVideoPlayer from "../components/CustomVideoPlayer"
import {
  getDownloadJobs,
  pauseOfflineDownload,
  refreshDownloadPlaybackUrls,
  removeDownloadJob,
  resumeOfflineDownload,
  resumePendingDownloads,
  subscribeToDownloads,
} from "../lib/offlineDownloadManager"

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`
  return `${Math.round(value / 1024)} KB`
}

function statusLabel(status) {
  if (status === "completed") return "ডাউনলোড সম্পূর্ণ"
  if (status === "paused") return "পজ করা আছে"
  if (status === "error") return "ডাউনলোড ব্যর্থ"
  if (status === "queued") return "অপেক্ষায় আছে"
  return "ব্যাকগ্রাউন্ডে ডাউনলোড হচ্ছে"
}

export default function Downloads() {
  const { currentUser } = useAuth()
  const [jobs, setJobs] = useState([])
  const [watching, setWatching] = useState(null)

  const reloadJobs = async () => {
    if (!currentUser?.uid) return
    const refreshed = await refreshDownloadPlaybackUrls(currentUser.uid)
    setJobs([...refreshed])
  }

  useEffect(() => {
    if (!currentUser?.uid) return
    setJobs(getDownloadJobs(currentUser.uid))
    resumePendingDownloads(currentUser)
    reloadJobs()

    const unsubscribe = subscribeToDownloads((allJobs) => {
      setJobs(allJobs
        .filter((job) => job.userId === currentUser.uid)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)))
    })
    const handleStorage = () => setJobs(getDownloadJobs(currentUser.uid))
    window.addEventListener("storage", handleStorage)
    return () => {
      unsubscribe()
      window.removeEventListener("storage", handleStorage)
    }
  }, [currentUser?.uid])

  const totals = useMemo(() => ({
    active: jobs.filter((job) => ["queued", "downloading"].includes(job.status)).length,
    completed: jobs.filter((job) => job.status === "completed").length,
  }), [jobs])

  const handleRemove = async (job) => {
    await removeDownloadJob(job.userId, job.classId)
    if (watching?.id === job.id) setWatching(null)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold sm:text-3xl">
              <Download className="h-7 w-7 text-primary" />
              Downloaded Videos
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              App খোলা থাকলে download চলবে। Reload বা reopen করলে আগের progress থেকে resume হবে।
            </p>
          </div>
          <div className="rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground">
            চলমান {totals.active} · সম্পূর্ণ {totals.completed}
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <Download className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">কোনো offline video নেই</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Rumble class থেকে “অফলাইনে সেভ করুন” চাপলে এখানে দেখা যাবে।
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const progress = Math.max(0, Math.min(100, Number(job.progress) || 0))
              const canWatch = job.status === "completed" && progress >= 100 && job.playbackUrl
              return (
                <article key={job.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        {job.status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                        ) : job.status === "error" ? (
                          <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                        ) : (
                          <Download className="h-5 w-5 shrink-0 text-primary" />
                        )}
                        <h2 className="truncate text-lg font-semibold">{job.title}</h2>
                      </div>
                      {job.courseTitle && (
                        <p className="truncate text-sm text-muted-foreground">{job.courseTitle}</p>
                      )}

                      <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                        <span>{statusLabel(job.status)} · {progress}%</span>
                        <span>
                          {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)} · {job.height}p
                        </span>
                      </div>
                      {job.error && <p className="mt-2 text-sm text-destructive">{job.error}</p>}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canWatch && (
                        <button
                          type="button"
                          onClick={() => setWatching(job)}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                        >
                          <Play className="h-4 w-4" />
                          ভিডিও দেখুন
                        </button>
                      )}
                      {job.status === "downloading" || job.status === "queued" ? (
                        <button
                          type="button"
                          onClick={() => pauseOfflineDownload(job.userId, job.classId)}
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <Pause className="h-4 w-4" />
                          Pause
                        </button>
                      ) : job.status !== "completed" ? (
                        <button
                          type="button"
                          onClick={() => resumeOfflineDownload(currentUser, job.classId)}
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <RotateCw className="h-4 w-4" />
                          Resume
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemove(job)}
                        className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        মুছুন
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {watching && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3">
          <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-black">
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
              <p className="truncate font-medium">{watching.title}</p>
              <button type="button" onClick={() => setWatching(null)} aria-label="Close player">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="aspect-video">
              <CustomVideoPlayer url={watching.playbackUrl} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
