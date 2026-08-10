"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
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
import { readViewSnapshot, writeViewSnapshot } from "../lib/viewSnapshotCache"

const COURSES_PER_PAGE = 10
const CATALOG_VIEW_KEY = "courses:global-catalog:v1"

function coursesViewKey(isAdmin, sortBy, page) {
  return `courses:${isAdmin ? "admin" : "student"}:${sortBy}:${page}`
}

function entitlementKey(uid) {
  return `course-entitlements:${uid || "anonymous"}`
}

function sortCourses(items, sortBy) {
  const list = [...items]
  if (sortBy === "title") {
    return list.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" }))
  }

  const createdAt = (course) => {
    const value = course?.createdAt
    if (typeof value?.toMillis === "function") return value.toMillis()
    if (typeof value?.seconds === "number") return value.seconds * 1000
    const parsed = new Date(value || 0).getTime()
    return Number.isFinite(parsed) ? parsed : 0
  }

  return list.sort((a, b) => sortBy === "oldest"
    ? createdAt(a) - createdAt(b)
    : createdAt(b) - createdAt(a))
}

function matchesSearch(course, rawSearch) {
  const search = rawSearch.trim().toLowerCase()
  if (!search) return true

  const searchableKeywords = Array.isArray(course.searchKeywords)
    ? course.searchKeywords.join(" ").toLowerCase()
    : String(course.searchKeywords || "").toLowerCase()

  return (
    String(course.title || "").toLowerCase().includes(search) ||
    String(course.description || "").toLowerCase().includes(search) ||
    getCourseCategories(course).some((category) => category.toLowerCase().includes(search)) ||
    searchableKeywords.includes(search)
  )
}

