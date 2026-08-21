"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Check, LockKeyhole, Search, Trash2, X } from "lucide-react"
import { collection, deleteDoc, doc, getDocs, query, updateDoc, where } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"

const normalize = (value) => String(value || "").trim()

function CollapsedGroup({ title, subtitle, open, onToggle, children }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition">
        <span className="rounded-xl bg-primary/10 p-2 text-primary">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        </div>
      </button>
      {open && <div className="border-t border-border p-3 sm:p-4">{children}</div>}
    </div>
  )
}

function CourseChoice({ course, selected, onToggle, cps = false }) {
  return (
    <button type="button" onClick={onToggle} className={`w-full rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${selected ? "border-primary bg-primary" : "border-muted-foreground/30"}`}>
          {selected && <Check className="h-4 w-4 text-primary-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{course.title || course.name || "Untitled course"}</div>
          {cps && <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">with live class & instant class</span>}
        </div>
      </div>
    </button>
  )
}

function AccessModal({ mode, user, ourCourses, ourGranted, cpsCourses, cpsGranted, busy, onClose, onGrant, onRemoveOur, onRemoveCps }) {
  const [openCps, setOpenCps] = useState(false)
  const [openOur, setOpenOur] = useState(false)
  const [selectedCps, setSelectedCps] = useState([])
  const [selectedOur, setSelectedOur] = useState([])
  const [search, setSearch] = useState("")
  const isGrant = mode === "grant"
  const q = search.trim().toLowerCase()
  const availableOur = useMemo(() => {
    const granted = new Set(ourGranted.map((item) => item.id))
    return ourCourses.filter((item) => !granted.has(item.id) && (!q || normalize(item.title).toLowerCase().includes(q)))
  }, [ourCourses, ourGranted, q])
  const availableCps = useMemo(() => {
    const granted = new Set(cpsGranted.map((item) => item.id))
    return cpsCourses.filter((item) => !granted.has(item.id) && (!q || normalize(item.title).toLowerCase().includes(q)))
  }, [cpsCourses, cpsGranted, q])
  const toggle = (setter, id) => setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl border border-border bg-background shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border p-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2"><LockKeyhole className="w-5 h-5 text-primary" /><h2 className="text-xl font-extrabold">{isGrant ? "Give Course Access" : "Granted Courses"}</h2></div>
            <p className="mt-1 text-sm text-muted-foreground truncate">{user?.name || user?.email} · Permanent course access</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>
        <div className="max-h-[calc(90vh-150px)] overflow-y-auto p-4 sm:p-5 space-y-3">
          {isGrant && (
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search courses..." className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3" />
            </div>
          )}

          <CollapsedGroup title="CPS Courses" subtitle={isGrant ? `${availableCps.length} available` : `${cpsGranted.length} granted`} open={openCps} onToggle={() => setOpenCps((value) => !value)}>
            <div className="space-y-2">
              {(isGrant ? availableCps : cpsGranted).map((course) => isGrant ? (
                <CourseChoice key={course.id} course={course} cps selected={selectedCps.includes(course.id)} onToggle={() => toggle(setSelectedCps, course.id)} />
              ) : (
                <div key={course.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{course.title}</div><span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-600 dark:text-violet-300">with live class & instant class</span></div>
                  <button type="button" disabled={busy} onClick={() => onRemoveCps(course.id)} className="rounded-lg bg-red-500/10 p-2 text-red-500 hover:bg-red-500/20 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {(isGrant ? availableCps : cpsGranted).length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">{isGrant ? "No CPS course left to grant." : "No CPS course has permanent access."}</div>}
            </div>
          </CollapsedGroup>

          <CollapsedGroup title="Our Courses" subtitle={isGrant ? `${availableOur.length} available` : `${ourGranted.length} granted`} open={openOur} onToggle={() => setOpenOur((value) => !value)}>
            <div className="space-y-2">
              {(isGrant ? availableOur : ourGranted).map((course) => isGrant ? (
                <CourseChoice key={course.id} course={course} selected={selectedOur.includes(course.id)} onToggle={() => toggle(setSelectedOur, course.id)} />
              ) : (
                <div key={course.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{course.title}</div></div>
                  <button type="button" disabled={busy} onClick={() => onRemoveOur(course.id)} className="rounded-lg bg-red-500/10 p-2 text-red-500 hover:bg-red-500/20 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {(isGrant ? availableOur : ourGranted).length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">{isGrant ? "No Easy Education course left to grant." : "No Easy Education course is granted."}</div>}
            </div>
          </CollapsedGroup>
        </div>
        <div className="flex gap-3 border-t border-border p-4 sm:p-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-muted px-4 py-2.5 font-semibold">Close</button>
          {isGrant && <button type="button" disabled={busy || (selectedCps.length + selectedOur.length === 0)} onClick={() => onGrant({ cpsIds: selectedCps, ourIds: selectedOur })} className="flex-1 rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Granting..." : `Grant Access (${selectedCps.length + selectedOur.length})`}</button>}
        </div>
      </div>
    </div>
  )
}

export default function UserCourseAccessBridge({ children }) {
  const { currentUser } = useAuth()
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [user, setUser] = useState(null)
  const [ourCourses, setOurCourses] = useState([])
  const [ourGranted, setOurGranted] = useState([])
  const [cpsCourses, setCpsCourses] = useState([])
  const [cpsGranted, setCpsGranted] = useState([])

  const token = async () => currentUser?.getIdToken?.().catch(() => null)

  const loadAccess = async (targetUser) => {
    const [courseSnapshot, paymentSnapshot, entitlementSnapshot, authToken] = await Promise.all([
      getDocs(collection(db, "courses")),
      getDocs(query(collection(db, "payments"), where("userId", "==", targetUser.id))),
      getDocs(query(collection(db, "cpsEntitlements"), where("userId", "==", targetUser.id))),
      token(),
    ])
    const localCourses = courseSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.courseFormat !== "cps")
    const grantedMap = new Map()
    paymentSnapshot.docs.forEach((paymentDoc) => {
      const payment = paymentDoc.data()
      if (payment.status !== "approved") return
      ;(payment.courses || []).forEach((course) => grantedMap.set(course.id, { ...course, paymentId: paymentDoc.id }))
    })
    const permanentCps = entitlementSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.status !== "revoked" && (item.accessType === "permanent" || Number(item.expiresAtMs || 0) === 0))
      .map((item) => ({ id: normalize(item.cpsCourseId || item.courseId), title: item.courseTitle || "CPS Course" }))

    let remoteCps = []
    if (authToken) {
      const response = await fetch("/api/cps?action=catalog", { headers: { Authorization: `Bearer ${authToken}` } }).catch(() => null)
      if (response?.ok) {
        const payload = await response.json().catch(() => ({}))
        remoteCps = (payload.courses || []).map((course) => ({ id: normalize(course.id).replace(/^cps:/, ""), title: course.title || "CPS Course" }))
      }
    }
    setOurCourses(localCourses)
    setOurGranted([...grantedMap.values()])
    setCpsCourses(remoteCps)
    setCpsGranted(permanentCps)
  }

  const resolveRowUser = async (button) => {
    const row = button.closest("tr")
    const email = row?.querySelectorAll("td")?.[1]?.textContent?.trim()
    if (!email) throw new Error("Could not resolve this user")
    const snapshot = await getDocs(query(collection(db, "users"), where("email", "==", email)))
    const match = snapshot.docs[0]
    if (!match) throw new Error("User profile was not found")
    return { id: match.id, ...match.data() }
  }

  const openFor = async (mode, button) => {
    setBusy(true)
    try {
      const target = await resolveRowUser(button)
      setUser(target)
      await loadAccess(target)
      setModal(mode)
    } catch (error) {
      toast({ variant: "error", title: "Course Access", description: error.message || "Could not load course access." })
    } finally {
      setBusy(false)
    }
  }

  const onCapture = (event) => {
    const button = event.target.closest("button")
    if (!button) return
    const title = button.getAttribute("title")
    if (title !== "Grant course" && title !== "Manage courses") return
    event.preventDefault()
    event.stopPropagation()
    openFor(title === "Grant course" ? "grant" : "manage", button)
  }

  const grantOur = async (courseIds, target, authToken) => {
    if (!courseIds.length) return
    const selected = ourCourses.filter((item) => courseIds.includes(item.id))
    const expanded = new Map()
    selected.forEach((course) => {
      if (course.courseFormat === "bundle" && Array.isArray(course.bundledCourses)) {
        course.bundledCourses.forEach((raw) => {
          const id = typeof raw === "string" ? raw : raw?.id
          const child = ourCourses.find((item) => item.id === id)
          if (child) expanded.set(id, { id: child.id, title: child.title, price: 0, bundleId: course.id, bundleTitle: course.title })
        })
      } else expanded.set(course.id, { id: course.id, title: course.title, price: course.price || 0 })
    })
    const response = await fetch("/api/process-enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({
        transaction_id: `MANUAL_${Date.now()}_${target.id}`,
        userId: target.id,
        userName: target.name,
        userEmail: target.email,
        skipPaymentVerification: true,
        finalAmount: 0,
        subtotal: 0,
        discount: 0,
        couponCode: "MANUAL_ADMIN_GRANT",
        paymentMethod: "Manual Grant by Admin",
        courses: [...expanded.values()],
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.success) throw new Error(payload.error || "Easy Education course grant failed")
  }

  const grantCps = async (courseIds, target, authToken) => {
    if (!courseIds.length) return
    const response = await fetch("/api/cps?action=grantBatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ action: "grantBatch", userIds: [target.id], courseIds, permanent: true }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok) throw new Error(payload.error || "CPS course grant failed")
  }

  const handleGrant = async ({ cpsIds, ourIds }) => {
    if (!user) return
    setBusy(true)
    try {
      const authToken = await token()
      if (!authToken) throw new Error("Admin session expired")
      await grantOur(ourIds, user, authToken)
      await grantCps(cpsIds, user, authToken)
      await loadAccess(user)
      toast({ title: "Access granted", description: "Permanent course access updated successfully." })
      setModal(null)
    } catch (error) {
      toast({ variant: "error", title: "Grant failed", description: error.message || "Could not grant course access." })
    } finally {
      setBusy(false)
    }
  }

  const removeOur = async (courseId) => {
    if (!user) return
    setBusy(true)
    try {
      const payments = await getDocs(query(collection(db, "payments"), where("userId", "==", user.id)))
      for (const paymentDoc of payments.docs) {
        const data = paymentDoc.data()
        if (data.status !== "approved") continue
        const next = (data.courses || []).filter((course) => course.id !== courseId)
        if (next.length !== (data.courses || []).length) await updateDoc(doc(db, "payments", paymentDoc.id), { courses: next })
      }
      await deleteDoc(doc(db, "userCourses", `${user.id}_${courseId}`)).catch(() => {})
      await loadAccess(user)
      toast({ title: "Access removed" })
    } catch (error) {
      toast({ variant: "error", title: "Removal failed", description: error.message })
    } finally { setBusy(false) }
  }

  const removeCps = async (courseId) => {
    if (!user) return
    setBusy(true)
    try {
      const authToken = await token()
      const response = await fetch("/api/cps?action=revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: "revoke", userId: user.id, courseId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || "CPS access removal failed")
      await loadAccess(user)
      toast({ title: "Access removed" })
    } catch (error) {
      toast({ variant: "error", title: "Removal failed", description: error.message })
    } finally { setBusy(false) }
  }

  return (
    <div onClickCapture={onCapture}>
      {children}
      {modal && user && <AccessModal mode={modal} user={user} ourCourses={ourCourses} ourGranted={ourGranted} cpsCourses={cpsCourses} cpsGranted={cpsGranted} busy={busy} onClose={() => setModal(null)} onGrant={handleGrant} onRemoveOur={removeOur} onRemoveCps={removeCps} />}
    </div>
  )
}
