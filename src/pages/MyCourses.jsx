"use client"

import { useState, useEffect, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { BookOpen, Play, Clock, CheckCircle, Lock, TrendingUp, ArrowRight } from "lucide-react"
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import ProgressBar from "../components/ProgressBar"
import { getCourseCategories } from "../lib/courseCategories"
import { readViewSnapshot, writeViewSnapshot } from "../lib/viewSnapshotCache"

function viewKey(uid) {
  return `my-courses:${uid || "anonymous"}`
}

export default function MyCourses() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const initialRef = useRef(readViewSnapshot(viewKey(currentUser?.uid)))
  const [purchasedCourses, setPurchasedCourses] = useState(() => initialRef.current?.courses || [])
  const [loading, setLoading] = useState(() => !initialRef.current)
  const [filter, setFilter] = useState("all")
  const [cacheRevision, setCacheRevision] = useState(0)

  useEffect(() => {
    const handler = (event) => {
      if (["payments", "userCourses", "courses", "classes", "watched", "userProgress"].includes(event.detail?.collection)) {
        setCacheRevision((value) => value + 1)
      }
    }
    window.addEventListener("easy-education-cache-updated", handler)
    return () => window.removeEventListener("easy-education-cache-updated", handler)
  }, [])

  useEffect(() => {
    if (!currentUser?.uid) return
    let cancelled = false

    const load = async () => {
      const key = viewKey(currentUser.uid)
      const saved = readViewSnapshot(key)
      if (saved?.courses) {
        setPurchasedCourses(saved.courses)
        setLoading(false)
      } else if (purchasedCourses.length === 0) {
        setLoading(true)
      }

      try {
        const [paymentsSnapshot, userCoursesSnapshot] = await Promise.all([
          getDocs(query(
            collection(db, "payments"),
            where("userId", "==", currentUser.uid),
            where("status", "==", "approved"),
          )),
          getDocs(query(
            collection(db, "userCourses"),
            where("userId", "==", currentUser.uid),
          )),
        ])
        if (cancelled) return

        const paymentCourseIds = new Set()
        paymentsSnapshot.docs.forEach((paymentDoc) => {
          const payment = paymentDoc.data()
          ;(payment.courses || []).forEach((courseItem) => {
            if (courseItem?.id) paymentCourseIds.add(courseItem.id)
          })
        })

        const bundleMap = new Map()
        await Promise.all([...paymentCourseIds].map(async (courseId) => {
          try {
            const snapshot = await getDoc(doc(db, "courses", courseId))
            if (!snapshot.exists()) return
            const data = snapshot.data()
            if (data.courseFormat === "bundle" && Array.isArray(data.bundledCourses)) {
              data.bundledCourses.forEach((bundled) => {
                const bundledId = typeof bundled === "string" ? bundled : bundled?.id
                if (bundledId) bundleMap.set(bundledId, { bundleId: courseId, bundleTitle: data.title })
              })
            }
          } catch (error) {
            console.warn("Bundle cache lookup failed:", courseId, error)
          }
        }))

        const uniqueEnrollments = new Map()
        userCoursesSnapshot.docs.forEach((snapshot) => {
          const data = snapshot.data()
          if (data?.courseId && !uniqueEnrollments.has(data.courseId)) {
            uniqueEnrollments.set(data.courseId, data)
          }
        })

        const built = (await Promise.all([...uniqueEnrollments.entries()].map(async ([courseId, userCourse]) => {
          try {
            const courseSnapshot = await getDoc(doc(db, "courses", courseId))
            if (!courseSnapshot.exists()) return null
            const courseData = { id: courseSnapshot.id, ...courseSnapshot.data() }
            if (courseData.courseFormat === "bundle") return null

            const [classesSnapshot, watchedSnapshot] = await Promise.all([
              getDocs(query(collection(db, "classes"), where("courseId", "==", courseId))),
              getDocs(query(
                collection(db, "watched"),
                where("userId", "==", currentUser.uid),
                where("courseId", "==", courseId),
              )),
            ])

            const totalClasses = classesSnapshot.size
            const watchedClasses = watchedSnapshot.size
            const progressPercent = totalClasses > 0
              ? Math.round((watchedClasses / totalClasses) * 100)
              : 0
            const bundleInfo = bundleMap.get(courseId)

            return {
              ...courseData,
              enrolledAt: userCourse.enrolledAt,
              totalClasses,
              watchedClasses,
              progressPercent,
              isCompleted: totalClasses > 0 && progressPercent === 100,
              fromBundle: bundleInfo?.bundleTitle || null,
              bundleId: bundleInfo?.bundleId || null,
            }
          } catch (error) {
            console.error("Cached course build failed:", courseId, error)
            return null
          }
        }))).filter(Boolean)

        if (cancelled) return
        setPurchasedCourses(built)
        writeViewSnapshot(key, { courses: built })
      } catch (error) {
        console.error("Error loading My Courses cache:", error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [currentUser?.uid, cacheRevision])

  const getFilteredCourses = () => {
    switch (filter) {
      case "completed":
        return purchasedCourses.filter((course) => course.isCompleted)
      case "in-progress":
        return purchasedCourses.filter((course) => !course.isCompleted && course.progressPercent > 0)
      default:
        return purchasedCourses
    }
  }

  const filteredCourses = getFilteredCourses()
  const stats = {
    total: purchasedCourses.length,
    completed: purchasedCourses.filter((c) => c.isCompleted).length,
    inProgress: purchasedCourses.filter((c) => !c.isCompleted && c.progressPercent > 0).length,
    notStarted: purchasedCourses.filter((c) => c.progressPercent === 0).length,
  }

  return (
    <div className="min-h-screen py-8 md:py-12 px-4 bg-background">
      <div className="container mx-auto max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">My Courses</h1>
          <p className="text-muted-foreground">Track your learning progress and continue where you left off</p>
        </motion.div>

        {loading && purchasedCourses.length === 0 ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 rounded-xl bg-muted animate-pulse" />)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[0, 1, 2].map((item) => <div key={item} className="h-72 rounded-xl bg-muted animate-pulse" />)}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
              {[
                { label: "Total Courses", value: stats.total, icon: BookOpen, color: "text-blue-500" },
                { label: "Completed", value: stats.completed, icon: CheckCircle, color: "text-green-500" },
                { label: "In Progress", value: stats.inProgress, icon: TrendingUp, color: "text-purple-500" },
                { label: "Not Started", value: stats.notStarted, icon: Lock, color: "text-orange-500" },
              ].map((stat) => (
                <div key={stat.label} className="bg-card border border-border rounded-xl p-4 md:p-5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">{stat.label}</h3>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <p className="text-2xl md:text-3xl font-bold">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
              {[
                { id: "all", label: "All Courses" },
                { id: "in-progress", label: "In Progress" },
                { id: "completed", label: "Completed" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                    filter === tab.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {filteredCourses.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCourses.map((course) => (
                  <div key={course.id} className="bg-card border border-border rounded-xl overflow-hidden group">
                    <div className="relative aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 overflow-hidden">
                      {course.thumbnailURL ? (
                        <img
                          src={course.thumbnailURL}
                          alt={course.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="w-12 h-12 text-primary/50" />
                        </div>
                      )}
                      <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full">
                        <p className="text-xs font-semibold text-white">{course.progressPercent}%</p>
                      </div>
                      {course.isCompleted && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="bg-green-500 rounded-full p-3"><CheckCircle className="w-8 h-8 text-white" /></div>
                        </div>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      <div>
                        <h3 className="font-semibold text-lg line-clamp-2 mb-1">{course.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          {getCourseCategories(course).join(", ") || "Uncategorized"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-semibold">{course.watchedClasses}/{course.totalClasses} classes</span>
                        </div>
                        <ProgressBar progress={course.progressPercent} showLabel={false} showPercentage={false} animated />
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                        <div className="flex items-center gap-1"><Clock className="w-4 h-4" /><span>Self-paced</span></div>
                        <div className="flex items-center gap-1"><BookOpen className="w-4 h-4" /><span>{course.totalClasses} classes</span></div>
                      </div>
                      <button
                        onClick={() => navigate(course.type === "batch" ? `/course/${course.id}/subjects` : `/course/${course.id}/chapters`)}
                        className="w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium flex items-center justify-center gap-2 mt-2"
                      >
                        <Play className="w-4 h-4" />
                        {course.isCompleted ? "Review Course" : "Continue Learning"}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-10 text-center">
                <BookOpen className="w-14 h-14 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-xl font-semibold mb-2">No courses yet</h3>
                <p className="text-muted-foreground mb-6">
                  {filter === "all"
                    ? "You haven't purchased any courses yet."
                    : `You don't have any ${filter === "completed" ? "completed" : "in-progress"} courses.`}
                </p>
                <Link to="/courses" className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium">
                  Browse Courses
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
