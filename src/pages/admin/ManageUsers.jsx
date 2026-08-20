"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  Search,
  Trash2,
  Ban,
  BookOpen,
  X,
  UserPlus,
  Check,
  Info,
  Clock,
  AlertTriangle,
  Wrench,
  ShieldCheck,
  Camera,
} from "lucide-react"
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  endAt,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  startAt,
  updateDoc,
  where,
} from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useAuth } from "../../contexts/AuthContext"
import {
  USER_ADMIN_ACTION_KEYS,
  getRoleLabel,
  getUsersCourseIds,
  hasUserAdminAction,
  isFullAdmin,
} from "../../lib/adminPermissions"

const USERS_PAGE_SIZE = 10

export default function ManageUsers() {
  const { userProfile, currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageCursors, setPageCursors] = useState([])
  const [lastVisible, setLastVisible] = useState(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [usersRefresh, setUsersRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [successMessage, setSuccessMessage] = useState("")
  const [courses, setCourses] = useState([])
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const [showGrantAccessModal, setShowGrantAccessModal] = useState(false)
  const [showUserDetailsModal, setShowUserDetailsModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedCoursesForGrant, setSelectedCoursesForGrant] = useState([])
  const [grantingAccess, setGrantingAccess] = useState(false)
  const [userEnrollments, setUserEnrollments] = useState({})
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [cleaningOrphans, setCleaningOrphans] = useState(false)
  const [orphanedRecords, setOrphanedRecords] = useState([])
  const [showOrphanedRecordsModal, setShowOrphanedRecordsModal] = useState(false)
  const [fixingAccounts, setFixingAccounts] = useState(false)
  const [courseSearchQuery, setCourseSearchQuery] = useState("")

  const can = (action) => hasUserAdminAction(userProfile, action)
  const allowedUsersCourseIds = getUsersCourseIds(userProfile)
  const canViewDetails = can(USER_ADMIN_ACTION_KEYS.VIEW_DETAILS)
  const canBan = can(USER_ADMIN_ACTION_KEYS.BAN)
  const canGrant = can(USER_ADMIN_ACTION_KEYS.GRANT_COURSE_ACCESS)
  const canManageCourses = can(USER_ADMIN_ACTION_KEYS.MANAGE_COURSE_ACCESS)
  const canCapture = can(USER_ADMIN_ACTION_KEYS.SCREEN_CAPTURE)
  const canDelete = can(USER_ADMIN_ACTION_KEYS.DELETE)
  const canPromote = can(USER_ADMIN_ACTION_KEYS.PROMOTE_ADMIN)
  const canFixAccounts = can(USER_ADMIN_ACTION_KEYS.FIX_ACCOUNTS)
  const canScanOrphans = can(USER_ADMIN_ACTION_KEYS.SCAN_ORPHANS)

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snapshot) => setCourses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
      .catch((error) => console.error("Error fetching courses:", error))
  }, [])

  const scopedCourses = useMemo(() => {
    if (allowedUsersCourseIds === null) return courses
    const allowed = new Set(allowedUsersCourseIds)
    return courses.filter((course) => allowed.has(course.id))
  }, [courses, allowedUsersCourseIds])

  useEffect(() => {
    if (users.length > 0) fetchUserEnrollments(users.map((user) => user.id))
    else setUserEnrollments({})
  }, [users])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setPage(1)
    setPageCursors([])
  }, [debouncedSearch])

  useEffect(() => {
    setLoading(true)
    const usersRef = collection(db, "users")

    if (debouncedSearch) {
      const normalizedEmail = debouncedSearch.toLowerCase()
      const normalizedName = debouncedSearch.charAt(0).toUpperCase() + debouncedSearch.slice(1)
      const nameQuery = query(usersRef, orderBy("name"), startAt(normalizedName), endAt(`${normalizedName}\uf8ff`), limit(USERS_PAGE_SIZE))
      const emailQuery = query(usersRef, orderBy("email"), startAt(normalizedEmail), endAt(`${normalizedEmail}\uf8ff`), limit(USERS_PAGE_SIZE))
      const results = { name: [], email: [] }
      const applyResults = () => {
        const merged = new Map([...results.name, ...results.email].map((user) => [user.id, user]))
        setUsers([...merged.values()].slice(0, USERS_PAGE_SIZE))
        setHasNextPage(false)
        setLoading(false)
      }
      const unsubscribeName = onSnapshot(nameQuery, (snapshot) => {
        results.name = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        applyResults()
      })
      const unsubscribeEmail = onSnapshot(emailQuery, (snapshot) => {
        results.email = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        applyResults()
      })
      return () => {
        unsubscribeName()
        unsubscribeEmail()
      }
    }

    const constraints = [orderBy(documentId())]
    const cursor = page > 1 ? pageCursors[page - 2] : null
    if (cursor) constraints.push(startAfter(cursor))
    constraints.push(limit(USERS_PAGE_SIZE + 1))

    return onSnapshot(
      query(usersRef, ...constraints),
      (snapshot) => {
        const pageDocs = snapshot.docs.slice(0, USERS_PAGE_SIZE)
        setUsers(pageDocs.map((item) => ({ id: item.id, ...item.data() })))
        setLastVisible(pageDocs.at(-1) || null)
        setHasNextPage(snapshot.docs.length > USERS_PAGE_SIZE)
        setLoading(false)
      },
      (error) => {
        console.error("Error fetching users:", error)
        setLoading(false)
      },
    )
  }, [debouncedSearch, page, pageCursors, usersRefresh])

  const fetchUsers = () => setUsersRefresh((current) => current + 1)

  const fetchUserEnrollments = async (userIds = users.map((user) => user.id)) => {
    if (userIds.length === 0) {
      setUserEnrollments({})
      return
    }
    try {
      const paymentsSnapshot = await getDocs(query(collection(db, "payments"), where("userId", "in", userIds.slice(0, USERS_PAGE_SIZE))))
      const enrollments = {}
      paymentsSnapshot.docs.forEach((paymentDoc) => {
        const payment = paymentDoc.data()
        if (payment.status !== "approved") return
        if (!enrollments[payment.userId]) enrollments[payment.userId] = []
        payment.courses?.forEach((course) => {
          if (allowedUsersCourseIds !== null && !allowedUsersCourseIds.includes(course.id)) return
          if (!enrollments[payment.userId].find((item) => item.id === course.id)) {
            enrollments[payment.userId].push({ ...course, paymentId: paymentDoc.id, enrolledAt: payment.submittedAt })
          }
        })
      })
      setUserEnrollments(enrollments)
    } catch (error) {
      console.error("Error fetching user enrollments:", error)
    }
  }

  const showSuccess = (message) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(""), 3000)
  }

  const handleBanUser = (userId, currentBanStatus) => {
    if (!canBan) return
    setConfirmDialog({
      isOpen: true,
      title: currentBanStatus ? "Unban User" : "Ban User",
      message: currentBanStatus
        ? "Unban this user and clear their active ban/device state?"
        : "Ban this user for 30 minutes?",
      variant: currentBanStatus ? "default" : "destructive",
      onConfirm: async () => {
        try {
          const user = users.find((item) => item.id === userId)
          if (currentBanStatus) {
            await updateDoc(doc(db, "users", userId), {
              banned: false,
              banExpiresAt: null,
              permanentBan: false,
              banCount: 0,
              banHistory: [],
              devices: [],
              kickedDevices: [],
              forceLogoutAt: serverTimestamp(),
              forceLogoutReason: `Unbanned by ${userProfile?.name || "Admin"} - Please log in again`,
              forcedBy: userProfile?.id || "unknown",
              clearBanCacheAt: serverTimestamp(),
            })
          } else {
            const banExpires = new Date(Date.now() + 30 * 60 * 1000)
            await updateDoc(doc(db, "users", userId), {
              banned: true,
              banExpiresAt: banExpires,
              banCount: (user?.banCount || 0) + 1,
              banHistory: [
                ...(user?.banHistory || []),
                {
                  timestamp: new Date().toISOString(),
                  reason: `Manually banned by ${userProfile?.name || "Admin"}`,
                  bannedBy: userProfile?.name || "Admin",
                  bannedById: userProfile?.id || "unknown",
                },
              ],
              devices: [],
              forceLogoutAt: serverTimestamp(),
              forceLogoutReason: `Banned by ${userProfile?.name || "Admin"}`,
              forcedBy: userProfile?.id || "unknown",
            })
          }
          showSuccess(currentBanStatus ? "User unbanned successfully!" : "User banned successfully!")
          fetchUsers()
        } catch (error) {
          toast({ variant: "error", title: "Ban Update Failed", description: error.message || "Failed to update ban status." })
        }
      },
    })
  }

  const handleScreenCaptureAccess = (user) => {
    if (!canCapture || !user?.id) return
    const willAllow = user.allowScreenCapture !== true
    setConfirmDialog({
      isOpen: true,
      title: willAllow ? "Allow Screen Capture" : "Restore Capture Restriction",
      message: willAllow
        ? `Allow ${user.name || user.email} to take screenshots and screen recordings in Easy Education? The app caches this exception for up to 24 hours.`
        : `Restore screenshot and screen-recording protection for ${user.name || user.email}? Their app will pick up the change on the next daily policy refresh.`,
      variant: willAllow ? "default" : "destructive",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "users", user.id), {
            allowScreenCapture: willAllow,
            screenCaptureAccessUpdatedAt: serverTimestamp(),
            screenCaptureAccessUpdatedBy: userProfile?.id || currentUser?.uid || "unknown",
          })
          showSuccess(willAllow ? "Screen capture enabled for this user." : "Screen capture protection restored for this user.")
          fetchUsers()
        } catch (error) {
          toast({ variant: "error", title: "Capture Access Failed", description: error.message || "Failed to update screen capture access." })
        }
      },
    })
  }

  const handleDeleteUser = (userId) => {
    if (!canDelete) return
    setConfirmDialog({
      isOpen: true,
      title: "Delete User",
      message: "Delete this user profile permanently? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "users", userId))
          setUsers((current) => current.filter((user) => user.id !== userId))
          showSuccess("User deleted successfully!")
        } catch (error) {
          toast({ variant: "error", title: "Deletion Failed", description: error.message || "Failed to delete user." })
        }
      },
    })
  }

  const handlePromoteAdmin = async (user) => {
    if (!canPromote || isFullAdmin(user)) return
    if (!window.confirm(`Make ${user.name || user.email} a Full Admin? This grants every admin-panel permission.`)) return
    if (!window.confirm("Final confirmation: this user will be able to change roles, permissions and all website data. Continue?")) return

    try {
      await updateDoc(doc(db, "users", user.id), { role: "admin", adminAccess: deleteField() })
      toast({ title: "Full Admin Granted", description: `${user.name || user.email} is now a Full Admin.` })
      fetchUsers()
    } catch (error) {
      toast({ variant: "error", title: "Promotion Failed", description: error.message || "Failed to grant Full Admin." })
    }
  }

  const handleGrantAccess = async () => {
    if (!canGrant || !selectedUser || selectedCoursesForGrant.length === 0) return
    setGrantingAccess(true)
    try {
      const coursesToEnrollMap = new Map()
      const bundlesGranted = []

      for (const courseId of selectedCoursesForGrant) {
        const course = scopedCourses.find((item) => item.id === courseId)
        if (!course) continue
        if (course.courseFormat === "bundle" && Array.isArray(course.bundledCourses) && course.bundledCourses.length > 0) {
          bundlesGranted.push({ id: course.id, title: course.title })
          for (const rawBundledCourse of course.bundledCourses) {
            const bundledCourseId = typeof rawBundledCourse === "string" ? rawBundledCourse : rawBundledCourse?.id
            const bundledCourse = scopedCourses.find((item) => item.id === bundledCourseId)
            if (!bundledCourse) continue
            coursesToEnrollMap.set(bundledCourseId, {
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
          coursesToEnrollMap.set(courseId, { id: course.id, title: course.title, price: course.price || 0 })
        }
      }

      const coursesToEnroll = [...coursesToEnrollMap.values()]
      if (coursesToEnroll.length === 0) throw new Error("No allowed course was selected")
      const transactionId = `MANUAL_${Date.now()}_${selectedUser.id}`
      const token = await currentUser?.getIdToken?.().catch(() => null)

      const response = await fetch("/api/process-enrollment", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          transaction_id: transactionId,
          userId: selectedUser.id,
          userName: selectedUser.name,
          userEmail: selectedUser.email,
          skipPaymentVerification: true,
          finalAmount: 0,
          subtotal: 0,
          discount: 0,
          couponCode: "MANUAL_ADMIN_GRANT",
          paymentMethod: "Manual Grant by Admin",
          courses: coursesToEnroll,
        }),
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error || "Failed to grant access")

      await addDoc(collection(db, "notifications"), {
        type: "admin_course_grant",
        title: "Admin Granted Course Access",
        message: `${userProfile?.name || "Admin"} granted ${selectedUser.name} access to ${coursesToEnroll.length} course(s)`,
        userId: selectedUser.id,
        userName: selectedUser.name,
        userEmail: selectedUser.email,
        adminId: userProfile?.id || "unknown",
        adminName: userProfile?.name || "Admin",
        adminEmail: userProfile?.email || "",
        courses: coursesToEnroll,
        bundles: bundlesGranted,
        transactionId,
        isRead: false,
        createdAt: serverTimestamp(),
        link: "/admin/payments",
      })

      toast({ title: "Success", description: `Granted access to ${coursesToEnroll.length} course(s).` })
      await fetchUserEnrollments()
      setShowGrantAccessModal(false)
      setSelectedUser(null)
      setSelectedCoursesForGrant([])
      setCourseSearchQuery("")
    } catch (error) {
      toast({ variant: "error", title: "Grant Access Failed", description: error.message || "Failed to grant course access." })
    } finally {
      setGrantingAccess(false)
    }
  }

  const handleRemoveFromCourse = (courseId) => {
    if (!canManageCourses || !selectedUser || !courseId) return
    if (allowedUsersCourseIds !== null && !allowedUsersCourseIds.includes(courseId)) return

    setConfirmDialog({
      isOpen: true,
      title: "Remove from Course",
      message: `Remove ${selectedUser.name} from this course?`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          const course = scopedCourses.find((item) => item.id === courseId)
          const bundledIds = course?.courseFormat === "bundle" && Array.isArray(course.bundledCourses)
            ? course.bundledCourses.map((item) => typeof item === "string" ? item : item?.id).filter(Boolean)
            : []
          const coursesToRemove = [courseId, ...bundledIds].filter((id) => allowedUsersCourseIds === null || allowedUsersCourseIds.includes(id))

          const paymentsSnapshot = await getDocs(query(collection(db, "payments"), where("userId", "==", selectedUser.id), where("status", "==", "approved")))
          for (const paymentDoc of paymentsSnapshot.docs) {
            const payment = paymentDoc.data()
            const updatedCourses = (payment.courses || []).filter((item) => !coursesToRemove.includes(item.id))
            if (updatedCourses.length !== (payment.courses || []).length) {
              await updateDoc(doc(db, "payments", paymentDoc.id), { courses: updatedCourses })
            }
          }

          for (const id of coursesToRemove) {
            await deleteDoc(doc(db, "userCourses", `${selectedUser.id}_${id}`)).catch(() => {})
          }

          showSuccess("Student course access removed successfully!")
          await fetchUserEnrollments()
        } catch (error) {
          toast({ variant: "error", title: "Removal Failed", description: error.message || "Failed to remove course access." })
        }
      },
    })
  }

  const getAvailableCoursesForUser = (userId) => {
    const enrolled = new Set((userEnrollments[userId] || []).map((item) => item.id))
    return scopedCourses.filter((course) => !enrolled.has(course.id))
  }

  const toggleCourseSelection = (courseId) => {
    setSelectedCoursesForGrant((current) => current.includes(courseId)
      ? current.filter((id) => id !== courseId)
      : [...current, courseId])
  }

  const scanForOrphanedRecords = async () => {
    if (!canScanOrphans) return
    setCleaningOrphans(true)
    try {
      const userCoursesSnapshot = await getDocs(collection(db, "userCourses"))
      const paymentsSnapshot = await getDocs(query(collection(db, "payments"), where("status", "==", "approved")))
      const paymentsByUser = new Map()
      paymentsSnapshot.docs.forEach((paymentDoc) => {
        const payment = paymentDoc.data()
        if (!paymentsByUser.has(payment.userId)) paymentsByUser.set(payment.userId, [])
        paymentsByUser.get(payment.userId).push(payment)
      })

      const suspicious = []
      for (const enrollmentDoc of userCoursesSnapshot.docs) {
        const enrollment = enrollmentDoc.data()
        if (allowedUsersCourseIds !== null && !allowedUsersCourseIds.includes(enrollment.courseId)) continue
        const userPayments = paymentsByUser.get(enrollment.userId) || []
        const hasPayment = userPayments.some((payment) => payment.courses?.some((course) => course.id === enrollment.courseId))
        if (hasPayment) continue
        const user = users.find((item) => item.id === enrollment.userId)
        const course = courses.find((item) => item.id === enrollment.courseId)
        suspicious.push({
          id: enrollmentDoc.id,
          userCourse: enrollment,
          userName: user?.name || "Unknown User",
          userEmail: user?.email || "Unknown",
          courseName: course?.title || "Unknown Course",
          bundleId: enrollment.bundleId || null,
          confidence: userPayments.length === 0 ? "high" : enrollment.bundleId ? "low" : "medium",
        })
      }
      setOrphanedRecords(suspicious)
      setShowOrphanedRecordsModal(true)
      toast({ title: "Scan Complete", description: `Found ${suspicious.length} potentially orphaned record(s).` })
    } catch (error) {
      toast({ variant: "error", title: "Scan Failed", description: error.message || "Failed to scan orphaned records." })
    } finally {
      setCleaningOrphans(false)
    }
  }

  const deleteOrphanedRecord = async (recordId) => {
    if (!canScanOrphans) return
    const record = orphanedRecords.find((item) => item.id === recordId)
    if (!record) return
    if (allowedUsersCourseIds !== null && !allowedUsersCourseIds.includes(record.userCourse.courseId)) return
    try {
      await deleteDoc(doc(db, "userCourses", recordId))
      setOrphanedRecords((current) => current.filter((item) => item.id !== recordId))
      toast({ title: "Record Deleted", description: "Orphaned record deleted successfully." })
    } catch (error) {
      toast({ variant: "error", title: "Delete Failed", description: error.message || "Failed to delete record." })
    }
  }

  const fixOrphanedAccounts = async () => {
    if (!canFixAccounts) return
    setFixingAccounts(true)
    try {
      const usersSnapshot = await getDocs(collection(db, "users"))
      let fixedCount = 0
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data()
        const updateData = {}
        if (Array.isArray(userData.kickedDevices)) updateData.kickedDevices = deleteField()
        if (userData.forceLogoutAt) {
          const timestamp = userData.forceLogoutAt.toMillis ? userData.forceLogoutAt.toMillis() : new Date(userData.forceLogoutAt).getTime()
          if (Date.now() - timestamp > 5 * 60 * 1000) {
            updateData.forceLogoutAt = deleteField()
            if (userData.forceLogoutReason) updateData.forceLogoutReason = deleteField()
            if (userData.forcedBy) updateData.forcedBy = deleteField()
          }
        }
        if (userData.clearBanCacheAt) updateData.clearBanCacheAt = deleteField()
        if (userData.banExpiresAt) {
          const end = userData.banExpiresAt.toDate ? userData.banExpiresAt.toDate() : new Date(userData.banExpiresAt)
          if (end <= new Date()) {
            updateData.banned = false
            updateData.banExpiresAt = deleteField()
          }
        }
        if (Array.isArray(userData.devices)) {
          const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          const validDevices = userData.devices.filter((device) => {
            if (!device.fingerprint) return false
            const lastActive = device.lastSeen || device.timestamp
            if (!lastActive) return true
            const date = new Date(lastActive)
            return !Number.isNaN(date.getTime()) && date >= cutoff
          })
          if (validDevices.length !== userData.devices.length) updateData.devices = validDevices
        }
        if (Object.keys(updateData).length > 0) {
          await updateDoc(doc(db, "users", userDoc.id), updateData)
          fixedCount += 1
        }
      }
      toast({ title: "Accounts Fixed", description: `Cleaned up ${fixedCount} user account(s).` })
      fetchUsers()
    } catch (error) {
      toast({ variant: "error", title: "Fix Failed", description: error.message || "Failed to fix accounts." })
    } finally {
      setFixingAccounts(false)
    }
  }

  const formatTimeRemaining = (banExpiresAt) => {
    if (!banExpiresAt) return null
    const end = banExpiresAt.toDate ? banExpiresAt.toDate() : new Date(banExpiresAt)
    const minutes = Math.floor((end - new Date()) / 60000)
    if (minutes <= 0) return "Ban expired"
    const hours = Math.floor(minutes / 60)
    return hours > 0 ? `${hours}h ${minutes % 60}m remaining` : `${minutes}m remaining`
  }

  const actionButton = (action, expanded) => {
    const Icon = action.icon
    return (
      <button
        key={action.id}
        onClick={action.onClick}
        className={`${expanded ? "px-3 py-2 text-sm" : "px-2.5 py-1.5 text-xs"} hover:bg-muted rounded-lg transition-colors font-medium border flex items-center gap-1.5 ${action.className}`}
        title={action.label}
      >
        <Icon className={expanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
        <span className={expanded ? "inline" : "hidden xl:inline"}>{action.label}</span>
        {action.badge != null && <span className="ml-1 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] rounded-full font-bold">{action.badge}</span>}
      </button>
    )
  }

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold mb-2">Manage Users</h1>
            <p className="text-muted-foreground">Only actions assigned to your role are shown.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canFixAccounts && (
              <button onClick={() => setConfirmDialog({ isOpen: true, title: "Fix Stale Accounts", message: "Clean stale devices, expired bans and old force-logout flags?", onConfirm: fixOrphanedAccounts })} disabled={fixingAccounts} className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 rounded-lg disabled:opacity-50">
                <Wrench className="w-4 h-4" />{fixingAccounts ? "Fixing..." : "Fix Accounts"}
              </button>
            )}
            {canScanOrphans && (
              <button onClick={scanForOrphanedRecords} disabled={cleaningOrphans} className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 rounded-lg disabled:opacity-50">
                <AlertTriangle className="w-4 h-4" />{cleaningOrphans ? "Scanning..." : "Scan Orphaned Courses"}
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {successMessage && <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm">{successMessage}</div>}

      <div className="bg-card border border-border rounded-xl p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by name or email..." className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">{[...Array(5)].map((_, index) => <div key={index} className="h-16 bg-muted rounded animate-pulse" />)}</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">User</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Email</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Role</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => {
                  const scopedEnrollments = userEnrollments[user.id] || []
                  const actions = []
                  if (canViewDetails) actions.push({ id: "info", label: "User info", icon: Info, className: "text-blue-500 border-blue-500/20", onClick: () => { setSelectedUser(user); setShowUserDetailsModal(true) } })
                  if (canBan) actions.push({ id: "ban", label: user.banned ? "Unban user" : "Ban user", icon: Ban, className: user.banned ? "text-green-500 border-green-500/20" : "text-yellow-500 border-yellow-500/20", onClick: () => handleBanUser(user.id, user.banned) })
                  if (canGrant) actions.push({ id: "grant", label: "Grant course", icon: UserPlus, className: "text-green-500 border-green-500/20", onClick: () => { setSelectedUser(user); setSelectedCoursesForGrant([]); setCourseSearchQuery(""); setShowGrantAccessModal(true) } })
                  if (canManageCourses && scopedEnrollments.length > 0) actions.push({ id: "courses", label: "Manage courses", icon: BookOpen, className: "text-blue-500 border-blue-500/20", badge: scopedEnrollments.length, onClick: () => { setSelectedUser(user); setShowRemoveModal(true) } })
                  if (canCapture) actions.push({ id: "capture", label: user.allowScreenCapture === true ? "Restrict capture" : "Allow capture", icon: Camera, className: user.allowScreenCapture === true ? "text-orange-500 border-orange-500/20" : "text-cyan-500 border-cyan-500/20", onClick: () => handleScreenCaptureAccess(user) })
                  if (canPromote && !isFullAdmin(user)) actions.push({ id: "promote", label: "Make Full Admin", icon: ShieldCheck, className: "text-purple-500 border-purple-500/20", onClick: () => handlePromoteAdmin(user) })
                  if (canDelete) actions.push({ id: "delete", label: "Delete user", icon: Trash2, className: "text-red-500 border-red-500/20", onClick: () => handleDeleteUser(user.id) })
                  const expanded = actions.length <= 2

                  return (
                    <tr key={user.id} className="hover:bg-muted/50">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                            {user.photoURL ? <img src={user.photoURL} alt="" className="w-full h-full object-cover" /> : <span className="text-primary font-semibold">{user.name?.[0] || "U"}</span>}
                          </div>
                          <span className="font-medium text-sm">{user.name || "Unnamed user"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-4"><span className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary">{getRoleLabel(user.role, user.adminAccess)}</span></td>
                      <td className="px-4 py-4"><span className={`px-2.5 py-1 rounded-full text-xs ${user.banned ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"}`}>{user.banned ? "Banned" : "Active"}</span></td>
                      <td className="px-4 py-4">
                        <div className={`flex items-center justify-end flex-wrap ${expanded ? "gap-2" : "gap-1"}`}>
                          {actions.length > 0 ? actions.map((action) => actionButton(action, expanded)) : <span className="text-xs text-muted-foreground">No assigned actions</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!debouncedSearch && (
            <div className="flex items-center justify-between p-4 border-t border-border">
              <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="px-4 py-2 bg-muted rounded-lg disabled:opacity-40">Previous</button>
              <span className="text-sm text-muted-foreground">Page {page}</span>
              <button
                onClick={() => {
                  if (!hasNextPage || !lastVisible) return
                  setPageCursors((current) => [...current.slice(0, page - 1), lastVisible])
                  setPage((current) => current + 1)
                }}
                disabled={!hasNextPage}
                className="px-4 py-2 bg-muted rounded-lg disabled:opacity-40"
              >Next</button>
            </div>
          )}
        </div>
      )}

      {showGrantAccessModal && selectedUser && (
        <Modal title={`Grant Course Access · ${selectedUser.name || selectedUser.email}`} onClose={() => { setShowGrantAccessModal(false); setSelectedUser(null); setSelectedCoursesForGrant([]); setCourseSearchQuery("") }}>
          {(() => {
            const available = getAvailableCoursesForUser(selectedUser.id).filter((course) => course.title?.toLowerCase().includes(courseSearchQuery.toLowerCase()))
            return (
              <>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input value={courseSearchQuery} onChange={(event) => setCourseSearchQuery(event.target.value)} placeholder="Search allowed courses..." className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg" />
                </div>
                <div className="max-h-80 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                  {available.map((course) => (
                    <button key={course.id} type="button" onClick={() => toggleCourseSelection(course.id)} className={`text-left p-3 border rounded-lg flex items-center justify-between gap-3 ${selectedCoursesForGrant.includes(course.id) ? "border-primary bg-primary/5" : "border-border"}`}>
                      <span className="text-sm font-medium">{course.title}</span>
                      <span className={`w-5 h-5 border rounded flex items-center justify-center ${selectedCoursesForGrant.includes(course.id) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>{selectedCoursesForGrant.includes(course.id) && <Check className="w-4 h-4 text-white" />}</span>
                    </button>
                  ))}
                  {available.length === 0 && <p className="col-span-full text-center text-muted-foreground py-8">No allowed course available to grant.</p>}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setShowGrantAccessModal(false); setSelectedUser(null) }} className="flex-1 py-2 bg-muted rounded-lg">Cancel</button>
                  <button onClick={handleGrantAccess} disabled={selectedCoursesForGrant.length === 0 || grantingAccess} className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50">{grantingAccess ? "Granting..." : `Grant Access (${selectedCoursesForGrant.length})`}</button>
                </div>
              </>
            )
          })()}
        </Modal>
      )}

      {showRemoveModal && selectedUser && (
        <Modal title={`Manage Course Access · ${selectedUser.name || selectedUser.email}`} onClose={() => { setShowRemoveModal(false); setSelectedUser(null) }}>
          <div className="space-y-3">
            {(userEnrollments[selectedUser.id] || []).map((enrollment) => (
              <div key={enrollment.id} className="flex items-center justify-between gap-3 p-4 border border-border rounded-lg">
                <div>
                  <p className="font-semibold">{enrollment.title}</p>
                  {enrollment.enrolledAt && <p className="text-xs text-muted-foreground">Enrolled: {new Date(enrollment.enrolledAt.seconds * 1000).toLocaleDateString()}</p>}
                </div>
                <button onClick={() => handleRemoveFromCourse(enrollment.id)} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm flex items-center gap-2"><Trash2 className="w-4 h-4" />Remove</button>
              </div>
            ))}
            {(userEnrollments[selectedUser.id] || []).length === 0 && <p className="text-center text-muted-foreground py-8">No manageable course enrollment.</p>}
          </div>
        </Modal>
      )}

      {showUserDetailsModal && selectedUser && (
        <Modal title="User Details" onClose={() => { setShowUserDetailsModal(false); setSelectedUser(null) }}>
          <div className="p-4 bg-muted/50 rounded-lg mb-4">
            <p className="font-semibold text-lg">{selectedUser.name || "Unnamed user"}</p>
            <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
            <p className="text-sm mt-1">Role: {getRoleLabel(selectedUser.role, selectedUser.adminAccess)}</p>
            <p className="text-sm mt-1">Screen capture: {selectedUser.allowScreenCapture === true ? "Allowed" : "Restricted"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 border border-border rounded-lg"><p className="text-xs text-muted-foreground">Devices</p><p className="font-semibold">{selectedUser.devices?.length || 0}</p></div>
            <div className="p-3 border border-border rounded-lg"><p className="text-xs text-muted-foreground">Ban count</p><p className="font-semibold">{selectedUser.banCount || 0}</p></div>
          </div>
          {selectedUser.banExpiresAt && <p className="text-sm flex items-center gap-2 mb-3"><Clock className="w-4 h-4" />{formatTimeRemaining(selectedUser.banExpiresAt)}</p>}
          {Array.isArray(selectedUser.banHistory) && selectedUser.banHistory.length > 0 && (
            <details className="p-4 border border-border rounded-lg mb-3">
              <summary className="cursor-pointer font-medium">Ban history ({selectedUser.banHistory.length})</summary>
              <div className="mt-3 space-y-2">{selectedUser.banHistory.map((banItem, index) => <div key={index} className="text-sm border-b border-border pb-2 last:border-0"><p>{banItem.reason}</p><p className="text-xs text-muted-foreground">{banItem.timestamp ? new Date(banItem.timestamp).toLocaleString() : "Unknown time"}</p></div>)}</div>
            </details>
          )}
          {Array.isArray(selectedUser.devices) && selectedUser.devices.length > 0 && (
            <details className="p-4 border border-border rounded-lg"><summary className="cursor-pointer font-medium">Devices ({selectedUser.devices.length})</summary><div className="mt-3 space-y-2">{selectedUser.devices.map((device, index) => <div key={index} className="text-sm border-b border-border pb-2 last:border-0"><p className="font-medium">Device {index + 1}</p><p className="text-muted-foreground">{device.platform || device.userAgent || "Unknown platform"}</p></div>)}</div></details>
          )}
        </Modal>
      )}

      {showOrphanedRecordsModal && (
        <Modal title="Orphaned Course Records" onClose={() => { setShowOrphanedRecordsModal(false); setOrphanedRecords([]) }} wide>
          <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm">
            Only records inside your allowed course scope are shown. Review before deleting.
          </div>
          <div className="space-y-3">
            {orphanedRecords.map((record) => (
              <div key={record.id} className="p-4 border border-border rounded-lg flex items-start justify-between gap-3">
                <div><p className="font-semibold">{record.courseName}</p><p className="text-sm text-muted-foreground">{record.userName} · {record.userEmail}</p><p className="text-xs mt-1 uppercase">{record.confidence} confidence{record.bundleId ? " · bundle" : ""}</p></div>
                <button onClick={() => deleteOrphanedRecord(record.id)} className="px-3 py-2 text-sm text-red-500 border border-red-500/20 rounded-lg">Delete record</button>
              </div>
            ))}
            {orphanedRecords.length === 0 && <div className="text-center py-10 text-muted-foreground"><Check className="w-10 h-10 mx-auto mb-2 text-green-500" /><p>No orphaned records found.</p></div>}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        onConfirm={async () => {
          const callback = confirmDialog.onConfirm
          setConfirmDialog({ isOpen: false, title: "", message: "", onConfirm: () => {} })
          await callback?.()
        }}
        onCancel={() => setConfirmDialog({ isOpen: false, title: "", message: "", onConfirm: () => {} })}
      />
    </div>
  )
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={`bg-card border border-border rounded-xl p-6 w-full max-h-[90vh] overflow-y-auto ${wide ? "max-w-4xl" : "max-w-2xl"}`}>
        <div className="flex items-center justify-between gap-4 mb-5"><h2 className="text-xl font-bold">{title}</h2><button onClick={onClose} className="p-2 hover:bg-muted rounded-lg"><X className="w-5 h-5" /></button></div>
        {children}
      </motion.div>
    </div>
  )
}
