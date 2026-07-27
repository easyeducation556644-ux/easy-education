"use client"

import { useEffect, useMemo, useState } from "react"
import {
  collection,
  deleteField,
  doc,
  documentId,
  endAt,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  updateDoc,
  where,
} from "firebase/firestore"
import { Search, ShieldCheck, X } from "lucide-react"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import { getRoleLabel, getStaffRole, STAFF_ROLES } from "../../lib/adminPermissions"

const PAGE_SIZE = 10
const TABS = [
  { id: "admins", label: "Admins" },
  { id: "users", label: "Normal Users" },
  { id: "others", label: "Other Roles" },
]

const matchesTab = (user, tab) => {
  if (tab === "admins") return user.role === "admin"
  if (tab === "users") return !user.role || user.role === "user"
  return (
    STAFF_ROLES.includes(user.role) ||
    (user.role && user.role !== "admin" && user.role !== "user")
  )
}

export default function ManageAdministration() {
  const [users, setUsers] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("admins")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [courseSearchQuery, setCourseSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageCursors, setPageCursors] = useState([])
  const [lastVisible, setLastVisible] = useState(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedRole, setSelectedRole] = useState("user")
  const [classPdfEnabled, setClassPdfEnabled] = useState(false)
  const [examEnabled, setExamEnabled] = useState(false)
  const [classPdfCourseIds, setClassPdfCourseIds] = useState([])
  const [examCourseIds, setExamCourseIds] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snapshot) =>
        setCourses(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (a.title || "").localeCompare(b.title || "")),
        ),
      )
      .catch((error) => {
        console.error("Error loading courses:", error)
        toast({ variant: "error", title: "Error", description: "Failed to load courses." })
      })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setPage(1)
    setPageCursors([])
  }, [activeTab, debouncedSearch])

  useEffect(() => {
    setLoading(true)
    const usersRef = collection(db, "users")

    if (debouncedSearch) {
      const normalizedEmail = debouncedSearch.toLowerCase()
      const normalizedName = debouncedSearch.charAt(0).toUpperCase() + debouncedSearch.slice(1)
      const nameQuery = query(
        usersRef,
        orderBy("name"),
        startAt(normalizedName),
        endAt(`${normalizedName}\uf8ff`),
        limit(PAGE_SIZE),
      )
      const emailQuery = query(
        usersRef,
        orderBy("email"),
        startAt(normalizedEmail),
        endAt(`${normalizedEmail}\uf8ff`),
        limit(PAGE_SIZE),
      )
      const searchResults = { name: [], email: [] }
      const applySearch = () => {
        const merged = new Map([...searchResults.name, ...searchResults.email].map((user) => [user.id, user]))
        setUsers([...merged.values()].filter((user) => matchesTab(user, activeTab)).slice(0, PAGE_SIZE))
        setHasNextPage(false)
        setLoading(false)
      }
      const unsubscribeName = onSnapshot(
        nameQuery,
        (snapshot) => {
          searchResults.name = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
          applySearch()
        },
        (error) => {
          console.error("Name search failed:", error)
          setLoading(false)
        },
      )
      const unsubscribeEmail = onSnapshot(
        emailQuery,
        (snapshot) => {
          searchResults.email = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
          applySearch()
        },
        (error) => {
          console.error("Email search failed:", error)
          setLoading(false)
        },
      )
      return () => {
        unsubscribeName()
        unsubscribeEmail()
      }
    }

    const roleConstraint =
      activeTab === "admins"
        ? where("role", "==", "admin")
        : activeTab === "users"
          ? where("role", "==", "user")
          : where("role", "in", STAFF_ROLES)
    const constraints = [roleConstraint, orderBy(documentId())]
    const cursor = page > 1 ? pageCursors[page - 2] : null
    if (cursor) constraints.push(startAfter(cursor))
    constraints.push(limit(PAGE_SIZE + 1))

    return onSnapshot(
      query(usersRef, ...constraints),
      (snapshot) => {
        const pageDocs = snapshot.docs.slice(0, PAGE_SIZE)
        setUsers(pageDocs.map((item) => ({ id: item.id, ...item.data() })))
        setLastVisible(pageDocs.at(-1) || null)
        setHasNextPage(snapshot.docs.length > PAGE_SIZE)
        setLoading(false)
      },
      (error) => {
        console.error("Error loading paginated users:", error)
        toast({ variant: "error", title: "Error", description: "Failed to load users." })
        setLoading(false)
      },
    )
  }, [activeTab, debouncedSearch, page, pageCursors])

  const filteredCourses = useMemo(() => {
    const search = courseSearchQuery.trim().toLowerCase()
    if (!search) return courses
    return courses.filter((course) => course.title?.toLowerCase().includes(search))
  }, [courses, courseSearchQuery])

  const openAccessEditor = (user) => {
    const access = user.adminAccess || {}
    const classIds = access.classPdfCourseIds || []
    const examIds = access.examCourseIds || []
    const currentRole =
      user.role === "admin" && access.mode === "limited"
        ? getStaffRole({ classPdfCourseIds: classIds, examCourseIds: examIds })
        : user.role || "user"
    setSelectedUser(user)
    setSelectedRole(currentRole)
    setClassPdfEnabled(currentRole === "class_pdf_admin" || currentRole === "class_exam_admin")
    setExamEnabled(currentRole === "exam_create_admin" || currentRole === "class_exam_admin")
    setClassPdfCourseIds(classIds)
    setExamCourseIds(examIds)
    setCourseSearchQuery("")
  }

  const toggleCourse = (courseId, selectedIds, setSelectedIds) => {
    setSelectedIds(
      selectedIds.includes(courseId) ? selectedIds.filter((id) => id !== courseId) : [...selectedIds, courseId],
    )
  }

  const handleSave = async () => {
    if (!selectedUser) return
    const nextClassIds = classPdfEnabled ? classPdfCourseIds : []
    const nextExamIds = examEnabled ? examCourseIds : []

    if ((selectedRole === "class_pdf_admin" || selectedRole === "class_exam_admin") && nextClassIds.length === 0) {
      toast({ variant: "error", title: "Course Required", description: "Select a course for Class & PDF Admin." })
      return
    }
    if ((selectedRole === "exam_create_admin" || selectedRole === "class_exam_admin") && nextExamIds.length === 0) {
      toast({ variant: "error", title: "Course Required", description: "Select a course for Exam Create Admin." })
      return
    }

    setSaving(true)
    try {
      if (selectedRole === "admin" || selectedRole === "user") {
        await updateDoc(doc(db, "users", selectedUser.id), {
          role: selectedRole,
          adminAccess: deleteField(),
        })
        setSelectedUser(null)
        toast({ title: "Role Updated", description: `${getRoleLabel(selectedRole)} role saved successfully.` })
        return
      }

      const adminAccess = { classPdfCourseIds: nextClassIds, examCourseIds: nextExamIds }
      await updateDoc(doc(db, "users", selectedUser.id), { role: selectedRole, adminAccess })
      setSelectedUser(null)
      toast({ title: "Access Updated", description: `${getRoleLabel(selectedRole)} access saved successfully.` })
    } catch (error) {
      console.error("Error saving staff access:", error)
      toast({ variant: "error", title: "Save Failed", description: error.message || "Failed to save permissions." })
    } finally {
      setSaving(false)
    }
  }

  const handleDowngrade = async (user) => {
    try {
      await updateDoc(doc(db, "users", user.id), { role: "user", adminAccess: deleteField() })
      toast({ title: "Role Changed", description: `${user.name || user.email} was downgraded to Normal User.` })
    } catch (error) {
      console.error("Error downgrading user:", error)
      toast({ variant: "error", title: "Update Failed", description: error.message || "Failed to downgrade user." })
    }
  }

  const goNext = () => {
    if (!hasNextPage || !lastVisible) return
    setPageCursors((current) => [...current.slice(0, page - 1), lastVisible])
    setPage((current) => current + 1)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Administration</h1>
        <p className="text-muted-foreground">Assign course-specific roles to uploaders and exam creators.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Realtime search by name or email..."
          className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">No matching users found.</div>
        ) : (
          users.map((user) => (
            <div key={user.id} className="p-4 border-b border-border last:border-b-0 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{user.name || "Unnamed user"}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                <p className="text-xs mt-1 capitalize">{getRoleLabel(user.role, user.adminAccess)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openAccessEditor(user)}
                  className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                >
                  {!user.role || user.role === "user" ? "Assign Role" : "Change Role"}
                </button>
                {user.role && user.role !== "user" && (
                  <button
                    onClick={() => handleDowngrade(user)}
                    className="px-3 py-2 text-sm border border-red-500/30 text-red-500 rounded-lg hover:bg-red-500/10"
                  >
                    Downgrade to User
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {!debouncedSearch && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-muted rounded-lg disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">Page {page} · {PAGE_SIZE} per page</span>
          <button
            onClick={goNext}
            disabled={!hasNextPage}
            className="px-4 py-2 bg-muted rounded-lg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold">Assign or Change Role</h2>
                <p className="text-sm text-muted-foreground">{selectedUser.name} · {selectedUser.email}</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-muted rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Role</label>
              <select
                value={selectedRole}
                onChange={(event) => {
                  const role = event.target.value
                  setSelectedRole(role)
                  setClassPdfEnabled(role === "class_pdf_admin" || role === "class_exam_admin")
                  setExamEnabled(role === "exam_create_admin" || role === "class_exam_admin")
                }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="admin">Full Admin</option>
                <option value="class_pdf_admin">Class & PDF Admin</option>
                <option value="exam_create_admin">Exam Create Admin</option>
                <option value="class_exam_admin">Class, PDF & Exam Admin</option>
                <option value="user">Normal User</option>
              </select>
            </div>

            {(classPdfEnabled || examEnabled) && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={courseSearchQuery}
                onChange={(event) => setCourseSearchQuery(event.target.value)}
                placeholder="Search courses..."
                className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            )}

            {classPdfEnabled && <PermissionSection
              title="Class & PDF Admin"
              description="Can manage classes/PDF resources only in selected courses."
              enabled={classPdfEnabled}
              setEnabled={setClassPdfEnabled}
              locked
              courses={filteredCourses}
              selectedIds={classPdfCourseIds}
              toggleCourse={(courseId) => toggleCourse(courseId, classPdfCourseIds, setClassPdfCourseIds)}
            />}
            {examEnabled && <PermissionSection
              title="Exam Create Admin"
              description="Can create exams and questions only in selected courses."
              enabled={examEnabled}
              setEnabled={setExamEnabled}
              locked
              courses={filteredCourses}
              selectedIds={examCourseIds}
              toggleCourse={(courseId) => toggleCourse(courseId, examCourseIds, setExamCourseIds)}
            />}

            <div className="flex gap-2 mt-5">
              <button onClick={() => setSelectedUser(null)} className="flex-1 px-4 py-2 bg-muted rounded-lg">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Role & Access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PermissionSection({ title, description, enabled, setEnabled, locked = false, courses, selectedIds, toggleCourse }) {
  return (
    <section className="border border-border rounded-xl p-4 mb-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          disabled={locked}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-1 w-4 h-4"
        />
        <span>
          <span className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" />{title}</span>
          <span className="block text-sm text-muted-foreground">{description}</span>
        </span>
      </label>
      {enabled && (
        <div className="mt-4 max-h-52 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2">
          {courses.map((course) => (
            <label key={course.id} className="flex items-center gap-2 p-2 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
              <input type="checkbox" checked={selectedIds.includes(course.id)} onChange={() => toggleCourse(course.id)} className="w-4 h-4" />
              <span className="text-sm truncate">{course.title}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
