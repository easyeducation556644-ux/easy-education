"use client"

import { useEffect, useMemo, useState } from "react"
import {
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react"
import { collection, getDocs } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"

const fmtDate = (ms) => Number(ms) ? new Date(Number(ms)).toLocaleString() : "—"

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-background/60 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black">{Number(value || 0).toLocaleString()}</div>
    </div>
  )
}

export default function ManageUdvash() {
  const { currentUser } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [courses, setCourses] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checkingId, setCheckingId] = useState("")
  const [deletingId, setDeletingId] = useState("")
  const [lastScan, setLastScan] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ label: "", registrationNumber: "", password: "", courseTypeId: "2" })
  const [accessForm, setAccessForm] = useState({ userId: "", courseId: "", days: "30" })
  const [accessBusy, setAccessBusy] = useState(false)
  const [userSearch, setUserSearch] = useState("")

  const authToken = async () => currentUser?.getIdToken?.().catch(() => null)

  const api = async (action, options = {}) => {
    const token = await authToken()
    if (!token) throw new Error("Admin session expired")
    const method = options.method || "GET"
    const response = await fetch(`/api/udvash?action=${encodeURIComponent(action)}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      body: method === "GET" ? undefined : JSON.stringify({ action, ...(options.body || {}) }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || "Udvash request failed")
    return payload
  }

  const load = async () => {
    setLoading(true)
    try {
      const [accountPayload, catalogPayload, userSnap] = await Promise.all([
        api("admin-accounts"),
        api("catalog"),
        getDocs(collection(db, "users")),
      ])
      setAccounts(accountPayload.accounts || [])
      setCourses(catalogPayload.courses || [])
      setUsers(userSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((user) => user.role !== "admin"))
    } catch (error) {
      toast({ variant: "error", title: "Udvash", description: error.message || "Could not load Udvash admin data." })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users.slice(0, 50)
    return users
      .filter((user) => `${user.name || ""} ${user.email || ""} ${user.id}`.toLowerCase().includes(q))
      .slice(0, 50)
  }, [users, userSearch])

  const addAccount = async (event) => {
    event.preventDefault()
    if (!form.registrationNumber.trim() || !form.password) return
    setSaving(true)
    try {
      const payload = await api("admin-add-account", { method: "POST", body: form })
      setAccounts((current) => [payload.account, ...current.filter((item) => item.id !== payload.account.id)])
      setForm((current) => ({ ...current, label: "", registrationNumber: "", password: "" }))
      toast({ title: "Udvash account connected", description: "Login verified. Press Check to sync courses, subjects and chapters." })
    } catch (error) {
      toast({ variant: "error", title: "Account could not be added", description: error.message })
    } finally {
      setSaving(false)
    }
  }

  const checkAccount = async (account) => {
    setCheckingId(account.id)
    setLastScan(null)
    try {
      const payload = await api("admin-check-account", { method: "POST", body: { accountId: account.id } })
      setAccounts((current) => current.map((item) => item.id === account.id ? payload.account : item))
      setLastScan({ accountId: account.id, ...payload.scan })
      const catalogPayload = await api("catalog")
      setCourses(catalogPayload.courses || [])
      toast({ title: "Udvash structure synced", description: `${payload.scan?.courseCount || 0} courses, ${payload.scan?.subjectCount || 0} subjects, ${payload.scan?.chapterCount || 0} chapters.` })
    } catch (error) {
      toast({ variant: "error", title: "Udvash check failed", description: error.message })
      await load()
    } finally {
      setCheckingId("")
    }
  }

  const deleteAccount = async (account) => {
    if (!window.confirm(`Delete ${account.label || account.registrationNumber}? This removes its cached structure too.`)) return
    setDeletingId(account.id)
    try {
      await api("admin-delete-account", { method: "POST", body: { accountId: account.id } })
      setAccounts((current) => current.filter((item) => item.id !== account.id))
      if (lastScan?.accountId === account.id) setLastScan(null)
      toast({ title: "Udvash account removed" })
    } catch (error) {
      toast({ variant: "error", title: "Delete failed", description: error.message })
    } finally {
      setDeletingId("")
    }
  }

  const grantAccess = async () => {
    if (!accessForm.userId || !accessForm.courseId) return
    setAccessBusy(true)
    try {
      const days = Math.max(0, Number(accessForm.days || 0))
      const expiresAtMs = days ? Date.now() + days * 24 * 60 * 60 * 1000 : 0
      await api("admin-grant-access", {
        method: "POST",
        body: { userId: accessForm.userId, courseId: accessForm.courseId, accessType: "premium", expiresAtMs },
      })
      toast({ title: "Udvash access granted", description: days ? `Access expires in ${days} days.` : "Access has no expiry." })
    } catch (error) {
      toast({ variant: "error", title: "Access grant failed", description: error.message })
    } finally {
      setAccessBusy(false)
    }
  }

  const revokeAccess = async () => {
    if (!accessForm.userId || !accessForm.courseId) return
    setAccessBusy(true)
    try {
      await api("admin-revoke-access", { method: "POST", body: { userId: accessForm.userId, courseId: accessForm.courseId } })
      toast({ title: "Udvash access revoked" })
    } catch (error) {
      toast({ variant: "error", title: "Access revoke failed", description: error.message })
    } finally {
      setAccessBusy(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><KeyRound className="h-6 w-6 text-primary" /><h1 className="text-3xl font-black">Udvash</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Source accounts stay server-side. Course access is controlled separately by Easy Education.</p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      <form onSubmit={addAccount} className="rounded-3xl border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /><h2 className="text-xl font-extrabold">Add source account</h2></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Label (optional)" className="rounded-xl border border-border bg-background px-3 py-2.5" />
          <input value={form.registrationNumber} onChange={(event) => setForm({ ...form, registrationNumber: event.target.value.replace(/\D/g, "") })} placeholder="Registration number" inputMode="numeric" className="rounded-xl border border-border bg-background px-3 py-2.5" />
          <div className="relative">
            <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type={showPassword ? "text" : "password"} placeholder="Password" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 pr-10" />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:bg-muted">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
          <div className="flex gap-2">
            <input value={form.courseTypeId} onChange={(event) => setForm({ ...form, courseTypeId: event.target.value })} type="number" min="1" title="Course type ID" className="w-24 rounded-xl border border-border bg-background px-3 py-2.5" />
            <button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-primary-foreground disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Add</button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Password and Udvash tokens are encrypted by the backend and are never returned to the browser.</p>
      </form>

      <div className="space-y-3">
        {accounts.length === 0 && <div className="rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No Udvash source account added yet.</div>}
        {accounts.map((account) => (
          <div key={account.id} className="rounded-3xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-black">{account.label}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${account.status === "active" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-300"}`}>{account.status}</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{account.name || "Unknown Udvash user"} · Reg {account.registrationNumber}</div>
                <div className="mt-1 text-xs text-muted-foreground">Last checked: {fmtDate(account.lastCheckedAtMs)} · Token expiry: {fmtDate(account.accessTokenExpiresAtMs)}</div>
                {account.lastError && <div className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-300">{account.lastError}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => checkAccount(account)} disabled={checkingId === account.id} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60">{checkingId === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Check</button>
                <button type="button" onClick={() => deleteAccount(account)} disabled={deletingId === account.id} className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-500/10 disabled:opacity-60">{deletingId === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Courses" value={account.courseCount} /><Metric label="Subjects" value={account.subjectCount} /><Metric label="Chapters" value={account.chapterCount} /></div>
          </div>
        ))}
      </div>

      {lastScan && (
        <div className="rounded-3xl border border-border bg-card p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" /><h2 className="text-xl font-extrabold">Latest structure scan</h2></div>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Courses" value={lastScan.courseCount} /><Metric label="Subjects" value={lastScan.subjectCount} /><Metric label="Chapters" value={lastScan.chapterCount} /></div>
          <div className="mt-4 space-y-2">
            {(lastScan.courses || []).map((course) => (
              <div key={course.masterCourseId} className="flex flex-col gap-1 rounded-2xl border border-border bg-background/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="font-bold">{course.name}</div><div className="text-xs text-muted-foreground">masterCourseId {course.masterCourseId}</div></div>
                <div className="text-sm font-semibold text-muted-foreground">{course.subjectCount} subjects · {course.chapterCount} chapters</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Content Types, Cards and CardDetails are intentionally not crawled here. They are fetched live only when that route is opened.</p>
        </div>
      )}

      <div className="rounded-3xl border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="text-xl font-extrabold">Course access</h2></div>
        <p className="mb-4 text-sm text-muted-foreground">Udvash is premium. A connected source account never gives students access automatically.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search user by name, email or UID" className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
            <select value={accessForm.userId} onChange={(event) => setAccessForm({ ...accessForm, userId: event.target.value })} className="w-full rounded-xl border border-border bg-background px-3 py-2.5">
              <option value="">Select user</option>
              {filteredUsers.map((user) => <option key={user.id} value={user.id}>{user.name || "Unnamed"} — {user.email || user.id}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <select value={accessForm.courseId} onChange={(event) => setAccessForm({ ...accessForm, courseId: event.target.value })} className="w-full rounded-xl border border-border bg-background px-3 py-2.5">
              <option value="">Select synced Udvash course</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.title} ({course.id})</option>)}
            </select>
            <div className="flex gap-2">
              <input value={accessForm.days} onChange={(event) => setAccessForm({ ...accessForm, days: event.target.value })} type="number" min="0" className="w-28 rounded-xl border border-border bg-background px-3 py-2.5" title="Access days; 0 = no expiry" />
              <button type="button" disabled={accessBusy || !accessForm.userId || !accessForm.courseId} onClick={grantAccess} className="flex-1 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">Grant</button>
              <button type="button" disabled={accessBusy || !accessForm.userId || !accessForm.courseId} onClick={revokeAccess} className="rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-bold text-red-600 disabled:opacity-50">Revoke</button>
            </div>
            <div className="text-xs text-muted-foreground">Days = 0 means no expiry.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
