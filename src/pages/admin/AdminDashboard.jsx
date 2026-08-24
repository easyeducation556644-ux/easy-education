"use client"

import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom"
import { useEffect, useState } from "react"
import {
  Users,
  BookOpen,
  Video,
  BarChart3,
  LayoutDashboard,
  Megaphone,
  Tag,
  CreditCard,
  Settings,
  Grid,
  GraduationCap,
  BookMarked,
  Menu,
  X,
  FileQuestion,
  Send,
  Bell,
  Ban,
  AlertTriangle,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  Gift,
  Layers3,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { collection, query, where, onSnapshot } from "firebase/firestore"
import { db } from "../../lib/firebase"
import AdminOverview from "./AdminOverview"
import ReadUsage from "./ReadUsage"
import ManageUsers from "./ManageUsers"
import ManageTrials from "./ManageTrials"
import ManageCourses from "./ManageCourses"
import ManageClasses from "./ManageClasses"
import ManageClassGroups from "./ManageClassGroups"
import ManageAnnouncements from "./ManageAnnouncements"
import ManageCoupons from "./ManageCoupons"
import ManagePayments from "./ManagePayments"
import WebsiteSettings from "./WebsiteSettings"
import Rankings from "./Rankings"
import ManageCategories from "./ManageCategories"
import ManageTeachers from "./ManageTeachers"
import ManageSubjects from "./ManageSubjects"
import ManageChapters from "./ManageChapters"
import ManageExams from "./ManageExams"
import ManageExamQuestions from "./ManageExamQuestions"
import ViewExamSubmissions from "./ViewExamSubmissions"
import ViewExamResults from "./ViewExamResults"
import ManageTelegramSubmissions from "./ManageTelegramSubmissions"
import Notifications from "./Notifications"
import BannedNotifications from "./BannedNotifications"
import BanManagement from "./BanManagement"
import ClassComments from "./ClassComments"
import ManageAdministration from "./ManageAdministration"
import ManageSecurityEvents from "./ManageSecurityEvents"
import { useAuth } from "../../contexts/AuthContext"
import {
  ADMIN_PAGE_CATALOG,
  ADMIN_PERMISSION_KEYS,
  getDefaultAdminPath,
  hasAdminPermission,
  isFullAdmin,
} from "../../lib/adminPermissions"

const ICON_BY_PERMISSION = {
  [ADMIN_PERMISSION_KEYS.OVERVIEW]: LayoutDashboard,
  [ADMIN_PERMISSION_KEYS.READ_USAGE]: BarChart3,
  [ADMIN_PERMISSION_KEYS.ADMINISTRATION]: ShieldCheck,
  [ADMIN_PERMISSION_KEYS.SECURITY_EVENTS]: ShieldAlert,
  [ADMIN_PERMISSION_KEYS.NOTIFICATIONS]: Bell,
  [ADMIN_PERMISSION_KEYS.BAN_ALERTS]: AlertTriangle,
  [ADMIN_PERMISSION_KEYS.BAN_MANAGEMENT]: Ban,
  [ADMIN_PERMISSION_KEYS.USERS]: Users,
  [ADMIN_PERMISSION_KEYS.CATEGORIES]: Grid,
  [ADMIN_PERMISSION_KEYS.COURSES]: BookOpen,
  [ADMIN_PERMISSION_KEYS.SUBJECTS]: BookMarked,
  [ADMIN_PERMISSION_KEYS.CHAPTERS]: BookMarked,
  [ADMIN_PERMISSION_KEYS.CLASSES]: Video,
  [ADMIN_PERMISSION_KEYS.CLASS_COMMENTS]: MessageSquare,
  [ADMIN_PERMISSION_KEYS.EXAMS]: FileQuestion,
  [ADMIN_PERMISSION_KEYS.EXAM_RESULTS]: BarChart3,
  [ADMIN_PERMISSION_KEYS.EXAM_SUBMISSIONS]: FileQuestion,
  [ADMIN_PERMISSION_KEYS.TEACHERS]: GraduationCap,
  [ADMIN_PERMISSION_KEYS.ANNOUNCEMENTS]: Megaphone,
  [ADMIN_PERMISSION_KEYS.COUPONS]: Tag,
  [ADMIN_PERMISSION_KEYS.PAYMENTS]: CreditCard,
  [ADMIN_PERMISSION_KEYS.TELEGRAM]: Send,
  [ADMIN_PERMISSION_KEYS.SETTINGS]: Settings,
  [ADMIN_PERMISSION_KEYS.RANKINGS]: BarChart3,
}

function AdminRoute({ children, permission, fullOnly = false }) {
  const { userProfile } = useAuth()
  const allowed = fullOnly ? isFullAdmin(userProfile) : hasAdminPermission(userProfile, permission)
  return allowed ? children : <Navigate to={getDefaultAdminPath(userProfile)} replace />
}

function NotificationBadge({ count, pulse = false }) {
  if (!count) return null
  return (
    <span className={`ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ${pulse ? "animate-pulse" : ""}`}>
      {count > 99 ? "99+" : count}
    </span>
  )
}

export default function AdminDashboard() {
  const location = useLocation()
  const { userProfile } = useAuth()
  const fullAdmin = isFullAdmin(userProfile)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadBanCount, setUnreadBanCount] = useState(0)

  const canReadNotifications = hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.NOTIFICATIONS)
  const canReadBanAlerts = hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.BAN_ALERTS)
  const canManageClasses = hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.CLASSES)

  useEffect(() => {
    if (!canReadNotifications) {
      setUnreadCount(0)
      return
    }
    const notificationsQuery = query(collection(db, "notifications"), where("isRead", "==", false))
    return onSnapshot(notificationsQuery, (snapshot) => setUnreadCount(snapshot.size))
  }, [canReadNotifications])

  useEffect(() => {
    if (!canReadBanAlerts) {
      setUnreadBanCount(0)
      return
    }
    const banNotificationsQuery = query(collection(db, "banNotifications"), where("isRead", "==", false))
    return onSnapshot(banNotificationsQuery, (snapshot) => setUnreadBanCount(snapshot.size))
  }, [canReadBanAlerts])

  const navItems = [
    ...ADMIN_PAGE_CATALOG.map((page) => ({
      ...page,
      name: page.label,
      icon: ICON_BY_PERMISSION[page.id] || LayoutDashboard,
    })),
    ...(canManageClasses ? [{
      id: "__class-groups",
      label: "Class Cards",
      name: "Class Cards",
      path: "/admin/class-groups",
      description: "Create Foundation/Special class cards and place classes inside them.",
      icon: Layers3,
    }] : []),
    ...(fullAdmin ? [{ id: "__trials", label: "Trials", name: "Trials", path: "/admin/trials", description: "Create and manage claim-first trials.", icon: Gift, fullAdminOnly: true }] : []),
  ]

  const visibleNavItems = navItems.filter((item) => {
    if (item.id === "__trials") return fullAdmin
    if (item.id === "__class-groups") return canManageClasses
    return item.fullAdminOnly ? fullAdmin : hasAdminPermission(userProfile, item.id)
  })
  const currentPage =
    visibleNavItems
      .filter((item) => item.path === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(item.path))
      .sort((a, b) => b.path.length - a.path.length)[0]?.name || "Admin Panel"

  const renderNavItem = (item, mobile = false) => {
    const isActive = item.path === "/admin"
      ? location.pathname === "/admin"
      : location.pathname.startsWith(item.path)
    const Icon = item.icon
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={mobile ? () => setMobileMenuOpen(false) : undefined}
        className={mobile
          ? `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md" : "hover:bg-muted text-foreground hover:text-primary"}`
          : `flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all duration-200 text-xs ${isActive ? "bg-primary text-primary-foreground shadow-sm font-medium" : "hover:bg-muted text-foreground hover:text-primary font-normal"}`}
      >
        <Icon className={mobile ? "w-5 h-5 flex-shrink-0" : "w-4 h-4 flex-shrink-0"} />
        <span className={mobile ? "font-medium" : ""}>{item.name}</span>
        {item.id === ADMIN_PERMISSION_KEYS.NOTIFICATIONS && <NotificationBadge count={unreadCount} />}
        {item.id === ADMIN_PERMISSION_KEYS.BAN_ALERTS && <NotificationBadge count={unreadBanCount} pulse />}
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="hidden lg:block border-b border-border bg-card sticky top-0 z-40 shadow-sm">
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold text-foreground">Admin Panel</h1>
          <p className="text-xs text-muted-foreground font-medium">{currentPage}</p>
        </div>
      </div>

      <div className="lg:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-50 shadow-sm">
        <div>
          <h1 className="text-base font-bold text-foreground">Admin Panel</h1>
          <p className="text-xs text-muted-foreground font-medium">{currentPage}</p>
        </div>
        <button onClick={() => setMobileMenuOpen((value) => !value)} className="p-2 hover:bg-muted rounded-lg transition-colors flex-shrink-0">
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden lg:flex flex-col w-56 bg-card border-r border-border overflow-y-auto">
          <div className="p-3">
            <nav className="space-y-0.5">{visibleNavItems.map((item) => renderNavItem(item))}</nav>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <div className="p-3 sm:p-4 lg:p-4">
            <Routes>
              <Route index element={hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.OVERVIEW) ? <AdminOverview /> : <Navigate to={getDefaultAdminPath(userProfile)} replace />} />
              <Route path="read-usage" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.READ_USAGE}><ReadUsage /></AdminRoute>} />
              <Route path="administration" element={<AdminRoute fullOnly><ManageAdministration /></AdminRoute>} />
              <Route path="security-events" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.SECURITY_EVENTS}><ManageSecurityEvents /></AdminRoute>} />
              <Route path="notifications" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.NOTIFICATIONS}><Notifications /></AdminRoute>} />
              <Route path="ban-notifications" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.BAN_ALERTS}><BannedNotifications /></AdminRoute>} />
              <Route path="ban-management" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.BAN_MANAGEMENT}><BanManagement /></AdminRoute>} />
              <Route path="users" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.USERS}><ManageUsers /></AdminRoute>} />
              <Route path="trials" element={<AdminRoute fullOnly><ManageTrials /></AdminRoute>} />
              <Route path="categories" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.CATEGORIES}><ManageCategories /></AdminRoute>} />
              <Route path="courses" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.COURSES}><ManageCourses /></AdminRoute>} />
              <Route path="subjects" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.SUBJECTS}><ManageSubjects /></AdminRoute>} />
              <Route path="chapters" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.CHAPTERS}><ManageChapters /></AdminRoute>} />
              <Route path="classes" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.CLASSES}><ManageClasses /></AdminRoute>} />
              <Route path="class-groups" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.CLASSES}><ManageClassGroups /></AdminRoute>} />
              <Route path="class-comments" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.CLASS_COMMENTS}><ClassComments /></AdminRoute>} />
              <Route path="exams" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.EXAMS}><ManageExams /></AdminRoute>} />
              <Route path="exams/:examId/questions" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.EXAMS}><ManageExamQuestions /></AdminRoute>} />
              <Route path="exam-results" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.EXAM_RESULTS}><ViewExamResults /></AdminRoute>} />
              <Route path="exam-submissions" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.EXAM_SUBMISSIONS}><ViewExamSubmissions /></AdminRoute>} />
              <Route path="teachers" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.TEACHERS}><ManageTeachers /></AdminRoute>} />
              <Route path="announcements" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.ANNOUNCEMENTS}><ManageAnnouncements /></AdminRoute>} />
              <Route path="coupons" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.COUPONS}><ManageCoupons /></AdminRoute>} />
              <Route path="payments" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.PAYMENTS}><ManagePayments /></AdminRoute>} />
              <Route path="telegram" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.TELEGRAM}><ManageTelegramSubmissions /></AdminRoute>} />
              <Route path="settings" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.SETTINGS}><WebsiteSettings /></AdminRoute>} />
              <Route path="rankings" element={<AdminRoute permission={ADMIN_PERMISSION_KEYS.RANKINGS}><Rankings /></AdminRoute>} />
              <Route path="*" element={<Navigate to={getDefaultAdminPath(userProfile)} replace />} />
            </Routes>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 bg-black/40 z-40 lg:hidden" />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 rounded-t-2xl max-h-[80vh] overflow-y-auto lg:hidden"
            >
              <div className="flex justify-center pt-2 pb-4"><div className="w-12 h-1 bg-muted rounded-full" /></div>
              <div className="px-4 pb-6">
                <h2 className="text-lg font-bold mb-4">Admin Menu</h2>
                <nav className="space-y-2">{visibleNavItems.map((item) => renderNavItem(item, true))}</nav>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}