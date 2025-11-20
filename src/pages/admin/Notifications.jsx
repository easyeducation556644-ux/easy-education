"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Bell, Check, CheckCheck, Trash2, ExternalLink, DollarSign, GraduationCap } from "lucide-react"
import { collection, getDocs, updateDoc, deleteDoc, doc, query, orderBy, limit } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import { useNavigate } from "react-router-dom"
import { format } from "date-fns"

export default function Notifications() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all") // all, unread, read

  useEffect(() => {
    fetchNotifications()
  }, [])

  const fetchNotifications = async () => {
    try {
      const notificationsQuery = query(
        collection(db, "notifications"),
        orderBy("createdAt", "desc"),
        limit(100)
      )
      const snapshot = await getDocs(notificationsQuery)
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      setNotifications(data)
    } catch (error) {
      console.error("Error fetching notifications:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load notifications",
      })
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (notificationId) => {
    try {
      await updateDoc(doc(db, "notifications", notificationId), {
        isRead: true,
      })
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      )
    } catch (error) {
      console.error("Error marking notification as read:", error)
    }
  }

  const markAllAsRead = async () => {
    try {
      const unreadNotifications = notifications.filter((n) => !n.isRead)
      for (const notification of unreadNotifications) {
        await updateDoc(doc(db, "notifications", notification.id), {
          isRead: true,
        })
      }
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      toast({
        title: "Success",
        description: "All notifications marked as read",
      })
    } catch (error) {
      console.error("Error marking all as read:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to mark all as read",
      })
    }
  }

  const deleteNotification = async (notificationId) => {
    try {
      await deleteDoc(doc(db, "notifications", notificationId))
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
      toast({
        title: "Success",
        description: "Notification deleted",
      })
    } catch (error) {
      console.error("Error deleting notification:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to delete notification",
      })
    }
  }

  const handleNotificationClick = (notification) => {
    if (!notification.isRead) {
      markAsRead(notification.id)
    }
    if (notification.link) {
      navigate(notification.link)
    }
  }

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.isRead
    if (filter === "read") return n.isRead
    return true
  })

  const unreadCount = notifications.filter((n) => !n.isRead).length

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Notifications</h1>
            <p className="text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}` : "All caught up!"}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
            >
              <CheckCheck className="w-4 h-4" />
              Mark all as read
            </button>
          )}
        </div>
      </motion.div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === "unread"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          Unread ({unreadCount})
        </button>
        <button
          onClick={() => setFilter("read")}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === "read"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-muted"
          }`}
        >
          Read ({notifications.length - unreadCount})
        </button>
      </div>

      {/* Notifications List */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="h-5 bg-muted rounded mb-2 w-3/4"></div>
              <div className="h-4 bg-muted rounded w-full"></div>
            </div>
          ))}
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold mb-2">No notifications</h3>
          <p className="text-muted-foreground">
            {filter === "all"
              ? "You don't have any notifications yet"
              : filter === "unread"
                ? "You don't have any unread notifications"
                : "You don't have any read notifications"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-card border rounded-lg overflow-hidden transition-all ${
                notification.isRead
                  ? "border-border"
                  : "border-primary/30 bg-primary/5"
              }`}
            >
              <div className="p-4">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      notification.isFree
                        ? "bg-green-500/10 text-green-500"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    {notification.isFree ? (
                      <GraduationCap className="w-5 h-5" />
                    ) : (
                      <DollarSign className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-base">{notification.title}</h3>
                      {!notification.isRead && (
                        <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2" />
                      )}
                    </div>
                    
                    <p className="text-sm text-muted-foreground mb-3">
                      {notification.message}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-3">
                      <span>👤 {notification.userName}</span>
                      <span>•</span>
                      <span>📧 {notification.userEmail}</span>
                      {notification.createdAt && (
                        <>
                          <span>•</span>
                          <span>
                            {format(notification.createdAt.toDate(), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </>
                      )}
                    </div>

                    {(notification.approvedBy || notification.rejectedBy || notification.adminName) && (
                      <div className={`p-2 rounded-lg mb-3 text-xs ${
                        notification.approvedBy || notification.adminName
                          ? "bg-green-500/10 text-green-600" 
                          : "bg-red-500/10 text-red-600"
                      }`}>
                        <p className="font-semibold">
                          {notification.approvedBy 
                            ? `✅ Payment approved by: ${notification.approvedBy}`
                            : notification.rejectedBy
                              ? `❌ Payment rejected by: ${notification.rejectedBy}`
                              : notification.adminName
                                ? `👨‍💼 Course access granted by: ${notification.adminName} (${notification.adminEmail || ''})`
                                : ''
                          }
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {notification.link && (
                        <button
                          onClick={() => handleNotificationClick(notification)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors text-sm"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View Details
                        </button>
                      )}
                      
                      {!notification.isRead && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-lg transition-colors text-sm"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Mark as read
                        </button>
                      )}
                      
                      <button
                        onClick={() => deleteNotification(notification.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors text-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
