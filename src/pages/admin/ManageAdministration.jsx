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
import { Search, ShieldCheck, ShieldAlert, X } from "lucide-react"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import {
  ADMIN_PAGE_CATALOG,
  ADMIN_PERMISSION_KEYS,
  USER_ADMIN_ACTIONS,
  USER_ADMIN_ACTION_KEYS,
  STAFF_ROLES,
  getEffectiveAdminPages,
  getPageCourseIds,
  getRoleLabel,
  getUsersCourseIds,
  isFullAdmin,
} from "../../lib/adminPermissions"

const PAGE_SIZE = 10
const TABS = [
  { id: "admins", label: "Admins & Moderators" },
  { id: "users", label: "Normal Users" },
  { id: "others", label: "Legacy / Other Roles" },
]

const matchesTab = (user, tab) => {
  if (tab === "admins") return user.role === "admin"
  if (tab === "users") return !user.role || user.role === "user"
  return STAFF_ROLES.includes(user.role) || (user.role && user.role !== "admin" && user.role !== "user")
}

const userNeedsCourseScope = (actions) =>
  actions.includes(USER_ADMIN_ACTION_KEYS.GRANT_COURSE_ACCESS) ||
  actions.includes(USER_ADMIN_ACTION_KEYS.MANAGE_COURSE_ACCESS)

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
  const [selectedPages, setSelectedPages] = useState([])
  const [courseIdsByPage, setCourseIdsByPage] = useState({})
  const [userActions, setUserActions] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snapshot) => {
        setCourses(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (a.title || "").localeCompare(b.title || "")),
        )
      })
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
      const nameQuery = query(usersRef, orderBy("name"), startAt(normalizedName), endAt(`${normalizedName}\uf8ff`), limit(PAGE_SIZE))
      const emailQuery = query(usersRef, orderBy("email"), startAt(normalizedEmail), endAt(`${normalizedEmail}\uf8ff`), limit(PAGE_SIZE))
      const searchResults = { name: [], email: [] }
      const applySearch = () => {
        const merged = new Map([...searchResults.name, ...searchResults.email].map((user) => [user.id, user]))
        setUsers([...merged.values()].filter((user) => matchesTab(user, activeTab)).slice(0, PAGE_SIZE))
        setHasNextPage(false)
        setLoading(false)
      }
      const unsubscribeName = onSnapshot(nameQuery, (snapshot) => {
        searchResults.name = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        applySearch()
      })
      const unsubscribeEmail = onSnapshot(emailQuery, (snapshot) => {
        searchResults.email = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        applySearch()
      })
      return () => {
        unsubscribeName()
        unsubscribeEmail()
      }
    }

    const roleConstraint = activeTab === "admins"
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

  const allCourseIds = useMemo(() => courses.map((course) => course.id), [courses])

  const openAccessEditor = (user) => {
    const full = isFullAdmin(user)
    const normal = !user.role || user.role === "user"
    const role = full ? "admin" : normal ? "user" : "moderator"
    const pages = [...getEffectiveAdminPages(user)].filter((id) => id !== ADMIN_PERMISSION_KEYS.ADMINISTRATION)
    const scopes = {}

    ADMIN_PAGE_CATALOG.forEach((pageDefinition) => {
      if (pageDefinition.courseScoped) scopes[pageDefinition.id] = getPageCourseIds(user, pageDefinition.id) || []
    })
    scopes[ADMIN_PERMISSION_KEYS.USERS] = getUsersCourseIds(user) || []

    setSelectedUser(user)
    setSelectedRole(role)
    setSelectedPages(role === "moderator" ? pages : [])
    setCourseIdsByPage(scopes)
    setUserActions(Array.isArray(user.adminAccess?.userActions) ? user.adminAccess.userActions : [])
    setCourseSearchQuery("")
  }

  const togglePage = (pageId) => {
    setSelectedPages((current) => current.includes(pageId)
      ? current.filter((id) => id !== pageId)
      : [...current, pageId])
  }

  const toggleUserAction = (actionId) => {
    setUserActions((current) => current.includes(actionId)
      ? current.filter((id) => id !== actionId)
      : [...current, actionId])
  }

  const toggleCourse = (pageId, courseId) => {
    setCourseIdsByPage((current) => {
      const ids = current[pageId] || []
      return {
        ...current,
        [pageId]: ids.includes(courseId) ? ids.filter((id) => id !== courseId) : [...ids, courseId],
      }
    })
  }

  const toggleAllCourses = (pageId) => {
    setCourseIdsByPage((current) => {
      const selectedIds = current[pageId] || []
      const allSelected = allCourseIds.length > 0 && allCourseIds.every((courseId) => selectedIds.includes(courseId))
      return {
        ...current,
        [pageId]: allSelected ? [] : [...allCourseIds],
      }
    })
  }

  const confirmTwice = (firstMessage, secondMessage) => {
    if (!window.confirm(firstMessage)) return false
    return window.confirm(secondMessage)
  }

  const validateModerator = () => {
    if (selectedPages.length === 0) {
      toast({ variant: "error", title: "Access Required", description: "Select at least one admin-panel page." })
      return false
    }

    for (const pageDefinition of ADMIN_PAGE_CATALOG) {
      if (!selectedPages.includes(pageDefinition.id) || !pageDefinition.courseScoped) continue
      if ((courseIdsByPage[pageDefinition.id] || []).length === 0) {
        toast({ variant: "error", title: "Course Required", description: `Select at least one course for ${pageDefinition.label}.` })
        return false
      }
    }

    if (selectedPages.includes(ADMIN_PERMISSION_KEYS.USERS)) {
      if (userActions.length === 0) {
        toast({ variant: "error", title: "Users Actions Required", description: "Choose what this moderator can do on the Users page." })
        return false
      }
      if (userNeedsCourseScope(userActions) && (courseIdsByPage[ADMIN_PERMISSION_KEYS.USERS] || []).length === 0) {
        toast({ variant: "error", title: "Course Required", description: "Select the courses this moderator may grant or remove for users." })
        return false
      }
    }

    return true
  }

  const handleSave = async () => {
    if (!selectedUser || saving) return

    if (selectedRole === "admin" && !isFullAdmin(selectedUser)) {
      const confirmed = confirmTwice(
        `Make ${selectedUser.name || selectedUser.email} a Full Admin? This grants every admin-panel capability.`,
        "Final confirmation: this user will be able to change roles, permissions and all website data. Continue?",
      )
      if (!confirmed) return
    }

    if (selectedRole === "moderator" && !validateModerator()) return

    const hadPromotePermission = Array.isArray(selectedUser.adminAccess?.userActions)
      && selectedUser.adminAccess.userActions.includes(USER_ADMIN_ACTION_KEYS.PROMOTE_ADMIN)
    const grantsPromotePermission = selectedRole === "moderator"
      && selectedPages.includes(ADMIN_PERMISSION_KEYS.USERS)
      && userActions.includes(USER_ADMIN_ACTION_KEYS.PROMOTE_ADMIN)
      && !hadPromotePermission

    if (grantsPromotePermission) {
      const confirmed = confirmTwice(
        `Give ${selectedUser.name || selectedUser.email} permission to make other users Full Admins?`,
        "Final confirmation: this is a high-risk permission and can grant complete control of the admin panel. Continue?",
      )
      if (!confirmed) return
    }

    setSaving(true)
    try {
      const userRef = doc(db, "users", selectedUser.id)

      if (selectedRole === "user") {
        await updateDoc(userRef, { role: "user", adminAccess: deleteField() })
      } else if (selectedRole === "admin") {
        await updateDoc(userRef, { role: "admin", adminAccess: deleteField() })
      } else {
        const pages = selectedPages.filter((id) => id !== ADMIN_PERMISSION_KEYS.ADMINISTRATION)
        const cleanScopes = {}
        ADMIN_PAGE_CATALOG.forEach((pageDefinition) => {
          if (pages.includes(pageDefinition.id) && pageDefinition.courseScoped) {
            cleanScopes[pageDefinition.id] = [...new Set(courseIdsByPage[pageDefinition.id] || [])]
          }
        })
        if (pages.includes(ADMIN_PERMISSION_KEYS.USERS) && userNeedsCourseScope(userActions)) {
          cleanScopes[ADMIN_PERMISSION_KEYS.USERS] = [...new Set(courseIdsByPage[ADMIN_PERMISSION_KEYS.USERS] || [])]
        }

        const classPdfCourseIds = [...new Set([
          ...(cleanScopes[ADMIN_PERMISSION_KEYS.SUBJECTS] || []),
          ...(cleanScopes[ADMIN_PERMISSION_KEYS.CHAPTERS] || []),
          ...(cleanScopes[ADMIN_PERMISSION_KEYS.CLASSES] || []),
        ])]
        const examCourseIds = cleanScopes[ADMIN_PERMISSION_KEYS.EXAMS] || []

        await updateDoc(userRef, {
          role: "admin",
          adminAccess: {
            mode: "limited",
            version: 2,
            pages,
            courseIdsByPage: cleanScopes,
            userActions: pages.includes(ADMIN_PERMISSION_KEYS.USERS) ? [...new Set(userActions)] : [],
            // Kept for old clients until every deployed admin build understands v2.
            classPdfCourseIds,
            examCourseIds,
          },
        })
      }

      setSelectedUser(null)
      toast({ title: "Access Updated", description: "Role and dynamic admin permissions saved successfully." })
    } catch (error) {
      console.error("Error saving admin access:", error)
      toast({ variant: "error", title: "Save Failed", description: error.message || "Failed to save permissions." })
    } finally {
      setSaving(false)
    }
  }

  const handleDowngrade = async (user) => {
    if (!window.confirm(`Downgrade ${user.name || user.email} to a Normal User?`)) return
    try {
      await updateDoc(doc(db, "users", user.id), { role: "user", adminAccess: deleteField() })
      toast({ title: "Role Changed", description: `${user.name || user.email} is now a Normal User.` })
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
        <p className="text-muted-foreground">Build a moderator role from individual pages, actions and course scopes.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Realtime search by name or email..." className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">No matching users found.</div>
        ) : users.map((user) => (
          <div key={user.id} className="p-4 border-b border-border last:border-b-0 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{user.name || "Unnamed user"}</p>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              <p className="text-xs mt-1 capitalize">{getRoleLabel(user.role, user.adminAccess)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => openAccessEditor(user)} className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                {!user.role || user.role === "user" ? "Assign Role" : "Change Role"}
              </button>
              {user.role && user.role !== "user" && (
                <button onClick={() => handleDowngrade(user)} className="px-3 py-2 text-sm border border-red-500/30 text-red-500 rounded-lg hover:bg-red-500/10">Downgrade to User</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!debouncedSearch && (
        <div className="flex items-center justify-between mt-4">
          <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="px-4 py-2 bg-muted rounded-lg disabled:opacity-40">Previous</button>
          <span className="text-sm text-muted-foreground">Page {page} · {PAGE_SIZE} per page</span>
          <button onClick={goNext} disabled={!hasNextPage} className="px-4 py-2 bg-muted rounded-lg disabled:opacity-40">Next</button>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold">Assign or Change Role</h2>
                <p className="text-sm text-muted-foreground">{selectedUser.name} · {selectedUser.email}</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-muted rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium mb-2">Role type</label>
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="admin">Full Admin</option>
                <option value="moderator">Custom Moderator</option>
                <option value="user">Normal User</option>
              </select>
              {selectedRole === "admin" && <p className="mt-2 text-xs text-red-500">Full Admin grants every permission. Promotion requires two confirmations.</p>}
            </div>

            {selectedRole === "moderator" && (
              <>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input value={courseSearchQuery} onChange={(event) => setCourseSearchQuery(event.target.value)} placeholder="Filter course selectors..." className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>

                <div className="space-y-3">
                  {ADMIN_PAGE_CATALOG.map((pageDefinition) => {
                    const enabled = selectedPages.includes(pageDefinition.id)
                    const reserved = pageDefinition.fullAdminOnly
                    return (
                      <section key={pageDefinition.id} className={`border rounded-xl p-4 ${reserved ? "border-amber-500/30 bg-amber-500/5" : "border-border"}`}>
                        <label className={`flex items-start gap-3 ${reserved ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                          <input type="checkbox" checked={enabled} disabled={reserved} onChange={() => togglePage(pageDefinition.id)} className="mt-1 w-4 h-4" />
                          <span className="flex-1">
                            <span className="font-semibold flex items-center gap-2">
                              {reserved ? <ShieldAlert className="w-4 h-4 text-amber-500" /> : <ShieldCheck className="w-4 h-4" />}
                              {pageDefinition.label}
                            </span>
                            <span className="block text-sm text-muted-foreground">{pageDefinition.description}</span>
                          </span>
                          {reserved && <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-600">Full Admin only</span>}
                        </label>

                        {enabled && pageDefinition.courseScoped && (
                          <CourseSelector
                            courses={filteredCourses}
                            allCourseIds={allCourseIds}
                            selectedIds={courseIdsByPage[pageDefinition.id] || []}
                            onToggle={(courseId) => toggleCourse(pageDefinition.id, courseId)}
                            onToggleAll={() => toggleAllCourses(pageDefinition.id)}
                          />
                        )}

                        {enabled && pageDefinition.hasUserActions && (
                          <div className="mt-4 border-t border-border pt-4">
                            <p className="text-sm font-semibold mb-2">Users page actions</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {USER_ADMIN_ACTIONS.map((action) => (
                                <label key={action.id} className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer ${action.dangerous ? "border-red-500/25 bg-red-500/5" : "border-border"}`}>
                                  <input type="checkbox" checked={userActions.includes(action.id)} onChange={() => toggleUserAction(action.id)} className="mt-1 w-4 h-4" />
                                  <span>
                                    <span className="text-sm font-medium">{action.label}</span>
                                    <span className="block text-xs text-muted-foreground">{action.description}</span>
                                    {action.doubleConfirm && <span className="block text-[11px] text-red-500 mt-1">Double confirmation required to grant and use this permission.</span>}
                                  </span>
                                </label>
                              ))}
                            </div>

                            {userNeedsCourseScope(userActions) && (
                              <div className="mt-4">
                                <p className="text-sm font-semibold">Allowed courses for user enrollment actions</p>
                                <p className="text-xs text-muted-foreground mb-2">Grant/remove course access buttons will only operate on these courses.</p>
                                <CourseSelector
                                  courses={filteredCourses}
                                  allCourseIds={allCourseIds}
                                  selectedIds={courseIdsByPage[ADMIN_PERMISSION_KEYS.USERS] || []}
                                  onToggle={(courseId) => toggleCourse(ADMIN_PERMISSION_KEYS.USERS, courseId)}
                                  onToggleAll={() => toggleAllCourses(ADMIN_PERMISSION_KEYS.USERS)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              </>
            )}

            <div className="flex gap-2 mt-5 sticky bottom-0 bg-card pt-3 border-t border-border">
              <button onClick={() => setSelectedUser(null)} className="flex-1 px-4 py-2 bg-muted rounded-lg">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50">
                {saving ? "Saving..." : "Save Role & Access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CourseSelector({ courses, allCourseIds, selectedIds, onToggle, onToggleAll }) {
  const allSelected = allCourseIds.length > 0 && allCourseIds.every((courseId) => selectedIds.includes(courseId))

  return (
    <div className="mt-3 rounded-lg bg-muted/25 p-2">
      <label className={`mb-2 flex items-center gap-2 rounded-lg border p-2 cursor-pointer ${allSelected ? "border-primary/50 bg-primary/10" : "border-border bg-card hover:bg-muted/50"}`}>
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={allCourseIds.length === 0} className="w-4 h-4" />
        <span className="text-sm font-semibold">All courses</span>
        <span className="ml-auto text-xs text-muted-foreground">{allCourseIds.length} total</span>
      </label>

      <div className="max-h-52 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2">
        {courses.length === 0 ? (
          <p className="col-span-full text-sm text-muted-foreground p-2">No matching course.</p>
        ) : courses.map((course) => (
          <label key={course.id} className="flex items-center gap-2 p-2 border border-border rounded-lg cursor-pointer hover:bg-muted/50 bg-card">
            <input type="checkbox" checked={selectedIds.includes(course.id)} onChange={() => onToggle(course.id)} className="w-4 h-4" />
            <span className="text-sm truncate">{course.title}</span>
          </label>
        ))}
      </div>
    </div>
  )
}