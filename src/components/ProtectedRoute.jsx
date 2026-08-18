import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { isAdminPanelUser } from "../lib/adminPermissions"

const AUTH_LOADING_RECOVERY_MS = 15000

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { currentUser, userProfile, loading, isBanned } = useAuth()
  const [loadingTimedOut, setLoadingTimedOut] = useState(false)

  useEffect(() => {
    if (!loading) {
      setLoadingTimedOut(false)
      return undefined
    }

    const timer = window.setTimeout(() => setLoadingTimedOut(true), AUTH_LOADING_RECOVERY_MS)
    return () => window.clearTimeout(timer)
  }, [loading])

  if (loading) {
    if (loadingTimedOut) {
      return (
        <div className="min-h-[45vh] px-4 py-12 flex items-center justify-center">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Taking longer than expected</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Your session could not be refreshed in time. Reload the page to retry with a clean connection.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Reload and retry
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-[45vh] px-4 py-8">
        <div className="container mx-auto max-w-5xl animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-72 max-w-full rounded bg-muted" />
          <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="h-28 rounded-lg bg-muted" />
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  if (isBanned) {
    return (
      <div className="min-h-screen bg-background">
        {/* Empty container - BanOverlay from AuthContext will show on top */}
      </div>
    )
  }

  if (adminOnly && !isAdminPanelUser(userProfile)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
