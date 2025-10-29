"use client"

import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { CheckCircle, Loader2, AlertCircle, Home, BookOpen } from "lucide-react"
import { useAuth } from "../contexts/AuthContext"
import { sendLocalNotification } from "../lib/pwa"
import { toast } from "../hooks/use-toast"

export default function PaymentSuccess() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(true)
  const [paymentData, setPaymentData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!currentUser) {
      navigate("/login")
      return
    }

    // ZiniPay returns both invoiceId and transactionId
    const invoiceId = searchParams.get('invoiceId') || searchParams.get('invoice_id')
    const transactionId = searchParams.get('transactionId') || searchParams.get('transaction_id')
    const status = searchParams.get('status')

    if (!invoiceId && !transactionId) {
      setError("No payment ID found in redirect URL")
      setLoading(false)
      setVerifying(false)
      return
    }

    if (status && status !== 'COMPLETED' && status !== 'completed') {
      setError("Payment was not completed successfully")
      setLoading(false)
      setVerifying(false)
      return
    }

    verifyAndProcessPayment(invoiceId, transactionId)
  }, [currentUser, searchParams, navigate])

  const verifyAndProcessPayment = async (invoiceId, transactionId) => {
    try {
      setVerifying(true)

      console.log('[PaymentSuccess] Verifying payment with:', { invoiceId, transactionId });

      // Send both IDs to the backend, preferring invoiceId but including transactionId for backward compatibility
      const enrollmentResponse = await fetch('/api/process-enrollment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          invoiceId: invoiceId || transactionId,
          transaction_id: transactionId || invoiceId,
          userId: currentUser.uid
        })
      })

      const enrollmentData = await enrollmentResponse.json()
      console.log('[PaymentSuccess] Enrollment response:', enrollmentData);

      if (!enrollmentData.success || !enrollmentData.verified) {
        const errorMessage = enrollmentData.error || "Payment verification failed";
        console.error('[PaymentSuccess] Verification failed:', errorMessage);
        setError(errorMessage)
        setVerifying(false)
        setLoading(false)
        return
      }

      const paymentRecord = enrollmentData.paymentRecord || {
        transactionId: enrollmentData.payment.transaction_id,
        finalAmount: enrollmentData.payment.amount,
        courses: enrollmentData.payment.metadata?.courses || []
      }

      setPaymentData(paymentRecord)

      if (!enrollmentData.alreadyProcessed) {
        const courses = paymentRecord.courses || []
        sendLocalNotification('Payment Successful! 🎉', {
          body: `Your payment of ৳${enrollmentData.payment.amount} has been confirmed. You now have access to ${courses.length} course(s).`,
          tag: 'payment-success',
          requireInteraction: false
        })

        toast({
          variant: "success",
          title: "Payment Successful!",
          description: `You now have access to ${courses.length} course(s).`,
        })
      }

    } catch (error) {
      console.error("Error processing payment:", error)
      setError("Failed to process payment. Please contact support.")
    } finally {
      setVerifying(false)
      setLoading(false)
    }
  }

  if (loading || verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
          <h2 className="text-2xl font-bold mb-2">Verifying Payment...</h2>
          <p className="text-muted-foreground">Please wait while we confirm your payment</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-card border border-border rounded-lg p-8 text-center"
        >
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2 text-red-600 dark:text-red-400">Payment Error</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <button
            onClick={() => navigate("/courses")}
            className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Courses
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-card border border-border rounded-lg p-8"
      >
        <div className="text-center mb-6">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2 text-green-600 dark:text-green-400">Payment Successful!</h2>
          <p className="text-muted-foreground">Your payment has been confirmed</p>
        </div>

        {paymentData && (
          <div className="space-y-4 mb-6">
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Transaction ID:</span>
                <span className="font-mono font-semibold">{paymentData.transactionId}</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Amount Paid:</span>
                <span className="font-semibold">৳{paymentData.finalAmount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Courses:</span>
                <span className="font-semibold">{paymentData.courses?.length || 0}</span>
              </div>
            </div>

            {paymentData.courses && paymentData.courses.length > 0 && (
              <div className="border border-border rounded-lg p-4">
                <h3 className="font-semibold mb-2 text-sm">Enrolled Courses:</h3>
                <ul className="space-y-1">
                  {paymentData.courses.map((course, index) => (
                    <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span>{course.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => navigate("/my-courses")}
            className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <BookOpen className="w-4 h-4" />
            Go to My Courses
          </button>
          <button
            onClick={() => navigate("/")}
            className="w-full px-6 py-3 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" />
            Back to Home
          </button>
        </div>
      </motion.div>
    </div>
  )
}
