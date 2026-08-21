"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, Clock3, Gift, RefreshCw, RotateCcw, Search, Users } from "lucide-react"
import { collection, getDocs } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"

const units = ["minutes", "hours", "days", "months"]
const keyOf = (source, id) => `${source}:${id}`

function SelectRow({ checked, title, subtitle, badge, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-xl border p-3 text-left transition ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-primary bg-primary" : "border-muted-foreground/30"}`}>
          {checked && <Check className="h-4 w-4 text-primary-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
          {badge && <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">{badge}</span>}
        </div>
      </div>
    </button>
  )
}

function Collapsed({ title, count, open, onToggle, children }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40">
        <span className="rounded-xl bg-primary/10 p-2 text-primary">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        <span className="flex-1 font-bold">{title}</span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{count}</span>
      </button>
      {open && <div className="border-t border-border p-3 sm:p-4">{children}</div>}
    </div>
  )
}

const fmtDuration = (campaign) => `${campaign.durationValue} ${campaign.durationUnit}`
const fmtDate = (ms) => Number(ms) ? new Date(Number(ms)).toLocaleString() : "—"

export default function ManageTrials() {
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [ourCourses, setOurCourses] = useState([])
  const [cpsCourses, setCpsCourses] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [responses, setResponses] = useState([])
  const [allUsers, setAllUsers] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState([])
  const [selectedCourses, setSelectedCourses] = useState([])
  const [openCps, setOpenCps] = useState(false)
  const [openOur, setOpenOur] = useState(false)
  const [userSearch, setUserSearch] = useState("")
  const [courseSearch, setCourseSearch] = useState("")
  const [durationValue, setDurationValue] = useState("7")
  const [durationUnit, setDurationUnit] = useState("days")
  const [title, setTitle] = useState("Free trial")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const authToken = async () => currentUser?.getIdToken?.().catch(() => null)

  const loadHistory = async () => {
    const token = await authToken()
    if (!token) return
    const response = await fetch("/api/trials?action=adminList", { headers: { Authorization: `Bearer ${token}` } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || "Could not load trial history")
    setCampaigns(payload.campaigns || [])
    setResponses(payload.responses || [])
  }

  const load = async () => {
    setLoading(true)
    try {
      const token = await authToken()
      const [usersSnap, coursesSnap, cpsResponse] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "courses")),
        token ? fetch("/api/cps?action=catalog", { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
      ])
      setUsers(usersSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.role !== "admin"))
      setOurCourses(coursesSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.courseFormat !== "cps"))
      if (cpsResponse?.ok) {
        const payload = await cpsResponse.json().catch(() => ({}))
        setCpsCourses((payload.courses || []).map((item) => ({ ...item, id: String(item.id || "").replace(/^cps:/, "") })))
      } else setCpsCourses([])
      await loadHistory()
    } catch (error) {
      toast({ variant: "error", title: "Trials", description: error.message || "Could not load trial management." })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter((item) => `${item.name || ""} ${item.email || ""}`.toLowerCase().includes(q))
  }, [users, userSearch])

  const filteredCps = useMemo(() => {
    const q = courseSearch.trim().toLowerCase()
    return cpsCourses.filter((item) => !q || `${item.title || ""} ${item.description || ""}`.toLowerCase().includes(q))
  }, [cpsCourses, courseSearch])

  const filteredOur = useMemo(() => {
    const q = courseSearch.trim().toLowerCase()
    return ourCourses.filter((item) => !q || `${item.title || ""} ${item.description || ""}`.toLowerCase().includes(q))
  }, [ourCourses, courseSearch])

  const allCourseKeys = useMemo(
    () => [...cpsCourses.map((course) => keyOf("cps", course.id)), ...ourCourses.map((course) => keyOf("our", course.id))],
    [cpsCourses, ourCourses],
  )
  const allCoursesSelected = allCourseKeys.length > 0 && allCourseKeys.every((key) => selectedCourses.includes(key))

  const toggleUser = (id) => setSelectedUsers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const toggleCourse = (source, id) => {
    const key = keyOf(source, id)
    setSelectedCourses((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])
  }
  const toggleAllCourses = () => setSelectedCourses(allCoursesSelected ? [] : allCourseKeys)

  const createTrial = async () => {
    if ((!allUsers && selectedUsers.length === 0) || selectedCourses.length === 0) return
    setBusy(true)
    try {
      const token = await authToken()
      if (!token) throw new Error("Admin session expired")
      const courseTargets = selectedCourses.map((key) => {
        const [source, ...rest] = key.split(":")
        const courseId = rest.join(":")
        const course = source === "cps" ? cpsCourses.find((item) => item.id === courseId) : ourCourses.find((item) => item.id === courseId)
        return { source, courseId, title: course?.title || "Course" }
      })
      const response = await fetch("/api/trials?action=adminCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "adminCreate", title, allUsers, userIds: selectedUsers, courseTargets, durationValue: Number(durationValue), durationUnit }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Trial creation failed")
      toast({ title: "Trial sent", description: "The timer will start only after each student claims it." })
      setSelectedUsers([])
      setSelectedCourses([])
      setAllUsers(false)
      await loadHistory()
    } catch (error) {
      toast({ variant: "error", title: "Trial failed", description: error.message || "Could not send trial." })
    } finally {
      setBusy(false)
    }
  }

  const resend = async (responseItem) => {
    setBusy(true)
    try {
      const token = await authToken()
      const response = await fetch("/api/trials?action=adminResend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "adminResend", campaignId: responseItem.campaignId, userId: responseItem.userId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not resend trial")
      toast({ title: "Trial resent" })
      await loadHistory()
    } catch (error) {
      toast({ variant: "error", title: "Resend failed", description: error.message })
    } finally {
      setBusy(false)
    }
  }

  const responseByCampaign = useMemo(() => {
    const map = new Map()
    responses.forEach((item) => {
      if (!map.has(item.campaignId)) map.set(item.campaignId, [])
      map.get(item.campaignId).push(item)
    })
    return map
  }, [responses])

  if (loading) return <div className="space-y-3">{[1,2,3,4].map((key) => <div key={key} className="h-24 animate-pulse rounded-2xl bg-muted" />)}</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><div className="flex items-center gap-2"><Gift className="h-6 w-6 text-primary" /><h1 className="text-3xl font-bold">Trials</h1></div><p className="mt-1 text-sm text-muted-foreground">Send claim-first trials for CPS and Easy Education courses.</p></div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 sm:p-6 space-y-5">
        <div><h2 className="text-xl font-extrabold">Create Trial</h2><p className="text-sm text-muted-foreground">No countdown starts until the student presses Claim Trial.</p></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="text-sm font-semibold">Trial name</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
            <div className="flex gap-2">
              <input value={durationValue} onChange={(event) => setDurationValue(event.target.value)} type="number" min="1" className="w-28 rounded-xl border border-border bg-background px-3 py-2.5" />
              <select value={durationUnit} onChange={(event) => setDurationUnit(event.target.value)} className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5">{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-sm font-semibold">Students</label>
            <button type="button" onClick={() => { setAllUsers((value) => !value); setSelectedUsers([]) }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${allUsers ? "border-primary bg-primary/5" : "border-border"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded border ${allUsers ? "border-primary bg-primary" : "border-muted-foreground/30"}`}>{allUsers && <Check className="h-4 w-4 text-primary-foreground" />}</span><Users className="h-4 w-4" /><span className="font-semibold">All Users</span><span className="ml-auto text-xs text-muted-foreground">{users.length} loaded</span>
            </button>
            {!allUsers && <><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search users..." className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3" /></div><div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-border p-2">{filteredUsers.map((item) => <SelectRow key={item.id} checked={selectedUsers.includes(item.id)} title={item.name || "Unnamed user"} subtitle={item.email} onClick={() => toggleUser(item.id)} />)}</div></>}
          </div>
        </div>

        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Search CPS or our courses..." className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3" /></div>
        <button type="button" onClick={toggleAllCourses} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${allCoursesSelected ? "border-primary bg-primary/5" : "border-border"}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded border ${allCoursesSelected ? "border-primary bg-primary" : "border-muted-foreground/30"}`}>{allCoursesSelected && <Check className="h-4 w-4 text-primary-foreground" />}</span>
          <span className="font-semibold">All Courses</span>
          <span className="ml-auto text-xs text-muted-foreground">{allCourseKeys.length} total</span>
        </button>
        <Collapsed title="CPS Courses" count={selectedCourses.filter((item) => item.startsWith("cps:")).length} open={openCps} onToggle={() => setOpenCps((value) => !value)}>
          <div className="grid gap-2 sm:grid-cols-2">{filteredCps.map((course) => <SelectRow key={course.id} checked={selectedCourses.includes(keyOf("cps", course.id))} title={course.title} badge="with live class & instant class" onClick={() => toggleCourse("cps", course.id)} />)}</div>
        </Collapsed>
        <Collapsed title="Our Courses" count={selectedCourses.filter((item) => item.startsWith("our:")).length} open={openOur} onToggle={() => setOpenOur((value) => !value)}>
          <div className="grid gap-2 sm:grid-cols-2">{filteredOur.map((course) => <SelectRow key={course.id} checked={selectedCourses.includes(keyOf("our", course.id))} title={course.title} onClick={() => toggleCourse("our", course.id)} />)}</div>
        </Collapsed>
        <button type="button" onClick={createTrial} disabled={busy || (!allUsers && selectedUsers.length === 0) || selectedCourses.length === 0 || Number(durationValue) <= 0} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">{busy ? "Sending..." : `Send Trial · ${selectedCourses.length} course${selectedCourses.length === 1 ? "" : "s"}`}</button>
      </div>

      <div className="space-y-3">
        <div><h2 className="text-xl font-extrabold">Trial Activity</h2><p className="text-sm text-muted-foreground">Claimed and cancelled students are tracked here. Cancelled offers can be resent.</p></div>
        {campaigns.map((campaign) => {
          const items = responseByCampaign.get(campaign.id) || []
          const claimed = items.filter((item) => item.status === "claimed")
          const cancelled = items.filter((item) => item.status === "cancelled")
          return (
            <div key={campaign.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="font-extrabold">{campaign.title || "Free trial"}</div><div className="mt-1 text-xs text-muted-foreground">{fmtDuration(campaign)} · {campaign.allUsers ? "All Users" : `${(campaign.userIds || []).length} selected users`} · {(campaign.courseTargets || []).length} courses · {fmtDate(campaign.createdAtMs)}</div></div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-green-500/10 px-2.5 py-1 text-green-600">Claimed {claimed.length}</span><span className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-500">Cancelled {cancelled.length}</span></div>
              </div>
              {(claimed.length > 0 || cancelled.length > 0) && <div className="mt-4 grid gap-2 lg:grid-cols-2">{[...claimed, ...cancelled].map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{item.userName || item.userEmail || item.userId}</div><div className="text-xs text-muted-foreground">{item.status === "claimed" ? `Claimed ${fmtDate(item.claimedAtMs)} · expires ${fmtDate(item.expiresAtMs)}` : `Cancelled ${fmtDate(item.cancelledAtMs)}`}</div></div>{item.status === "cancelled" && <button type="button" disabled={busy} onClick={() => resend(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-2 text-xs font-bold text-primary hover:bg-primary/15"><RotateCcw className="h-3.5 w-3.5" />Re-send</button>}</div>)}</div>}
            </div>
          )
        })}
        {campaigns.length === 0 && <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground"><Clock3 className="mx-auto mb-2 h-6 w-6" />No trial campaign yet.</div>}
      </div>
    </div>
  )
}
