import { ArrowLeft, BookOpen, Download, Home, User } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"

const tabs = [
  { label: "Home", path: "/", icon: Home },
  { label: "Courses", path: "/courses", icon: BookOpen },
  { label: "Downloads", path: "/downloads", icon: Download, auth: true },
  { label: "Profile", path: "/profile", icon: User, auth: true },
]

function pageTitle(pathname) {
  if (pathname === "/") return "Easy Education"
  if (pathname.startsWith("/downloads")) return "Downloads"
  if (pathname.startsWith("/profile")) return "Profile"
  if (pathname.startsWith("/course/")) return "Course"
  if (pathname.startsWith("/courses")) return "Courses"
  if (pathname.startsWith("/announcements")) return "Announcements"
  if (pathname.startsWith("/community")) return "Community"
  return "Easy Education"
}

export function NativeAppTopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const isRoot = location.pathname === "/"

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-3">
        <button
          type="button"
          onClick={() => (isRoot ? null : navigate(-1))}
          className={`grid h-10 w-10 place-items-center rounded-xl transition-colors ${isRoot ? "pointer-events-none opacity-0" : "hover:bg-muted"}`}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <img src="/easy-education-icon.svg" alt="" className="h-8 w-8 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{pageTitle(location.pathname)}</p>
          <p className="text-[11px] text-muted-foreground">Easy Education</p>
        </div>
      </div>
    </header>
  )
}

export function NativeBottomNav() {
  const location = useLocation()
  const { currentUser } = useAuth()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/95 pb-[max(env(safe-area-inset-bottom),4px)] backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-md grid-cols-4 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const target = tab.auth && !currentUser ? "/login" : tab.path
          const active = tab.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.path)

          return (
            <Link
              key={tab.path}
              to={target}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
            >
              <span className={`grid h-8 w-12 place-items-center rounded-full ${active ? "bg-primary/12" : ""}`}>
                <Icon className="h-5 w-5" />
              </span>
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
