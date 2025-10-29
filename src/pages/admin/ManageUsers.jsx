"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, Shield, ShieldOff, Trash2, Ban, BookOpen, X } from "lucide-react"
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageUsers() {
  const [users, setUsers] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [successMessage, setSuccessMessage] = useState("")
  const [courses, setCourses] = useState([])
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedCourse, setSelectedCourse] = useState("")
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
    try {
      console.log(" Toggling ban status for user:", userId, "Current status:", currentBanStatus)
      await updateDoc(doc(db, "users", userId), { banned: !currentBanStatus })
      setUsers(users.map((u) => (u.id === userId ? { ...u, banned: !currentBanStatus } : u)))
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

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Manage Users</h1>
        <p className="text-muted-foreground">View and manage all platform users</p>
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
                      <div className="flex items-center justify-end gap-1 sm:gap-2">
                        {user.role === "admin" ? (
                          <button
                            onClick={() => handleDemoteToUser(user.id)}
                            className="p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors"
                            title="Demote to User"
                          >
                            <ShieldOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-500" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePromoteToAdmin(user.id)}
                            className="p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors"
                            title="Promote to Admin"
                          >
                            <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                          </button>
                        )}
                        <button
                          onClick={() => handleBanUser(user.id, user.banned)}
                          className="p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors"
                          title={user.banned ? "Unban User" : "Ban User"}
                        >
                          <Ban
                            className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${user.banned ? "text-green-500" : "text-yellow-500"}`}
                          />
                        </button>
                        {userEnrollments[user.id] && userEnrollments[user.id].length > 0 && (
                          <button
                            onClick={() => {
                              setSelectedUser(user)
                              setShowRemoveModal(true)
                            }}
                            className="p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors relative"
                            title={`Manage Courses (${userEnrollments[user.id].length})`}
                          >
                            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-500" />
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                              {userEnrollments[user.id].length}
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-1.5 sm:p-2 hover:bg-muted rounded-lg transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500" />
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
