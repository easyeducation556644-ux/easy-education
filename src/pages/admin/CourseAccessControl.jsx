"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  LockKeyhole,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react"
import { collection, getDocs } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"

const DURATION_UNITS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "months", label: "Months" },
]

function chunks(items, size = 5) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function titleOf(user) {
  return user?.name || user?.fullName || user?.displayName || user?.email || "Unnamed user"
}

function buildOurCourses(selectedIds, courses) {
  const courseById = new Map(courses.map((course) => [course.id, course]))
  const result = new Map()
  for (const courseId of selectedIds) {
    const course = courseById.get(courseId)
    if (!course) continue
    if (course.courseFormat === "bundle" && Array.isArray(course.bundledCourses) && course.bundledCourses.length > 0) {
      for (const rawBundledCourse of course.bundledCourses) {
        const bundledCourseId = typeof rawBundledCourse === "string" ? rawBundledCourse : rawBundledCourse?.id
        const bundledCourse = courseById.get(bundledCourseId)
        if (!bundledCourse) continue
        result.set(bundledCourseId, {
          id: bundledCourse.id,
          title: bundledCourse.title,
          price: 0,
          bundleId: course.id,
          bundleTitle: course.title,
          bundleIds: [course.id],
          bundleTitles: [course.title],
        })
      }
    } else {
      result.set(course.id, { id: course.id, title: course.title, price: course.price || 0 })
    }
  }
  return [...result.values()]
}

