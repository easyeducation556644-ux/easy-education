import { useState } from "react"
import {
  ArrowLeft,
  Bell,
  BookOpen,
  ChevronRight,
  CreditCard,
  Download,
  GraduationCap,
  Grid2X2,
  Home,
  LayoutDashboard,
  Menu,
  User,
  Users,
  X,
} from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"

const primaryTabs = [
  { label: "Home", path: "/", icon: Home },
  { label: "My Courses", path: "/my-courses", icon: GraduationCap, auth: true },
  { label: "Courses", path: "/courses", icon: BookOpen },
  { label: "Downloads", path: "/downloads", icon: Download, auth: true },
]

function pageTitle(pathname) {
  if (pathname === "/") return "Easy Education"
  if (pathname.startsWith("/my-courses")) return "My Courses"
  if (pathname.startsWith("/downloads")) return "Downloads"
  if (pathname.startsWith("/profile")) return "Profile"
  if (pathname.startsWith("/dashboard")) return "Dashboard"
  if (pathname.startsWith("/payment-history")) return "Payments"
  if (pathname.startsWith("/course/")) return "Course"
  if (pathname.startsWith("/courses")) return "Courses"
  if (pathname.startsWith("/announcements")) return "Announcements"
  if (pathname.startsWith("/community")) return "Community"
  return "Easy Education"
}

export function NativeAppTopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { currentUser, isAdminPanelUser } = useAuth()
  const isRoot = location.pathname === "/"
  const dashboardPath = isAdminPanelUser ? "/admin" : "/dashboard"

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3">
        {!isRoot ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-muted"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <img src="/easy-education-icon.svg" alt="" className="h-9 w-9 shrink-0 rounded-xl" />
        )}

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[16px] font-bold">{pageTitle(location.pathname)}</p>
          {isRoot && <p className="text-[11px] text-muted-foreground">Learn anywhere, anytime</p>}
        </div>

        {currentUser && (
          <Link
            to={dashboardPath}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary active:scale-95"
            aria-label="Dashboard"
          >
            <LayoutDashboard className="h-5 w-5" />
          </Link>
        )}
      </div>
    </header>
  )
}

function MoreSheet({ open, onClose }) {
  const { currentUser, isAdminPanelUser } = useAuth()
  if (!open) return null

  const dashboardPath = isAdminPanelUser ? "/admin" : "/dashboard"
  const items = [
    { label: "Dashboard", path: dashboardPath, icon: LayoutDashboard, auth: true },
    { label: "Profile", path: "/profile", icon: User, auth: true },
    { label: "Announcements", path: "/announcements", icon: Bell },
    { label: "Community", path: "/community", icon: Users },
    { label: "Payment History", path: "/payment-history", icon: CreditCard, auth: true },
  ]

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/55" onClick={onClose}>
      <section
        className="w-full rounded-t-[28px] border-t border-border bg-background px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" />
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">More</p>
            <p className="text-xs text-muted-foreground">Easy Education</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {items.map((item) => {
            const Icon = item.icon
            const target = item.auth && !currentUser ? "/login" : item.path
            return (
              <Link
                key={item.label}
                to={target}
                onClick={onClose}
                className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-b-0 active:bg-muted/70"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="flex-1 font-medium">{item.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export function NativeBottomNav() {
  const location = useLocation()
  const { currentUser } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/97 pb-[max(env(safe-area-inset-bottom),4px)] backdrop-blur-xl">
        <div className="mx-auto grid h-[68px] max-w-md grid-cols-5 px-1">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon
            const target = tab.auth && !currentUser ? "/login" : tab.path
            const active = tab.path === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(tab.path)

            return (
              <Link
                key={tab.path}
                to={target}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                <span className={`grid h-8 w-11 place-items-center rounded-full ${active ? "bg-primary/12" : ""}`}>
                  <Icon className="h-5 w-5" />
                </span>
                {tab.label}
              </Link>
            )
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium ${moreOpen ? "text-primary" : "text-muted-foreground"}`}
          >
            <span className={`grid h-8 w-11 place-items-center rounded-full ${moreOpen ? "bg-primary/12" : ""}`}>
              <Menu className="h-5 w-5" />
            </span>
            More
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}
