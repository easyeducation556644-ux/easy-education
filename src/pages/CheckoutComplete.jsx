"use client"

import { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { CheckCircle, Clock, Home, Sparkles, ArrowRight, BookOpen, Loader2 } from "lucide-react"
import { useAuth } from "../contexts/AuthContext"

export default function CheckoutComplete() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAuth()
  const [timeRemaining, setTimeRemaining] = useState(24)
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
  
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining((prev) => (prev > 0 ? prev - 1 : 0))
    }, 3600000)
    
    return () => clearInterval(timer)
  }, [])
  
  const steps = [
    { number: 1, title: "Payment Verified", description: "Our team checks your transaction" },
    { number: 2, title: "Approval Pending", description: "Admin review in progress", active: true },
    { number: 3, title: "Access Granted", description: "Courses unlocked for you" },
  ]
  
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
            className="text-2xl sm:text-3xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"
          >
            Payment Submitted!
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-muted-foreground mb-6 text-sm sm:text-base"
          >
            Your payment has been received and is pending admin approval.
          </motion.p>

          {/* Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 rounded-xl p-4 mb-6"
          >
            <div className="flex items-center gap-3 justify-center flex-wrap">
              <Clock className="w-5 h-5 text-primary flex-shrink-0" />
              <div>
                <p className="font-semibold text-primary text-sm sm:text-base">Status: Pending</p>
                <p className="text-xs text-primary/70">Awaiting admin approval</p>
              </div>
            </div>
          </motion.div>

          {/* Progress Steps */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="mb-8"
          >
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {steps.map((step, index) => (
                <div key={step.number} className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm mb-2 transition-all ${
                      step.active
                        ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                        : index < 1
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {step.number}
                  </div>
                  <p className="text-xs font-medium line-clamp-2">{step.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{step.description}</p>
                </div>
              ))}
            </div>
          </motion.div>

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

          {/* Info Box */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
            className="bg-muted/50 rounded-xl p-4 mb-8 text-left"
          >
            <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm sm:text-base">
              <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
              What happens next?
            </h3>
            <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-primary font-bold flex-shrink-0">1.</span>
                <span>Our admin team will verify your payment</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold flex-shrink-0">2.</span>
                <span>You'll receive an email confirmation</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold flex-shrink-0">3.</span>
                <span>Access your courses in "My Courses"</span>
              </li>
            </ul>
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="space-y-3"
          >
            <button
              onClick={() => navigate("/dashboard")}
              className="w-full py-2.5 sm:py-3 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-primary-foreground rounded-lg transition-all font-medium flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Home className="w-4 h-4 flex-shrink-0" />
              Go to Dashboard
              <ArrowRight className="w-4 h-4 flex-shrink-0" />
            </button>
            <button
              onClick={() => navigate("/my-courses")}
              className="w-full py-2.5 sm:py-3 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium text-sm sm:text-base"
            >
              View My Courses
            </button>
          </motion.div>

          <p className="text-xs text-muted-foreground mt-6">Typically approved within {timeRemaining} hours</p>
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