export default function Courses() {
  const location = useLocation()
  const { isAdmin, currentUser } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [sortBy, setSortBy] = useState("newest")
  const [page, setPage] = useState(1)

  const initialViewRef = useRef(readViewSnapshot(coursesViewKey(isAdmin, "newest", 1)))
  const initialEntitlementsRef = useRef(readViewSnapshot(entitlementKey(currentUser?.uid)))
  const initialCatalogRef = useRef(readViewSnapshot(CATALOG_VIEW_KEY))
  const [courses, setCourses] = useState(() => initialViewRef.current?.courses || [])
  const [loading, setLoading] = useState(() => !initialViewRef.current)
  const [pageCursors, setPageCursors] = useState([null])
  const [lastVisible, setLastVisible] = useState(null)
  const [hasNextPage, setHasNextPage] = useState(() => Boolean(initialViewRef.current?.hasNextPage))
  const [catalogCourses, setCatalogCourses] = useState(() => initialCatalogRef.current?.courses || null)
  const [catalogRequested, setCatalogRequested] = useState(() => Boolean(initialCatalogRef.current?.courses))
  const [catalogLoading, setCatalogLoading] = useState(false)
  const catalogLoadRef = useRef(null)
  const [purchasedBundleCourses, setPurchasedBundleCourses] = useState(
    () => new Set(initialEntitlementsRef.current?.bundleIds || []),
  )
  const [cacheRevision, setCacheRevision] = useState(0)
  const [entitlementRevision, setEntitlementRevision] = useState(0)
  const lastViewKeyRef = useRef(coursesViewKey(isAdmin, "newest", 1))

  const filterMode = Boolean(searchQuery.trim()) || categoryFilter !== "all"

  useEffect(() => {
    if (location.state?.searchQuery) setSearchQuery(location.state.searchQuery)
    if (location.state?.categoryFilter) setCategoryFilter(location.state.categoryFilter)
  }, [location.state])

  useEffect(() => {
    const handler = (event) => {
      const collectionName = event.detail?.collection
      if (collectionName === "courses") setCacheRevision((value) => value + 1)
      if (collectionName === "userCourses") setEntitlementRevision((value) => value + 1)
    }
    window.addEventListener("easy-education-cache-updated", handler)
    return () => window.removeEventListener("easy-education-cache-updated", handler)
  }, [])

  const ensureGlobalCatalog = useCallback(async ({ forceCacheRefresh = false } = {}) => {
    if (catalogLoadRef.current) return catalogLoadRef.current

    if (!forceCacheRefresh && catalogCourses) return catalogCourses

    const cached = readViewSnapshot(CATALOG_VIEW_KEY)
    if (!forceCacheRefresh && cached?.courses) {
      setCatalogCourses(cached.courses)
      return cached.courses
    }

    setCatalogLoading(true)
    const work = (async () => {
      try {
        // This exact collection query is permanent-cached by nativeCachedFirestore.
        // It can cost reads once on the first global search/filter, but typing,
        // changing filters, sorting, and revisiting the page do not refetch it.
        const snapshot = await getDocs(collection(db, "courses"))
        const allCourses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setCatalogCourses(allCourses)
        writeViewSnapshot(CATALOG_VIEW_KEY, { courses: allCourses })
        return allCourses
      } catch (error) {
        console.error("Error loading global course catalog:", error)
        return catalogCourses || cached?.courses || []
      } finally {
        setCatalogLoading(false)
        catalogLoadRef.current = null
      }
    })()

    catalogLoadRef.current = work
    return work
  }, [catalogCourses])

  useEffect(() => {
    if (filterMode) {
      setCatalogRequested(true)
      setPage(1)
      ensureGlobalCatalog()
    }
  }, [filterMode, ensureGlobalCatalog])

  useEffect(() => {
    if (!catalogRequested || !catalogCourses || cacheRevision === 0) return
    // Targeted sync has already fetched only the changed course document.
    // Re-running the permanent collection query now reads from Firestore's local cache
    // and refreshes our lightweight global search snapshot without a collection refetch.
    ensureGlobalCatalog({ forceCacheRefresh: true })
  }, [cacheRevision])

  useEffect(() => {
    if (filterMode) return
    let cancelled = false

    const loadCoursesPage = async () => {
      const viewKey = coursesViewKey(isAdmin, sortBy, page)
      const cachedView = readViewSnapshot(viewKey)
      const viewChanged = lastViewKeyRef.current !== viewKey
      lastViewKeyRef.current = viewKey

      if (cachedView?.courses) {
        setCourses(cachedView.courses)
        setHasNextPage(Boolean(cachedView.hasNextPage))
        setLoading(false)
      } else if (viewChanged || courses.length === 0) {
        setCourses([])
        setHasNextPage(false)
        setLoading(true)
      }

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

        const nextAvailable = rawDocs.length > COURSES_PER_PAGE
        setCourses(pageCourses)
        setLastVisible(visibleDocs.at(-1) || null)
        setHasNextPage(nextAvailable)
        writeViewSnapshot(viewKey, {
          courses: pageCourses,
          hasNextPage: nextAvailable,
        })
      } catch (error) {
        console.error("Error loading cached courses page:", error)
        if (!cancelled && !cachedView) {
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
  }, [isAdmin, sortBy, page, pageCursors, cacheRevision, filterMode])

  useEffect(() => {
    let cancelled = false

    const refreshEntitlements = async () => {
      if (!currentUser) {
        setPurchasedBundleCourses(new Set())
        return
      }

      const key = entitlementKey(currentUser.uid)
      const cached = readViewSnapshot(key)
      if (cached?.bundleIds) setPurchasedBundleCourses(new Set(cached.bundleIds))

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
        writeViewSnapshot(key, { bundleIds: [...purchasedBundleSet] })
      } catch (error) {
        console.error("Error loading cached course entitlements:", error)
      }
    }

    refreshEntitlements()
    return () => { cancelled = true }
  }, [currentUser?.uid, entitlementRevision])

  const globallyFilteredCourses = useMemo(() => {
    if (!filterMode || !catalogCourses) return []

    let filtered = catalogCourses.filter((course) => isAdmin || course.publishStatus !== "draft")

    if (purchasedBundleCourses.size > 0) {
      filtered = filtered.filter((course) =>
        course.courseFormat !== "bundle" || !purchasedBundleCourses.has(course.id),
      )
    }

    if (searchQuery.trim()) {
      filtered = filtered.filter((course) => matchesSearch(course, searchQuery))
    }

    if (categoryFilter !== "all") {
      filtered = filtered.filter((course) => getCourseCategories(course).includes(categoryFilter))
    }

    return sortCourses(filtered, sortBy)
  }, [filterMode, catalogCourses, isAdmin, purchasedBundleCourses, searchQuery, categoryFilter, sortBy])

  const normalPageCourses = useMemo(() => {
    if (filterMode) return []
    if (purchasedBundleCourses.size === 0) return courses
    return courses.filter((course) =>
      course.courseFormat !== "bundle" || !purchasedBundleCourses.has(course.id),
    )
  }, [courses, purchasedBundleCourses, filterMode])

  const filteredTotalPages = Math.max(1, Math.ceil(globallyFilteredCourses.length / COURSES_PER_PAGE))
  const filteredPage = Math.min(page, filteredTotalPages)
  const filteredPageCourses = useMemo(() => {
    if (!filterMode) return []
    const start = (filteredPage - 1) * COURSES_PER_PAGE
    return globallyFilteredCourses.slice(start, start + COURSES_PER_PAGE)
  }, [filterMode, globallyFilteredCourses, filteredPage])

  useEffect(() => {
    if (filterMode && page > filteredTotalPages) setPage(filteredTotalPages)
  }, [filterMode, page, filteredTotalPages])

  const displayCourses = filterMode ? filteredPageCourses : normalPageCourses
  const displayLoading = filterMode ? catalogLoading && !catalogCourses : loading

  const categories = useMemo(() => {
    const source = catalogCourses || courses
    return ["all", ...new Set(
      source
        .filter((course) => isAdmin || course.publishStatus !== "draft")
        .flatMap(getCourseCategories),
    )]
  }, [catalogCourses, courses, isAdmin])

  const resetCursorPagination = (nextSort = sortBy) => {
    setPage(1)
    setPageCursors([null])
    setLastVisible(null)
    if (nextSort !== sortBy) setSortBy(nextSort)
  }

  const changeSort = (nextSort) => {
    if (nextSort === sortBy) return
    if (filterMode) {
      setSortBy(nextSort)
      setPage(1)
    } else {
      resetCursorPagination(nextSort)
    }
  }

  const changeSearch = (value) => {
    setSearchQuery(value)
    setPage(1)
    if (value.trim()) {
      setCatalogRequested(true)
      ensureGlobalCatalog()
    }
  }

  const changeCategory = (value) => {
    setCategoryFilter(value)
    setPage(1)
    if (value !== "all") {
      setCatalogRequested(true)
      ensureGlobalCatalog()
    } else if (!searchQuery.trim()) {
      resetCursorPagination(sortBy)
    }
  }

  const goNext = () => {
    if (displayLoading) return

    if (filterMode) {
      if (filteredPage >= filteredTotalPages) return
      setPage((current) => current + 1)
    } else {
      if (!hasNextPage || !lastVisible) return
      setPage((current) => current + 1)
      setPageCursors((current) => [...current, lastVisible])
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const goPrevious = () => {
    if (page <= 1 || displayLoading) return

    setPage((current) => Math.max(1, current - 1))
    if (!filterMode) {
      setPageCursors((current) => current.slice(0, -1))
      setLastVisible(null)
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const canGoNext = filterMode
    ? filteredPage < filteredTotalPages
    : Boolean(hasNextPage && lastVisible)

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
                  onFocus={() => {
                    if (readViewSnapshot(CATALOG_VIEW_KEY)?.courses) setCatalogRequested(true)
                  }}
                  onChange={(e) => changeSearch(e.target.value)}
                  placeholder="Search all courses..."
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
                  onFocus={() => {
                    setCatalogRequested(true)
                    ensureGlobalCatalog()
                  }}
                  onChange={(e) => changeCategory(e.target.value)}
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
                  onClick={() => changeSort(option)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium smooth-transition ${sortBy === option ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!displayLoading && (
          <div className="mb-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            {filterMode ? (
              <span>
                {globallyFilteredCourses.length} matching course{globallyFilteredCourses.length === 1 ? "" : "s"} · Page {filteredPage} of {filteredTotalPages}
              </span>
            ) : (
              <span>Page {page} · Showing {displayCourses.length} of up to {COURSES_PER_PAGE}</span>
            )}
            <span>{COURSES_PER_PAGE} courses per page</span>
          </div>
        )}

        {displayLoading && displayCourses.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse">
                <div className="aspect-video bg-muted rounded-lg mb-4" />
                <div className="h-5 bg-muted rounded mb-2" />
                <div className="h-4 bg-muted rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : displayCourses.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayCourses.map((course) => (
                <CourseCard key={course.id} course={course} showMinimal={true} />
              ))}
            </div>

            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={goPrevious}
                disabled={page <= 1 || displayLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <span className="min-w-20 text-center text-sm font-semibold">Page {filterMode ? filteredPage : page}</span>
              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext || displayLoading}
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
            <h3 className="text-lg font-semibold mb-2">No courses found</h3>
            <p className="text-muted-foreground">
              {filterMode ? "Try another search or category." : "No courses are available on this page."}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
