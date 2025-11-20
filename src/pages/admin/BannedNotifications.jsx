import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { AlertTriangle, Clock, Ban, CheckCircle, User } from "lucide-react"
import { collection, query, orderBy, doc, updateDoc, onSnapshot } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"

export default function BannedNotifications() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")

  useEffect(() => {
    let isMounted = true
    const fetchBanNotifications = () => {
      const notificationsQuery = query(
        collection(db, "banNotifications"),
        orderBy("createdAt", "desc")
      )
      
      const unsubscribe = onSnapshot(
        notificationsQuery,
        (snapshot) => {
          if (!isMounted) return
          try {
            const notificationsData = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
            setNotifications(notificationsData)
            setLoading(false)
          } catch (error) {
            console.error("Error processing notifications:", error)
            if (isMounted) {
              setLoading(false)
            }
          }
        },
        (error) => {
          console.error("Error fetching ban notifications:", error)
          if (isMounted) {
            toast({
              variant: "error",
              title: "Error",
              description: "Failed to fetch ban notifications. Retrying...",
            })
            setLoading(false)
            setNotifications([])
          }
        }
      )

      return unsubscribe
    }

    const unsubscribe = fetchBanNotifications()
    return () => {
      isMounted = false
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const markAsRead = async (notificationId) => {
    try {
      await updateDoc(doc(db, "banNotifications", notificationId), {
        isRead: true,
      })
      setNotifications(
        notifications.map((n) =>
          n.id === notificationId ? { ...n, isRead: true } : n
        )
      )
      toast({
        variant: "success",
        title: "Success",
        description: "Notification marked as read",
      })
    } catch (error) {
      console.error("Error marking notification as read:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to update notification",
      })
    }
  }

  const formatTimeRemaining = (bannedUntil) => {
    if (!bannedUntil) return "Permanent"
    
    const now = new Date()
    const banEnd = new Date(bannedUntil)
    const diff = banEnd - now

    if (diff <= 0) return "Ban expired"

    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m remaining`
    }
    return `${remainingMinutes}m remaining`
  }

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.isRead
    if (filter === "temporary") return n.type === "temporary"
    if (filter === "permanent") return n.type === "permanent"
    return true
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Ban Notifications</h1>
        <p className="text-muted-foreground">
          Monitor and manage user ban notifications
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 md:px-4 py-2 text-sm md:text-base rounded-lg transition-colors ${
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-3 md:px-4 py-2 text-sm md:text-base rounded-lg transition-colors ${
            filter === "unread"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          Unread ({notifications.filter((n) => !n.isRead).length})
        </button>
        <button
          onClick={() => setFilter("temporary")}
          className={`px-3 md:px-4 py-2 text-sm md:text-base rounded-lg transition-colors ${
            filter === "temporary"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          Temporary ({notifications.filter((n) => n.type === "temporary").length})
        </button>
        <button
          onClick={() => setFilter("permanent")}
          className={`px-3 md:px-4 py-2 text-sm md:text-base rounded-lg transition-colors ${
            filter === "permanent"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          Permanent ({notifications.filter((n) => n.type === "permanent").length})
        </button>
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-xl">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Ban Notifications</h3>
          <p className="text-muted-foreground">
            {filter === "all"
              ? "There are no ban notifications"
              : `No ${filter} ban notifications found`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredNotifications.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-card border rounded-xl p-4 md:p-6 ${
                notification.isRead ? "border-border" : "border-red-500/50 bg-red-500/5"
              }`}
            >
              <div className="flex flex-col md:flex-row items-start md:justify-between gap-4">
                <div className="flex items-start gap-3 md:gap-4 flex-1 w-full">
                  <div
                    className={`p-2 md:p-3 rounded-full flex-shrink-0 ${
                      notification.type === "permanent"
                        ? "bg-red-500/10"
                        : "bg-yellow-500/10"
                    }`}
                  >
                    {notification.type === "permanent" ? (
                      <Ban className="w-5 h-5 md:w-6 md:h-6 text-red-500" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 md:w-6 md:h-6 text-yellow-500" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base md:text-lg">
                        {notification.type === "permanent"
                          ? "Permanent Ban Issued"
                          : "Temporary Ban Issued"}
                      </h3>
                      {!notification.isRead && (
                        <span className="px-2 py-1 bg-red-500 text-white text-xs rounded-full">
                          New
                        </span>
                      )}
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{notification.userName}</span>
                        <span className="text-muted-foreground">({notification.userEmail})</span>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Reason:</span>{" "}
                        {notification.reason}
                      </p>

                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Devices:</span>
                          <span className="font-medium">{notification.deviceCount}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Ban Count:</span>
                          <span className="font-medium">{notification.banCount}</span>
                        </div>
                        {notification.bannedUntil && (
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium text-yellow-600">
                              {formatTimeRemaining(notification.bannedUntil)}
                            </span>
                          </div>
                        )}
                      </div>

                      {notification.createdAt && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(notification.createdAt.toDate()).toLocaleString()}
                        </p>
                      )}
                    </div>

                    {notification.devices && notification.devices.length > 0 && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm text-primary hover:underline">
                          View Device Details
                        </summary>
                        <div className="mt-2 space-y-2 text-sm bg-muted p-3 rounded-lg">
                          {notification.devices.map((device, idx) => (
                            <div key={idx} className="border-b border-border pb-2 last:border-0">
                              <p className="font-medium">Device {idx + 1}</p>
                              <p className="text-xs text-muted-foreground">
                                Fingerprint: {device.fingerprint}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Platform: {device.platform}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Resolution: {device.screenResolution}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>

                {!notification.isRead && (
                  <button
                    onClick={() => markAsRead(notification.id)}
                    className="px-3 md:px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-xs md:text-sm whitespace-nowrap w-full md:w-auto"
                  >
                    Mark as Read
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
