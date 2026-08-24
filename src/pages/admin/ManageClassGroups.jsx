"use client"

import { useEffect, useMemo, useState } from "react"
import { Layers3, Plus, Pencil, Trash2, Eye, EyeOff, Save, X } from "lucide-react"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"
import {
  ADMIN_PERMISSION_KEYS,
  getAllowedCourseIds,
} from "../../lib/adminPermissions"

const emptyForm = { title: "", order: 0, isVisible: true }

const arrayValue = (value) => Array.isArray(value) ? value : value ? [value] : []

const isArchivedClass = (item) => {
  if (item?.isArchived === true) return true
  return arrayValue(item?.subject).includes("archive") || arrayValue(item?.chapter).includes("archive")
}

export default function ManageClassGroups() {
  const { userProfile } = useAuth()
  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState("")
  const [courseSearch, setCourseSearch] = useState("")
  const [groups, setGroups] = useState([])
  const [classes, setClasses] = useState([])
  const [classSearch, setClassSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    const loadCourses = async () => {
      try {
        const snapshot = await getDocs(collection(db, "courses"))
        const allCourses = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        const allowedIds = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.CLASSES)
        setCourses(
          (allowedIds === null ? allCourses : allCourses.filter((course) => allowedIds.includes(course.id)))
            .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""))),
        )
      } catch (error) {
        toast({ variant: "error", title: "Error", description: error.message || "Failed to load courses." })
      } finally {
        setLoading(false)
      }
    }
    loadCourses()
  }, [userProfile])

  useEffect(() => {
    if (!selectedCourse) {
      setGroups([])
      setClasses([])
      return
    }
    loadCourseData()
  }, [selectedCourse])

  const loadCourseData = async () => {
    try {
      const [groupSnapshot, classSnapshot] = await Promise.all([
        getDocs(query(collection(db, "classGroups"), where("courseId", "==", selectedCourse))),
        getDocs(query(collection(db, "classes"), where("courseId", "==", selectedCourse))),
      ])

      setGroups(
        groupSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
      )
      setClasses(
        classSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => !isArchivedClass(item))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
      )
    } catch (error) {
      console.error("Error loading class cards:", error)
      toast({ variant: "error", title: "Error", description: error.message || "Failed to load class cards." })
    }
  }

  const selectedCourseData = courses.find((course) => course.id === selectedCourse)

  const filteredCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase()
    if (!q) return courses
    return courses.filter((course) => String(course.title || course.name || "").toLowerCase().includes(q))
  }, [courses, courseSearch])

  const filteredClasses = useMemo(() => {
    const q = classSearch.trim().toLowerCase()
    if (!q) return classes
    return classes.filter((item) => {
      const haystack = [
        item.title,
        ...arrayValue(item.subject),
        ...arrayValue(item.chapter),
      ].join(" ").toLowerCase()
      return haystack.includes(q)
    })
  }, [classes, classSearch])

  const openCreate = () => {
    setEditingGroup(null)
    setForm({ ...emptyForm, order: groups.length })
    setShowEditor(true)
  }

  const openEdit = (group) => {
    setEditingGroup(group)
    setForm({
      title: group.title || "",
      order: Number(group.order || 0),
      isVisible: group.isVisible !== false,
    })
    setShowEditor(true)
  }

  const saveGroup = async (event) => {
    event.preventDefault()
    if (!selectedCourse || !form.title.trim()) return
    setSaving(true)
    try {
      const data = {
        courseId: selectedCourse,
        title: form.title.trim(),
        order: Number(form.order || 0),
        isVisible: form.isVisible !== false,
        updatedAt: serverTimestamp(),
      }
      if (editingGroup) {
        await updateDoc(doc(db, "classGroups", editingGroup.id), data)
      } else {
        await addDoc(collection(db, "classGroups"), { ...data, createdAt: serverTimestamp() })
      }
      setShowEditor(false)
      setEditingGroup(null)
      setForm(emptyForm)
      await loadCourseData()
      toast({ title: "Saved", description: editingGroup ? "Class card updated." : "Class card created." })
    } catch (error) {
      toast({ variant: "error", title: "Save failed", description: error.message || "Could not save class card." })
    } finally {
      setSaving(false)
    }
  }

  const deleteGroup = async (group) => {
    const assigned = classes.filter((item) => item.classGroupId === group.id)
    if (assigned.length > 0) {
      toast({
        variant: "error",
        title: "Card is in use",
        description: `Move ${assigned.length} class${assigned.length === 1 ? "" : "es"} out of this card before deleting it.`,
      })
      return
    }
    if (!window.confirm(`Delete “${group.title}”?`)) return
    try {
      await deleteDoc(doc(db, "classGroups", group.id))
      await loadCourseData()
      toast({ title: "Deleted", description: "Class card removed." })
    } catch (error) {
      toast({ variant: "error", title: "Delete failed", description: error.message || "Could not delete class card." })
    }
  }

  const assignClass = async (classId, groupId) => {
    try {
      await updateDoc(doc(db, "classes", classId), {
        classGroupId: groupId || "",
        updatedAt: serverTimestamp(),
      })
      setClasses((current) => current.map((item) => item.id === classId ? { ...item, classGroupId: groupId || "" } : item))
      toast({ title: "Updated", description: groupId ? "Class moved to card." : "Class moved to Regular." })
    } catch (error) {
      toast({ variant: "error", title: "Update failed", description: error.message || "Could not move class." })
    }
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading class cards...</div>

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Class Cards</h1>
          <p className="text-muted-foreground">
            Create extra cards beside Archive, then place classes inside them without changing the normal course structure.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={!selectedCourse}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Create Card
        </button>
      </div>

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <label className="mb-2 block text-sm font-medium">Select Course</label>
        <input
          value={courseSearch}
          onChange={(event) => setCourseSearch(event.target.value)}
          placeholder="Search course..."
          className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <select
          value={selectedCourse}
          onChange={(event) => setSelectedCourse(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Choose a course...</option>
          {filteredCourses.map((course) => (
            <option key={course.id} value={course.id}>{course.title || course.name} ({course.type || "subject"})</option>
          ))}
        </select>
      </section>

      {selectedCourse && (
        <>
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Cards</h2>
                <p className="text-xs text-muted-foreground">
                  {selectedCourseData?.type === "batch"
                    ? "Inside a card: Subject → Chapter → Class"
                    : "Inside a card: Chapter → Class"}
                </p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-xs">{groups.length} card{groups.length === 1 ? "" : "s"}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((group) => {
                const count = classes.filter((item) => item.classGroupId === group.id).length
                return (
                  <div key={group.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="rounded-lg bg-primary/10 p-2"><Layers3 className="h-5 w-5 text-primary" /></div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold">{group.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">{count} class{count === 1 ? "" : "es"} · order {group.order || 0}</p>
                          <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            {group.isVisible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            {group.isVisible !== false ? "Visible" : "Hidden"}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => openEdit(group)} className="rounded-lg p-2 hover:bg-muted"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => deleteGroup(group)} className="rounded-lg p-2 text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
              {groups.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                  No custom cards yet. Create Foundation Class, Special Class, or any other card you need.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold">Place Classes</h2>
                <p className="text-xs text-muted-foreground">Archive stays separate. Only active classes are shown here.</p>
              </div>
              <input
                value={classSearch}
                onChange={(event) => setClassSearch(event.target.value)}
                placeholder="Search class / subject / chapter..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm sm:max-w-sm"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-muted/60 text-left text-xs">
                  <tr><th className="p-3">Class</th><th className="p-3">Subject</th><th className="p-3">Chapter</th><th className="p-3">Card</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredClasses.map((item) => (
                    <tr key={item.id}>
                      <td className="p-3 text-sm font-medium">{item.title}</td>
                      <td className="p-3 text-xs text-muted-foreground">{arrayValue(item.subject).join(", ") || "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">{arrayValue(item.chapter).join(", ") || "General"}</td>
                      <td className="p-3">
                        <select
                          value={item.classGroupId || ""}
                          onChange={(event) => assignClass(item.id, event.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Regular</option>
                          {groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {filteredClasses.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No matching active classes.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">{editingGroup ? "Edit Card" : "Create Card"}</h2>
              <button type="button" onClick={() => setShowEditor(false)} className="rounded-lg p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={saveGroup} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Card name</label>
                <input
                  required
                  autoFocus
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Foundation Class"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Order</label>
                <input
                  type="number"
                  value={form.order}
                  onChange={(event) => setForm((current) => ({ ...current, order: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5"
                />
              </div>
              <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  checked={form.isVisible !== false}
                  onChange={(event) => setForm((current) => ({ ...current, isVisible: event.target.checked }))}
                />
                <div><div className="text-sm font-medium">Visible to students</div><div className="text-xs text-muted-foreground">Hidden cards stay available for admin/bot mapping.</div></div>
              </label>
              <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Card"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
