"use client"

import { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { CheckCircle, Home, ArrowRight, BookOpen, Loader2 } from "lucide-react"
import { useAuth } from "../contexts/AuthContext"

export default function CheckoutComplete() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAuth()
  const [isProcessing, setIsProcessing] = useState(false)
  const [purchasedCourses, setPurchasedCourses] = useState([])
  
  useEffect(() => {
    if (!currentUser) {
      console.log("[CheckoutComplete] No user found, redirecting to login")
      navigate("/login", { replace: true })
      return
    }
    
    // Get courses from location state (if coming from checkout)
    if (location.state?.courses) {
      setPurchasedCourses(location.state.courses)
    }
    
    // Get transaction_id from URL params (if coming from RupantorPay redirect)
    const urlParams = new URLSearchParams(location.search)
    const transactionId = urlParams.get('transaction_id') || urlParams.get('transactionId')
    
    // If we have a transaction_id but no courses in state, process enrollment
    if (transactionId && !location.state?.courses) {
      processEnrollment(transactionId)
    }
    
    console.log("[CheckoutComplete] Loaded with state:", location.state)
    console.log("[CheckoutComplete] Transaction ID from URL:", transactionId)
  }, [currentUser, navigate, location])
  
  const processEnrollment = async (transactionId) => {
    setIsProcessing(true)
    
    try {
      console.log("[CheckoutComplete] Processing enrollment for transaction:", transactionId)
      
      const response = await fetch('/api/process-enrollment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_id: transactionId,
          userId: currentUser.uid
        })
      })
      
      const data = await response.json()
      console.log("[CheckoutComplete] Enrollment response:", data)
      
      if (data.success) {
        if (data.payment?.metadata?.courses) {
          setPurchasedCourses(data.payment.metadata.courses)
        }
        console.log("[CheckoutComplete] Enrollment processed successfully")
      } else {
        console.error("[CheckoutComplete] Enrollment failed:", data.error)
      }
    } catch (error) {
      console.error("[CheckoutComplete] Error processing enrollment:", error)
    } finally {
      setIsProcessing(false)
    }
  }
  
  
  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-background flex items-center justify-center px-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Processing your enrollment...</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-background flex items-center justify-center px-4 py-8 sm:py-12">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-2xl w-full">
        {/* Main Success Card */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 text-center shadow-xl mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full flex items-center justify-center mx-auto mb-6 relative"
          >
            <CheckCircle className="w-8 h-8 sm:w-12 sm:h-12 text-primary" />
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-accent opacity-30"
            />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-2xl sm:text-3xl font-bold mb-2 bg-gradient-to-r from-green-600 to-green-500 bg-clip-text text-transparent"
          >
            Payment Successful!
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-muted-foreground mb-6 text-sm sm:text-base"
          >
            Your course enrollment has been completed successfully. You can now access your course from your dashboard.
          </motion.p>

          {/* Purchased Courses Section */}
          {purchasedCourses.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-muted/50 rounded-xl p-4 mb-6 text-left"
            >
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm sm:text-base">
                <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                Courses Purchased
              </h3>
              <div className="space-y-2">
                {purchasedCourses.map((course, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs sm:text-sm">
                    <span className="text-primary font-bold flex-shrink-0">•</span>
                    <span className="text-muted-foreground line-clamp-2">{course.title || "Course"}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}


          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="space-y-3"
          >
            <button
              onClick={() => navigate("/my-courses")}
              className="w-full py-2.5 sm:py-3 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-primary-foreground rounded-lg transition-all font-medium flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <BookOpen className="w-4 h-4 flex-shrink-0" />
              Go to My Courses
              <ArrowRight className="w-4 h-4 flex-shrink-0" />
            </button>
            <button
              onClick={() => navigate("/courses")}
              className="w-full py-2.5 sm:py-3 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium text-sm sm:text-base"
            >
              Browse More Courses
            </button>
          </motion.div>
        </div>

        {/* Support Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
          className="bg-card border border-border rounded-xl p-4 sm:p-6 text-center"
        >
          <p className="text-xs sm:text-sm text-muted-foreground mb-3">Having issues with your payment?</p>
          <a
            href="mailto:support@easyeducation.com"
            className="text-primary hover:text-primary/80 font-medium text-xs sm:text-sm transition-colors"
          >
            Contact Support
          </a>
        </motion.div>
      </motion.div>
    </div>
  )
}