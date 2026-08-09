"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, CalendarDays, Database, RefreshCw, Search, Users } from "lucide-react"
import { useAuth } from "../../contexts/AuthContext"

function currentUsageDay() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
  if (Number(values.hour) < 14) date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function shiftDay(day, amount) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0))
}

function formatTime(value) {
  if (!value) return "—"
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value))
  } catch (_) {
    return value
  }
}

function StatCard({ icon: Icon, label, value, helper }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{formatNumber(value)}</p>
        </div>
      </div>
      {helper ? <p className="mt-2 text-xs text-muted-foreground">{helper}</p> : null}
    </div>
  )
}

function EmptyRow({ colSpan, text = "No tracked data for this day." }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
        {text}
      </td>
    </tr>
  )
}

export default function ReadUsage() {
  const { currentUser } = useAuth()
  const [day, setDay] = useState(currentUsageDay)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")

  const fetchUsage = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    setError("")
    try {
      const token = await currentUser.getIdToken()
      const response = await fetch(`/api/firestore-read-usage?day=${encodeURIComponent(day)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to load read usage")
      setData(payload)
    } catch (err) {
      setError(err.message || "Failed to load read usage")
    } finally {
      setLoading(false)
    }
  }, [currentUser, day])

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage])

  useEffect(() => {
    const timer = window.setInterval(fetchUsage, 60000)
    return () => window.clearInterval(timer)
  }, [fetchUsage])

  const queryRows = useMemo(() => {
    const rows = data?.sources || []
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) =>
      `${row.page} ${row.operation} ${row.source}`.toLowerCase().includes(term),
    )
  }, [data, search])

  const maxHourlyReads = Math.max(1, ...(data?.hours || []).map((item) => Number(item.reads || 0)))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Firestore Read Usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            কোন page, query/collection আর user কত document read করছে তার app-level history।
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDay((value) => shiftDay(value, -1))}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            Previous
          </button>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => setDay((value) => shiftDay(value, 1))}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            Next
          </button>
          <button
            type="button"
            onClick={fetchUsage}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <strong>Usage day:</strong> {day} 2:00 PM → {shiftDay(day, 1)} 2:00 PM (Asia/Dhaka). Historical data is kept by date; a new bucket starts automatically at 2:00 PM.
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Database} label="Tracked reads" value={data?.totalReads} helper="Document reads attributed by the app tracker" />
        <StatCard icon={Activity} label="Read calls" value={data?.totalCalls} helper="getDoc / getDocs / listeners / transactions" />
        <StatCard icon={Users} label="Users / sessions" value={data?.users?.length} helper="Logged-in users plus anonymous sessions" />
        <StatCard icon={CalendarDays} label="Pages with reads" value={data?.pages?.length} helper={`Last event: ${formatTime(data?.lastSeen)}`} />
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold">Reads by page</h3>
            <p className="text-xs text-muted-foreground">কোন route সবচেয়ে বেশি read করছে</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Page</th>
                  <th className="px-3 py-2 text-right">Reads</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(data?.pages || []).slice(0, 30).map((row) => (
                  <tr key={row.label} className="border-t border-border/70">
                    <td className="max-w-[280px] truncate px-3 py-2 font-mono text-xs" title={row.label}>{row.label}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.reads)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.calls)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatTime(row.lastSeen)}</td>
                  </tr>
                ))}
                {!data?.pages?.length ? <EmptyRow colSpan={4} /> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold">Reads by user</h3>
            <p className="text-xs text-muted-foreground">কোন account/session কত read করেছে</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2 text-right">Reads</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users || []).slice(0, 50).map((row) => (
                  <tr key={row.uid} className="border-t border-border/70">
                    <td className="px-3 py-2">
                      <div className="max-w-[260px] truncate font-medium" title={row.email || row.uid}>{row.email || row.name || row.uid}</div>
                      <div className="max-w-[260px] truncate font-mono text-[10px] text-muted-foreground">{row.uid}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.reads)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.calls)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatTime(row.lastSeen)}</td>
                  </tr>
                ))}
                {!data?.users?.length ? <EmptyRow colSpan={4} /> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-semibold">Query / collection breakdown</h3>
            <p className="text-xs text-muted-foreground">কোথায় read খরচ হচ্ছে—page + operation + Firestore source</p>
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search page, operation, source..."
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Operation</th>
                <th className="px-3 py-2">Firestore source</th>
                <th className="px-3 py-2 text-right">Reads</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {queryRows.slice(0, 100).map((row, index) => (
                <tr key={`${row.page}-${row.operation}-${row.source}-${index}`} className="border-t border-border/70">
                  <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs" title={row.page}>{row.page}</td>
                  <td className="px-3 py-2"><span className="rounded bg-muted px-2 py-1 font-mono text-xs">{row.operation}</span></td>
                  <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs" title={row.source}>{row.source}</td>
                  <td className="px-3 py-2 text-right font-bold">{formatNumber(row.reads)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(row.calls)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatTime(row.lastSeen)}</td>
                </tr>
              ))}
              {!queryRows.length ? <EmptyRow colSpan={6} text={search ? "No matching tracked query." : "No tracked data for this day."} /> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="font-semibold">Hourly read activity</h3>
          <p className="text-xs text-muted-foreground">Bangladesh time; usage-day boundary remains 2:00 PM</p>
        </div>
        <div className="grid grid-cols-12 gap-1 sm:grid-cols-24">
          {(data?.hours || []).map((item) => {
            const height = Math.max(4, Math.round((Number(item.reads || 0) / maxHourlyReads) * 120))
            return (
              <div key={item.hour} className="flex min-w-0 flex-col items-center gap-1" title={`${item.hour}:00 — ${formatNumber(item.reads)} reads`}>
                <div className="flex h-32 w-full items-end justify-center rounded bg-muted/30 px-0.5">
                  <div className="w-full rounded-t bg-primary/80" style={{ height }} />
                </div>
                <span className="text-[9px] text-muted-foreground">{item.hour}</span>
              </div>
            )
          })}
        </div>
      </section>

      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        This controller starts collecting after this version is deployed. It measures app-attributed Firestore document reads from client SDK calls. Firestore index-entry billing and server-side Firebase Admin SDK reads are not included, so Firebase Console may be slightly higher.
      </div>
    </div>
  )
}
