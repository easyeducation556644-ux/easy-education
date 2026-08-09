import { Navigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { isAdminPanelUser } from "../lib/adminPermissions"

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { currentUser, userProfile, loading, isBanned } = useAuth()

  if (loading) {
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
