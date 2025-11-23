"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, Shield, ShieldOff, Trash2, Ban, BookOpen, X, UserPlus, Check, Info, Clock, AlertTriangle } from "lucide-react"
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, addDoc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useAuth } from "../../contexts/AuthContext"

export default function ManageUsers() {
  const { userProfile } = useAuth()
  const [users, setUsers] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [successMessage, setSuccessMessage] = useState("")
  const [courses, setCourses] = useState([])
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const [showGrantAccessModal, setShowGrantAccessModal] = useState(false)
  const [showUserDetailsModal, setShowUserDetailsModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedCourse, setSelectedCourse] = useState("")
  const [selectedCoursesForGrant, setSelectedCoursesForGrant] = useState([])
  const [grantingAccess, setGrantingAccess] = useState(false)
  const [userEnrollments, setUserEnrollments] = useState({})
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  useEffect(() => {
    fetchUsers()
    fetchCourses()
    fetchUserEnrollments()
  }, [])

  useEffect(() => {
    filterUsers()
  }, [users, searchQuery])

  const fetchUsers = async () => {
    try {
      const usersSnapshot = await getDocs(collection(db, "users"))
      const usersData = usersSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      setUsers(usersData)
    } catch (error) {
      console.error("Error fetching users:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCourses = async () => {
    try {
      const coursesSnapshot = await getDocs(collection(db, "courses"))
      const coursesData = coursesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      setCourses(coursesData)
    } catch (error) {
      console.error("Error fetching courses:", error)
    }
  }

  const fetchUserEnrollments = async () => {
    try {
      const paymentsSnapshot = await getDocs(
        query(collection(db, "payments"), where("status", "==", "approved"))
      )
      
      const enrollments = {}
      paymentsSnapshot.docs.forEach((doc) => {
        const payment = doc.data()
        const userId = payment.userId
        
        if (!enrollments[userId]) {
          enrollments[userId] = []
        }
        
        payment.courses?.forEach((course) => {
          if (!enrollments[userId].find(c => c.id === course.id)) {
            enrollments[userId].push({
              ...course,
              paymentId: doc.id,
              enrolledAt: payment.submittedAt,
            })
          }
        })
      })
      
      setUserEnrollments(enrollments)
    } catch (error) {
      console.error("Error fetching user enrollments:", error)
    }
  }

  const filterUsers = () => {
    if (!searchQuery) {
      setFilteredUsers(users)
    } else {
      const filtered = users.filter(
        (user) =>
          user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.email?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      setFilteredUsers(filtered)
    }
  }

  const showSuccess = (message) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(""), 3000)
  }

  const handlePromoteToAdmin = async (userId) => {
    try {
      console.log(" Promoting user to admin:", userId)
      await updateDoc(doc(db, "users", userId), { role: "admin" })
      setUsers(users.map((u) => (u.id === userId ? { ...u, role: "admin" } : u)))
      showSuccess("User promoted to admin successfully!")
      console.log(" User promoted successfully")
    } catch (error) {
      console.error(" Error promoting user:", error)
      toast({
        variant: "error",
        title: "Promotion Failed",
        description: error.message || "Failed to promote user",
      })
    }
  }

  const handleDemoteToUser = async (userId) => {
    try {
      console.log(" Demoting user to regular user:", userId)
      await updateDoc(doc(db, "users", userId), { role: "user" })
      setUsers(users.map((u) => (u.id === userId ? { ...u, role: "user" } : u)))
      showSuccess("User demoted to regular user successfully!")
      console.log(" User demoted successfully")
    } catch (error) {
      console.error(" Error demoting user:", error)
      toast({
        variant: "error",
        title: "Demotion Failed",
        description: error.message || "Failed to demote user",
      })
    }
  }

  const handleBanUser = async (userId, currentBanStatus) => {
    setConfirmDialog({
      isOpen: true,
      title: currentBanStatus ? "Unban User" : "Ban User",
      message: currentBanStatus 
        ? "Are you sure you want to unban this user? This will clear all ban records and log them out to refresh their session."
        : "Are you sure you want to ban this user? They will be unable to access the platform.",
      variant: currentBanStatus ? "default" : "destructive",
      onConfirm: async () => {
        try {
          console.log(" Toggling ban status for user:", userId, "Current status:", currentBanStatus)
          
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
              forceLogoutReason: `Unbanned by ${userProfile?.name || 'Admin'} - Please log in again`,
              forcedBy: userProfile?.id || 'unknown',
              clearBanCacheAt: serverTimestamp()
            })
            setUsers(users.map((u) => (u.id === userId ? { ...u, banned: false, permanentBan: false, banCount: 0 } : u)))
          } else {
            const banExpires = new Date(Date.now() + 30 * 60 * 1000)
            await updateDoc(doc(db, "users", userId), {
              banned: true,
              banExpiresAt: banExpires,
              banCount: (users.find(u => u.id === userId)?.banCount || 0) + 1,
              banHistory: [
                ...(users.find(u => u.id === userId)?.banHistory || []),
                {
                  timestamp: new Date().toISOString(),
                  reason: `Manually banned by ${userProfile?.name || 'Admin'}`,
                  bannedBy: userProfile?.name || 'Admin',
                  bannedById: userProfile?.id || 'unknown'
                }
              ],
              devices: [],
              forceLogoutAt: serverTimestamp(),
              forceLogoutReason: `Banned by ${userProfile?.name || 'Admin'}`,
              forcedBy: userProfile?.id || 'unknown'
            })
            setUsers(users.map((u) => (u.id === userId ? { ...u, banned: true } : u)))
          }
          
          showSuccess(!currentBanStatus ? "User banned successfully!" : "User unbanned successfully!")
          console.log(" Ban status updated successfully")
        } catch (error) {
          console.error(" Error banning user:", error)
          toast({
            variant: "error",
            title: "Ban Status Update Failed",
            description: error.message || "Failed to update ban status",
          })
        }
      }
    })
  }

  const handleUnbanUser = async (userId) => {
    try {
      await updateDoc(doc(db, "users", userId), {
        banned: false,
        banExpiresAt: null,
        permanentBan: false,
        banCount: 0,
        banHistory: [],
        devices: [],
        kickedDevices: [],
        forceLogoutAt: serverTimestamp(),
        forceLogoutReason: `Unbanned by ${userProfile?.name || 'Admin'} - Please log in again`,
        forcedBy: userProfile?.id || 'unknown',
        clearBanCacheAt: serverTimestamp()
      })
      
      await fetchUsers()
      setShowUserDetailsModal(false)
      
      showSuccess("User unbanned successfully!")
      toast({
        variant: "success",
        title: "Success",
        description: "User has been completely unbanned and logged out. They can now log in again.",
      })
    } catch (error) {
      console.error("Error unbanning user:", error)
      toast({
        variant: "error",
        title: "Unban Failed",
        description: error.message || "Failed to unban user",
      })
    }
  }

  const formatTimeRemaining = (banExpiresAt) => {
    if (!banExpiresAt) return null
    
    const now = new Date()
    const banEnd = banExpiresAt.toDate()
    const diff = banEnd - now

    if (diff <= 0) return "Ban expired"

    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m remaining`
    }
    return `${remainingMinutes}m remaining`
  }

  const handleDeleteUser = async (userId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete User",
      message: "Are you sure you want to delete this user? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          console.log(" Deleting user:", userId)
          await deleteDoc(doc(db, "users", userId))
          setUsers(users.filter((u) => u.id !== userId))
          showSuccess("User deleted successfully!")
          console.log(" User deleted successfully")
        } catch (error) {
          console.error(" Error deleting user:", error)
          toast({
            variant: "error",
            title: "Deletion Failed",
            description: error.message || "Failed to delete user",
          })
        }
      }
    })
  }

  const handleGrantAccess = async () => {
    if (!selectedUser || selectedCoursesForGrant.length === 0) {
      toast({
        variant: "warning",
        title: "Selection Required",
        description: "Please select both user and at least one course",
      })
      return
    }

    setGrantingAccess(true)
    try {
      const coursesToEnroll = selectedCoursesForGrant.map(courseId => {
        const course = courses.find(c => c.id === courseId)
        return {
          id: course.id,
          title: course.title,
          price: course.price || 0
        }
      })

      const transactionId = `MANUAL_${Date.now()}_${selectedUser.id}`
      
      const response = await fetch('/api/process-enrollment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_id: transactionId,
          userId: selectedUser.id,
          userName: selectedUser.name,
          userEmail: selectedUser.email,
          skipPaymentVerification: true,
          finalAmount: 0,
          subtotal: 0,
          discount: 0,
          couponCode: 'MANUAL_ADMIN_GRANT',
          paymentMethod: 'Manual Grant by Admin',
          courses: coursesToEnroll
        })
      })

      const result = await response.json()

      if (result.success) {
        await addDoc(collection(db, "notifications"), {
          type: 'admin_course_grant',
          title: 'Admin Granted Course Access',
          message: `${userProfile?.name || 'Admin'} granted ${selectedUser.name} access to ${coursesToEnroll.length} course(s)`,
          userId: selectedUser.id,
          userName: selectedUser.name,
          userEmail: selectedUser.email,
          adminId: userProfile?.id || 'unknown',
          adminName: userProfile?.name || 'Admin',
          adminEmail: userProfile?.email || 'admin@gmail.com',
          courses: coursesToEnroll,
          transactionId: transactionId,
          isRead: false,
          createdAt: serverTimestamp(),
          link: '/admin/payments'
        })

        toast({
          title: "Success",
          description: `Successfully granted access to ${coursesToEnroll.length} course(s)!`,
        })
        
        await fetchUserEnrollments()
        await fetchUsers()
        setShowGrantAccessModal(false)
        setSelectedUser(null)
        setSelectedCoursesForGrant([])
      } else {
        throw new Error(result.error || 'Failed to grant access')
      }
    } catch (error) {
      console.error("Error granting course access:", error)
      toast({
        variant: "error",
        title: "Grant Access Failed",
        description: error.message || "Failed to grant course access",
      })
    } finally {
      setGrantingAccess(false)
    }
  }

  const handleRemoveFromCourse = async (courseId) => {
    if (!selectedUser || !courseId) {
      toast({
        variant: "warning",
        title: "Selection Required",
        description: "Please select both user and course",
      })
      return
    }

    setConfirmDialog({
      isOpen: true,
      title: "Remove from Course",
      message: `Are you sure you want to remove ${selectedUser.name} from this course?`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          console.log(" Removing user from course:", selectedUser.id, courseId)

          // Remove from payments collection
          const paymentsQuery = query(
            collection(db, "payments"),
            where("userId", "==", selectedUser.id),
            where("status", "==", "approved"),
          )
          const paymentsSnapshot = await getDocs(paymentsQuery)

          for (const paymentDoc of paymentsSnapshot.docs) {
            const payment = paymentDoc.data()
            const updatedCourses = payment.courses?.filter((c) => c.id !== courseId) || []

            await updateDoc(doc(db, "payments", paymentDoc.id), {
              courses: updatedCourses,
            })
          }

          // CRITICAL FIX: Also remove from userCourses collection
          const userCourseDocId = `${selectedUser.id}_${courseId}`
          const userCourseRef = doc(db, "userCourses", userCourseDocId)
          
          try {
            await deleteDoc(userCourseRef)
            console.log(` Successfully removed userCourses document: ${userCourseDocId}`)
          } catch (error) {
            console.warn(` userCourses document may not exist: ${userCourseDocId}`, error)
          }

          showSuccess("Student removed from course successfully!")
          await fetchUserEnrollments()
          
          if (!userEnrollments[selectedUser.id] || userEnrollments[selectedUser.id].length <= 1) {
            setShowRemoveModal(false)
            setSelectedUser(null)
          }
        } catch (error) {
          console.error(" Error removing student from course:", error)
          toast({
            variant: "error",
            title: "Removal Failed",
            description: error.message || "Failed to remove student from course",
          })
        }
      }
    })
  }

  const toggleCourseSelection = (courseId) => {
    setSelectedCoursesForGrant(prev => {
      if (prev.includes(courseId)) {
        return prev.filter(id => id !== courseId)
      } else {
        return [...prev, courseId]
      }
    })
  }

  const getAvailableCoursesForUser = (userId) => {
    const enrolledCourseIds = userEnrollments[userId]?.map(e => e.id) || []
    return courses.filter(c => !enrolledCourseIds.includes(c.id))
  }

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Manage Users</h1>
            <p className="text-muted-foreground">View and manage all platform users</p>
          </div>
        </div>
      </motion.div>

      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm"
        >
          {successMessage}
        </motion.div>
      )}

      <div className="bg-card border border-border rounded-xl p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs sm:text-sm font-semibold whitespace-nowrap">
                    User
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs sm:text-sm font-semibold whitespace-nowrap">
                    Email
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs sm:text-sm font-semibold whitespace-nowrap">
                    Role
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs sm:text-sm font-semibold whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs sm:text-sm font-semibold whitespace-nowrap">
                    Devices
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-right text-xs sm:text-sm font-semibold whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/50">
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          {user.photoURL ? (
                            <img
                              src={user.photoURL || "/placeholder.svg"}
                              alt={user.name}
                              className="w-full h-full rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-primary font-semibold text-xs sm:text-sm">
                              {user.name?.[0] || "U"}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                          {user.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-muted-foreground">
                      <span className="truncate block max-w-[150px] sm:max-w-none">{user.email}</span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      <span
                        className={`px-2 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-medium whitespace-nowrap ${
                          user.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted-foreground/10 text-muted-foreground"
                        }`}
                      >
                        {user.role === "admin" ? "admin" : "user"}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      <span
                        className={`px-2 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-medium whitespace-nowrap ${
                          user.banned
                            ? "bg-red-500/10 text-red-500"
                            : user.online
                              ? "bg-green-500/10 text-green-500"
                              : "bg-muted-foreground/10 text-muted-foreground"
                        }`}
                      >
                        {user.banned ? "Banned" : user.online ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      <span className="text-xs sm:text-sm font-medium">
                        {user.devices?.length || 0}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center justify-end gap-1 sm:gap-2 flex-wrap">
                        {user.role === "admin" ? (
                          <button
                            onClick={() => handleDemoteToUser(user.id)}
                            className="px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium text-orange-500 border border-orange-500/20 flex items-center gap-1"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Demote</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePromoteToAdmin(user.id)}
                            className="px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium text-primary border border-primary/20 flex items-center gap-1"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Promote</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedUser(user)
                            setShowUserDetailsModal(true)
                          }}
                          className="px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium text-blue-500 border border-blue-500/20 flex items-center gap-1"
                        >
                          <Info className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Info</span>
                        </button>
                        <button
                          onClick={() => handleBanUser(user.id, user.banned)}
                          className={`px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium border flex items-center gap-1 ${
                            user.banned 
                              ? "text-green-500 border-green-500/20" 
                              : "text-yellow-500 border-yellow-500/20"
                          }`}
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{user.banned ? "Unban" : "Ban"}</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(user)
                            setSelectedCoursesForGrant([])
                            setShowGrantAccessModal(true)
                          }}
                          className="px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium text-green-500 border border-green-500/20 flex items-center gap-1"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Grant Access</span>
                        </button>
                        {userEnrollments[user.id] && userEnrollments[user.id].length > 0 && (
                          <button
                            onClick={() => {
                              setSelectedUser(user)
                              setShowRemoveModal(true)
                            }}
                            className="px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium text-blue-500 border border-blue-500/20 flex items-center gap-1 relative"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Manage Courses</span>
                            <span className="ml-1 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] rounded-full font-bold">
                              {userEnrollments[user.id].length}
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-xs font-medium text-red-500 border border-red-500/20 flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredUsers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No users found</p>
            </div>
          )}
        </div>
      )}

      {showGrantAccessModal && selectedUser && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Grant Course Access</h2>
              <button
                onClick={() => {
                  setShowGrantAccessModal(false)
                  setSelectedUser(null)
                  setSelectedCoursesForGrant([])
                }}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                {selectedUser.photoURL ? (
                  <img
                    src={selectedUser.photoURL}
                    alt={selectedUser.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-primary font-semibold text-lg">
                      {selectedUser.name?.[0] || "U"}
                    </span>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-lg">{selectedUser.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                </div>
              </div>
            </div>

            {getAvailableCoursesForUser(selectedUser.id).length > 0 ? (
              <>
                <div className="space-y-3 mb-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    Select courses to grant access ({getAvailableCoursesForUser(selectedUser.id).length} available)
                  </p>
                  <div className="max-h-[400px] overflow-y-auto space-y-2">
                    {getAvailableCoursesForUser(selectedUser.id).map((course) => (
                      <div
                        key={course.id}
                        onClick={() => toggleCourseSelection(course.id)}
                        className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-all ${
                          selectedCoursesForGrant.includes(course.id)
                            ? 'bg-primary/10 border-primary'
                            : 'bg-background border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex-1">
                          <h3 className="font-semibold mb-1">{course.title}</h3>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Price: ৳{course.price || 0}</span>
                            {course.instructor && <span>Instructor: {course.instructor}</span>}
                          </div>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          selectedCoursesForGrant.includes(course.id)
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground/30'
                        }`}>
                          {selectedCoursesForGrant.includes(course.id) && (
                            <Check className="w-4 h-4 text-white" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowGrantAccessModal(false)
                      setSelectedUser(null)
                      setSelectedCoursesForGrant([])
                    }}
                    className="flex-1 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGrantAccess}
                    disabled={selectedCoursesForGrant.length === 0 || grantingAccess}
                    className="flex-1 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {grantingAccess ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Granting...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        Grant Access ({selectedCoursesForGrant.length})
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No available courses to grant access</p>
                <p className="text-sm mt-2">This user is already enrolled in all courses</p>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {showRemoveModal && selectedUser && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Manage Course Enrollments</h2>
              <button
                onClick={() => {
                  setShowRemoveModal(false)
                  setSelectedUser(null)
                }}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                {selectedUser.photoURL ? (
                  <img
                    src={selectedUser.photoURL}
                    alt={selectedUser.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-primary font-semibold text-lg">
                      {selectedUser.name?.[0] || "U"}
                    </span>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-lg">{selectedUser.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                </div>
              </div>
            </div>

            {userEnrollments[selectedUser.id] && userEnrollments[selectedUser.id].length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground mb-3">
                  Enrolled in {userEnrollments[selectedUser.id].length} course(s)
                </p>
                {userEnrollments[selectedUser.id].map((enrollment) => (
                  <div
                    key={enrollment.id}
                    className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:border-primary/50 transition-colors"
                  >
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{enrollment.title}</h3>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Price: ৳{enrollment.price || 0}</span>
                        {enrollment.enrolledAt && (
                          <span>
                            Enrolled: {new Date(enrollment.enrolledAt.seconds * 1000).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveFromCourse(enrollment.id)}
                      className="ml-4 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>This user is not enrolled in any courses</p>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-border">
              <button
                onClick={() => {
                  setShowRemoveModal(false)
                  setSelectedUser(null)
                }}
                className="w-full py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showUserDetailsModal && selectedUser && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">User Details</h2>
              <button
                onClick={() => {
                  setShowUserDetailsModal(false)
                  setSelectedUser(null)
                }}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                {selectedUser.photoURL ? (
                  <img
                    src={selectedUser.photoURL}
                    alt={selectedUser.name}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-primary font-semibold text-2xl">
                      {selectedUser.name?.[0] || "U"}
                    </span>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-xl">{selectedUser.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Role: <span className="font-medium">{selectedUser.role || 'user'}</span>
                  </p>
                </div>
              </div>
            </div>

            {(selectedUser.banned || selectedUser.permanentBan || selectedUser.banCount > 0) && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  Ban Information
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <p className="font-semibold">
                          {selectedUser.permanentBan ? (
                            <span className="text-red-500">Permanently Banned</span>
                          ) : selectedUser.banned ? (
                            <span className="text-yellow-500">Temporarily Banned</span>
                          ) : (
                            <span className="text-green-500">Active</span>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Ban Count</p>
                        <p className="font-semibold">{selectedUser.banCount || 0}</p>
                      </div>
                      {selectedUser.banExpiresAt && !selectedUser.permanentBan && (
                        <div className="col-span-2">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Time Remaining
                          </p>
                          <p className="font-semibold text-yellow-600">
                            {formatTimeRemaining(selectedUser.banExpiresAt)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedUser.banHistory && selectedUser.banHistory.length > 0 && (
                    <details className="p-4 bg-muted rounded-lg">
                      <summary className="cursor-pointer font-medium">Ban History ({selectedUser.banHistory.length})</summary>
                      <div className="mt-3 space-y-2">
                        {selectedUser.banHistory.map((ban, idx) => (
                          <div key={idx} className="text-sm border-b border-border pb-2 last:border-0">
                            <p className="font-medium">Ban #{idx + 1}</p>
                            <p className="text-muted-foreground">Reason: {ban.reason}</p>
                            {ban.ipAddress && (
                              <p className="text-muted-foreground">
                                <span className="font-semibold text-blue-500">IP Address:</span> {ban.ipAddress}
                              </p>
                            )}
                            <p className="text-muted-foreground">
                              Date: {new Date(ban.timestamp).toLocaleString()}
                            </p>
                            {ban.bannedUntil && (
                              <p className="text-muted-foreground">
                                Until: {new Date(ban.bannedUntil).toLocaleString()}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {selectedUser.devices && selectedUser.devices.length > 0 && (
                    <details className="p-4 bg-muted rounded-lg">
                      <summary className="cursor-pointer font-medium">Devices ({selectedUser.devices.length})</summary>
                      <div className="mt-3 space-y-2">
                        {selectedUser.devices.map((device, idx) => (
                          <div key={idx} className="text-sm border-b border-border pb-2 last:border-0">
                            <p className="font-medium">Device {idx + 1}</p>
                            {device.ipAddress && (
                              <p className="text-muted-foreground">
                                <span className="font-semibold text-blue-500">IP Address:</span> {device.ipAddress}
                              </p>
                            )}
                            <p className="text-muted-foreground">Platform: {device.platform}</p>
                            <p className="text-muted-foreground">Resolution: {device.screenResolution}</p>
                            <p className="text-muted-foreground">
                              Last Seen: {new Date(device.timestamp || device.lastSeen).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {(selectedUser.banned || selectedUser.permanentBan) && (
                    <button
                      onClick={() => handleUnbanUser(selectedUser.id)}
                      className="w-full py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                    >
                      <Ban className="w-5 h-5" />
                      Unban User & Clear Devices
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-border">
              <button
                onClick={() => {
                  setShowUserDetailsModal(false)
                  setSelectedUser(null)
                }}
                className="w-full py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
      />
    </div>
  )
}
