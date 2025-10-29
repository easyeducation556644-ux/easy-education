"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { ThumbsUp, ThumbsDown, Play, BookOpen, GraduationCap, User, Award, Clock, Lock, FileQuestion, FileText, ExternalLink } from "lucide-react"
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
} from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"
import CustomVideoPlayer from "../components/CustomVideoPlayer"
import ExamCard from "../components/ExamCard"
import Breadcrumb from "../components/Breadcrumb"
import ResourceViewer from "../components/ResourceViewer"
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
  const [userReaction, setUserReaction] = useState(null) // 'like' or 'dislike' or null
  const [reactionDocId, setReactionDocId] = useState(null)
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
      checkUserReaction()
    }
  }, [currentClass, currentUser])

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
          const paymentsQuery = query(
            collection(db, "payments"),
            where("userId", "==", currentUser.uid),
            where("status", "==", "approved"),
          )
          const paymentsSnapshot = await getDocs(paymentsQuery)

          const hasApprovedCourse = paymentsSnapshot.docs.some((doc) => {
            const payment = doc.data()
            return payment.courses?.some((c) => c.id === resolvedCourseId)
          })
          setHasAccess(hasApprovedCourse)
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

  const checkUserReaction = async () => {
    if (!currentUser || !currentClass) return

    try {
      const votesQuery = query(
        collection(db, "votes"),
        where("userId", "==", currentUser.uid),
        where("classId", "==", currentClass.id),
      )
      const votesSnapshot = await getDocs(votesQuery)

      if (!votesSnapshot.empty) {
        const voteDoc = votesSnapshot.docs[0]
        setUserReaction(voteDoc.data().type) // 'like' or 'dislike'
        setReactionDocId(voteDoc.id)
      } else {
        setUserReaction(null)
        setReactionDocId(null)
      }
    } catch (error) {
      console.error("Error checking reaction:", error)
    }
  }

  const handleReaction = async (type) => {
    if (!currentUser || !currentClass) return

    try {
      // If clicking the same reaction, remove it
      if (userReaction === type && reactionDocId) {
        await deleteDoc(doc(db, "votes", reactionDocId))

        // Update class counts
        if (type === "like") {
          await updateDoc(doc(db, "classes", currentClass.id), {
            likesCount: increment(-1),
          })
          setCurrentClass({ ...currentClass, likesCount: (currentClass.likesCount || 0) - 1 })
        } else {
          await updateDoc(doc(db, "classes", currentClass.id), {
            dislikesCount: increment(-1),
          })
          setCurrentClass({ ...currentClass, dislikesCount: (currentClass.dislikesCount || 0) - 1 })
        }

        setUserReaction(null)
        setReactionDocId(null)
      } else {
        // If switching reaction, remove old one first
        if (reactionDocId) {
          await deleteDoc(doc(db, "votes", reactionDocId))

          // Decrement old reaction count
          if (userReaction === "like") {
            await updateDoc(doc(db, "classes", currentClass.id), {
              likesCount: increment(-1),
            })
            setCurrentClass({ ...currentClass, likesCount: (currentClass.likesCount || 0) - 1 })
          } else {
            await updateDoc(doc(db, "classes", currentClass.id), {
              dislikesCount: increment(-1),
            })
            setCurrentClass({ ...currentClass, dislikesCount: (currentClass.dislikesCount || 0) - 1 })
          }
        }

        // Add new reaction
        const voteDoc = await addDoc(collection(db, "votes"), {
          userId: currentUser.uid,
          classId: currentClass.id,
          type: type, // 'like' or 'dislike'
          timestamp: serverTimestamp(),
        })

        // Increment new reaction count
        if (type === "like") {
          await updateDoc(doc(db, "classes", currentClass.id), {
            likesCount: increment(1),
          })
          setCurrentClass({ ...currentClass, likesCount: (currentClass.likesCount || 0) + 1 })
        } else {
          await updateDoc(doc(db, "classes", currentClass.id), {
            dislikesCount: increment(1),
          })
          setCurrentClass({ ...currentClass, dislikesCount: (currentClass.dislikesCount || 0) + 1 })
        }

        setUserReaction(type)
        setReactionDocId(voteDoc.id)
      }
    } catch (error) {
      console.error("Error handling reaction:", error)
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
              <h1 className="text-xl sm:text-2xl font-bold mb-3">{currentClass?.title || "Select a class to watch"}</h1>

              {currentClass && currentClass.duration && (
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Duration: {currentClass.duration}</span>
                </div>
              )}

              {currentUser && currentClass && (
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    onClick={() => handleReaction("like")}
                    className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg transition-all text-sm sm:text-base ${
                      userReaction === "like"
                        ? "bg-primary text-primary-foreground shadow-lg"
                        : "bg-muted hover:bg-muted/80 text-foreground"
                    }`}
                  >
                    <ThumbsUp className={`w-4 h-4 sm:w-5 sm:h-5 ${userReaction === "like" ? "fill-current" : ""}`} />
                    <span className="font-medium">{currentClass.likesCount || 0}</span>
                  </button>

                  <button
                    onClick={() => handleReaction("dislike")}
                    className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg transition-all text-sm sm:text-base ${
                      userReaction === "dislike"
                        ? "bg-red-500 text-white shadow-lg"
                        : "bg-muted hover:bg-muted/80 text-foreground"
                    }`}
                  >
                    <ThumbsDown
                      className={`w-4 h-4 sm:w-5 sm:h-5 ${userReaction === "dislike" ? "fill-current" : ""}`}
                    />
                    <span className="font-medium">{currentClass.dislikesCount || 0}</span>
                  </button>
                </div>
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

          </div>
          {currentClass?.teacherName && (
              <div className="bg-gradient-to-br from-primary/10 via-secondary/5 to-primary/5 border-2 border-primary/20 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
                  <div className="relative flex-shrink-0">
                    {currentClass.teacherImageURL ? (
                      <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary rounded-full blur-md opacity-50"></div>
                        <img
                          src={currentClass.teacherImageURL || "/placeholder.svg"}
                          alt={currentClass.teacherName}
                          className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-4 border-background shadow-xl"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-xl border-4 border-background">
                        <User className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 sm:w-8 sm:h-8 bg-primary rounded-full flex items-center justify-center border-2 border-background shadow-lg">
                      <GraduationCap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                    </div>
                  </div>

                  <div className="flex-1 text-center sm:text-left">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                      Instructor
                    </p>
                    <h3 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                      {currentClass.teacherName}
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-foreground">Teaching with dedication and excellence</p>
                  </div>

                  <div className="hidden md:block">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <Award className="w-7 h-7 sm:w-8 sm:h-8 text-primary" />
                    </div>
                  </div>
                </div>
              </div>
            )}
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
