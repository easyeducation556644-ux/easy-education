"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { BookOpen, ArrowLeft, Lock, Archive, FileQuestion, Send, CheckCircle2, X, ArrowRight } from "lucide-react"
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"
import { toast as showGlobalToast } from "../hooks/use-toast"
import { isFirebaseId } from "../lib/utils/slugUtils"

export default function CourseSubjects() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const { currentUser, isAdmin } = useAuth()
  const { getExamsByCourse } = useExam()
  const [course, setCourse] = useState(null)
  const [actualCourseId, setActualCourseId] = useState(null)
  const [subjects, setSubjects] = useState([])
  const [subjectData, setSubjectData] = useState([])
  const [hasArchive, setHasArchive] = useState(false)
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [courseNotFound, setCourseNotFound] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [telegramId, setTelegramId] = useState("")
  const [telegramMobile, setTelegramMobile] = useState("")
  const [telegramSubmitted, setTelegramSubmitted] = useState(false)
  const [submittingTelegram, setSubmittingTelegram] = useState(false)
  const [showTelegramModal, setShowTelegramModal] = useState(false)
  const [telegramStep, setTelegramStep] = useState(1)

  useEffect(() => {
    fetchCourseData()
  }, [courseId])

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
        title: "সফল!",
        description: "টেলিগ্রাম তথ্য সফলভাবে জমা হয়েছে!",
      })
    } catch (error) {
      console.error("Error submitting telegram info:", error)
      showGlobalToast({
        variant: "destructive",
        title: "ত্রুটি",
        description: "জমা দিতে ব্যর্থ। আবার চেষ্টা করুন।",
      })
    } finally {
      setSubmittingTelegram(false)
    }
  }

  const handleNextStep = () => {
    if (telegramStep === 1 && telegramId.trim()) {
      setTelegramStep(2)
    }
  }

  const handlePrevStep = () => {
    if (telegramStep === 2) {
      setTelegramStep(1)
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
        const classesData = classesSnapshot.docs.map((doc) => ({
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

        const subjectChapterMap = {}
        classesData
          .filter((cls) => !isClassArchived(cls) && cls.subject)
          .forEach((cls) => {
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

        const subjectsQuery = query(collection(db, "subjects"), where("courseId", "==", resolvedCourseId))
        const subjectsSnapshot = await getDocs(subjectsQuery)
        const fetchedSubjects = subjectsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        setSubjectData(fetchedSubjects)

        const archiveClasses = classesData.filter((cls) => isClassArchived(cls))
        setHasArchive(archiveClasses.length > 0)

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
            onClick={() => navigate(`/course/${courseId}`)}
            className="flex items-center gap-2 text-primary hover:text-primary/80 mb-4 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Course
          </button>
          <h1 className="text-3xl font-bold mb-2">{course?.title}</h1>
          <p className="text-muted-foreground">Select a subject to view chapters</p>
        </div>

        {course?.telegramLink && currentUser && hasAccess && (
          <div className="mb-6">
            <button
              onClick={() => setShowTelegramModal(true)}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-500 dark:to-cyan-500 text-white rounded-lg hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-2 font-medium"
            >
              <Send className="w-5 h-5" />
              টেলিগ্রাম গ্রুপে যুক্ত হন
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exams.length > 0 && (
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

          {subjects.map((subject, index) => {
            const subjectInfo = subjectData.find(s => s.title === subject)
            const hasImage = subjectInfo?.imageUrl
            
            return (
              <motion.button
                key={subject}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (index + (exams.length > 0 ? 1 : 0)) * 0.1 }}
                onClick={() => {
                  navigate(`/course/${courseId}/subjects/${encodeURIComponent(subject)}/chapters`)
                }}
                className="group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                {hasImage ? (
                  <div className="relative">
                    <div className="aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 relative overflow-hidden">
                      <img
                        src={subjectInfo.imageUrl}
                        alt={subject}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-6">
                      <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{subject}</h3>
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
                    <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{subject}</h3>
                    <p className="text-sm text-muted-foreground">Click to view chapters</p>
                  </div>
                )}
              </motion.button>
            )
          })}

          {hasArchive && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (subjects.length + (exams.length > 0 ? 1 : 0)) * 0.1 }}
              onClick={() => {
                navigate(`/course/${courseId}/subjects/archive/chapters`)
              }}
              className="group relative bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Archive className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">Archive</h3>
                <p className="text-sm text-muted-foreground">Archived classes from previous batches</p>
              </div>
            </motion.button>
          )}
        </div>

        {subjects.length === 0 && !hasArchive && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No subjects or archived classes available for this course yet.</p>
          </div>
        )}


        {/* Telegram Join Section */}
        {course?.telegramLink && (
          <div className="mt-8 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-border rounded-xl p-6 shadow-lg"
            >
              <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
                <Send className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <span className="bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                  Join Telegram Community
                </span>
              </h2>
              
              <p className="text-sm text-muted-foreground mb-4">
                Join our Telegram group to get updates, interact with instructors, and connect with fellow students.
              </p>

              {telegramSubmitted ? (
                <div className="space-y-3">
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-700 dark:text-green-300 text-sm mb-0.5">
                        Information Submitted Successfully!
                      </p>
                      <p className="text-sm text-green-600 dark:text-green-400">
                        You have successfully submitted your Telegram information. Now you can join the Telegram group using the button below.
                      </p>
                    </div>
                  </div>
                  
                  <a
                    href={course.telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 py-3 px-6 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium shadow-md hover:shadow-lg"
                  >
                    <Send className="w-5 h-5" />
                    <span>Join Telegram Group</span>
                  </a>
                </div>
              ) : (
                <>
                  <a
                    href={course.telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full md:w-auto md:inline-block py-3 px-6 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium text-center mb-6 shadow-md hover:shadow-lg"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Send className="w-5 h-5" />
                      <span>Join Telegram Group</span>
                    </div>
                  </a>

                  <div className="border-t border-border pt-4">
                    <h3 className="font-semibold mb-3 text-sm">Submit Your Telegram Information</h3>
                    <p className="block text-xs font-medium text-muted-foreground mb-1.5">
টেলিগ্রাম গ্রুপে জয়েন রিকুয়েষ্ট দেওয়ার আগে নিচের ফর্মটা সাবমিট করে তারপর রিকুয়েষ্ট দিবে, ফর্মটা একবারের বেশি সাবমিট করা যাবেনা তাই সঠিক ইনফর্মেশন দিয়ে সাবমিট করবে। আর রিকুয়েষ্ট দেওয়ার পর অপেক্ষা করবে আমরা সময় মতো তোমাকে গ্রুপে এড করে নিবো।</p>
                    
                    <form onSubmit={handleTelegramSubmit} className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Webapp Account Name
                          </label>
                          <input
                            type="text"
                            value={currentUser?.displayName || currentUser?.email || ""}
                            disabled
                            className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Webapp Account Gmail
                          </label>
                          <input
                            type="email"
                            value={currentUser?.email || ""}
                            disabled
                            className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            তোমার টেলিগ্রাম আইডির নাম লিখো [যেই আইডি থেকে রিকুয়েস্ট পাঠানো হয়েছে]
                          </label>
                          <input
                            type="text"
                            value={telegramId}
                            onChange={(e) => setTelegramId(e.target.value)}
                            placeholder="Example: Shakib"
                            required
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Mobile Number
                          </label>
                          <input
                            type="tel"
                            value={telegramMobile}
                            onChange={(e) => setTelegramMobile(e.target.value)}
                            placeholder="01912345678"
                            required
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={submittingTelegram || !telegramId.trim() || !telegramMobile.trim()}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium text-sm flex items-center justify-center gap-2"
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
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </div>

      {/* Telegram Submission Modal */}
      <AnimatePresence>
        {showTelegramModal && currentUser && hasAccess && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold mb-1 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                    টেলিগ্রাম গ্রুপে যুক্ত হন
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    ধাপ {telegramStep} / 2
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowTelegramModal(false)
                    setTelegramStep(1)
                  }}
                  className="p-1 hover:bg-muted rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!telegramSubmitted ? (
                <form onSubmit={handleTelegramSubmit} className="space-y-4">
                  {telegramStep === 1 && (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="space-y-4"
                    >
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          তোমার টেলিগ্রাম আইডির নাম লিখো *
                        </label>
                        <input
                          type="text"
                          value={telegramId}
                          onChange={(e) => setTelegramId(e.target.value)}
                          placeholder="উদাহরণ: Shakib"
                          required
                          className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          যেই আইডি থেকে রিকুয়েস্ট পাঠানো হয়েছে সেই আইডির নাম লিখো
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleNextStep}
                        disabled={!telegramId.trim()}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-muted disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                      >
                        পরবর্তী
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {telegramStep === 2 && (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          মোবাইল নম্বর *
                        </label>
                        <input
                          type="tel"
                          value={telegramMobile}
                          onChange={(e) => setTelegramMobile(e.target.value)}
                          placeholder="01912345678"
                          required
                          className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          টেলিগ্রাম গ্রুপে জয়েন রিকুয়েস্ট দেওয়ার আগে এই ফর্মটা সাবমিট করে তারপর রিকুয়েস্ট দিবে। ফর্মটা একবারের বেশি সাবমিট করা যাবেনা তাই সঠিক ইনফর্মেশন দিয়ে সাবমিট করবে।
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={handlePrevStep}
                          className="flex-1 py-3 bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium"
                        >
                          পূর্ববর্তী
                        </button>
                        <button
                          type="submit"
                          disabled={submittingTelegram || !telegramMobile.trim()}
                          className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                        >
                          {submittingTelegram ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>জমা হচ্ছে...</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4" />
                              <span>জমা দিন</span>
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </form>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-4"
                >
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-700 dark:text-green-300 mb-1">
                        সফলভাবে জমা হয়েছে!
                      </p>
                      <p className="text-sm text-green-600/80 dark:text-green-400/80">
                        এখন নিচের বাটনে ক্লিক করে টেলিগ্রাম গ্রুপে জয়েন রিকুয়েস্ট পাঠাও
                      </p>
                    </div>
                  </div>

                  <a
                    href={course?.telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-500 dark:to-cyan-500 text-white rounded-lg hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-2 font-medium"
                  >
                    <Send className="w-5 h-5" />
                    <span>টেলিগ্রাম গ্রুপে যান</span>
                  </a>
                </motion.div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
