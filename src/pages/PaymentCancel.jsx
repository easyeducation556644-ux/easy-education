"use client"

import { useNavigate, useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { XCircle, ArrowLeft, ShoppingCart } from "lucide-react"

export default function PaymentCancel() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-card border border-border rounded-lg p-8 text-center"
      >
        <XCircle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Payment Cancelled</h2>
        <p className="text-muted-foreground mb-6">
          Checkout was cancelled. If you already sent money, check Payment history or contact support before paying again.
        </p>

        <div className="space-y-3">
          <button
            onClick={() => {
              if (sessionStorage.getItem('ekmivo-pending-order') === params.get('order_id')) {
                sessionStorage.removeItem('ekmivo-payment-attempt')
                sessionStorage.removeItem('ekmivo-pending-order')
              }
              navigate("/checkout")
            }}
            className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-4 h-4" />
            Try Again
          </button>
          <button
            onClick={() => navigate("/courses")}
            className="w-full px-6 py-3 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Courses
          </button>
        </div>
      </motion.div>
    </div>
  )
}
