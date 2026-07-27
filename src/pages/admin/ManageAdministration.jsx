"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, deleteField, doc, getDocs, updateDoc } from "firebase/firestore"
import { Search, ShieldCheck, X } from "lucide-react"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"

export default function ManageAdministration() {
  const [users, setUsers] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [courseSearchQuery, setCourseSearchQuery] = useState("")
  const [selectedUser, setSelectedUser] = useState(null)
  const [classPdfEnabled, setClassPdfEnabled] = useState(false)
  const [examEnabled, setExamEnabled] = useState(false)
  const [classPdfCourseIds, setClassPdfCourseIds] = useState([])
  const [examCourseIds, setExamCourseIds] = useState([])
  const [saving, setSaving] = useState(false)

  const fetchData = async () => {
    try {
      const [usersSnapshot, coursesSnapshot] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "courses")),
      ])
      setUsers(usersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
      setCourses(
        coursesSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => (a.title || "").localeCompare(b.title || "")),
      )
    } catch (error) {
      console.error("Error loading administration data:", error)
      toast({ variant: "error", title: "Error", description: "Failed to load users and courses." })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filteredUsers = useMemo(() => {
    const search = searchQuery.trim().toLowerCase()
    if (!search) return users
    return users.filter(
      (user) => user.name?.toLowerCase().includes(search) || user.email?.toLowerCase().includes(search),
    )
  }, [users, searchQuery])

  const filteredCourses = useMemo(() => {
    const search = courseSearchQuery.trim().toLowerCase()
    if (!search) return courses
    return courses.filter((course) => course.title?.toLowerCase().includes(search))
  }, [courses, courseSearchQuery])

  const openAccessEditor = (user) => {
    const access = user.adminAccess || {}
    const classIds = access.classPdfCourseIds || []
    const examIds = access.examCourseIds || []
    setSelectedUser(user)
    setClassPdfEnabled(classIds.length > 0)
    setExamEnabled(examIds.length > 0)
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

    if (classPdfEnabled && nextClassIds.length === 0) {
      toast({ variant: "error", title: "Course Required", description: "Select a course for Class & PDF Admin." })
      return
    }
    if (examEnabled && nextExamIds.length === 0) {
      toast({ variant: "error", title: "Course Required", description: "Select a course for Exam Create Admin." })
      return
    }
    if (nextClassIds.length === 0 && nextExamIds.length === 0) {
      toast({ variant: "error", title: "Permission Required", description: "Enable at least one admin permission." })
      return
    }

    setSaving(true)
    try {
      const adminAccess = {
        mode: "limited",
        classPdfCourseIds: nextClassIds,
        examCourseIds: nextExamIds,
      }
      await updateDoc(doc(db, "users", selectedUser.id), { role: "admin", adminAccess })
      setUsers((current) =>
        current.map((user) => (user.id === selectedUser.id ? { ...user, role: "admin", adminAccess } : user)),
      )
      setSelectedUser(null)
      toast({ title: "Access Updated", description: "Limited admin permissions were saved successfully." })
    } catch (error) {
      console.error("Error saving admin access:", error)
      toast({ variant: "error", title: "Save Failed", description: error.message || "Failed to save permissions." })
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveAdmin = async (user) => {
    try {
      await updateDoc(doc(db, "users", user.id), { role: "user", adminAccess: deleteField() })
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? { ...item, role: "user", adminAccess: undefined } : item)),
      )
      toast({ title: "Access Removed", description: `${user.name || user.email} is now a regular user.` })
    } catch (error) {
      console.error("Error removing admin access:", error)
      toast({ variant: "error", title: "Update Failed", description: error.message || "Failed to remove access." })
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-muted-foreground">Loading administration settings...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Administration</h1>
        <p className="text-muted-foreground">Assign course-specific access to uploaders and exam creators.</p>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search user by name or email..."
          className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {filteredUsers.map((user) => {
          const limited = user.role === "admin" && user.adminAccess?.mode === "limited"
          const fullAdmin = user.role === "admin" && !limited
          return (
            <div key={user.id} className="p-4 border-b border-border last:border-b-0 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{user.name || "Unnamed user"}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                <p className="text-xs mt-1">
                  {fullAdmin
                    ? "Full Admin"
                    : limited
                      ? `Limited Admin · Class/PDF: ${user.adminAccess.classPdfCourseIds?.length || 0} · Exams: ${user.adminAccess.examCourseIds?.length || 0}`
                      : "Regular User"}
                </p>
              </div>
              {!fullAdmin && (
                <div className="flex gap-2">
                  <button
                    onClick={() => openAccessEditor(user)}
                    className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                  >
                    {limited ? "Edit Access" : "Assign Admin Access"}
                  </button>
                  {limited && (
                    <button
                      onClick={() => handleRemoveAdmin(user)}
                      className="px-3 py-2 text-sm border border-red-500/30 text-red-500 rounded-lg hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold">Limited Admin Access</h2>
                <p className="text-sm text-muted-foreground">{selectedUser.name} · {selectedUser.email}</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-muted rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={courseSearchQuery}
                onChange={(event) => setCourseSearchQuery(event.target.value)}
                placeholder="Search courses..."
                className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <PermissionSection
              title="Class & PDF Admin"
              description="Can create, edit and archive classes/PDF resources only in selected courses."
              enabled={classPdfEnabled}
              setEnabled={setClassPdfEnabled}
              courses={filteredCourses}
              selectedIds={classPdfCourseIds}
              toggleCourse={(courseId) => toggleCourse(courseId, classPdfCourseIds, setClassPdfCourseIds)}
            />

            <PermissionSection
              title="Exam Create Admin"
              description="Can create exams and manage questions only in selected courses."
              enabled={examEnabled}
              setEnabled={setExamEnabled}
              courses={filteredCourses}
              selectedIds={examCourseIds}
              toggleCourse={(courseId) => toggleCourse(courseId, examCourseIds, setExamCourseIds)}
            />

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setSelectedUser(null)}
                className="flex-1 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PermissionSection({ title, description, enabled, setEnabled, courses, selectedIds, toggleCourse }) {
  return (
    <section className="border border-border rounded-xl p-4 mb-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
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
              <input
                type="checkbox"
                checked={selectedIds.includes(course.id)}
                onChange={() => toggleCourse(course.id)}
                className="w-4 h-4"
              />
              <span className="text-sm truncate">{course.title}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
