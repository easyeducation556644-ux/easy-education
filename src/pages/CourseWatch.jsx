"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import {
  Eye,
  Play,
  Clock,
  Lock,
  FileText,
  Download,
  Trash2,
  CheckCircle2,
  LoaderCircle,
  CalendarClock,
} from "lucide-react"
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "../lib/cacheV2Firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import CustomVideoPlayer from "../components/CustomVideoPlayer"
import Breadcrumb from "../components/Breadcrumb"
import ResourceViewer from "../components/ResourceViewer"
import ClassReactions from "../components/ClassReactions"
import CommentsSection from "../components/CommentsSection"
import { isFirebaseId } from "../lib/utils/slugUtils"
import {
  getOfflineVideoOptions,
  getOfflineVideoUrl,
  getSavedOfflineVideoUrl,
  hasOfflineVideo,
  removeOfflineVideo,
  removeOfflineVideosForOtherUsers,
} from "../lib/offlineVideos"
import { queueOfflineDownload } from "../lib/offlineDownloadManager"
import { hasNativeDownloader, nativeRequest } from "../lib/nativeAndroid"

const RUMBLE_URL_PATTERN = /https?:\/\/(?:www\.)?rumble\.com\//i
const YOUTUBE_URL_PATTERN = /https?:\/\/(?:(?:www|m)\.)?(?:youtube\.com|youtu\.be)\//i

function supportsOfflineDownload(videoUrl, nativeApp) {
  const value = videoUrl || ""
  return RUMBLE_URL_PATTERN.test(value) || (nativeApp && YOUTUBE_URL_PATTERN.test(value))
}

function formatOfflineSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "সাইজ অজানা"
  const megabytes = bytes / (1024 * 1024)
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(megabytes))} MB`
}

function getMobileQualityLabel(height) {
  if (height <= 360) return "মোবাইলের জন্য সেরা · কম ডাটা"
  if (height <= 480) return "মোবাইলের জন্য ভালো"
  return "HD · বেশি ডাটা ও স্টোরেজ"
}

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === "function") return value.toDate()
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatUploadTime(value) {
  const date = toDate(value)
  if (!date) return "Upload time not recorded"
  try {
    return new Intl.DateTimeFormat("bn-BD", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Dhaka",
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

export default function CourseWatch() {
  const { courseId, classId } = useParams()
  const navigate = useNavigate()
  const { currentUser, isAdmin } = useAuth()
  const nativeApp = hasNativeDownloader()

  const [course, setCourse] = useState(null)
  const [actualCourseId, setActualCourseId] = useState(null)
  const [classes, setClasses] = useState([])
  const [currentClass, setCurrentClass] = useState(null)
  const [viewCount, setViewCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [toast, setToast] = useState(null)

  const [offlineSaved, setOfflineSaved] = useState(false)
  const [offlinePlaybackUrl, setOfflinePlaybackUrl] = useState(null)
  const [offlineProgress, setOfflineProgress] = useState(0)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineQuality, setOfflineQuality] = useState(360)
  const [offlineQualityOptions, setOfflineQualityOptions] = useState([])
  const [offlineQualityLoading, setOfflineQualityLoading] = useState(false)

  const trackedViewsRef = useRef(new Set())
  const offlineAbortRef = useRef(null)

  useEffect(() => {
    fetchCourseAccess()
  }, [courseId, currentUser?.uid, isAdmin])

  useEffect(() => {
    if (!actualCourseId) return
    const classesQuery = query(collection(db, "classes"), where("courseId", "==", actualCourseId))
    return onSnapshot(
      classesQuery,
      (snapshot) => {
        const nextClasses = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        setClasses(nextClasses)
        setCurrentClass((previous) => {
          const requested = classId ? nextClasses.find((item) => item.id === classId) : null
          const same = previous ? nextClasses.find((item) => item.id === previous.id) : null
          return requested || same || nextClasses[0] || null
        })
      },
      (error) => console.error("Error reading cached class list:", error),
    )
  }, [actualCourseId, classId])

  useEffect(() => {
    if (!currentClass || !currentUser) return
    trackClassView()
  }, [currentClass?.id, currentUser?.uid])

  useEffect(() => {
    if (!currentClass) return
    const viewsQuery = query(collection(db, "classViews"), where("classId", "==", currentClass.id))
    return onSnapshot(viewsQuery, (snapshot) => setViewCount(snapshot.size), (error) => console.error("Error fetching view count:", error))
  }, [currentClass?.id])

  useEffect(() => {
    let active = true
    const checkOfflineCopy = async () => {
      setOfflineSaved(false)
      setOfflinePlaybackUrl(null)
      setOfflineProgress(0)
      if (!currentUser?.uid || !currentClass?.id || !supportsOfflineDownload(currentClass.videoURL, nativeApp)) return
      try {
        await removeOfflineVideosForOtherUsers(currentUser.uid)
        const saved = await hasOfflineVideo(currentUser.uid, currentClass.id)
        const savedUrl = saved ? await getSavedOfflineVideoUrl(currentUser.uid, currentClass.id) : null
        if (active) {
          setOfflineSaved(saved)
          setOfflinePlaybackUrl(savedUrl)
        }
      } catch (error) {
        console.warn("Unable to inspect offline video cache:", error)
      }
    }
    checkOfflineCopy()
    return () => {
      active = false
      offlineAbortRef.current?.abort()
      offlineAbortRef.current = null
    }
  }, [currentUser?.uid, currentClass?.id, currentClass?.videoURL, nativeApp])

  useEffect(() => {
    const videoUrl = currentClass?.videoURL || ""
    if (!currentUser || !currentClass?.id || !supportsOfflineDownload(videoUrl, nativeApp)) {
      setOfflineQualityOptions([])
      return
    }

    const controller = new AbortController()
    let active = true
    setOfflineQualityLoading(true)
    const request = nativeApp && YOUTUBE_URL_PATTERN.test(videoUrl)
      ? nativeRequest("youtubeOptions", { videoUrl })
      : getOfflineVideoOptions({ user: currentUser, classId: currentClass.id, videoUrl, signal: controller.signal })

    request
      .then((payload) => {
        if (!active) return
        const options = Array.isArray(payload?.options) ? payload.options : []
        setOfflineQualityOptions(options)
        if (payload?.recommendedHeight) setOfflineQuality(Number(payload.recommendedHeight))
        else if (options.length > 0) setOfflineQuality(Number(options[0].height) || 360)
      })
      .catch((error) => {
        if (!active || error.name === "AbortError") return
        setOfflineQualityOptions([])
        showToast(error.message || "Offline quality পাওয়া যায়নি", "error")
      })
      .finally(() => active && setOfflineQualityLoading(false))

    return () => {
      active = false
      controller.abort()
    }
  }, [currentUser?.uid, currentClass?.id, currentClass?.videoURL, nativeApp])

  const fetchCourseAccess = async () => {
    setLoading(true)
    setCourseNotFound(false)
    try {
      let courseData = null
      let resolvedCourseId = courseId
      if (isFirebaseId(courseId)) {
        const courseDoc = await getDoc(doc(db, "courses", courseId))
        if (courseDoc.exists()) courseData = { id: courseDoc.id, ...courseDoc.data() }
      } else {
        const snapshot = await getDocs(query(collection(db, "courses"), where("slug", "==", courseId)))
        if (!snapshot.empty) {
          const courseDoc = snapshot.docs[0]
          courseData = { id: courseDoc.id, ...courseDoc.data() }
          resolvedCourseId = courseDoc.id
        }
      }

      if (!courseData) {
        setCourseNotFound(true)
        setCourse(null)
        setActualCourseId(null)
        return
      }

      setCourse(courseData)
      setActualCourseId(resolvedCourseId)
      if (isAdmin) {
        setHasAccess(true)
      } else if (currentUser) {
        const enrollment = await getDoc(doc(db, "userCourses", `${currentUser.uid}_${resolvedCourseId}`))
        if (enrollment.exists()) {
          setHasAccess(true)
        } else {
          const payments = await getDocs(query(collection(db, "payments"), where("userId", "==", currentUser.uid), where("status", "==", "approved")))
          setHasAccess(payments.docs.some((item) => item.data().courses?.some((entry) => entry.id === resolvedCourseId)))
        }
      } else {
        setHasAccess(false)
      }
    } catch (error) {
      console.error("Error fetching course data:", error)
      setCourseNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  const trackClassView = async () => {
    if (!currentUser || !currentClass) return
    const viewKey = `${currentUser.uid}_${currentClass.id}`
    if (trackedViewsRef.current.has(viewKey)) return
    trackedViewsRef.current.add(viewKey)
    try {
      await addDoc(collection(db, "classViews"), { userId: currentUser.uid, classId: currentClass.id, timestamp: serverTimestamp() })
    } catch (error) {
      trackedViewsRef.current.delete(viewKey)
      console.error("Error tracking view:", error)
    }
  }

  const trackVideoWatch = async (classItem) => {
    if (!actualCourseId || !currentUser?.uid) return
    try {
      await setDoc(doc(db, "watched", `${currentUser.uid}_${actualCourseId}_${classItem.id}`), {
        userId: currentUser.uid,
        courseId: actualCourseId,
        classId: classItem.id,
        className: classItem.title,
        watchedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error("Error tracking video watch:", error)
    }
  }

  const showToast = (message, type = "info") => {
    setToast({ message, type, id: Date.now() })
    setTimeout(() => setToast(null), 3000)
  }

  const selectClass = (item) => {
    setCurrentClass(item)
    trackVideoWatch(item)
  }

  const handlePreviousVideo = () => {
    const index = classes.findIndex((item) => item.id === currentClass?.id)
    if (index > 0) selectClass(classes[index - 1])
    else showToast("This is the first video")
  }

  const handleNextVideo = () => {
    const index = classes.findIndex((item) => item.id === currentClass?.id)
    if (index >= 0 && index < classes.length - 1) selectClass(classes[index + 1])
    else showToast("This is the last video")
  }

  const handleSaveOffline = () => {
    if (!currentUser || !currentClass?.id || offlineQualityOptions.length === 0) return
    const option = offlineQualityOptions.find((item) => Number(item.height) === Number(offlineQuality)) || offlineQualityOptions[0]
    queueOfflineDownload({
      user: currentUser,
      classId: currentClass.id,
      title: currentClass.title,
      courseTitle: course?.title,
      courseId: actualCourseId,
      videoUrl: currentClass.videoURL,
      height: Number(option.height) || 360,
      kind: option.kind,
      totalBytes: Number(option.contentLength) || 0,
    })
    navigate("/downloads")
  }

  const handleRemoveOffline = async () => {
    if (!currentUser?.uid || !currentClass?.id || offlineBusy) return
    setOfflineBusy(true)
    try {
      await removeOfflineVideo(currentUser.uid, currentClass.id)
      setOfflineSaved(false)
      setOfflinePlaybackUrl(null)
      setOfflineProgress(0)
      showToast("অফলাইন কপি মুছে ফেলা হয়েছে", "success")
    } catch {
      showToast("অফলাইন কপি মুছতে সমস্যা হয়েছে", "error")
    } finally {
      setOfflineBusy(false)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" /></div>

  if (courseNotFound || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6"><Lock className="w-10 h-10 text-red-500" /></div>
          <h2 className="text-2xl font-bold mb-3">Course Not Found</h2>
          <p className="text-muted-foreground mb-6">The course you're looking for doesn't exist or has been removed.</p>
          <button onClick={() => navigate("/courses")} className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium">Browse Courses</button>
        </div>
      </div>
    )
  }

  if (!hasAccess && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6"><Lock className="w-10 h-10 text-red-500" /></div>
          <h2 className="text-2xl font-bold mb-3">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">You need to purchase this course to watch the videos.</p>
          <Link to={`/course/${courseId}`} className="block w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium">Purchase Course</Link>
        </div>
      </div>
    )
  }

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Courses", href: "/courses" },
    { label: course.title, href: `/course/${courseId}` },
    { label: "Watch" },
  ]
  const currentVideoSupportsOffline = supportsOfflineDownload(currentClass?.videoURL, nativeApp)
  const currentVideoIsYoutube = YOUTUBE_URL_PATTERN.test(currentClass?.videoURL || "")

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <Breadcrumb items={breadcrumbItems} />
        <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
          <div className="bg-card border border-border rounded-lg sm:rounded-xl overflow-hidden shadow-lg">
            <div className="aspect-video bg-black relative">
              {currentClass?.videoURL ? (
                <CustomVideoPlayer
                  url={offlineSaved && currentUser?.uid && RUMBLE_URL_PATTERN.test(currentClass.videoURL) ? offlinePlaybackUrl || getOfflineVideoUrl(currentUser.uid, currentClass.id) : currentClass.videoURL}
                  onNext={handleNextVideo}
                  onPrevious={handlePreviousVideo}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white"><div className="text-center"><Play className="w-16 h-16 mx-auto mb-4 opacity-50" /><p>No video available</p></div></div>
              )}
            </div>

            {/* Exactly one web instruction. YouTube captions inside the player are disabled by CustomVideoPlayer. */}
            {currentClass?.videoURL && currentVideoIsYoutube && !nativeApp && (
              <div className="border-t border-border bg-card px-4 py-2 text-sm text-muted-foreground">
                ভিডিও ডাউনলোড করতে Easy Education app ব্যবহার করুন
              </div>
            )}

            {currentClass?.videoURL && currentVideoSupportsOffline && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
                <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  {offlineBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : offlineSaved ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Download className="h-4 w-4" />}
                  <span>{offlineBusy ? `অফলাইনের জন্য সেভ হচ্ছে${offlineProgress ? ` — ${offlineProgress}%` : "…"}` : offlineSaved ? "এই ডিভাইসে অফলাইনে পাওয়া যাবে" : currentVideoIsYoutube ? "YouTube ভিডিও ফোন থেকেই resolve ও download হবে" : "ইন্টারনেট ছাড়াই পরে দেখুন"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!offlineSaved && (
                    <select value={offlineQuality} onChange={(event) => setOfflineQuality(Number(event.target.value))} disabled={offlineBusy || offlineQualityLoading || offlineQualityOptions.length === 0} className="rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50">
                      {offlineQualityLoading && <option value={offlineQuality}>কোয়ালিটি খোঁজা হচ্ছে…</option>}
                      {!offlineQualityLoading && offlineQualityOptions.length === 0 && <option value={offlineQuality}>কোনো offline quality পাওয়া যায়নি</option>}
                      {offlineQualityOptions.map((option) => <option key={`${option.kind || "video"}-${option.height}`} value={option.height}>{option.height}p · {formatOfflineSize(Number(option.contentLength))} · {getMobileQualityLabel(Number(option.height))}</option>)}
                    </select>
                  )}
                  {offlineSaved ? (
                    <button type="button" onClick={handleRemoveOffline} disabled={offlineBusy} className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive"><Trash2 className="h-4 w-4" />মুছে ফেলুন</button>
                  ) : (
                    <button type="button" onClick={handleSaveOffline} disabled={offlineBusy || offlineQualityLoading || offlineQualityOptions.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{offlineBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download page খুলুন</button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg sm:rounded-xl p-4 sm:p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4 mb-3">
              <h1 className="text-xl sm:text-2xl font-bold flex-1">{currentClass?.title || "Select a class to watch"}</h1>
              {viewCount > 0 && <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full"><Eye className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-semibold text-muted-foreground">{viewCount}</span></div>}
            </div>
            {currentClass?.topic && <p className="mb-4 text-base sm:text-lg text-muted-foreground font-medium">{currentClass.topic}</p>}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
              {currentClass?.duration && <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Duration: {currentClass.duration}</span></div>}
              {currentClass && <div className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Uploaded: {formatUploadTime(currentClass.createdAt)}</span></div>}
            </div>
            {currentUser && currentClass && <ClassReactions classId={currentClass.id} currentUser={currentUser} />}
          </div>

          {Array.isArray(currentClass?.resourceLinks) && currentClass.resourceLinks.length > 0 && (
            <div className="bg-card border border-border rounded-lg sm:rounded-xl p-4 sm:p-6 shadow-lg">
              <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 mb-4"><FileText className="w-5 h-5 text-primary" />Class Resources</h2>
              <div className="space-y-3">{currentClass.resourceLinks.map((resource, index) => resource.label && resource.url ? <ResourceViewer key={index} resource={resource} /> : null)}</div>
            </div>
          )}

          {currentUser && currentClass && <CommentsSection classId={currentClass.id} currentUser={currentUser} isAdmin={isAdmin} />}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50">
          <div className={`px-6 py-3 rounded-lg shadow-lg backdrop-blur-sm ${toast.type === "success" ? "bg-green-500/90 text-white" : toast.type === "error" ? "bg-red-500/90 text-white" : "bg-gray-900/90 text-white"}`}><p className="text-sm font-medium">{toast.message}</p></div>
        </div>
      )}
    </div>
  )
}
