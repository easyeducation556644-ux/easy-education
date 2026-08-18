import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { isFirebaseId } from "../lib/slug"
import CourseDetail from "../pages/CourseDetail"

function CourseDetailSkeleton() {
  return (
    <div className="min-h-screen px-4 py-12" aria-busy="true" aria-label="Loading course">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-6 aspect-video animate-pulse rounded-xl bg-muted lg:hidden" />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="mb-4 h-10 w-3/4 animate-pulse rounded bg-muted" />
              <div className="space-y-3">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
              </div>
              <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="h-16 animate-pulse rounded-lg bg-muted" />
                <div className="h-16 animate-pulse rounded-lg bg-muted" />
              </div>
            </div>
            <div className="h-56 animate-pulse rounded-xl border border-border bg-muted" />
          </div>
          <div>
            <div className="mb-6 hidden aspect-video animate-pulse rounded-xl bg-muted lg:block" />
            <div className="space-y-4 rounded-xl border border-border bg-card p-6">
              <div className="h-10 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-12 w-full animate-pulse rounded bg-muted" />
              <div className="h-12 w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

async function resolveCourse(courseId) {
  if (isFirebaseId(courseId)) {
    const snapshot = await getDoc(doc(db, "courses", courseId))
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
  }

  const snapshot = await getDocs(
    query(collection(db, "courses"), where("slug", "==", courseId)),
  )
  if (snapshot.empty) return null
  const courseDoc = snapshot.docs[0]
  return { id: courseDoc.id, ...courseDoc.data() }
}

async function primeCourseDetailQueries(courseData, currentUser) {
  if (!courseData) return
  const jobs = []

  // CourseDetail currently displays a student count from this exact query. Cache
  // it once so the actual page can render from local data immediately.
  jobs.push(getDocs(
    query(collection(db, "userCourses"), where("courseId", "==", courseData.id)),
  ))

  if (courseData.instructors?.length) {
    jobs.push(getDocs(
      query(
        collection(db, "teachers"),
        where("name", "in", courseData.instructors.slice(0, 10)),
      ),
    ))
  }

  if (currentUser?.uid) {
    const entitlementRef = doc(db, "userCourses", `${currentUser.uid}_${courseData.id}`)
    jobs.push(
      getDoc(entitlementRef).then((snapshot) => {
        if (snapshot.exists()) return null
        return getDocs(
          query(
            collection(db, "payments"),
            where("userId", "==", currentUser.uid),
            where("status", "==", "approved"),
          ),
        )
      }),
    )
    jobs.push(getDocs(
      query(
        collection(db, "payments"),
        where("userId", "==", currentUser.uid),
        where("status", "==", "pending"),
      ),
    ))
  }

  await Promise.allSettled(jobs)
}

export default function CourseDetailRoute() {
  const { courseId } = useParams()
  const { currentUser, loading: authLoading } = useAuth()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (authLoading) return
    let active = true
    setReady(false)

    ;(async () => {
      try {
        const courseData = await resolveCourse(courseId)
        await primeCourseDetailQueries(courseData, currentUser)
      } catch (error) {
        // CourseDetail retains its own error/not-found handling. This preloader is
        // performance-only and must never block navigation permanently.
        console.warn("Course detail cache preload failed:", error)
      } finally {
        if (active) setReady(true)
      }
    })()

    return () => {
      active = false
    }
  }, [courseId, currentUser?.uid, authLoading])

  if (authLoading || !ready) return <CourseDetailSkeleton />
  return <CourseDetail />
}
