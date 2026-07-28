"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe2,
  ScanSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
} from "lucide-react"
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore"
import { db } from "../../lib/firebase"

const PAGE_SIZE = 10

const EVENT_LABELS = {
  devtools_shortcut: "Inspect / DevTools Shortcut",
  view_source_shortcut: "View Source Shortcut",
  devtools_size_heuristic: "DevTools Size Detection",
  video_context_menu: "Video Right Click",
}

const EVENT_STYLES = {
  devtools_shortcut: "bg-red-500/10 text-red-600 border-red-500/20",
  view_source_shortcut: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  devtools_size_heuristic: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  video_context_menu: "bg-blue-500/10 text-blue-600 border-blue-500/20",
}

const formatDateTime = (value) => {
  if (!value) return "Unknown"
  const date = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"

  return date.toLocaleString("en-BD", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default function ManageSecurityEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [cursor, setCursor] = useState(null)
  const [cursorHistory, setCursorHistory] = useState([])
  const [nextCursor, setNextCursor] = useState(null)

  const loadEvents = useCallback(async (targetCursor = null) => {
    setLoading(true)
    setError("")

    try {
      const queryParts = [
        collection(db, "examAttempts"),
        where(documentId(), ">=", "security_"),
        where(documentId(), "<", "security`"),
        orderBy(documentId(), "desc"),
      ]

      if (targetCursor) {
        queryParts.push(startAfter(targetCursor))
      }
      queryParts.push(limit(PAGE_SIZE + 1))

      const snapshot = await getDocs(query(...queryParts))
      const pageDocs = snapshot.docs.slice(0, PAGE_SIZE)

      setEvents(
        pageDocs
          .map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }))
          .filter((event) => event.eventCategory === "security_event"),
      )
      setNextCursor(
        snapshot.docs.length > PAGE_SIZE
          ? pageDocs[pageDocs.length - 1]
          : null,
      )
    } catch (loadError) {
      setEvents([])
      setNextCursor(null)
      setError(
        loadError.code === "permission-denied"
          ? "Security Events access denied"
          : loadError.message || "Failed to load security events",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEvents(cursor)
  }, [cursor, loadEvents])

  const filteredEvents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return events

    return events.filter((event) =>
      [
        event.userName,
        event.userEmail,
        event.eventType,
        EVENT_LABELS[event.eventType],
        event.route,
        event.ipAddress,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    )
  }, [events, searchTerm])

  const handleNext = () => {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(nextCursor)
  }

  const handlePrevious = () => {
    if (cursorHistory.length === 0) return
    const previousCursor = cursorHistory[cursorHistory.length - 1]
    setCursorHistory((history) => history.slice(0, -1))
    setCursor(previousCursor)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            Security Events
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Detected Inspect, View Source and video context-menu activity
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadEvents(cursor)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search current page by user, email, route or IP..."
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex min-h-56 items-center justify-center">
            <RefreshCw className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-4 text-center">
            <ScanSearch className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="font-medium">No security events found</p>
            <p className="text-sm text-muted-foreground">
              New detected activity will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredEvents.map((event) => (
              <article key={event.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        EVENT_STYLES[event.eventType] ||
                        "border-border bg-muted text-foreground"
                      }`}
                    >
                      {EVENT_LABELS[event.eventType] || event.eventType}
                    </span>
                    {event.hitCount > 1 && (
                      <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                        {event.hitCount} times
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDateTime(event.lastDetectedAt)}
                  </div>
                </div>

                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {event.userName || "Unknown User"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {event.userEmail || event.userId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Globe2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="break-all font-medium">
                        {event.route || "/"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        IP: {event.ipAddress || "Unknown"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
                  <p>
                    Method: {event.detectionMethod || "Unknown"}
                    {event.details?.shortcut
                      ? ` • ${event.details.shortcut}`
                      : ""}
                  </p>
                  <p className="mt-1 line-clamp-2 break-all">
                    {event.userAgent || "Unknown device"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {cursorHistory.length + 1} • Maximum {PAGE_SIZE} records
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={loading || cursorHistory.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={loading || !nextCursor}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Note: Browser security restrictions make Inspect/View Source detection
        heuristic; this list records detected attempts, not absolute proof.
      </p>
    </div>
  )
}
