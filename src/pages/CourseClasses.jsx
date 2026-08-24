"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { Play, ArrowLeft, Lock, Archive, FileText, BookOpen, Layers3 } from "lucide-react"
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from "../lib/cacheV2Firestore"
import { doc as firestoreDoc, getDoc as getFirestoreDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { isFirebaseId } from "../lib/utils/slugUtils"

const arrayValue = (value) => Array.isArray(value) ? value : value ? [value] : []

function isArchivedClass(cls) {
  if (cls.isArchived === true) return true
  return arrayValue(cls.subject).includes("archive") || arrayValue(cls.chapter).includes("archive")
}

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))

export default function CourseClasses() {
  const { courseId, subject, chapter } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, isAdmin } = useAuth()
  const [course, setCourse] = useState(null)
  const [actualCourseId, setActualCourseId] = useState(null)
  const [classes, setClasses] = useState([])
  const [classGroup, setClassGroup] = useState(null)
  const [groupMissing, setGroupMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [imageErrors, setImageErrors] = useState({})

  const isArchive = location.pathname.includes("/archive/")
  const groupId = chapter?.startsWith("__group__") ? chapter.slice("__group__".length) : ""
  const isGroup = Boolean(groupId)
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const groupSubject = searchParams.get("subject") || ""
  const groupChapter = searchParams.get("chapter") || ""

  useEffect(() => {
    fetchCourseData()
  }, [courseId, currentUser?.uid, isAdmin, groupId])

  useEffect(() => {
    if (!actualCourseId) return

    const classesQuery = query(collection(db, "classes"), where("courseId", "==", actualCourseId))
    const unsubscribe = onSnapshot(
      classesQuery,
      (snapshot) => {
        let data = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))

        // Legacy classes do not have isPublished. Only explicit false is hidden from students.
        if (!isAdmin) data = data.filter((item) => item.isPublished !== false)

        if (isGroup) {
          data = data.filter((item) => !isArchivedClass(item) && item.classGroupId === groupId)
        } else {
          data = data.filter((item) => isArchive
            ? isArchivedClass(item)
            : !isArchivedClass(item) && !item.classGroupId)

          if (subject) {
            const decodedSubject = decodeURIComponent(subject)
            data = data.filter((item) => arrayValue(item.subject).includes(decodedSubject))
          }
          if (chapter) {
            const decodedChapter = decodeURIComponent(chapter)
            data = data.filter((item) => arrayValue(item.chapter).includes(decodedChapter))
          }
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
  }, [actualCourseId, subject, chapter, isArchive, isGroup, groupId, isAdmin])

  const fetchCourseData = async () => {
    setLoading(true)
    setCourseNotFound(false)
    setGroupMissing(false)
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

      if (isGroup) {
        const groupDoc = await getFirestoreDoc(firestoreDoc(db, "classGroups", groupId))
        if (!groupDoc.exists()) {
          setClassGroup(null)
          setGroupMissing(true)
        } else {
          const groupData = { id: groupDoc.id, ...groupDoc.data() }
          const belongsToCourse = groupData.courseId === resolvedCourseId
          const allowedToSee = isAdmin || groupData.isVisible !== false
          if (!belongsToCourse || !allowedToSee) {
            setClassGroup(null)
            setGroupMissing(true)
          } else {
            setClassGroup(groupData)
          }
        }
      } else {
        setClassGroup(null)
      }

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

  const groupSubjects = useMemo(() => uniqueSorted(
    classes.flatMap((item) => arrayValue(item.subject)).filter((value) => value !== "archive"),
  ), [classes])

  const groupChapterSource = useMemo(() => {
    if (!isGroup) return []
    if ((course?.type || "subject") === "batch" && groupSubject) {
      return classes.filter((item) => arrayValue(item.subject).includes(groupSubject))
    }
    return classes
  }, [classes, course?.type, groupSubject, isGroup])

  const groupChapters = useMemo(() => uniqueSorted(
    groupChapterSource
      .flatMap((item) => arrayValue(item.chapter).length ? arrayValue(item.chapter) : ["General"])
      .filter((value) => value !== "archive"),
  ), [groupChapterSource])

  const finalGroupClasses = useMemo(() => {
    if (!isGroup || !groupChapter) return classes
    return groupChapterSource.filter((item) => {
      const chapters = arrayValue(item.chapter).length ? arrayValue(item.chapter) : ["General"]
      return chapters.includes(groupChapter)
    })
  }, [classes, groupChapterSource, groupChapter, isGroup])

  const groupBasePath = isGroup ? `/course/${courseId}/classes/__group__${groupId}` : ""
  const isBatchGroup = isGroup && (course?.type || "subject") === "batch"
  const showGroupSubjects = isBatchGroup && !groupSubject
  const showGroupChapters = isGroup && !showGroupSubjects && !groupChapter
  const shownClasses = isGroup ? finalGroupClasses : classes

  const handleBack = () => {
    if (isGroup) {
      if (groupChapter) {
        if (isBatchGroup) {
          navigate(`${groupBasePath}?subject=${encodeURIComponent(groupSubject)}`)
        } else {
          navigate(groupBasePath)
        }
        return
      }
      if (isBatchGroup && groupSubject) {
        navigate(groupBasePath)
        return
      }
      navigate((course?.type || "subject") === "batch" ? `/course/${courseId}/subjects` : `/course/${courseId}/chapters`)
      return
    }

    if (isArchive && subject) navigate(`/course/${courseId}/archive/${subject}/chapters`)
    else if (subject) navigate(`/course/${courseId}/subjects/${subject}/chapters`)
    else navigate(`/course/${courseId}/chapters`)
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

  if (isGroup && groupMissing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
          <Layers3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Class card not available</h2>
          <p className="text-sm text-muted-foreground mb-5">This card was removed, hidden, or does not belong to this course.</p>
          <button onClick={handleBack} className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg">Back to course</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <div className="mb-8">
          <button onClick={handleBack} className="flex items-center gap-2 text-primary hover:text-primary/80 mb-4">
            <ArrowLeft className="w-5 h-5" />Back
          </button>
          <h1 className="text-3xl font-bold mb-2">{course?.title}</h1>
          <div className="text-muted-foreground">
            {isGroup ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-medium text-foreground"><Layers3 className="w-4 h-4 text-primary" />{classGroup?.title}</div>
                {groupSubject && <div>Subject: {groupSubject}</div>}
                {groupChapter && <div>Chapter: {groupChapter}</div>}
              </div>
            ) : (
              <>
                {isArchive && <div className="flex items-center gap-2 mb-1"><Archive className="w-4 h-4 text-primary" /><span className="font-medium">Archive</span></div>}
                <div>{chapter && `Chapter: ${decodeURIComponent(chapter)}`}{subject && !isArchive && ` • Subject: ${decodeURIComponent(subject)}`}</div>
              </>
            )}
          </div>
        </div>

        {showGroupSubjects && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groupSubjects.map((name, index) => (
              <motion.button
                key={name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.06, 0.36) }}
                onClick={() => navigate(`${groupBasePath}?subject=${encodeURIComponent(name)}`)}
                className="group relative bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:shadow-lg transition-all text-left"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4"><BookOpen className="w-6 h-6 text-primary" /></div>
                <h3 className="text-lg font-bold group-hover:text-primary">{name}</h3>
                <p className="text-sm text-muted-foreground mt-2">View chapters</p>
              </motion.button>
            ))}
          </div>
        )}

        {showGroupChapters && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groupChapters.map((name, index) => {
              const queryParts = []
              if (isBatchGroup && groupSubject) queryParts.push(`subject=${encodeURIComponent(groupSubject)}`)
              queryParts.push(`chapter=${encodeURIComponent(name)}`)
              return (
                <motion.button
                  key={name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.06, 0.36) }}
                  onClick={() => navigate(`${groupBasePath}?${queryParts.join("&")}`)}
                  className="group relative bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:shadow-lg transition-all text-left"
                >
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4"><BookOpen className="w-6 h-6 text-primary" /></div>
                  <h3 className="text-lg font-bold group-hover:text-primary">{name}</h3>
                  <p className="text-sm text-muted-foreground mt-2">View classes</p>
                </motion.button>
              )
            })}
          </div>
        )}

        {!showGroupSubjects && !showGroupChapters && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {shownClasses.map((cls, index) => (
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
        )}

        {showGroupSubjects && groupSubjects.length === 0 && (
          <div className="text-center py-12"><p className="text-muted-foreground text-lg">No subjects found in this card.</p></div>
        )}
        {showGroupChapters && groupChapters.length === 0 && (
          <div className="text-center py-12"><p className="text-muted-foreground text-lg">No chapters found in this card.</p></div>
        )}
        {!showGroupSubjects && !showGroupChapters && shownClasses.length === 0 && (
          <div className="text-center py-12"><p className="text-muted-foreground text-lg">No classes found {isArchive ? "in this archived chapter" : isGroup ? "in this card selection" : "for this selection"}.</p></div>
        )}
      </div>
    </div>
  )
}