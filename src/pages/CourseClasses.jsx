"use client"

import { useEffect, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { Play, ArrowLeft, Lock, Archive, FileText } from "lucide-react"
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from "../lib/cacheV2Firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { isFirebaseId } from "../lib/utils/slugUtils"

const arrayValue = (value) => Array.isArray(value) ? value : value ? [value] : []

function isArchivedClass(cls) {
  if (cls.isArchived === true) return true
  return arrayValue(cls.subject).includes("archive") || arrayValue(cls.chapter).includes("archive")
}

export default function CourseClasses() {
  const { courseId, subject, chapter } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, isAdmin } = useAuth()
  const [course, setCourse] = useState(null)
  const [actualCourseId, setActualCourseId] = useState(null)
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [imageErrors, setImageErrors] = useState({})

  const isArchive = location.pathname.includes("/archive/")

  useEffect(() => {
    fetchCourseData()
  }, [courseId, currentUser?.uid, isAdmin])

  useEffect(() => {
    if (!actualCourseId) return

    const classesQuery = query(collection(db, "classes"), where("courseId", "==", actualCourseId))
    const unsubscribe = onSnapshot(
      classesQuery,
      (snapshot) => {
        let data = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        data = data.filter((item) => isArchive ? isArchivedClass(item) : !isArchivedClass(item))

        if (subject) {
          const decodedSubject = decodeURIComponent(subject)
          data = data.filter((item) => arrayValue(item.subject).includes(decodedSubject))
        }
        if (chapter) {
          const decodedChapter = decodeURIComponent(chapter)
          data = data.filter((item) => arrayValue(item.chapter).includes(decodedChapter))
        }

        data.sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        setClasses(data)
      },
      (error) => console.error("Error reading cached classes:", error),
    )

    // Cache V2's onSnapshot is not a permanent server listener for public content.
    // It renders the trusted persistent query cache immediately, then re-runs locally
    // whenever PermanentCacheSyncAgent syncs a changed class document from the server.
    return unsubscribe
  }, [actualCourseId, subject, chapter, isArchive])

  const fetchCourseData = async () => {
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
        const userCourseDoc = await getDoc(doc(db, "userCourses", `${currentUser.uid}_${resolvedCourseId}`))
        if (userCourseDoc.exists()) {
          setHasAccess(true)
        } else {
          const paymentsSnapshot = await getDocs(query(
            collection(db, "payments"),
            where("userId", "==", currentUser.uid),
            where("status", "==", "approved"),
          ))
          setHasAccess(paymentsSnapshot.docs.some((item) => item.data().courses?.some((entry) => entry.id === resolvedCourseId)))
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" /></div>
  }

  if (courseNotFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6"><Lock className="w-10 h-10 text-red-500" /></div>
          <h2 className="text-2xl font-bold mb-3">Course Not Found</h2>
          <p className="text-muted-foreground mb-6">The course you're looking for doesn't exist or has been removed.</p>
          <button onClick={() => navigate("/courses")} className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium">Browse Courses</button>
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
          <button onClick={() => navigate(`/course/${courseId}`)} className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium">Purchase Course</button>
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
              if (isArchive && subject) navigate(`/course/${courseId}/archive/${subject}/chapters`)
              else if (subject) navigate(`/course/${courseId}/subjects/${subject}/chapters`)
              else navigate(`/course/${courseId}/chapters`)
            }}
            className="flex items-center gap-2 text-primary hover:text-primary/80 mb-4"
          >
            <ArrowLeft className="w-5 h-5" />Back to Chapters
          </button>
          <h1 className="text-3xl font-bold mb-2">{course?.title}</h1>
          <div className="text-muted-foreground">
            {isArchive && <div className="flex items-center gap-2 mb-1"><Archive className="w-4 h-4 text-primary" /><span className="font-medium">Archive</span></div>}
            <div>{chapter && `Chapter: ${decodeURIComponent(chapter)}`}{subject && !isArchive && ` • Subject: ${decodeURIComponent(subject)}`}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {classes.map((cls, index) => (
            <motion.button
              key={cls.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.06, 0.36) }}
              onClick={() => navigate(`/course/${courseId}/watch/${cls.id}`)}
              className="group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all text-left flex flex-col"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative w-full h-48 overflow-hidden bg-muted flex-shrink-0">
                {cls.imageURL && !imageErrors[cls.id] ? (
                  <><img src={cls.imageURL} alt={cls.title} className="w-full h-full object-cover" loading="lazy" onError={() => setImageErrors((current) => ({ ...current, [cls.id]: true }))} /><div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" /></>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary/10 group-hover:bg-primary/20"><Play className="w-12 h-12 fill-current text-primary" /></div>
                )}
              </div>
              <div className="relative p-6 flex-1 flex flex-col">
                <h3 className="text-lg font-bold mb-3 line-clamp-2 group-hover:text-primary">{cls.title}</h3>
                {arrayValue(cls.teacherName).length > 0 && <div className="mb-2 text-sm text-muted-foreground"><span className="truncate">{arrayValue(cls.teacherName).join(", ")}</span></div>}
                {Array.isArray(cls.resourceLinks) && cls.resourceLinks.length > 0 && (
                  <div className="mt-auto pt-3 space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium mb-1"><FileText className="w-4 h-4" /><span>Resources:</span></div>
                    <div className="pl-6 space-y-1">{cls.resourceLinks.map((resource, resourceIndex) => <div key={resourceIndex} className="text-sm text-muted-foreground truncate">• {resource.label || `Resource ${resourceIndex + 1}`}</div>)}</div>
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>

        {classes.length === 0 && <div className="text-center py-12"><p className="text-muted-foreground text-lg">No classes found {isArchive ? "in this archived chapter" : "for this selection"}.</p></div>}
      </div>
    </div>
  )
}
