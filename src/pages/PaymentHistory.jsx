"use client"

import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { CreditCard, ArrowLeft, Calendar, Banknote, CheckCircle, Clock, XCircle, BookOpen } from "lucide-react"
import { useAuth } from "../contexts/AuthContext"
import { collection, query, where, getDocs, orderBy } from "firebase/firestore"
import { db } from "../lib/firebase"
import { Link } from "react-router-dom"

export default function PaymentHistory() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) {
      navigate("/login")
      return
    }
    fetchPayments()
  }, [currentUser, navigate])

  const fetchPayments = async () => {
    try {
      const paymentsQuery = query(
        collection(db, "payments"),
        where("userId", "==", currentUser.uid)
      )
      const paymentsSnapshot = await getDocs(paymentsQuery)
      let paymentsData = paymentsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      
      paymentsData.sort((a, b) => {
        const dateA = a.submittedAt?.toDate?.() || a.createdAt?.toDate?.() || new Date(0)
        const dateB = b.submittedAt?.toDate?.() || b.createdAt?.toDate?.() || new Date(0)
        return dateB - dateA
      })
      
      setPayments(paymentsData)
    } catch (error) {
      console.error("Error fetching payments:", error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case "approved":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
      case "pending":
        return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800"
      case "rejected":
        return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800"
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="w-5 h-5" />
      case "pending":
        return <Clock className="w-5 h-5" />
      case "rejected":
        return <XCircle className="w-5 h-5" />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen py-8 px-4 bg-gradient-to-br from-background via-primary/5 to-background">
      <div className="container-balanced">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </button>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-8">
            <h1 className="text-4xl md:text-5xl font-bold mb-2 flex items-center gap-3 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              <CreditCard className="w-10 h-10 text-primary" />
              Payment History
            </h1>
            <p className="text-muted-foreground text-lg">Track all your payment transactions and status</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary border-t-accent"></div>
            </div>
          ) : payments.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {payments.map((payment, index) => (
                <motion.div
                  key={payment.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:shadow-lg transition-all"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                    {/* Date */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">Date</p>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-primary" />
                        <p className="font-semibold">
                          {payment.submittedAt?.toDate?.()?.toLocaleDateString() || "N/A"}
                        </p>
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">Amount</p>
                      <div className="flex items-center gap-2">
                        <Banknote className="w-5 h-5 text-primary" />
                        <p className="font-semibold">৳{payment.finalAmount?.toFixed(2) || 0}</p>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">Status</p>
                      <div
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-medium text-sm ${getStatusColor(payment.status)}`}
                      >
                        {getStatusIcon(payment.status)}
                        <span className="capitalize">{payment.status}</span>
                      </div>
                    </div>

                    {/* Transaction ID */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">
                        Transaction ID
                      </p>
                      <p className="font-mono text-sm truncate">{payment.transactionId}</p>
                    </div>

                    {/* Courses Count */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">
                        Courses
                      </p>
                      <p className="font-semibold text-lg">{payment.courses?.length || 0}</p>
                    </div>
                  </div>

                  {/* Courses List */}
                  <div className="border-t border-border pt-4">
                    <p className="text-sm font-semibold mb-3">Courses Included</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {payment.courses?.map((course, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
                          <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{course.title}</p>
                            <p className="text-xs text-muted-foreground">৳{course.price || 0}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Discount Info */}
                  {payment.couponCode && (
                    <div className="border-t border-border pt-4 mt-4">
                      <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-200 dark:border-green-800">
                        <div>
                          <p className="text-sm font-medium">Coupon Applied</p>
                          <p className="text-xs text-muted-foreground">{payment.couponCode}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                            -৳{payment.discount?.toFixed(2) || 0}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-card border border-border rounded-xl">
              <CreditCard className="w-20 h-20 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-semibold mb-2">No Payment History</p>
              <p className="text-muted-foreground mb-6">You haven't made any payments yet</p>
              <Link
                to="/courses"
                className="inline-block px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium"
              >
                Browse Courses
              </Link>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
