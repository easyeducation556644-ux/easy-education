"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { Play, ArrowLeft, Lock, Clock, User, Archive, FileText } from "lucide-react"
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { isFirebaseId } from "../lib/utils/slugUtils"

export default function CourseClasses() {
  const { courseId, subject, chapter } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, isAdmin } = useAuth()
  const [course, setCourse] = useState(null)
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [imageErrors, setImageErrors] = useState({})

  const isArchive = location.pathname.includes("/archive/")

  useEffect(() => {
    fetchCourseData()
  }, [courseId, subject, chapter])

  const fetchCourseData = async () => {
    try {
      let courseData = null
      let actualCourseId = courseId
      
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
          actualCourseId = courseDoc.id
        }
      }
      
      if (courseData) {
        setCourse(courseData)

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
            return payment.courses?.some((c) => c.id === actualCourseId)
          })
          setHasAccess(hasApprovedCourse)
        }

        const classesQuery = query(collection(db, "classes"), where("courseId", "==", actualCourseId))
        const classesSnapshot = await getDocs(classesQuery)
        let classesData = classesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))

        const isClassArchived = (cls) => {
          if (cls.isArchived === true) return true
          const subjectIsArchive = Array.isArray(cls.subject)
            ? cls.subject.includes("archive")
            : cls.subject === "archive"
          const chapterIsArchive = Array.isArray(cls.chapter)
            ? cls.chapter.includes("archive")
            : cls.chapter === "archive"
          return subjectIsArchive || chapterIsArchive
        }

        if (isArchive) {
          classesData = classesData.filter((cls) => isClassArchived(cls))
        } else {
          classesData = classesData.filter((cls) => !isClassArchived(cls))
        }

        if (subject) {
          const decodedSubject = decodeURIComponent(subject)
          classesData = classesData.filter((cls) => {
            if (Array.isArray(cls.subject)) {
              return cls.subject.includes(decodedSubject)
            }
            return cls.subject === decodedSubject
          })
        }
        if (chapter) {
          const decodedChapter = decodeURIComponent(chapter)
          classesData = classesData.filter((cls) => {
            if (Array.isArray(cls.chapter)) {
              return cls.chapter.includes(decodedChapter)
            }
            return cls.chapter === decodedChapter
          })
        }

        classesData.sort((a, b) => a.order - b.order)
        setClasses(classesData)
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

  if (!hasAccess && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">You need to purchase this course to watch the videos.</p>
          <button
            onClick={() => navigate(`/course/${courseId}`)}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium"
          >
            Purchase Course
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <div className="mb-8">
          <button
            onClick={() => {
              if (isArchive && subject) {
                navigate(`/course/${courseId}/archive/${subject}/chapters`)
              } else if (subject && course?.type === "batch") {
                navigate(`/course/${courseId}/subjects/${subject}/chapters`)
              } else if (subject && !course?.type) {
                navigate(`/course/${courseId}/subjects/${subject}/chapters`)
              } else if (!subject) {
                navigate(`/course/${courseId}/chapters`)
              } else {
                navigate(`/course/${courseId}/subjects`)
              }
            }}
            className="flex items-center gap-2 text-primary hover:text-primary/80 mb-4 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Chapters
          </button>
          <h1 className="text-3xl font-bold mb-2">{course?.title}</h1>
          <div className="text-muted-foreground">
            {isArchive && (
              <div className="flex items-center gap-2 mb-1">
                <Archive className="w-4 h-4 text-primary" />
                <span className="font-medium">Archive</span>
              </div>
            )}
            <div>
              {chapter && `Chapter: ${decodeURIComponent(chapter)}`}
              {subject && !isArchive && ` • Subject: ${decodeURIComponent(subject)}`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {classes.map((cls, index) => (
            <motion.button
              key={cls.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => navigate(`/course/${courseId}/watch/${cls.id}`)}
              className="group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              
              {/* Class Image */}
              {cls.imageURL && !imageErrors[cls.id] && (
                <div className="relative w-full h-48 overflow-hidden bg-muted">
                  <img
                    src={cls.imageURL}
                    alt={cls.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={() => {
                      setImageErrors((prev) => ({ ...prev, [cls.id]: true }))
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}

              <div className="relative p-6">
                {(!cls.imageURL || imageErrors[cls.id]) && (
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-colors bg-primary/10 group-hover:bg-primary/20">
                    <Play className="w-6 h-6 fill-current text-primary" />
                  </div>
                )}
                <h3 className="text-lg font-bold mb-3 line-clamp-2 transition-colors group-hover:text-primary">
                  {cls.title}
                </h3>

                {cls.teacherName && (
                  <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                    <User className="w-4 h-4" />
                    <span className="truncate">{cls.teacherName}</span>
                  </div>
                )}

                {cls.duration && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>{cls.duration}</span>
                  </div>
                )}

                {cls.resourceLinks && cls.resourceLinks.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>{cls.resourceLinks.length} Resource{cls.resourceLinks.length > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>

        {classes.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              No classes found {isArchive ? "in this archived chapter" : "for this selection"}.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
