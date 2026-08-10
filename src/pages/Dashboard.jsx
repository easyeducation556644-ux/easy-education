import { useState, useEffect, useRef } from "react"
import { Link, Navigate } from "react-router-dom"
import {
  BookOpen,
  CreditCard,
  CheckCircle,
  Clock,
  XCircle,
  GraduationCap,
  User,
  ArrowRight,
  ReceiptText,
} from "lucide-react"
import { collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { readViewSnapshot, writeViewSnapshot } from "../lib/viewSnapshotCache"

function viewKey(uid) {
  return `dashboard:${uid || "anonymous"}`
}

function paymentDate(value) {
  try {
    if (value?.toDate) return value.toDate().toLocaleDateString()
    if (Number.isFinite(value?.seconds)) return new Date(value.seconds * 1000).toLocaleDateString()
    if (value) return new Date(value).toLocaleDateString()
  } catch (_) {
    // Fall through.
  }
  return "N/A"
}

function statusStyle(status) {
  if (status === "approved") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
  if (status === "pending") return "bg-amber-500/10 text-amber-600 border-amber-500/20"
  if (status === "rejected") return "bg-rose-500/10 text-rose-600 border-rose-500/20"
  return "bg-muted text-muted-foreground border-border"
}

function StatusIcon({ status }) {
  if (status === "approved") return <CheckCircle className="h-3.5 w-3.5" />
  if (status === "pending") return <Clock className="h-3.5 w-3.5" />
  if (status === "rejected") return <XCircle className="h-3.5 w-3.5" />
  return null
}

export default function Dashboard() {
  const { currentUser, userProfile } = useAuth()
  const initialRef = useRef(readViewSnapshot(viewKey(currentUser?.uid)))
  const [stats, setStats] = useState(() => initialRef.current?.stats || {
    coursesEnrolled: 0,
    pendingPayments: 0,
    approvedPayments: 0,
    totalPayments: 0,
  })
  const [recentPayments, setRecentPayments] = useState(() => initialRef.current?.recentPayments || [])
  const [loading, setLoading] = useState(() => !initialRef.current)
  const [cacheRevision, setCacheRevision] = useState(0)

  useEffect(() => {
    const handler = (event) => {
      if (["payments", "userCourses"].includes(event.detail?.collection)) {
        setCacheRevision((value) => value + 1)
      }
    }
    window.addEventListener("easy-education-cache-updated", handler)
    return () => window.removeEventListener("easy-education-cache-updated", handler)
  }, [])

  useEffect(() => {
    if (!currentUser?.uid) return
    let cancelled = false

    const loadDashboard = async () => {
      const key = viewKey(currentUser.uid)
      const saved = readViewSnapshot(key)
      if (saved) {
        setStats(saved.stats || stats)
        setRecentPayments(saved.recentPayments || [])
        setLoading(false)
      } else {
        setLoading(true)
      }

      try {
        const [paymentsSnapshot, userCoursesSnapshot] = await Promise.all([
          getDocs(query(collection(db, "payments"), where("userId", "==", currentUser.uid))),
          getDocs(query(collection(db, "userCourses"), where("userId", "==", currentUser.uid))),
        ])
        if (cancelled) return

        const payments = paymentsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        payments.sort((a, b) => {
          const aSeconds = a.submittedAt?.seconds || 0
          const bSeconds = b.submittedAt?.seconds || 0
          return bSeconds - aSeconds
        })

        const uniqueCourses = new Set()
        userCoursesSnapshot.docs.forEach((snapshot) => {
          const enrollment = snapshot.data()
          if (enrollment.courseId && !enrollment.isBundle) uniqueCourses.add(enrollment.courseId)
        })

        const nextStats = {
          coursesEnrolled: uniqueCourses.size,
          pendingPayments: payments.filter((item) => item.status === "pending").length,
          approvedPayments: payments.filter((item) => item.status === "approved").length,
          totalPayments: payments.length,
        }
        const nextRecent = payments.slice(0, 5)

        setStats(nextStats)
        setRecentPayments(nextRecent)
        writeViewSnapshot(key, { stats: nextStats, recentPayments: nextRecent })
      } catch (error) {
        console.error("Error loading cached dashboard:", error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDashboard()
    return () => { cancelled = true }
  }, [currentUser?.uid, cacheRevision])

  if (!currentUser) return <Navigate to="/login" />

  return (
    <div className="min-h-screen bg-background px-4 py-8 md:px-6 md:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-primary">Student Dashboard</p>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              Welcome back, {userProfile?.name || "Student"}
            </h1>
            <p className="mt-2 text-muted-foreground">Continue learning and manage your account from one place.</p>
          </div>
          <Link
            to="/my-courses"
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground sm:mt-0"
          >
            Continue learning <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {loading && !initialRef.current ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-muted" />)}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-64 animate-pulse rounded-2xl bg-muted" />
              <div className="h-64 animate-pulse rounded-2xl bg-muted" />
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              {[
                { label: "My Courses", value: stats.coursesEnrolled, icon: GraduationCap },
                { label: "Approved", value: stats.approvedPayments, icon: CheckCircle },
                { label: "Pending", value: stats.pendingPayments, icon: Clock },
                { label: "Payments", value: stats.totalPayments, icon: ReceiptText },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border bg-card p-4 md:p-5">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="text-2xl font-bold md:text-3xl">{item.value}</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground md:text-sm">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
                <div className="mb-5">
                  <h2 className="text-xl font-semibold">Quick actions</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Everything you use most often.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { to: "/my-courses", label: "My Courses", note: "Continue classes", icon: BookOpen },
                    { to: "/courses", label: "Browse", note: "Find a course", icon: GraduationCap },
                    { to: "/payment-history", label: "Payments", note: "Transactions", icon: CreditCard },
                    { to: "/profile", label: "Profile", note: "Account details", icon: User },
                  ].map((action) => (
                    <Link
                      key={action.to}
                      to={action.to}
                      className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <action.icon className="mb-3 h-5 w-5 text-primary" />
                      <p className="text-sm font-semibold">{action.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{action.note}</p>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Recent payments</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Your latest transactions.</p>
                  </div>
                  <Link to="/payment-history" className="text-sm font-medium text-primary hover:underline">View all</Link>
                </div>

                {recentPayments.length > 0 ? (
                  <div className="divide-y divide-border">
                    {recentPayments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-semibold">৳{payment.finalAmount ?? 0}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {payment.courses?.length || 0} course(s) · {paymentDate(payment.submittedAt)}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusStyle(payment.status)}`}>
                          <StatusIcon status={payment.status} /> {payment.status || "unknown"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border py-10 text-center">
                    <CreditCard className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm font-medium">No payments yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">Your transactions will appear here.</p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
