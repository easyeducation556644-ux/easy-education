"use client"

import { useEffect, useMemo, useState } from "react"
import {
  collection,
  documentId,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
} from "firebase/firestore"
import { BookOpen, Search, ShieldCheck, X } from "lucide-react"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"

const PAGE_SIZE = 10

const isNormalUser = (user) => !user.role || user.role === "user"

export default function GrantCourseAccess() {
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [courses, setCourses] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [courseSearch, setCourseSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageCursors, setPageCursors] = useState([])
  const [lastVisible, setLastVisible] = useState(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedCourseIds, setSelectedCourseIds] = useState([])
  const [granting, setGranting] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setPage(1)
    setPageCursors([])
  }, [debouncedSearch])

  useEffect(() => {
    let active = true
    setLoadingCourses(true)
    getDocs(collection(db, "courses"))
      .then((snapshot) => {
        if (!active) return
        setCourses(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (a.title || "").localeCompare(b.title || "")),
        )
      })
      .catch((error) => {
        console.error("Unable to load grantable courses:", error)
        toast({ variant: "error", title: "Courses unavailable", description: "Could not load courses." })
      })
      .finally(() => {
        if (active) setLoadingCourses(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadUsers = async () => {
      setLoadingUsers(true)
      try {
        const usersRef = collection(db, "users")

        if (debouncedSearch) {
          const email = debouncedSearch.toLowerCase()
          const name = debouncedSearch.charAt(0).toUpperCase() + debouncedSearch.slice(1)
          const [nameSnapshot, emailSnapshot] = await Promise.all([
            getDocs(query(usersRef, orderBy("name"), startAt(name), endAt(`${name}\uf8ff`), limit(PAGE_SIZE))),
            getDocs(query(usersRef, orderBy("email"), startAt(email), endAt(`${email}\uf8ff`), limit(PAGE_SIZE))),
          ])
          if (!active) return
          const merged = new Map(
            [...nameSnapshot.docs, ...emailSnapshot.docs].map((item) => [
              item.id,
              { id: item.id, ...item.data() },
            ]),
          )
          setUsers([...merged.values()].filter(isNormalUser).slice(0, PAGE_SIZE))
          setHasNextPage(false)
          setLastVisible(null)
          return
        }

        const constraints = [where("role", "==", "user"), orderBy(documentId())]
        const cursor = page > 1 ? pageCursors[page - 2] : null
        if (cursor) constraints.push(startAfter(cursor))
        constraints.push(limit(PAGE_SIZE + 1))
        const snapshot = await getDocs(query(usersRef, ...constraints))
        if (!active) return
        const pageDocs = snapshot.docs.slice(0, PAGE_SIZE)
        setUsers(pageDocs.map((item) => ({ id: item.id, ...item.data() })))
        setLastVisible(pageDocs.at(-1) || null)
        setHasNextPage(snapshot.docs.length > PAGE_SIZE)
      } catch (error) {
        console.error("Unable to load users for access grant:", error)
        if (active) {
          setUsers([])
          toast({ variant: "error", title: "Users unavailable", description: "Could not load users." })
        }
      } finally {
        if (active) setLoadingUsers(false)
      }
    }

    loadUsers()
    return () => {
      active = false
    }
  }, [debouncedSearch, page, pageCursors])

  const filteredCourses = useMemo(() => {
    const term = courseSearch.trim().toLowerCase()
    if (!term) return courses
    return courses.filter((course) => (course.title || "").toLowerCase().includes(term))
  }, [courses, courseSearch])

  const openGrant = (user) => {
    setSelectedUser(user)
    setSelectedCourseIds([])
    setCourseSearch("")
  }

  const toggleCourse = (courseId) => {
    setSelectedCourseIds((current) =>
      current.includes(courseId)
        ? current.filter((id) => id !== courseId)
        : [...current, courseId],
    )
  }

  const grantAccess = async () => {
    if (!selectedUser || selectedCourseIds.length === 0 || !currentUser) return
    setGranting(true)
    try {
      const token = await currentUser.getIdToken()
      const response = await fetch("/api/admin-grant-course-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          courseIds: selectedCourseIds,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to grant course access")
      }

      toast({
        title: "Course access granted",
        description: `${selectedCourseIds.length} selected course${selectedCourseIds.length === 1 ? "" : "s"} granted to ${selectedUser.name || selectedUser.email}.`,
      })
      setSelectedUser(null)
      setSelectedCourseIds([])
    } catch (error) {
      console.error("Grant-only access failed:", error)
      toast({ variant: "error", title: "Grant failed", description: error.message || "Please try again." })
    } finally {
      setGranting(false)
    }
  }

  const goNext = () => {
    if (!hasNextPage || !lastVisible) return
    setPageCursors((current) => [...current.slice(0, page - 1), lastVisible])
    setPage((current) => current + 1)
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Users — Grant Course Access</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          This limited admin page can only search users and grant course access. No ban, delete, revoke, role, or profile-management actions are available.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search user by name or email..."
          className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loadingUsers ? (
          <div className="p-10 text-center text-muted-foreground">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">No matching users found.</div>
        ) : (
          users.map((user) => (
            <div key={user.id} className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{user.name || "Unnamed user"}</p>
                <p className="truncate text-sm text-muted-foreground">{user.email || user.id}</p>
              </div>
              <button
                type="button"
                onClick={() => openGrant(user)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <BookOpen className="h-4 w-4" />
                Grant Access
              </button>
            </div>
          ))
        )}
      </div>

      {!debouncedSearch && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="rounded-lg bg-muted px-4 py-2 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <button
            type="button"
            onClick={goNext}
            disabled={!hasNextPage}
            className="rounded-lg bg-muted px-4 py-2 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Grant Course Access</h2>
                <p className="text-sm text-muted-foreground">{selectedUser.name || "User"} · {selectedUser.email}</p>
              </div>
              <button type="button" onClick={() => setSelectedUser(null)} className="rounded-lg p-2 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={courseSearch}
                onChange={(event) => setCourseSearch(event.target.value)}
                placeholder="Search courses..."
                className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="mb-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{loadingCourses ? "Loading courses..." : `${courses.length} courses available`}</span>
              <span className="font-medium">{selectedCourseIds.length} selected</span>
            </div>

            <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {filteredCourses.map((course) => (
                <label key={course.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selectedCourseIds.includes(course.id)}
                    onChange={() => toggleCourse(course.id)}
                    className="mt-1 h-4 w-4"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium">{course.title || "Untitled Course"}</span>
                    {course.courseFormat === "bundle" ? <span className="text-xs text-muted-foreground">Bundle</span> : null}
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="flex-1 rounded-lg bg-muted px-4 py-2.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={grantAccess}
                disabled={granting || selectedCourseIds.length === 0}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-50"
              >
                {granting ? "Granting..." : `Grant ${selectedCourseIds.length || ""} Course${selectedCourseIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
