"use client"

import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { BookOpen, Play, CheckCircle, Lock, TrendingUp, ArrowRight } from "lucide-react"
import { collection, query, where, getDocs, doc, getDoc, getCountFromServer } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import ProgressBar from "../components/ProgressBar"
import { getCourseCategories } from "../lib/courseCategories"
import { readViewCache, writeViewCache } from "../lib/viewCache"

const VIEW_TTL = 5 * 60 * 1000

export default function MyCourses() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [purchasedCourses, setPurchasedCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")

  useEffect(() => {
    if (!currentUser?.uid) return
    let cancelled = false
    const key = `my-courses:${currentUser.uid}`
    const cached = readViewCache(key, VIEW_TTL)

    if (cached?.data) {
      setPurchasedCourses(cached.data)
      setLoading(false)
      if (cached.fresh) return
    }

    const refresh = async () => {
      try {
        const userCoursesSnapshot = await getDocs(query(
          collection(db, "userCourses"),
          where("userId", "==", currentUser.uid),
        ))

        const unique = new Map()
        for (const row of userCoursesSnapshot.docs) {
          const userCourse = row.data()
          const courseId = userCourse.courseId
          if (!courseId || unique.has(courseId)) continue

          const courseSnap = await getDoc(doc(db, "courses", courseId))
          if (!courseSnap.exists()) continue
          const courseData = { id: courseSnap.id, ...courseSnap.data() }
          if (courseData.courseFormat === "bundle") continue

          const classesQ = query(collection(db, "classes"), where("courseId", "==", courseId))
          const watchedQ = query(
            collection(db, "watched"),
            where("userId", "==", currentUser.uid),
            where("courseId", "==", courseId),
          )
          const [classCount, watchedCount] = await Promise.all([
            getCountFromServer(classesQ),
            getCountFromServer(watchedQ),
          ])
          const totalClasses = classCount.data().count
          const watchedClasses = watchedCount.data().count
          const progressPercent = totalClasses > 0 ? Math.round((watchedClasses / totalClasses) * 100) : 0

          unique.set(courseId, {
            ...courseData,
            totalClasses,
            watchedClasses,
            progressPercent,
            isCompleted: progressPercent === 100,
            bundleId: userCourse.bundleId || null,
          })
        }

        const data = Array.from(unique.values())
        if (!cancelled) {
          setPurchasedCourses(data)
          writeViewCache(key, data)
        }
      } catch (error) {
        console.error("Error fetching purchased courses:", error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    return () => { cancelled = true }
  }, [currentUser?.uid])

  const filteredCourses = useMemo(() => {
    if (filter === "completed") return purchasedCourses.filter((c) => c.isCompleted)
    if (filter === "in-progress") return purchasedCourses.filter((c) => !c.isCompleted && c.progressPercent > 0)
    return purchasedCourses
  }, [filter, purchasedCourses])

  const stats = {
    total: purchasedCourses.length,
    completed: purchasedCourses.filter((c) => c.isCompleted).length,
    inProgress: purchasedCourses.filter((c) => !c.isCompleted && c.progressPercent > 0).length,
    notStarted: purchasedCourses.filter((c) => c.progressPercent === 0).length,
  }

  return (
    <div className="min-h-screen px-4 py-8 md:py-12">
      <div className="container mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">My Courses</h1>
          <p className="text-muted-foreground">Continue learning from where you left off.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            ["Total", stats.total, BookOpen],
            ["Completed", stats.completed, CheckCircle],
            ["In Progress", stats.inProgress, TrendingUp],
            ["Not Started", stats.notStarted, Lock],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <Icon className="h-5 w-5 text-primary mb-3" />
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto">
          {[["all","All Courses"],["in-progress","In Progress"],["completed","Completed"]].map(([id,label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-4 py-2 rounded-lg whitespace-nowrap ${filter === id ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{label}</button>
          ))}
        </div>

        {loading && purchasedCourses.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3].map((i) => <div key={i} className="h-72 rounded-xl border border-border bg-card animate-pulse" />)}
          </div>
        ) : filteredCourses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCourses.map((course) => (
              <div key={course.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="aspect-video bg-muted overflow-hidden">
                  {course.thumbnailURL ? <img src={course.thumbnailURL} alt={course.title} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><BookOpen className="w-10 h-10 text-muted-foreground" /></div>}
                </div>
                <div className="p-4 space-y-3">
                  <div><h3 className="font-semibold line-clamp-2">{course.title}</h3><p className="text-xs text-muted-foreground">{getCourseCategories(course).join(", ") || "Uncategorized"}</p></div>
                  <div><div className="flex justify-between text-xs mb-1"><span>Progress</span><span>{course.watchedClasses}/{course.totalClasses}</span></div><ProgressBar progress={course.progressPercent} showLabel={false} showPercentage={false} /></div>
                  <button onClick={() => navigate(course.type === "batch" ? `/course/${course.id}/subjects` : `/course/${course.id}/chapters`)} className="w-full py-2 bg-primary text-primary-foreground rounded-lg flex items-center justify-center gap-2"><Play className="w-4 h-4" />Continue <ArrowRight className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-10 text-center"><BookOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground" /><p className="mb-4 text-muted-foreground">No courses found.</p><Link to="/courses" className="inline-flex px-5 py-2 rounded-lg bg-primary text-primary-foreground">Browse Courses</Link></div>
        )}
      </div>
    </div>
  )
}
