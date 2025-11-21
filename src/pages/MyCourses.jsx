"use client"

import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { BookOpen, Play, Clock, CheckCircle, Lock, TrendingUp, ArrowRight } from "lucide-react"
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import ProgressBar from "../components/ProgressBar"

export default function MyCourses() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [purchasedCourses, setPurchasedCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all") // all, completed, in-progress

  useEffect(() => {
    if (currentUser) {
      fetchPurchasedCourses()
    }
  }, [currentUser])

  const fetchPurchasedCourses = async () => {
    try {
      const paymentsQuery = query(
        collection(db, "payments"),
        where("userId", "==", currentUser.uid),
        where("status", "==", "approved")
      )
      const paymentsSnapshot = await getDocs(paymentsQuery)
      
      const bundleMap = new Map()
      
      for (const paymentDoc of paymentsSnapshot.docs) {
        const payment = paymentDoc.data()
        if (payment.courses) {
          for (const courseItem of payment.courses) {
            try {
              const courseDoc = await getDoc(doc(db, "courses", courseItem.id))
              if (courseDoc.exists()) {
                const courseData = courseDoc.data()
                if (courseData.courseFormat === 'bundle' && courseData.bundledCourses) {
                  courseData.bundledCourses.forEach((bundledId) => {
                    bundleMap.set(bundledId, {
                      bundleId: courseItem.id,
                      bundleTitle: courseData.title
                    })
                  })
                }
              }
            } catch (error) {
              console.error("Error checking bundle:", error)
            }
          }
        }
      }

      const userCoursesQuery = query(
        collection(db, "userCourses"),
        where("userId", "==", currentUser.uid)
      )
      const userCoursesSnapshot = await getDocs(userCoursesQuery)

      const courseMap = new Map()

      for (const userCourseDoc of userCoursesSnapshot.docs) {
        const userCourse = userCourseDoc.data()
        const courseId = userCourse.courseId

        if (courseMap.has(courseId)) {
          continue
        }

        try {
          const courseDoc = await getDoc(doc(db, "courses", courseId))

          if (courseDoc.exists()) {
            const courseData = { id: courseDoc.id, ...courseDoc.data() }

            if (courseData.courseFormat === 'bundle') {
              continue
            }

            const classesQuery = query(collection(db, "classes"), where("courseId", "==", courseId))
            const classesSnapshot = await getDocs(classesQuery)
            const totalClasses = classesSnapshot.size

            const watchedQuery = query(
              collection(db, "watched"),
              where("userId", "==", currentUser.uid),
              where("courseId", "==", courseId),
            )
            const watchedSnapshot = await getDocs(watchedQuery)
            const watchedClasses = watchedSnapshot.size

            const progressPercent = totalClasses > 0 ? Math.round((watchedClasses / totalClasses) * 100) : 0

            const bundleInfo = bundleMap.get(courseId)

            courseMap.set(courseId, {
              ...courseData,
              enrolledAt: userCourse.enrolledAt,
              totalClasses,
              watchedClasses,
              progressPercent,
              isCompleted: progressPercent === 100,
              fromBundle: bundleInfo ? bundleInfo.bundleTitle : null,
              bundleId: bundleInfo ? bundleInfo.bundleId : null,
            })
          }
        } catch (error) {
          console.error("Error fetching course:", error)
        }
      }

      setPurchasedCourses(Array.from(courseMap.values()))
    } catch (error) {
      console.error("Error fetching purchased courses:", error)
    } finally {
      setLoading(false)
    }
  }

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-12 px-4 bg-background">
      <div className="container mx-auto max-w-5xl">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-4xl font-bold mb-2">My Courses</h1>
          <p className="text-muted-foreground">Track your learning progress and continue where you left off</p>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Courses", value: stats.total, icon: BookOpen, color: "text-blue-500" },
            { label: "Completed", value: stats.completed, icon: CheckCircle, color: "text-green-500" },
            { label: "In Progress", value: stats.inProgress, icon: TrendingUp, color: "text-purple-500" },
            { label: "Not Started", value: stats.notStarted, icon: Lock, color: "text-orange-500" },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-card border border-border rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">{stat.label}</h3>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <p className="text-3xl font-bold">{stat.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Filter Tabs */}
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

        {/* Courses Grid */}
        {filteredCourses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCourses.map((course, index) => (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group"
              >
                {/* Course Image */}
                <div className="relative aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 overflow-hidden">
                  {course.thumbnailURL ? (
                    <img
                      src={course.thumbnailURL || "/placeholder.svg"}
                      alt={course.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="w-12 h-12 text-primary/50" />
                    </div>
                  )}

                  {/* Progress Badge */}
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full">
                    <p className="text-xs font-semibold text-white">{course.progressPercent}%</p>
                  </div>

                  {/* Completion Badge */}
                  {course.isCompleted && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="bg-green-500 rounded-full p-3">
                        <CheckCircle className="w-8 h-8 text-white" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Course Info */}
                <div className="p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold text-lg line-clamp-2 mb-1">{course.title}</h3>
                    <p className="text-xs text-muted-foreground">{course.category}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-semibold">
                        {course.watchedClasses}/{course.totalClasses} classes
                      </span>
                    </div>
                    <ProgressBar
                      progress={course.progressPercent}
                      showLabel={false}
                      showPercentage={false}
                      animated={true}
                    />
                  </div>

                  {/* Course Stats */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      <span>Self-paced</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <BookOpen className="w-4 h-4" />
                      <span>{course.totalClasses} classes</span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => navigate(course.type === "batch" ? `/course/${course.id}/subjects` : `/course/${course.id}/chapters`)}
                    className="w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium flex items-center justify-center gap-2 mt-2"
                  >
                    <Play className="w-4 h-4" />
                    {course.isCompleted ? "Review Course" : "Continue Learning"}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-12 text-center"
          >
            <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-xl font-semibold mb-2">No courses yet</h3>
            <p className="text-muted-foreground mb-6">
              {filter === "all"
                ? "You haven't purchased any courses yet. Browse our course library to get started!"
                : `You don't have any ${filter === "completed" ? "completed" : "in-progress"} courses.`}
            </p>
            <Link
              to="/courses"
              className="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium"
            >
              Browse Courses
            </Link>
          </motion.div>
        )}
      </div>
    </div>
  )
}
