"use client"

import { useState, useEffect, useMemo } from "react"
import { useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { Search, Filter, BookOpen, ChevronLeft, ChevronRight } from "lucide-react"
import CourseCard from "../components/CourseCard"
import {
  collection,
  query,
  orderBy,
  getDocs,
  where,
  limit,
  startAfter,
} from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { getCourseCategories } from "../lib/courseCategories"

const COURSES_PER_PAGE = 10

export default function Courses() {
  const location = useLocation()
  const { isAdmin, currentUser } = useAuth()
  const [courses, setCourses] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [sortBy, setSortBy] = useState("newest")
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageCursors, setPageCursors] = useState([null])
  const [lastVisible, setLastVisible] = useState(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [purchasedBundleCourses, setPurchasedBundleCourses] = useState(new Set())

  useEffect(() => {
    if (location.state?.searchQuery) setSearchQuery(location.state.searchQuery)
    if (location.state?.categoryFilter) setCategoryFilter(location.state.categoryFilter)
  }, [location.state])

  useEffect(() => {
    let cancelled = false

    const loadCoursesPage = async () => {
      setLoading(true)
      try {
        const cursor = pageCursors[pageCursors.length - 1]
        const sortField = sortBy === "title" ? "title" : "createdAt"
        const sortDirection = sortBy === "oldest" || sortBy === "title" ? "asc" : "desc"
        const constraints = [orderBy(sortField, sortDirection)]
        if (cursor) constraints.push(startAfter(cursor))
        constraints.push(limit(COURSES_PER_PAGE + 1))

        const snapshot = await getDocs(query(collection(db, "courses"), ...constraints))
        if (cancelled) return

        const rawDocs = snapshot.docs
        const visibleDocs = rawDocs.slice(0, COURSES_PER_PAGE)
        let pageCourses = visibleDocs.map((doc) => ({ id: doc.id, ...doc.data() }))

        if (!isAdmin) {
          pageCourses = pageCourses.filter((course) => course.publishStatus !== "draft")
        }

        setCourses(pageCourses)
        setLastVisible(visibleDocs.at(-1) || null)
        setHasNextPage(rawDocs.length > COURSES_PER_PAGE)
      } catch (error) {
        console.error("Error fetching courses page:", error)
        if (!cancelled) {
          setCourses([])
          setHasNextPage(false)
          setLastVisible(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCoursesPage()
    return () => { cancelled = true }
  }, [isAdmin, sortBy, pageCursors])

  useEffect(() => {
    let cancelled = false

    const refreshEntitlements = async () => {
      if (!currentUser) {
        setPurchasedBundleCourses(new Set())
        return
      }

      try {
        const userCoursesQuery = query(
          collection(db, "userCourses"),
          where("userId", "==", currentUser.uid),
        )
        const snapshot = await getDocs(userCoursesQuery)
        if (cancelled) return

        const purchasedBundleSet = new Set()
        snapshot.docs.forEach((doc) => {
          const userCourse = doc.data()
          if (userCourse.isBundle) purchasedBundleSet.add(userCourse.courseId)
          if (userCourse.bundleId) purchasedBundleSet.add(userCourse.bundleId)
        })
        setPurchasedBundleCourses(purchasedBundleSet)
      } catch (error) {
        console.error("Error refreshing purchased courses:", error)
      }
    }

    refreshEntitlements()
    return () => { cancelled = true }
  }, [currentUser?.uid])

  const filteredCourses = useMemo(() => {
    let filtered = [...courses]

    if (purchasedBundleCourses.size > 0) {
      filtered = filtered.filter((course) =>
        course.courseFormat !== "bundle" || !purchasedBundleCourses.has(course.id),
      )
    }

    if (searchQuery?.trim()) {
      const search = searchQuery.toLowerCase()
      filtered = filtered.filter((course) => {
        const searchableKeywords = Array.isArray(course.searchKeywords)
          ? course.searchKeywords.join(",").toLowerCase()
          : (course.searchKeywords || "").toLowerCase()

        return (
          course.title?.toLowerCase().includes(search) ||
          course.description?.toLowerCase().includes(search) ||
          getCourseCategories(course).some((category) => category.toLowerCase().includes(search)) ||
          searchableKeywords.includes(search)
        )
      })
    }

    if (categoryFilter && categoryFilter !== "all") {
      filtered = filtered.filter((course) => getCourseCategories(course).includes(categoryFilter))
    }

    return filtered
  }, [courses, searchQuery, categoryFilter, purchasedBundleCourses])

  const categories = ["all", ...new Set(courses.flatMap(getCourseCategories))]

  const resetPagination = (nextSort = sortBy) => {
    setPage(1)
    setPageCursors([null])
    if (nextSort !== sortBy) setSortBy(nextSort)
  }

  const goNext = () => {
    if (!hasNextPage || !lastVisible || loading) return
    setPage((current) => current + 1)
    setPageCursors((current) => [...current, lastVisible])
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const goPrevious = () => {
    if (page <= 1 || loading) return
    setPage((current) => Math.max(1, current - 1))
    setPageCursors((current) => current.slice(0, -1))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="min-h-screen py-8 md:py-12 px-4 md:px-6">
      <div className="container mx-auto max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Available Courses</h1>
          <p className="text-base md:text-lg text-muted-foreground">তোমার প্রয়োজনীয় কোর্সটি পেতে সার্চ করো।</p>
        </motion.div>

        <div className="bg-card border border-border rounded-lg p-4 md:p-6 mb-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-2 text-foreground">Search Courses</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in this page..."
                  className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm smooth-transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-foreground">Category</label>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm appearance-none smooth-transition"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat === "all" ? "All Categories" : cat}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
            <span className="text-sm font-medium text-foreground">Sort by:</span>
            <div className="flex flex-wrap gap-2">
              {["newest", "oldest", "title"].map((option) => (
                <button
                  key={option}
                  onClick={() => resetPagination(option)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium smooth-transition ${sortBy === option ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!loading && (
          <div className="mb-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Page {page} · Showing {filteredCourses.length} of up to {COURSES_PER_PAGE}</span>
            <span>{COURSES_PER_PAGE} courses per page</span>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse">
                <div className="aspect-video bg-muted rounded-lg mb-4" />
                <div className="h-5 bg-muted rounded mb-2" />
                <div className="h-4 bg-muted rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : filteredCourses.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCourses.map((course) => (
                <CourseCard key={course.id} course={course} showMinimal={true} />
              ))}
            </div>

            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={goPrevious}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <span className="min-w-20 text-center text-sm font-semibold">Page {page}</span>
              <button
                type="button"
                onClick={goNext}
                disabled={!hasNextPage || loading}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No courses found on this page</h3>
            <p className="text-muted-foreground">Try another page or adjust your search and filters</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={goPrevious}
                disabled={page <= 1 || loading}
                className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!hasNextPage || loading}
                className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
