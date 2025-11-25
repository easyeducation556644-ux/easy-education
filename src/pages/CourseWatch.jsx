"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Eye, Play, BookOpen, GraduationCap, User, Award, Clock, Lock, FileQuestion, FileText, ExternalLink } from "lucide-react"
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

    try {
      const viewRef = doc(db, "classViews", `${currentUser.uid}_${currentClass.id}`)
      await setDoc(
        viewRef,
        {
          userId: currentUser.uid,
          classId: currentClass.id,
          timestamp: serverTimestamp(),
        },
        { merge: true }
      )
    } catch (error) {
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
                    url={currentClass.videoURL}
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
