import { useState, useEffect } from "react"
import { Link, Navigate } from "react-router-dom"
import { motion } from "framer-motion"
import {
  ThumbsUp,
  TrendingUp,
  Download,
  CreditCard,
  CheckCircle,
  Clock,
  XCircle,
  Zap,
  Award,
  Target,
  BookOpen,
  GraduationCap,
  Star,
} from "lucide-react"
import { collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import DashboardLayout from "../components/DashboardLayout"

export default function Dashboard() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const [stats, setStats] = useState({
    votesGiven: 0,
    coursesEnrolled: 0,
    pendingPayments: 0,
    approvedPayments: 0,
  })
  const [recentPayments, setRecentPayments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (currentUser) {
      fetchUserStats()
    }
  }, [currentUser])

  const fetchUserStats = async () => {
    try {
      const votesQuery = query(collection(db, "votes"), where("userId", "==", currentUser.uid))
      const votesSnapshot = await getDocs(votesQuery)

      const paymentsQuery = query(collection(db, "payments"), where("userId", "==", currentUser.uid))
      const paymentsSnapshot = await getDocs(paymentsQuery)
      const paymentsData = paymentsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

      paymentsData.sort((a, b) => {
        const dateA = a.submittedAt?.toDate?.() || new Date(0)
        const dateB = b.submittedAt?.toDate?.() || new Date(0)
        return dateB - dateA
      })

      const approvedPayments = paymentsData.filter((p) => p.status === "approved")
      const pendingPayments = paymentsData.filter((p) => p.status === "pending")

      setRecentPayments(paymentsData.slice(0, 5))
      setStats({
        votesGiven: votesSnapshot.size,
        coursesEnrolled: approvedPayments.length,
        pendingPayments: pendingPayments.length,
        approvedPayments: approvedPayments.length,
      })
    } catch (error) {
      console.error("Error fetching user stats:", error)
    } finally {
      setLoading(false)
    }
  }

  if (!currentUser) {
    return <Navigate to="/login" />
  }

  const getStatusColor = (status) => {
    switch (status) {
      case "approved":
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
      case "pending":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
      case "rejected":
        return "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20"
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="w-4 h-4" />
      case "pending":
        return <Clock className="w-4 h-4" />
      case "rejected":
        return <XCircle className="w-4 h-4" />
      default:
        return null
    }
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-accent/5 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              Welcome back, {userProfile?.name || "Student"}!
            </h1>
            <p className="text-muted-foreground text-lg">Here's your learning journey at a glance</p>
          </motion.div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary border-t-accent"></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 }}
                  className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 rounded-2xl p-6 hover:shadow-xl transition-all duration-300 group"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-blue-500/10 rounded-xl group-hover:bg-blue-500/20 transition-colors">
                      <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <TrendingUp className="w-5 h-5 text-blue-600/50" />
                  </div>
                  <p className="text-3xl font-bold mb-1 text-blue-700 dark:text-blue-400">{stats.coursesEnrolled}</p>
                  <p className="text-sm text-muted-foreground font-medium">Courses Enrolled</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-2xl p-6 hover:shadow-xl transition-all duration-300 group"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-purple-500/10 rounded-xl group-hover:bg-purple-500/20 transition-colors">
                      <ThumbsUp className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <Star className="w-5 h-5 text-purple-600/50" />
                  </div>
                  <p className="text-3xl font-bold mb-1 text-purple-700 dark:text-purple-400">{stats.votesGiven}</p>
                  <p className="text-sm text-muted-foreground font-medium">Votes Given</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                  className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-2xl p-6 hover:shadow-xl transition-all duration-300 group"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-amber-500/10 rounded-xl group-hover:bg-amber-500/20 transition-colors">
                      <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <Zap className="w-5 h-5 text-amber-600/50" />
                  </div>
                  <p className="text-3xl font-bold mb-1 text-amber-700 dark:text-amber-400">{stats.pendingPayments}</p>
                  <p className="text-sm text-muted-foreground font-medium">Pending Payments</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-2xl p-6 hover:shadow-xl transition-all duration-300 group"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-emerald-500/10 rounded-xl group-hover:bg-emerald-500/20 transition-colors">
                      <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <Award className="w-5 h-5 text-emerald-600/50" />
                  </div>
                  <p className="text-3xl font-bold mb-1 text-emerald-700 dark:text-emerald-400">{stats.approvedPayments}</p>
                  <p className="text-sm text-muted-foreground font-medium">Approved Payments</p>
                </motion.div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-card border border-border rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Quick Actions</h2>
                    <Target className="w-5 h-5 text-primary" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Link to="/my-courses">
                      <button className="w-full p-4 bg-gradient-to-br from-primary/10 to-accent/10 hover:from-primary/20 hover:to-accent/20 border border-primary/20 rounded-xl transition-all text-left group">
                        <GraduationCap className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
                        <p className="font-semibold text-sm">My Courses</p>
                        <p className="text-xs text-muted-foreground">Continue learning</p>
                      </button>
                    </Link>
                    <Link to="/payment-history">
                      <button className="w-full p-4 bg-gradient-to-br from-primary/10 to-accent/10 hover:from-primary/20 hover:to-accent/20 border border-primary/20 rounded-xl transition-all text-left group">
                        <CreditCard className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
                        <p className="font-semibold text-sm">Payment History</p>
                        <p className="text-xs text-muted-foreground">View transactions</p>
                      </button>
                    </Link>
                    <Link to="/courses">
                      <button className="w-full p-4 bg-gradient-to-br from-primary/10 to-accent/10 hover:from-primary/20 hover:to-accent/20 border border-primary/20 rounded-xl transition-all text-left group">
                        <BookOpen className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
                        <p className="font-semibold text-sm">Browse Courses</p>
                        <p className="text-xs text-muted-foreground">Explore new content</p>
                      </button>
                    </Link>
                    <Link to="/profile">
                      <button className="w-full p-4 bg-gradient-to-br from-primary/10 to-accent/10 hover:from-primary/20 hover:to-accent/20 border border-primary/20 rounded-xl transition-all text-left group">
                        <Award className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
                        <p className="font-semibold text-sm">My Profile</p>
                        <p className="text-xs text-muted-foreground">Update info</p>
                      </button>
                    </Link>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="bg-card border border-border rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Recent Payments</h2>
                    <CreditCard className="w-5 h-5 text-primary" />
                  </div>
                  {recentPayments.length > 0 ? (
                    <div className="space-y-3">
                      {recentPayments.map((payment, index) => (
                        <div
                          key={payment.id}
                          className="p-4 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">৳{payment.finalAmount}</p>
                            <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(payment.status)}`}>
                              {getStatusIcon(payment.status)}
                              {payment.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {payment.courses?.length || 0} course(s) • {payment.submittedAt?.toDate?.()?.toLocaleDateString() || "N/A"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CreditCard className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-muted-foreground">No payments yet</p>
                    </div>
                  )}
                </motion.div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
