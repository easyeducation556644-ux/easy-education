"use client"
import { toast } from "../../hooks/use-toast"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { CreditCard, Check, X, Clock, Download, Trash2 } from "lucide-react"
import { collection, getDocs, updateDoc, doc, setDoc, serverTimestamp, query, orderBy, deleteDoc } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { sendPaymentConfirmationEmail } from "../../lib/email"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManagePayments() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  useEffect(() => {
    fetchPayments()
  }, [])

  const fetchPayments = async () => {
    try {
      const q = query(collection(db, "payments"), orderBy("submittedAt", "desc"))
      const snapshot = await getDocs(q)
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setPayments(data)
    } catch (error) {
      console.error("Error fetching payments:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (payment) => {
    setConfirmDialog({
      isOpen: true,
      title: "Approve Payment",
      message: "Approve this payment and grant course access?",
      variant: "default",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "payments", payment.id), {
            status: "approved",
            approvedAt: serverTimestamp(),
          })

          for (const course of payment.courses) {
            await setDoc(doc(db, "userCourses", `${payment.userId}_${course.id}`), {
              userId: payment.userId,
              courseId: course.id,
              enrolledAt: serverTimestamp(),
              progress: 0,
            })
          }

          try {
            await sendPaymentConfirmationEmail(payment.userEmail, payment.userName, {
              courses: payment.courses,
              subtotal: payment.subtotal,
              discount: payment.discount || 0,
              finalAmount: payment.finalAmount,
              transactionId: payment.transactionId
            })
          } catch (error) {
            console.error('Email notification failed:', error)
          }

          toast({
            title: "Success",
            description: "Payment approved and course access granted!",
          })
          fetchPayments()
        } catch (error) {
          console.error("Error approving payment:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to approve payment. Check console for details.",
          })
        }
      }
    })
  }

  const handleReject = async (paymentId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Reject Payment",
      message: "Are you sure you want to reject this payment? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "payments", paymentId), {
            status: "rejected",
            rejectedAt: serverTimestamp(),
            rejectionReason: "Payment verification failed",
          })

          toast({
            title: "Success",
            description: "Payment rejected successfully!",
          })
          fetchPayments()
        } catch (error) {
          console.error("Error rejecting payment:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to reject payment",
          })
        }
      }
    })
  }

  const handleDelete = async (paymentId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Payment",
      message: "Are you sure you want to permanently delete this rejected payment? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "payments", paymentId))

          toast({
            title: "Success",
            description: "Payment deleted successfully!",
          })
          fetchPayments()
        } catch (error) {
          console.error("Error deleting payment:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete payment",
          })
        }
      }
    })
  }

  const exportToCSV = () => {
    const approvedPayments = payments.filter(p => p.status === "approved")
    
    if (approvedPayments.length === 0) {
      toast({
        variant: "error",
        title: "No Data",
        description: "No completed payments to export",
      })
      return
    }

    const headers = ["Name", "Email", "Sender Number", "Transaction ID", "Amount", "Courses", "Approved At"]
    const rows = approvedPayments.map(payment => [
      payment.userName,
      payment.userEmail,
      payment.senderNumber,
      payment.transactionId,
      payment.finalAmount,
      payment.courses?.map(c => c.title).join("; ") || "",
      payment.approvedAt?.toDate?.()?.toLocaleString() || ""
    ])

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    
    link.setAttribute("href", url)
    link.setAttribute("download", `completed_payments_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast({
      title: "Success",
      description: `Exported ${approvedPayments.length} completed payments`,
    })
  }

  const filteredPayments = payments.filter((payment) => {
    if (filter === "all") return true
    return payment.status === filter
  })

  const getStatusBadge = (status) => {
    const styles = {
      pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
      approved: "bg-green-500/10 text-green-600 border-green-500/20",
      rejected: "bg-red-500/10 text-red-600 border-red-500/20",
    }
    const icons = {
      pending: Clock,
      approved: Check,
      rejected: X,
    }
    const Icon = icons[status] || Clock

    return (
      <span
        className={`px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || styles.pending} flex items-center gap-1 w-fit`}
      >
        <Icon className="w-4 h-4" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <CreditCard className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
          Manage Payments
        </h1>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <div className="flex flex-wrap gap-2">
            {["all", "pending", "approved", "rejected"].map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-3 sm:px-4 py-2 rounded-lg transition-colors capitalize text-xs sm:text-sm font-medium ${
                  filter === status ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                }`}
              >
                {status} ({payments.filter((p) => status === "all" || p.status === status).length})
              </button>
            ))}
          </div>
          <button
            onClick={exportToCSV}
            className="px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Completed
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {filteredPayments.map((payment) => (
          <motion.div
            key={payment.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4 sm:p-6"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base sm:text-lg mb-1 truncate">{payment.userName}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground truncate">{payment.userEmail}</p>
                </div>
                {getStatusBadge(payment.status)}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-1">Sender Number</p>
                  <p className="font-medium text-sm sm:text-base break-all">{payment.senderNumber}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-1">Transaction ID</p>
                  <p className="font-medium font-mono text-xs sm:text-sm break-all">{payment.transactionId}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-1">Submitted At</p>
                  <p className="font-medium text-xs sm:text-sm">
                    {payment.submittedAt?.toDate?.()?.toLocaleString() || "Recently"}
                  </p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-1">Amount</p>
                  <p className="font-bold text-primary text-base sm:text-lg">৳{payment.finalAmount}</p>
                  {payment.couponCode && (
                    <p className="text-xs text-green-600">
                      Coupon: {payment.couponCode} (-{payment.discountPercent}%)
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs sm:text-sm text-muted-foreground mb-2">
                  Courses ({payment.courses?.length || 0})
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {payment.courses?.map((course, index) => (
                    <div key={index} className="text-xs sm:text-sm flex justify-between gap-2">
                      <span className="truncate">{course.title}</span>
                      <span className="text-muted-foreground flex-shrink-0">৳{course.price}</span>
                    </div>
                  ))}
                </div>
              </div>

              {payment.rejectionReason && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-xs sm:text-sm text-red-600">
                    <strong>Rejection Reason:</strong> {payment.rejectionReason}
                  </p>
                </div>
              )}

              {payment.status === "pending" && (
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => handleApprove(payment)}
                    className="flex-1 px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-xs sm:text-sm font-medium"
                  >
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(payment.id)}
                    className="flex-1 px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-xs sm:text-sm font-medium"
                  >
                    <X className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              )}

              {payment.status === "rejected" && (
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => handleDelete(payment.id)}
                    className="flex-1 px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-xs sm:text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {filteredPayments.length === 0 && (
        <div className="text-center py-12">
          <CreditCard className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm sm:text-base text-muted-foreground">No {filter !== "all" && filter} payments found</p>
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
