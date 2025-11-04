"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { BookOpen, ArrowLeft, Lock, Archive, Send, CheckCircle2, FileQuestion } from "lucide-react"
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"
import { toast as showGlobalToast } from "../hooks/use-toast"
import { isFirebaseId } from "../lib/utils/slugUtils"

export default function CourseChapters() {
  const { courseId, subject } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, isAdmin } = useAuth()
  const { getExamsByCourse } = useExam()
  const [course, setCourse] = useState(null)
  const [actualCourseId, setActualCourseId] = useState(null)
  const [chapters, setChapters] = useState([])
  const [chapterData, setChapterData] = useState([])
  const [subjects, setSubjects] = useState([])
  const [subjectData, setSubjectData] = useState([])
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [telegramId, setTelegramId] = useState("")
  const [telegramMobile, setTelegramMobile] = useState("")
  const [telegramSubmitted, setTelegramSubmitted] = useState(false)
  const [submittingTelegram, setSubmittingTelegram] = useState(false)

  const isArchiveRoot = subject && decodeURIComponent(subject) === "archive"
  const isArchiveSubject = location.pathname.includes("/archive/")
  const isArchive = isArchiveRoot || isArchiveSubject

  useEffect(() => {
    fetchCourseData()
  }, [courseId, subject])

  useEffect(() => {
    if (currentUser && actualCourseId) {
      checkTelegramSubmission()
    }
  }, [currentUser, actualCourseId])

  const checkTelegramSubmission = async () => {
    if (!currentUser || !actualCourseId) return
    
    try {
      const submissionQuery = query(
        collection(db, "telegramSubmissions"),
        where("userId", "==", currentUser.uid),
        where("courseId", "==", actualCourseId)
      )
      const submissionSnapshot = await getDocs(submissionQuery)
      setTelegramSubmitted(!submissionSnapshot.empty)
    } catch (error) {
      console.error("Error checking telegram submission:", error)
    }
  }

  const handleTelegramSubmit = async (e) => {
    e.preventDefault()
    if (!currentUser || !telegramId.trim() || !telegramMobile.trim() || telegramSubmitted) return

    setSubmittingTelegram(true)

    try {
      await addDoc(collection(db, "telegramSubmissions"), {
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email,
        userEmail: currentUser.email,
        telegramId: telegramId.trim(),
        telegramMobile: telegramMobile.trim(),
        courseId: actualCourseId,
        courseName: course?.title || "",
        submittedAt: serverTimestamp()
      })

      setTelegramSubmitted(true)
      setTelegramId("")
      setTelegramMobile("")
      showGlobalToast({
        title: "Success!",
        description: "Telegram information submitted successfully!",
      })
    } catch (error) {
      console.error("Error submitting telegram info:", error)
      showGlobalToast({
        variant: "destructive",
        title: "Error",
        description: "Failed to submit. Please try again.",
      })
    } finally {
      setSubmittingTelegram(false)
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

        if (isArchiveRoot) {
          const archivedClasses = classesData.filter((cls) => isClassArchived(cls))
          classesData = archivedClasses

          const subjectChapterMap = {}
          archivedClasses.forEach((cls) => {
            const subjects = Array.isArray(cls.subject) ? cls.subject : [cls.subject]
            subjects.forEach((s) => {
              if (s && s !== "archive") {
                if (!subjectChapterMap[s]) {
                  subjectChapterMap[s] = new Set()
                }
                const chapters = Array.isArray(cls.chapter) ? cls.chapter : [cls.chapter || "General"]
                chapters.forEach((ch) => {
                  if (ch && ch !== "archive") {
                    subjectChapterMap[s].add(ch)
                  }
                })
              }
            })
          })

          const subjectsWithClasses = Object.keys(subjectChapterMap).filter(subject => {
            return subjectChapterMap[subject].size > 0
          })
          const uniqueSubjects = subjectsWithClasses.sort()
          setSubjects(uniqueSubjects)
          setChapters([])
          
          const subjectsSnapshot = await getDocs(collection(db, "subjects"))
          const fetchedSubjects = subjectsSnapshot.docs
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
            .filter((s) => {
              if (s.courseIds && Array.isArray(s.courseIds)) {
                return s.courseIds.includes(resolvedCourseId) || s.courseIds.includes('archive')
              }
              return s.courseId === resolvedCourseId
            })
          setSubjectData(fetchedSubjects)
        } else if (isArchiveSubject && subject) {
          const decodedSubject = decodeURIComponent(subject)
          const filteredClasses = classesData.filter((cls) => {
            if (!isClassArchived(cls)) return false
            if (Array.isArray(cls.subject)) {
              return cls.subject.includes(decodedSubject)
            }
            return cls.subject === decodedSubject
          })
          classesData = filteredClasses

          const chapterClassCount = {}
          filteredClasses.forEach((cls) => {
            const chapters = Array.isArray(cls.chapter) ? cls.chapter : [cls.chapter || "General"]
            chapters.forEach((ch) => {
              if (ch && ch !== "archive") {
                chapterClassCount[ch] = (chapterClassCount[ch] || 0) + 1
              }
            })
          })

          const chaptersWithClasses = Object.keys(chapterClassCount).filter(ch => chapterClassCount[ch] > 0)
          const uniqueChapters = chaptersWithClasses.sort()
          setChapters(uniqueChapters)
          setSubjects([])
          
          const chaptersSnapshot = await getDocs(collection(db, "chapters"))
          const fetchedChapters = chaptersSnapshot.docs
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
            .filter((c) => {
              if (c.courseIds && Array.isArray(c.courseIds)) {
                return c.courseIds.includes(resolvedCourseId) || c.courseIds.includes('archive')
              }
              return c.courseId === resolvedCourseId
            })
          setChapterData(fetchedChapters)
        } else if (subject) {
          const decodedSubject = decodeURIComponent(subject)
          const filteredClasses = classesData.filter((cls) => {
            if (isClassArchived(cls)) return false
            if (Array.isArray(cls.subject)) {
              return cls.subject.includes(decodedSubject)
            }
            return cls.subject === decodedSubject
          })
          classesData = filteredClasses

          const chapterClassCount = {}
          filteredClasses.forEach((cls) => {
            const chapters = Array.isArray(cls.chapter) ? cls.chapter : [cls.chapter || "General"]
            chapters.forEach((ch) => {
              if (ch && ch !== "archive") {
                chapterClassCount[ch] = (chapterClassCount[ch] || 0) + 1
              }
            })
          })

          const chaptersWithClasses = Object.keys(chapterClassCount).filter(ch => chapterClassCount[ch] > 0)
          const uniqueChapters = chaptersWithClasses.sort()
          setChapters(uniqueChapters)
          setSubjects([])
          
          const chaptersSnapshot = await getDocs(collection(db, "chapters"))
          const fetchedChapters = chaptersSnapshot.docs
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
            .filter((c) => {
              if (c.courseIds && Array.isArray(c.courseIds)) {
                return c.courseIds.includes(resolvedCourseId) || c.courseIds.includes('archive')
              }
              return c.courseId === resolvedCourseId
            })
          setChapterData(fetchedChapters)
        } else {
          const filteredClasses = classesData.filter((cls) => !isClassArchived(cls))
          classesData = filteredClasses

          const chapterClassCount = {}
          filteredClasses.forEach((cls) => {
            const chapters = Array.isArray(cls.chapter) ? cls.chapter : [cls.chapter || "General"]
            chapters.forEach((ch) => {
              if (ch && ch !== "archive") {
                chapterClassCount[ch] = (chapterClassCount[ch] || 0) + 1
              }
            })
          })

          const chaptersWithClasses = Object.keys(chapterClassCount).filter(ch => chapterClassCount[ch] > 0)
          const uniqueChapters = chaptersWithClasses.sort()
          setChapters(uniqueChapters)
          setSubjects([])
          
          const chaptersSnapshot = await getDocs(collection(db, "chapters"))
          const fetchedChapters = chaptersSnapshot.docs
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
            .filter((c) => {
              if (c.courseIds && Array.isArray(c.courseIds)) {
                return c.courseIds.includes(resolvedCourseId) || c.courseIds.includes('archive')
              }
              return c.courseId === resolvedCourseId
            })
          setChapterData(fetchedChapters)
        }

        const examsData = await getExamsByCourse(resolvedCourseId)
        setExams(examsData)
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
              if (isArchiveSubject && subject && !isArchiveRoot) {
                navigate(`/course/${courseId}/subjects/archive/chapters`)
              } else if (subject) {
                navigate(`/course/${courseId}/subjects`)
              } else {
                navigate(`/course/${courseId}`)
              }
            }}
            className="flex items-center gap-2 text-primary hover:text-primary/80 mb-4 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            {isArchiveSubject && !isArchiveRoot
              ? "Back to Archive Subjects"
              : subject
                ? "Back to Subjects"
                : "Back to Course"}
          </button>
          <h1 className="text-3xl font-bold mb-2">{course?.title}</h1>
          <p className="text-muted-foreground">
            {isArchive ? (
              <span className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-primary" />
                Archive
              </span>
            ) : subject ? (
              `Subject: ${decodeURIComponent(subject)} - Select a chapter`
            ) : (
              "Select a chapter to view classes"
            )}
          </p>
        </div>

        {/* Telegram Join Section - Only show on first page (subject-based courses or archive root) */}
        {course?.telegramLink && !subject && !isArchiveSubject && (
          <div className="bg-gradient-to-br from-blue-50/80 to-cyan-50/50 dark:from-blue-950/30 dark:to-cyan-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-4 md:p-5 mb-6 shadow-lg max-w-4xl">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg md:text-xl font-bold mb-1.5 flex items-center gap-2">
                  <Send className="w-4 h-4 md:w-5 md:h-5 text-blue-600 dark:text-blue-400" />
                  <span className="bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                    Join Telegram Community
                  </span>
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground">
                  Get updates and connect with instructors and students
                </p>
              </div>

              <a
                href={course.telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 py-2 md:py-2.5 px-4 md:px-5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium text-center shadow-md hover:shadow-lg text-sm flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>Join Group</span>
              </a>
            </div>

            <div className="border-t border-blue-200 dark:border-blue-800 pt-3">
              <h3 className="font-semibold mb-2.5 text-xs md:text-sm">Submit Your Telegram Information</h3>
              <p className="block text-xs font-medium text-muted-foreground mb-1.5">
টেলিগ্রাম গ্রুপে জয়েন রিকুয়েষ্ট দেওয়ার আগে নিচের ফর্মটা সাবমিট করে তারপর রিকুয়েষ্ট দিবে, ফর্মটা একবারের বেশি সাবমিট করা যাবেনা তাই সঠিক ইনফর্মেশন দিয়ে সাবমিট করবে। আর রিকুয়েষ্ট দেওয়ার পর অপেক্ষা করবে আমরা সময় মতো তোমাকে গ্রুপে এড করে নিবো।</p>
              
              {telegramSubmitted ? (
                <div className="space-y-3">
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-700 dark:text-green-300 text-xs mb-0.5">
                        Information Submitted Successfully!
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        You have successfully submitted your Telegram information. Now you can join the Telegram group using the button below.
                      </p>
                    </div>
                  </div>
                  
                  <a
                    href={course.telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 py-2.5 px-5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium shadow-md hover:shadow-lg text-sm"
                  >
                    <Send className="w-4 h-4" />
                    <span>Join Telegram Group</span>
                  </a>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold mb-2.5 text-xs md:text-sm">Submit Your Telegram Information</h3>
                  <p className="block text-xs font-medium text-muted-foreground mb-1.5">
টেলিগ্রাম গ্রুপে জয়েন রিকুয়েষ্ট দেওয়ার আগে নিচের ফর্মটা সাবমিট করে তারপর রিকুয়েষ্ট দিবে, ফর্মটা একবারের বেশি সাবমিট করা যাবেনা তাই সঠিক ইনফর্মেশন দিয়ে সাবমিট করবে। আর রিকুয়েষ্ট দেওয়ার পর অপেক্ষা করবে আমরা সময় মতো তোমাকে গ্রুপে এড করে নিবো।</p>
                  
                  <form onSubmit={handleTelegramSubmit} className="space-y-2.5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Webapp Account Name
                      </label>
                      <input
                        type="text"
                        value={currentUser?.displayName || currentUser?.email || ""}
                        disabled
                        className="w-full px-2.5 py-1.5 bg-muted/50 border border-border rounded-lg text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Webapp Account Gmail
                      </label>
                      <input
                        type="email"
                        value={currentUser?.email || ""}
                        disabled
                        className="w-full px-2.5 py-1.5 bg-muted/50 border border-border rounded-lg text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        তোমার টেলিগ্রাম আইডির নাম লিখো [যেই আইডি থেকে রিকুয়েস্ট পাঠানো হয়েছে]
                      </label>
                      <input
                        type="text"
                        value={telegramId}
                        onChange={(e) => setTelegramId(e.target.value)}
                        placeholder="Example: Shakib"
                        required
                        className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Mobile Number
                      </label>
                      <input
                        type="tel"
                        value={telegramMobile}
                        onChange={(e) => setTelegramMobile(e.target.value)}
                        placeholder="01912345678"
                        required
                        className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submittingTelegram || !telegramId.trim() || !telegramMobile.trim()}
                    className="w-full md:w-auto py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium text-xs flex items-center justify-center gap-2"
                  >
                    {submittingTelegram ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Submit Information</span>
                      </>
                    )}
                  </button>
                </form>
                </>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {!isArchive && !subject && exams.length > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0 }}
              onClick={() => navigate(`/course/${courseId}/exams`)}
              className="group relative bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <FileQuestion className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">Exams</h3>
                <p className="text-sm text-muted-foreground">
                  {exams.length} exam{exams.length !== 1 ? "s" : ""} available
                </p>
              </div>
            </motion.button>
          )}

          {isArchive && subjects.length > 0
            ? subjects.map((archiveSubject, index) => {
                const subjectInfo = subjectData.find(s => s.title === archiveSubject)
                const hasImage = subjectInfo?.imageUrl
                
                return (
                  <motion.button
                    key={archiveSubject}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    onClick={() => {
                      navigate(`/course/${courseId}/archive/${encodeURIComponent(archiveSubject)}/chapters`)
                    }}
                    className="group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                    {hasImage ? (
                      <div className="relative">
                        <div className="aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 relative overflow-hidden">
                          <img
                            src={subjectInfo.imageUrl}
                            alt={archiveSubject}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-6">
                          <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                            {archiveSubject}
                          </h3>
                          {subjectInfo.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">{subjectInfo.description}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="relative p-6">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                          <BookOpen className="w-6 h-6 text-primary" />
                        </div>
                        <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                          {archiveSubject}
                        </h3>
                        <p className="text-sm text-muted-foreground">Click to view archived chapters</p>
                      </div>
                    )}
                  </motion.button>
                )
              })
            : chapters.map((chapter, index) => {
                const chapterInfo = chapterData.find(c => c.title === chapter)
                const hasImage = chapterInfo?.imageUrl
                
                return (
                  <motion.button
                    key={chapter}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    onClick={() => {
                      if (isArchiveSubject && subject) {
                        navigate(
                          `/course/${courseId}/archive/${encodeURIComponent(subject)}/${encodeURIComponent(chapter)}/classes`,
                        )
                      } else if (subject) {
                        navigate(
                          `/course/${courseId}/classes/${encodeURIComponent(subject)}/${encodeURIComponent(chapter)}`,
                        )
                      } else {
                        navigate(`/course/${courseId}/classes/${encodeURIComponent(chapter)}`)
                      }
                    }}
                    className="group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                    {hasImage ? (
                      <div className="relative">
                        <div className="aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 relative overflow-hidden">
                          <img
                            src={chapterInfo.imageUrl}
                            alt={chapter}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-6">
                          <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{chapter}</h3>
                          {chapterInfo.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">{chapterInfo.description}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="relative p-6">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                          <BookOpen className="w-6 h-6 text-primary" />
                        </div>
                        <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{chapter}</h3>
                        <p className="text-sm text-muted-foreground">Click to view classes</p>
                      </div>
                    )}
                  </motion.button>
                )
              })}
        </div>

        {!isArchive && chapters.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No chapters available {subject ? "for this subject" : ""} yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
