"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Eye, Play, BookOpen, GraduationCap, User, Award, Clock, Lock, FileQuestion, FileText, ExternalLink, Download, Trash2, CheckCircle2, LoaderCircle } from "lucide-react"
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  increment,
  serverTimestamp,
  setDoc,
  onSnapshot,
} from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"
import CustomVideoPlayer from "../components/CustomVideoPlayer"
import ExamCard from "../components/ExamCard"
import Breadcrumb from "../components/Breadcrumb"
import ResourceViewer from "../components/ResourceViewer"
import ClassReactions from "../components/ClassReactions"
import CommentsSection from "../components/CommentsSection"
import { toast as showGlobalToast } from "../hooks/use-toast"
import { isFirebaseId } from "../lib/utils/slugUtils"
import {
  getOfflineVideoOptions,
  getOfflineVideoUrl,
  hasOfflineVideo,
  removeOfflineVideo,
  removeOfflineVideosForOtherUsers,
  saveOfflineVideo,
} from "../lib/offlineVideos"

const RUMBLE_URL_PATTERN = /(?:^|\.)rumble\.com\//i

function formatOfflineSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "সাইজ অজানা"
  const megabytes = bytes / (1024 * 1024)
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${Math.max(1, Math.round(megabytes))} MB`
}

function getMobileQualityLabel(height) {
  if (height <= 360) return "মোবাইলের জন্য সেরা · কম ডাটা"
  if (height <= 480) return "মোবাইলের জন্য ভালো"
  return "HD · বেশি ডাটা ও স্টোরেজ"
}

export default function CourseWatch() {
  const { courseId, classId } = useParams()
  const navigate = useNavigate()
  const { currentUser, isAdmin } = useAuth()
  const [course, setCourse] = useState(null)
  const [actualCourseId, setActualCourseId] = useState(null)
  const [classes, setClasses] = useState([])
  const [currentClass, setCurrentClass] = useState(null)
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [selectedChapter, setSelectedChapter] = useState(null)
  const [viewCount, setViewCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [toast, setToast] = useState(null)
  const [exams, setExams] = useState([])
  const [showExams, setShowExams] = useState(false)
  const [offlineSaved, setOfflineSaved] = useState(false)
  const [offlineProgress, setOfflineProgress] = useState(0)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineQuality, setOfflineQuality] = useState(360)
  const [offlineQualityOptions, setOfflineQualityOptions] = useState([])
  const [offlineQualityLoading, setOfflineQualityLoading] = useState(false)
  const trackedViewsRef = useRef(new Set())
  const offlineAbortRef = useRef(null)
  
  const { getExamsByCourse } = useExam()

  useEffect(() => {
    fetchCourseData()
  }, [courseId])

  useEffect(() => {
    if (currentClass && currentUser) {
      trackClassView()
    }
  }, [currentClass, currentUser])

  useEffect(() => {
    if (currentClass) {
      const unsubscribe = fetchViewCount()
      return () => unsubscribe && unsubscribe()
    }
  }, [currentClass])

  useEffect(() => {
    if (actualCourseId) {
      fetchExamsForCourse()
    }
  }, [actualCourseId])

  useEffect(() => {
    let active = true

    const checkOfflineCopy = async () => {
      setOfflineSaved(false)
      setOfflineProgress(0)
      if (
        !currentUser?.uid ||
        !currentClass?.id ||
        !RUMBLE_URL_PATTERN.test(currentClass.videoURL || "")
      ) return

      try {
        await removeOfflineVideosForOtherUsers(currentUser.uid)
        const saved = await hasOfflineVideo(currentUser.uid, currentClass.id)
        if (active) setOfflineSaved(saved)
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
  }, [currentUser?.uid, currentClass?.id])

  useEffect(() => {
    if (
      !currentUser ||
      !currentClass?.id ||
      !RUMBLE_URL_PATTERN.test(currentClass.videoURL || "")
    ) {
      setOfflineQualityOptions([])
      return
    }

    const controller = new AbortController()
    setOfflineQualityLoading(true)

    getOfflineVideoOptions({
      user: currentUser,
      classId: currentClass.id,
      signal: controller.signal,
    })
      .then((payload) => {
        const options = Array.isArray(payload?.options) ? payload.options : []
        setOfflineQualityOptions(options)
        if (payload?.recommendedHeight) {
          setOfflineQuality(payload.recommendedHeight)
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.warn("Unable to load offline quality options:", error)
          setOfflineQualityOptions([])
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOfflineQualityLoading(false)
      })

    return () => controller.abort()
  }, [currentUser, currentClass?.id, currentClass?.videoURL])

  const fetchExamsForCourse = async () => {
    if (!actualCourseId) return
    try {
      const examsData = await getExamsByCourse(actualCourseId)
      setExams(examsData)
    } catch (error) {
      console.error("Error fetching exams:", error)
    }
  }

  const fetchCourseData = async () => {
    try {
      let courseData = null
      let resolvedCourseId = courseId
      
      if (isFirebaseId(courseId)) {
        const courseDoc = await getDoc(doc(db, "courses", courseId))
        if (courseDoc.exists()) {
          courseData = { id: courseDoc.id, ...courseDoc.data() }
        }
      } else {
        const q = query(collection(db, "courses"), where("slug", "==", courseId))
        const snapshot = await getDocs(q)
        if (!snapshot.empty) {
          const courseDoc = snapshot.docs[0]
          courseData = { id: courseDoc.id, ...courseDoc.data() }
          resolvedCourseId = courseDoc.id
        }
      }
      
      if (courseData) {
        setCourse(courseData)
        setActualCourseId(resolvedCourseId)

        if (isAdmin) {
          setHasAccess(true)
        } else if (currentUser) {
          // Check userCourses collection first (supports bundles and new enrollments)
          const userCourseDoc = await getDoc(doc(db, "userCourses", `${currentUser.uid}_${resolvedCourseId}`))
          
          if (userCourseDoc.exists()) {
            setHasAccess(true)
          } else {
            // Fallback: Check payments for legacy free enrollments
            const paymentsQuery = query(
              collection(db, "payments"),
              where("userId", "==", currentUser.uid),
              where("status", "==", "approved")
            )
            const paymentsSnapshot = await getDocs(paymentsQuery)
            const hasApprovedCourse = paymentsSnapshot.docs.some((doc) => {
              const payment = doc.data()
              return payment.courses?.some((c) => c.id === resolvedCourseId)
            })
            setHasAccess(hasApprovedCourse)
          }
        }

        const classesQuery = query(collection(db, "classes"), where("courseId", "==", resolvedCourseId))
        const classesSnapshot = await getDocs(classesQuery)
        const classesData = classesSnapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .sort((a, b) => a.order - b.order)

        setClasses(classesData)

        if (classesData.length > 0) {
          // If classId is provided in URL, find and set that specific class
          let initialClass = classesData[0]
          if (classId) {
            const foundClass = classesData.find(cls => cls.id === classId)
            if (foundClass) {
              initialClass = foundClass
            }
          }
          setCurrentClass(initialClass)

          if (courseData.type === "batch" && initialClass.subject) {
            setSelectedSubject(initialClass.subject)
            if (initialClass.chapter) {
              setSelectedChapter(initialClass.chapter)
            }
          } else if (initialClass.chapter) {
            setSelectedChapter(initialClass.chapter)
          }
        }
      } else {
        setCourseNotFound(true)
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
      await addDoc(collection(db, "classViews"), {
        userId: currentUser.uid,
        classId: currentClass.id,
        timestamp: serverTimestamp(),
      })
    } catch (error) {
      trackedViewsRef.current.delete(viewKey)
      console.error("Error tracking view:", error)
    }
  }

  const fetchViewCount = () => {
    if (!currentClass) return

    try {
      const viewsQuery = query(
        collection(db, "classViews"),
        where("classId", "==", currentClass.id)
      )
      
      const unsubscribe = onSnapshot(viewsQuery, (snapshot) => {
        setViewCount(snapshot.size)
      })
      
      return unsubscribe
    } catch (error) {
      console.error("Error fetching view count:", error)
      return null
    }
  }

  const selectClass = (classItem) => {
    setCurrentClass(classItem)
    if (currentUser && classItem) {
      trackVideoWatch(classItem)
    }
  }

  const trackVideoWatch = async (classItem) => {
    if (!actualCourseId) return
    try {
      const watchedRef = doc(db, "watched", `${currentUser.uid}_${actualCourseId}_${classItem.id}`)
      await setDoc(
        watchedRef,
        {
          userId: currentUser.uid,
          courseId: actualCourseId,
          classId: classItem.id,
          className: classItem.title,
          watchedAt: serverTimestamp(),
        },
        { merge: true },
      )
    } catch (error) {
      console.error("Error tracking video watch:", error)
    }
  }

  const handlePreviousVideo = () => {
    if (!currentClass || classes.length === 0) {
      showToast("No videos available", "info")
      return
    }

    const currentIndex = classes.findIndex((cls) => cls.id === currentClass.id)

    if (currentIndex > 0) {
      const previousClass = classes[currentIndex - 1]
      setCurrentClass(previousClass)

      // Update selected subject/chapter if needed
      if (course?.type === "batch" && previousClass.subject) {
        setSelectedSubject(previousClass.subject)
        if (previousClass.chapter) {
          setSelectedChapter(previousClass.chapter)
        }
      } else if (previousClass.chapter) {
        setSelectedChapter(previousClass.chapter)
      }

      showToast(`Playing: ${previousClass.title}`, "success")
    } else {
      showToast("This is the first video", "info")
    }
  }

  const handleNextVideo = () => {
    if (!currentClass || classes.length === 0) {
      showToast("No videos available", "info")
      return
    }

    const currentIndex = classes.findIndex((cls) => cls.id === currentClass.id)

    if (currentIndex < classes.length - 1) {
      const nextClass = classes[currentIndex + 1]
      setCurrentClass(nextClass)

      // Update selected subject/chapter if needed
      if (course?.type === "batch" && nextClass.subject) {
        setSelectedSubject(nextClass.subject)
        if (nextClass.chapter) {
          setSelectedChapter(nextClass.chapter)
        }
      } else if (nextClass.chapter) {
        setSelectedChapter(nextClass.chapter)
      }

      showToast(`Playing: ${nextClass.title}`, "success")
    } else {
      showToast("This is the last video", "info")
    }
  }

  const handleWatchNow = () => {
    navigate(`/course/${courseId}/chapters`)
  }

  const showToast = (message, type = "info") => {
    setToast({ message, type, id: Date.now() })
    setTimeout(() => setToast(null), 3000)
  }

  const handleSaveOffline = async () => {
    if (!currentUser || !currentClass?.id || offlineBusy) return

    const controller = new AbortController()
    offlineAbortRef.current = controller
    setOfflineBusy(true)
    setOfflineProgress(0)

    try {
      await saveOfflineVideo({
        user: currentUser,
        classId: currentClass.id,
        height: offlineQuality,
        signal: controller.signal,
        onProgress: setOfflineProgress,
      })
      setOfflineSaved(true)
      showToast("ভিডিওটি অফলাইনে দেখার জন্য সেভ হয়েছে", "success")
    } catch (error) {
      if (error.name !== "AbortError") {
        showToast(error.message || "অফলাইন ভিডিও সেভ করা যায়নি", "error")
      }
    } finally {
      if (offlineAbortRef.current === controller) offlineAbortRef.current = null
      setOfflineBusy(false)
    }
  }

  const handleRemoveOffline = async () => {
    if (!currentUser?.uid || !currentClass?.id || offlineBusy) return
    setOfflineBusy(true)
    try {
      await removeOfflineVideo(currentUser.uid, currentClass.id)
      setOfflineSaved(false)
      setOfflineProgress(0)
      showToast("অফলাইন কপি মুছে ফেলা হয়েছে", "success")
    } catch {
      showToast("অফলাইন কপি মুছতে সমস্যা হয়েছে", "error")
    } finally {
      setOfflineBusy(false)
    }
  }

  const organizeClasses = () => {
    if (course?.type === "batch") {
      const structure = {}
      classes.forEach((cls) => {
        const subject = cls.subject || "Uncategorized"
        const chapter = cls.chapter || "General"

        if (!structure[subject]) structure[subject] = {}
        if (!structure[subject][chapter]) structure[subject][chapter] = []
        structure[subject][chapter].push(cls)
      })
      return structure
    } else {
      const structure = {}
      classes.forEach((cls) => {
        const chapter = cls.chapter || "General"
        if (!structure[chapter]) structure[chapter] = []
        structure[chapter].push(cls)
      })
      return structure
    }
  }

  const classStructure = organizeClasses()

  const getDisplayClasses = () => {
    if (course?.type === "batch") {
      if (selectedSubject && selectedChapter) {
        return classStructure[selectedSubject]?.[selectedChapter] || []
      } else if (selectedSubject) {
        return Object.values(classStructure[selectedSubject] || {}).flat()
      }
      return [] // No subject selected yet
    } else {
      if (selectedChapter) {
        return classStructure[selectedChapter] || []
      }
      return [] // No chapter selected yet
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (courseNotFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Course Not Found</h2>
          <p className="text-muted-foreground mb-6">The course you're looking for doesn't exist or has been removed.</p>
          <button
            onClick={() => navigate("/courses")}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium"
          >
            Browse Courses
          </button>
        </div>
      </div>
    )
  }

  if (!course) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Course not found</h2>
          <p className="text-muted-foreground">The course you're looking for doesn't exist.</p>
        </div>
      </div>
    )
  }

  // Access control - only show videos if user has purchased
  if (!hasAccess && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">
            You need to purchase this course to watch the videos. Your payment will be reviewed by our admin team.
          </p>
          <div className="space-y-3">
            <Link
              to={`/course/${courseId}`}
              className="block w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium"
            >
              Purchase Course
            </Link>
            <Link
              to="/courses"
              className="block w-full py-3 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium"
            >
              Browse Other Courses
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Courses", href: "/courses" },
    { label: course?.title || "Loading...", href: `/course/${courseId}` },
    { label: "Watch" }
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <Breadcrumb items={breadcrumbItems} />
        <div className="max-w-5xl mx-auto">
          {/* Main Content - Video Player */}
          <div className="space-y-4 sm:space-y-6">
            {/* Video Player */}
            <div className="bg-card border border-border rounded-lg sm:rounded-xl overflow-hidden shadow-lg">
              <div className="aspect-video bg-black relative">
                {currentClass?.videoURL ? (
                  <CustomVideoPlayer
                    url={
                      offlineSaved &&
                      currentUser?.uid &&
                      RUMBLE_URL_PATTERN.test(currentClass.videoURL || "")
                        ? getOfflineVideoUrl(currentUser.uid, currentClass.id)
                        : currentClass.videoURL
                    }
                    onNext={handleNextVideo}
                    onPrevious={handlePreviousVideo}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white">
                    <div className="text-center">
                      <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p>No video available</p>
                    </div>
                  </div>
                )}
              </div>
              {currentClass?.videoURL && RUMBLE_URL_PATTERN.test(currentClass.videoURL) && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    {offlineBusy ? (
                      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
                    ) : offlineSaved ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Download className="h-4 w-4 shrink-0" />
                    )}
                    <span>
                      {offlineBusy
                        ? `অফলাইনের জন্য সেভ হচ্ছে${offlineProgress ? ` — ${offlineProgress}%` : "…"}`
                        : offlineSaved
                          ? "এই ডিভাইসে অফলাইনে পাওয়া যাবে"
                          : "ইন্টারনেট ছাড়াই পরে দেখুন"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!offlineSaved && (
                      <label className="sr-only" htmlFor={`offline-quality-${currentClass.id}`}>
                        অফলাইন ভিডিও কোয়ালিটি
                      </label>
                    )}
                    {!offlineSaved && (
                      <select
                        id={`offline-quality-${currentClass.id}`}
                      value={offlineQuality}
                      onChange={(event) => setOfflineQuality(Number(event.target.value))}
                      disabled={offlineBusy || offlineQualityLoading || offlineQualityOptions.length === 0}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                    >
                        {offlineQualityLoading && (
                          <option value={offlineQuality}>কোয়ালিটি খোঁজা হচ্ছে…</option>
                        )}
                        {!offlineQualityLoading && offlineQualityOptions.length === 0 && (
                          <option value={offlineQuality}>কোনো offline quality পাওয়া যায়নি</option>
                        )}
                        {offlineQualityOptions.map((option) => (
                          <option key={option.height} value={option.height}>
                            {option.height}p · {formatOfflineSize(option.contentLength)} · {getMobileQualityLabel(option.height)}
                          </option>
                        ))}
                      </select>
                    )}
                    {offlineSaved ? (
                      <button
                        type="button"
                        onClick={handleRemoveOffline}
                        disabled={offlineBusy}
                        className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        মুছে ফেলুন
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSaveOffline}
                        disabled={offlineBusy || offlineQualityLoading || offlineQualityOptions.length === 0}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {offlineBusy ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        অফলাইনে সেভ করুন
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            
            <div className="bg-card border border-border rounded-lg sm:rounded-xl p-4 sm:p-6 shadow-lg">
              <div className="flex items-start justify-between gap-4 mb-3">
                <h1 className="text-xl sm:text-2xl font-bold flex-1">{currentClass?.title || "Select a class to watch"}</h1>
                {viewCount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full">
                    <Eye className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-muted-foreground">{viewCount}</span>
                  </div>
                )}
              </div>

              {currentClass && currentClass.topic && (
                <div className="mb-4">
                  <p className="text-base sm:text-lg text-muted-foreground font-medium">{currentClass.topic}</p>
                </div>
              )}

              {currentClass && currentClass.duration && (
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Duration: {currentClass.duration}</span>
                </div>
              )}

              {currentUser && currentClass && (
                <ClassReactions classId={currentClass.id} currentUser={currentUser} />
              )}
            </div>

            {currentClass?.resourceLinks && currentClass.resourceLinks.length > 0 && (
              <div className="bg-card border border-border rounded-lg sm:rounded-xl p-4 sm:p-6 shadow-lg">
                <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 mb-4">
                  <FileText className="w-5 h-5 text-primary" />
                  Class Resources
                </h2>
                <div className="space-y-3">
                  {currentClass.resourceLinks.map((resource, index) => (
                    resource.label && resource.url && (
                      <ResourceViewer key={index} resource={resource} />
                    )
                  ))}
                </div>
              </div>
            )}

            {currentUser && currentClass && (
              <CommentsSection classId={currentClass.id} currentUser={currentUser} isAdmin={isAdmin} />
            )}

          </div>
        </div>
      </div>


      {/* Toast Notification Display */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div
            className={`px-6 py-3 rounded-lg shadow-lg backdrop-blur-sm ${
              toast.type === "success"
                ? "bg-green-500/90 text-white"
                : toast.type === "error"
                  ? "bg-red-500/90 text-white"
                  : "bg-gray-900/90 text-white"
            }`}
          >
            <p className="text-sm font-medium">{toast.message}</p>
          </div>
        </div>
      )}
    </div>
  )
}