export default function CourseAccessControl({ open, onClose }) {
  const { currentUser, userProfile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState([])
  const [ourCourses, setOurCourses] = useState([])
  const [cpsCourses, setCpsCourses] = useState([])
  const [selectedUsers, setSelectedUsers] = useState([])
  const [allUsers, setAllUsers] = useState(false)
  const [selectedCps, setSelectedCps] = useState([])
  const [selectedOur, setSelectedOur] = useState([])
  const [userSearch, setUserSearch] = useState("")
  const [courseSearch, setCourseSearch] = useState("")
  const [cpsOpen, setCpsOpen] = useState(true)
  const [ourOpen, setOurOpen] = useState(false)
  const [permanent, setPermanent] = useState(false)
  const [durationValue, setDurationValue] = useState("60")
  const [durationUnit, setDurationUnit] = useState("minutes")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const token = await currentUser?.getIdToken?.()
        if (!token) throw new Error("Admin authentication token is unavailable")
        const [usersSnapshot, coursesSnapshot, cpsResponse] = await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "courses")),
          fetch("/api/cps?action=catalog", {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          }),
        ])
        const cpsPayload = await cpsResponse.json().catch(() => ({}))
        if (!cpsResponse.ok) throw new Error(cpsPayload.error || "Could not load CPS courses")
        if (cancelled) return
        setUsers(usersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
        setOurCourses(coursesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
        setCpsCourses(Array.isArray(cpsPayload.courses) ? cpsPayload.courses : [])
      } catch (error) {
        if (!cancelled) toast({ variant: "error", title: "Access Control", description: error.message || "Could not load course access data." })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, currentUser])

  useEffect(() => {
    if (open) return
    setSelectedUsers([])
    setAllUsers(false)
    setSelectedCps([])
    setSelectedOur([])
    setUserSearch("")
    setCourseSearch("")
    setPermanent(false)
    setDurationValue("60")
    setDurationUnit("minutes")
    setCpsOpen(true)
    setOurOpen(false)
  }, [open])

  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase()
    if (!needle) return users
    return users.filter((user) => `${titleOf(user)} ${user.email || ""}`.toLowerCase().includes(needle))
  }, [users, userSearch])

  const filteredCps = useMemo(() => {
    const needle = courseSearch.trim().toLowerCase()
    if (!needle) return cpsCourses
    return cpsCourses.filter((course) => `${course.title || ""} ${course.batch || ""} ${course.category || ""}`.toLowerCase().includes(needle))
  }, [cpsCourses, courseSearch])

  const filteredOur = useMemo(() => {
    const needle = courseSearch.trim().toLowerCase()
    if (!needle) return ourCourses
    return ourCourses.filter((course) => `${course.title || ""}`.toLowerCase().includes(needle))
  }, [ourCourses, courseSearch])

  if (!open) return null

  const toggle = (setter, value) => setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const targetUserCount = allUsers ? users.length : selectedUsers.length
  const selectedCourseCount = selectedCps.length + selectedOur.length

  const grantOurCourseAccess = async (targets, token) => {
    if (selectedOur.length === 0) return 0
    const coursesToEnroll = buildOurCourses(selectedOur, ourCourses)
    if (coursesToEnroll.length === 0) return 0
    let completed = 0
    for (const group of chunks(targets, 5)) {
      await Promise.all(group.map(async (user) => {
        const transactionId = `MANUAL_BULK_${Date.now()}_${user.id}`
        const response = await fetch("/api/process-enrollment", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            transaction_id: transactionId,
            userId: user.id,
            userName: titleOf(user),
            userEmail: user.email || "",
            skipPaymentVerification: true,
            finalAmount: 0,
            subtotal: 0,
            discount: 0,
            couponCode: "MANUAL_ADMIN_BULK_GRANT",
            paymentMethod: "Manual Grant by Admin",
            courses: coursesToEnroll,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.success) throw new Error(payload.error || `Could not grant Easy Education courses to ${titleOf(user)}`)
        completed += coursesToEnroll.length
      }))
    }
    return completed
  }

  const handleGrant = async () => {
    const targets = allUsers ? users : users.filter((user) => selectedUsers.includes(user.id))
    if (targets.length === 0) {
      toast({ variant: "error", title: "Select users", description: "Choose one, multiple or all users." })
      return
    }
    if (selectedCourseCount === 0) {
      toast({ variant: "error", title: "Select courses", description: "Choose at least one CPS or Easy Education course." })
      return
    }
    const numericDuration = Number(durationValue)
    if (!permanent && selectedCps.length > 0 && (!Number.isFinite(numericDuration) || numericDuration <= 0)) {
      toast({ variant: "error", title: "Trial duration", description: "Enter a positive trial duration." })
      return
    }

    setSaving(true)
    try {
      const token = await currentUser?.getIdToken?.()
      if (!token) throw new Error("Admin authentication token is unavailable")
      let cpsGranted = 0
      let ourGranted = 0

      if (selectedCps.length > 0) {
        const allVisibleCps = selectedCps.length === cpsCourses.length && cpsCourses.length > 0
        const response = await fetch("/api/cps", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            action: "grantBatch",
            allUsers,
            userIds: allUsers ? [] : selectedUsers,
            allCourses: allVisibleCps,
            courseIds: selectedCps,
            permanent,
            durationValue: permanent ? null : numericDuration,
            durationUnit: permanent ? "permanent" : durationUnit,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.ok) throw new Error(payload.error || "CPS access grant failed")
        cpsGranted = Number(payload.grants || 0)
      }

      if (selectedOur.length > 0) ourGranted = await grantOurCourseAccess(targets, token)

      toast({
        title: "Course access updated",
        description: `${cpsGranted} CPS entitlement(s)${selectedOur.length ? ` • ${ourGranted} Easy Education enrollment(s)` : ""}.`,
      })
      onClose?.()
    } catch (error) {
      toast({ variant: "error", title: "Grant failed", description: error.message || "Could not update course access." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-background/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card/95 backdrop-blur-xl px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary"><Sparkles className="h-4 w-4" />Course access studio</div>
            <h2 className="mt-1 text-2xl font-bold">Access & trial grants</h2>
            <p className="mt-1 text-sm text-muted-foreground">One, multiple or all users × one, multiple or all CPS courses.</p>
          </div>
          <button onClick={onClose} className="rounded-full border border-border p-2 hover:bg-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">{[...Array(6)].map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-muted" />)}</div>
        ) : (
          <div className="grid gap-5 p-5 sm:p-6">
            <section className="rounded-2xl border border-border bg-background/50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /><div><p className="font-semibold">1. Choose users</p><p className="text-xs text-muted-foreground">Select one, many, or every user.</p></div></div>
                <button
                  type="button"
                  onClick={() => { setAllUsers((value) => !value); setSelectedUsers([]) }}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${allUsers ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
                >
                  {allUsers ? `All users (${users.length})` : "Select all users"}
                </button>
              </div>
              {!allUsers && (
                <>
                  <div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name or email" className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 outline-none focus:ring-2 focus:ring-primary/40" /></div>
                  <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {filteredUsers.map((user) => {
                      const checked = selectedUsers.includes(user.id)
                      return <button key={user.id} type="button" onClick={() => toggle(setSelectedUsers, user.id)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{titleOf(user)}</span><span className="block truncate text-xs text-muted-foreground">{user.email}</span></span></button>
                    })}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-background/50 p-4">
              <div className="mb-3 flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" /><div><p className="font-semibold">2. Choose courses</p><p className="text-xs text-muted-foreground">CPS stays app-only; it is never added to the public Courses page.</p></div></div>
              <div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Search courses" className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 outline-none focus:ring-2 focus:ring-primary/40" /></div>

              <div className="overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-amber-500/10">
                <button type="button" onClick={() => setCpsOpen((value) => !value)} className="flex w-full items-center gap-3 p-4 text-left">
                  <span className="rounded-xl bg-violet-500/15 p-2 text-violet-500"><Sparkles className="h-5 w-5" /></span>
                  <span className="flex-1"><span className="block font-bold">CPS courses</span><span className="text-xs text-muted-foreground">App-only catalog • locked preview until granted</span></span>
                  <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-bold text-violet-600 dark:text-violet-300">With live class & instant class</span>
                  <ChevronDown className={`h-5 w-5 transition ${cpsOpen ? "rotate-180" : ""}`} />
                </button>
                {cpsOpen && (
                  <div className="border-t border-violet-500/15 p-3 sm:p-4">
                    <div className="mb-3 flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedCps(cpsCourses.map((course) => course.id))} className="rounded-full border border-violet-500/25 px-3 py-1.5 text-xs font-semibold hover:bg-violet-500/10">All CPS courses</button><button type="button" onClick={() => setSelectedCps([])} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">Clear CPS</button></div>
                    <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                      {filteredCps.map((course) => {
                        const checked = selectedCps.includes(course.id)
                        return <button key={course.id} type="button" onClick={() => toggle(setSelectedCps, course.id)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? "border-violet-500 bg-violet-500/10" : "border-violet-500/15 bg-background/70 hover:bg-violet-500/5"}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-violet-500 bg-violet-500 text-white" : "border-muted-foreground/30"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{course.title}</span><span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-600 dark:text-violet-300">LIVE + INSTANT</span></span></button>
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
                <button type="button" onClick={() => setOurOpen((value) => !value)} className="flex w-full items-center gap-3 p-4 text-left">
                  <span className="rounded-xl bg-primary/10 p-2 text-primary"><BookOpen className="h-5 w-5" /></span>
                  <span className="flex-1"><span className="block font-bold">Our courses</span><span className="text-xs text-muted-foreground">Existing Easy Education catalog & enrollment flow</span></span>
                  <ChevronDown className={`h-5 w-5 transition ${ourOpen ? "rotate-180" : ""}`} />
                </button>
                {ourOpen && (
                  <div className="border-t border-border p-3 sm:p-4">
                    <div className="mb-3 flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedOur(ourCourses.map((course) => course.id))} className="rounded-full border border-primary/25 px-3 py-1.5 text-xs font-semibold hover:bg-primary/5">All our courses</button><button type="button" onClick={() => setSelectedOur([])} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">Clear</button></div>
                    <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                      {filteredOur.map((course) => {
                        const checked = selectedOur.includes(course.id)
                        return <button key={course.id} type="button" onClick={() => toggle(setSelectedOur, course.id)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span><span className="truncate text-sm font-semibold">{course.title}</span></button>
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-background/50 p-4">
              <div className="mb-3 flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /><div><p className="font-semibold">3. CPS access duration</p><p className="text-xs text-muted-foreground">Any number of minutes, hours, days or months; or permanent.</p></div></div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => setPermanent((value) => !value)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${permanent ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}>{permanent ? "Permanent access" : "Trial access"}</button>
                {!permanent && <><input type="number" min="0.01" step="any" value={durationValue} onChange={(event) => setDurationValue(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary/40" /><select value={durationUnit} onChange={(event) => setDurationUnit(event.target.value)} className="rounded-xl border border-border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary/40">{DURATION_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></>}
              </div>
              {selectedOur.length > 0 && !permanent && <div className="mt-3 flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><span>The trial clock is enforced for CPS entitlements. “Our courses” keep the existing permanent enrollment rules so current payments/offline access are not silently changed.</span></div>}
            </section>

            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
              <div className="flex-1 text-sm text-muted-foreground"><strong className="text-foreground">{targetUserCount}</strong> user(s) • <strong className="text-foreground">{selectedCps.length}</strong> CPS • <strong className="text-foreground">{selectedOur.length}</strong> our course(s)</div>
              <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-semibold hover:bg-muted">Cancel</button>
              <button onClick={handleGrant} disabled={saving || targetUserCount === 0 || selectedCourseCount === 0} className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Granting access…" : "Grant selected access"}</button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
