import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Chrome } from "lucide-react"
import { useAuth } from "../contexts/AuthContext"

export default function Login() {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const { signInWithGoogle, userProfile, currentUser } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (currentUser && userProfile) {
      console.log(" User already logged in, redirecting...")
      if (userProfile.role === "admin") {
        navigate("/admin", { replace: true })
      } else {
        navigate("/dashboard", { replace: true })
      }
    }
  }, [currentUser, userProfile, navigate])

  const handleGoogleSignIn = async () => {
    setError("")
    setLoading(true)

    try {
      console.log(" Attempting Google login...")
      const { profile } = await signInWithGoogle()
      console.log(" Google login successful, profile:", profile)

      setTimeout(() => {
        if (profile?.role === "admin") {
          console.log(" Redirecting to admin dashboard")
          navigate("/admin", { replace: true })
        } else {
          console.log(" Redirecting to user dashboard")
          navigate("/dashboard", { replace: true })
        }
      }, 200)
    } catch (err) {
      console.error(" Google login error:", err)
      if (err.message === "MANUAL_BAN") {
        setError("Your account has been banned by an admin. Please contact support.")
      } else if (err.message === "TEMP_BAN") {
        setError("Multiple device login detected! Your account has been temporarily banned for 30 minutes.")
      } else if (err.message === "PERMANENT_BAN") {
        setError("Your account has been permanently banned due to multiple violations.")
      } else if (err.code === "auth/popup-closed-by-user") {
        setError("Sign-in popup was closed. Please try again.")
      } else if (err.code === "auth/popup-blocked") {
        setError("Sign-in popup was blocked by your browser. Please allow popups and try again.")
      } else if (err.code === "auth/cancelled-popup-request") {
        setError("Another sign-in popup is already open.")
      } else if (err.code === "auth/network-request-failed") {
        setError("Network error. Please check your internet connection.")
      } else if (err.code === "auth/internal-error") {
        setError("Google Sign-in is not configured properly. Please contact support.")
      } else {
        setError(`Failed to sign in with Google: ${err.message || "Unknown error"}`)
      }
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
              Welcome Back
            </h1>
            <p className="text-muted-foreground">Sign in to continue learning</p>
          </div>

          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <h3 className="font-semibold text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-2">
              ⚠️ গুরুত্বপূর্ণ সতর্কবার্তা
            </h3>
            <div className="text-sm text-yellow-600 dark:text-yellow-300 space-y-1">
              <p>• সর্বোচ্চ <strong>১টি ডিভাইস</strong> থেকে একসাথে লগইন করতে পারবেন</p>
              <p>• ২য় ডিভাইসে লগইন করলে আপনার অ্যাকাউন্ট <strong>৩০ মিনিটের জন্য ব্যান</strong> হবে</p>
              <p>• ৩ বার নিয়ম ভঙ্গ করলে <strong>স্থায়ী ব্যান</strong> হবে</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Chrome className="w-5 h-5" />
            {loading ? "Signing in..." : "Sign in with Google"}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
