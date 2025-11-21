import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, Ban, Clock, Smartphone, Trash2, Shield, AlertTriangle, CheckCircle, User, X, MapPin } from "lucide-react"
import { collection, getDocs, doc, updateDoc, query, orderBy, serverTimestamp, addDoc, onSnapshot, deleteField } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useAuth } from "../../contexts/AuthContext"
import { DeviceLocationMap } from "../../components/DeviceLocationMap"

export default function BanManagement() {
  const { userProfile } = useAuth()
  const [users, setUsers] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [selectedUser, setSelectedUser] = useState(null)
  const [showDevicesModal, setShowDevicesModal] = useState(false)
  const [showBanModal, setShowBanModal] = useState(false)
  const [banReason, setBanReason] = useState("")
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  useEffect(() => {
    const unsubscribe = fetchUsers()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  useEffect(() => {
    filterUsers()
  }, [users, searchQuery, filter])

  const fetchUsers = () => {
    setLoading(true)
    const usersQuery = query(collection(db, "users"), orderBy("createdAt", "desc"))
    
    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const usersData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        setUsers(usersData)
        setLoading(false)
      },
      (error) => {
        console.error("Error fetching users:", error)
        toast({
          variant: "error",
          title: "Error",
          description: "Failed to fetch users",
        })
        setLoading(false)
      }
    )

    return unsubscribe
  }

  const filterUsers = () => {
    let filtered = users

    if (searchQuery) {
      filtered = filtered.filter(
        (user) =>
          user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.email?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    if (filter === "banned") {
      filtered = filtered.filter((user) => user.banned === true || user.permanentBan === true)
    } else if (filter === "online") {
      filtered = filtered.filter((user) => user.online === true)
    } else if (filter === "offline") {
      filtered = filtered.filter((user) => user.online === false)
    }

    setFilteredUsers(filtered)
  }

  const handleBanUser = async () => {
    if (!selectedUser || !banReason.trim()) {
      toast({
        variant: "warning",
        title: "Missing Information",
        description: "Please provide a ban reason",
      })
      return
    }

    try {
      const now = new Date()
      const banExpires = new Date(now.getTime() + 30 * 60 * 1000)
      const userData = users.find(u => u.id === selectedUser.id)
      const banHistory = userData?.banHistory || []

      await updateDoc(doc(db, "users", selectedUser.id), {
        banned: true,
        banExpiresAt: banExpires,
        banHistory: [...banHistory, {
          timestamp: now.toISOString(),
          reason: `Manual ban by admin: ${banReason}`,
          adminId: userProfile?.id || 'unknown',
          adminName: userProfile?.name || 'Admin',
          bannedUntil: banExpires.toISOString(),
          type: 'manual'
        }]
      })

      await addDoc(collection(db, "banNotifications"), {
        userId: selectedUser.id,
        userEmail: selectedUser.email,
        userName: selectedUser.name,
        type: 'temporary',
        reason: `Manual ban by admin: ${banReason}`,
        adminId: userProfile?.id || 'unknown',
        adminName: userProfile?.name || 'Admin',
        bannedUntil: banExpires.toISOString(),
        createdAt: serverTimestamp(),
        isRead: false
      })

      toast({
        title: "Success",
        description: `User banned for 30 minutes`,
      })

      setShowBanModal(false)
      setBanReason("")
      setSelectedUser(null)
    } catch (error) {
      console.error("Error banning user:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to ban user",
      })
    }
  }

  const handleUnbanUser = async (user) => {
    setConfirmDialog({
      isOpen: true,
      title: "Unban User",
      message: `Are you sure you want to unban ${user.name}? This will clear all ban records and log them out from all devices. They can log in again immediately.`,
      variant: "default",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "users", user.id), {
            banned: false,
            banExpiresAt: null,
            permanentBan: false,
            banCount: 0,
            banHistory: [],
            devices: [],
            kickedDevices: [],
            forceLogoutAt: serverTimestamp(),
            forceLogoutReason: `Unbanned by ${userProfile?.name || 'Admin'} - You can log in again`,
            forcedBy: userProfile?.id || 'unknown',
            clearBanCacheAt: serverTimestamp()
          })

          toast({
            title: "Success",
            description: "User unbanned successfully. They will be logged out and can log in again immediately.",
          })
        } catch (error) {
          console.error("Error unbanning user:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to unban user",
          })
        }
      }
    })
  }

  const handleKickDevice = async (userId, deviceFingerprint) => {
    setConfirmDialog({
      isOpen: true,
      title: "Kick Device",
      message: "This will remove the device from the user's account and force logout. The user will need to log in again from that device.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          const user = users.find(u => u.id === userId)
          const kickedDevices = (user.kickedDevices || [])
          
          if (!kickedDevices.includes(deviceFingerprint)) {
            kickedDevices.push(deviceFingerprint)
          }
          
          const updatedDevices = (user.devices || []).filter(d => d.fingerprint !== deviceFingerprint)

          const updateData = {
            devices: updatedDevices,
            kickedDevices: kickedDevices,
            forceLogoutAt: serverTimestamp(),
            forceLogoutReason: `Device kicked by ${userProfile?.name || 'Admin'}`,
            forcedBy: userProfile?.id || 'unknown',
            lastActive: serverTimestamp()
          }

          if (updatedDevices.length === 0) {
            updateData.online = false
          }

          await updateDoc(doc(db, "users", userId), updateData)

          toast({
            title: "Success",
            description: "Device kicked successfully. User will be logged out immediately.",
          })
          
          if (selectedUser?.id === userId) {
            setSelectedUser({...user, devices: updatedDevices})
          }
        } catch (error) {
          console.error("Error kicking device:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to kick device",
          })
        }
      }
    })
  }

  const handleLogoutAllUsers = async () => {
    const nonAdminUsers = users.filter(u => u.role !== "admin")
    const onlineCount = nonAdminUsers.filter(u => u.online).length
    
    setConfirmDialog({
      isOpen: true,
      title: "Log Out All Users",
      message: `This will forcefully log out ${nonAdminUsers.length} non-admin users (${onlineCount} currently online) from ALL devices. This action will be logged. Are you absolutely sure?`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          let successCount = 0
          let failCount = 0
          const failedUsers = []
          const BATCH_SIZE = 10
          
          const logoutTimestamp = new Date().toISOString()
          
          for (let i = 0; i < nonAdminUsers.length; i += BATCH_SIZE) {
            const batch = nonAdminUsers.slice(i, i + BATCH_SIZE)
            const promises = batch.map(async (user) => {
              try {
                await updateDoc(doc(db, "users", user.id), {
                  devices: [],
                  kickedDevices: [],
                  online: false,
                  lastActive: serverTimestamp(),
                  forceLogoutAt: serverTimestamp(),
                  forceLogoutReason: `Mass logout by ${userProfile?.name || 'Admin'}`,
                  forcedBy: userProfile?.id || 'unknown',
                  clearBanCacheAt: serverTimestamp()
                })
                successCount++
              } catch (error) {
                console.error(`Error logging out user ${user.name}:`, error)
                failCount++
                failedUsers.push(user.name)
              }
            })
            
            await Promise.allSettled(promises)
          }
          
          await addDoc(collection(db, "adminActions"), {
            action: "mass_logout",
            adminId: userProfile?.id || 'unknown',
            adminName: userProfile?.name || 'Admin',
            timestamp: logoutTimestamp,
            affectedUsers: nonAdminUsers.length,
            successCount,
            failCount,
            failedUsers,
            createdAt: serverTimestamp()
          })
          
          toast({
            title: "Completed",
            description: `Successfully logged out ${successCount} users${failCount > 0 ? `. ${failCount} failed: ${failedUsers.join(', ')}` : ''}. Users can log back in after 1 minute, or click "Clear Logout Flags" for immediate access.`,
          })
        } catch (error) {
          console.error("Error logging out all users:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to log out all users",
          })
        }
      }
    })
  }

  const handleClearLogoutFlags = async () => {
    setConfirmDialog({
      isOpen: true,
      title: "Clear Force Logout Flags",
      message: "This will clear all force logout flags from ALL users (including admins), allowing them to log in again. This is useful if users are stuck in a logout loop. Continue?",
      variant: "default",
      onConfirm: async () => {
        try {
          const allUsers = users
          let clearCount = 0
          let failCount = 0
          const BATCH_SIZE = 10
          
          for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
            const batch = allUsers.slice(i, i + BATCH_SIZE)
            const promises = batch.map(async (user) => {
              try {
                await updateDoc(doc(db, "users", user.id), {
                  forceLogoutAt: deleteField(),
                  forceLogoutReason: deleteField(),
                  forcedBy: deleteField()
                })
                clearCount++
              } catch (error) {
                console.error(`Error clearing flags for user ${user.name}:`, error)
                failCount++
              }
            })
            await Promise.allSettled(promises)
          }
          
          await addDoc(collection(db, "adminActions"), {
            action: "clear_logout_flags",
            adminId: userProfile?.id || 'unknown',
            adminName: userProfile?.name || 'Admin',
            timestamp: new Date().toISOString(),
            affectedUsers: allUsers.length,
            successCount: clearCount,
            failCount,
            createdAt: serverTimestamp()
          })
          
          toast({
            title: "Success",
            description: `Cleared logout flags for ${clearCount} users (including admins)${failCount > 0 ? `. ${failCount} failed` : ''}. All users can now log in normally.`,
          })
        } catch (error) {
          console.error("Error clearing logout flags:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to clear logout flags",
          })
        }
      }
    })
  }

  const formatTimeRemaining = (banExpiresAt) => {
    if (!banExpiresAt) return null
    
    const now = new Date()
    const banEnd = banExpiresAt.toDate()
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold mb-2">Ban Management & Device Control</h1>
            <p className="text-muted-foreground">
              Manage user bans, monitor devices, and control access
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClearLogoutFlags}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2 whitespace-nowrap"
            >
              <CheckCircle className="w-4 h-4" />
              Clear Logout Flags
            </button>
            <button
              onClick={handleLogoutAllUsers}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2 whitespace-nowrap"
            >
              <Ban className="w-4 h-4" />
              Log Out All Users
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border hover:bg-muted"
            }`}
          >
            All Users ({users.length})
          </button>
          <button
            onClick={() => setFilter("banned")}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === "banned"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border hover:bg-muted"
            }`}
          >
            Banned ({users.filter((u) => u.banned === true || u.permanentBan === true).length})
          </button>
          <button
            onClick={() => setFilter("online")}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === "online"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border hover:bg-muted"
            }`}
          >
            Online ({users.filter((u) => u.online === true).length})
          </button>
          <button
            onClick={() => setFilter("offline")}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === "offline"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border hover:bg-muted"
            }`}
          >
            Offline ({users.filter((u) => u.online === false).length})
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid gap-4">
        {filteredUsers.map((user) => {
          const isBanned = user.banned === true || user.permanentBan === true
          const timeRemaining = user.banExpiresAt ? formatTimeRemaining(user.banExpiresAt) : null

          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-card border rounded-xl p-6 ${
                isBanned ? "border-red-500/50 bg-red-500/5" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1">
                  <div className={`p-3 rounded-full ${user.role === "admin" ? "bg-purple-500/10" : "bg-primary/10"}`}>
                    {user.role === "admin" ? (
                      <Shield className="w-6 h-6 text-purple-500" />
                    ) : (
                      <User className="w-6 h-6 text-primary" />
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="font-semibold text-lg">{user.name}</h3>
                      {user.role === "admin" && (
                        <span className="px-2.5 py-0.5 bg-purple-500 text-white text-xs font-medium rounded-full">
                          Admin
                        </span>
                      )}
                      {user.online && (
                        <span className="px-2.5 py-0.5 bg-green-500 text-white text-xs font-medium rounded-full flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                          Online
                        </span>
                      )}
                      {!user.online && (
                        <span className="px-2.5 py-0.5 bg-gray-500 text-white text-xs font-medium rounded-full">
                          Offline
                        </span>
                      )}
                      {(user.devices?.length || 0) > 0 && (
                        <span className="px-2.5 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium rounded-full border border-blue-500/30 flex items-center gap-1">
                          <Smartphone className="w-3 h-3" />
                          {user.devices.length}
                        </span>
                      )}
                      {user.banCount > 0 && (
                        <span className="px-2.5 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs font-medium rounded-full border border-yellow-500/30 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {user.banCount}
                        </span>
                      )}
                      {isBanned && (
                        <span className="px-2.5 py-0.5 bg-red-500 text-white text-xs font-medium rounded-full animate-pulse">
                          {user.permanentBan ? "⛔ Permanent Ban" : "🚫 Banned"}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground mb-2">{user.email}</p>

                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-muted-foreground" />
                        <span>{user.devices?.length || 0} devices</span>
                      </div>
                      {user.banCount > 0 && (
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          <span className="text-yellow-600">Ban count: {user.banCount}</span>
                        </div>
                      )}
                      {timeRemaining && (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-red-500" />
                          <span className="text-red-600 font-medium">{timeRemaining}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedUser(user)
                      setShowDevicesModal(true)
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
                  >
                    View Devices
                  </button>
                  {isBanned ? (
                    <button
                      onClick={() => handleUnbanUser(user)}
                      className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Unban
                    </button>
                  ) : user.role !== "admin" && (
                    <button
                      onClick={() => {
                        setSelectedUser(user)
                        setShowBanModal(true)
                      }}
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm flex items-center gap-2"
                    >
                      <Ban className="w-4 h-4" />
                      Ban
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {showDevicesModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">{selectedUser.name}'s Devices</h2>
                <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
              </div>
              <button
                onClick={() => setShowDevicesModal(false)}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {selectedUser.devices && selectedUser.devices.length > 0 ? (
                selectedUser.devices.map((device, idx) => (
                  <div key={idx} className="bg-muted p-4 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Smartphone className="w-5 h-5 text-primary" />
                          <h3 className="font-semibold">Device {idx + 1}</h3>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p><span className="font-medium">Platform:</span> {device.platform}</p>
                          <p><span className="font-medium">Resolution:</span> {device.screenResolution}</p>
                          <p><span className="font-medium">Language:</span> {device.language}</p>
                          <p><span className="font-medium">IP Address:</span> <span className="text-blue-500">{device.ipAddress || 'Unknown'}</span></p>
                          {device.geolocation && (
                            <>
                              <p><span className="font-medium">Location:</span> {device.geolocation.city}, {device.geolocation.region}, {device.geolocation.country}</p>
                              <p><span className="font-medium">Timezone:</span> {device.geolocation.timezone}</p>
                              {device.geolocation.latitude && device.geolocation.longitude && device.geolocation.latitude !== 0 && device.geolocation.longitude !== 0 && (
                                <div className="mt-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <MapPin className="w-4 h-4 text-blue-500" />
                                    <span className="font-medium text-sm">Device Location</span>
                                  </div>
                                  <DeviceLocationMap 
                                    latitude={device.geolocation.latitude}
                                    longitude={device.geolocation.longitude}
                                    city={device.geolocation.city}
                                    country={device.geolocation.country}
                                    region={device.geolocation.region}
                                    district={device.geolocation.district}
                                    thana={device.geolocation.thana}
                                  />
                                </div>
                              )}
                            </>
                          )}
                          <p><span className="font-medium">Last Seen:</span> {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : new Date(device.timestamp).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground"><span className="font-medium">Fingerprint:</span> {device.fingerprint}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleKickDevice(selectedUser.id, device.fingerprint)}
                        className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Kick
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Smartphone className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No devices found</p>
                </div>
              )}

              {selectedUser.banHistory && selectedUser.banHistory.length > 0 && (
                <div className="mt-6 pt-6 border-t border-border">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    Ban History
                  </h3>
                  <div className="space-y-2">
                    {selectedUser.banHistory.slice().reverse().map((ban, idx) => (
                      <div key={idx} className="bg-red-950/30 border border-red-500/30 p-3 rounded-lg text-sm">
                        <p className="font-medium text-red-400">{ban.reason}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(ban.timestamp).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {showBanModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl max-w-md w-full"
          >
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-2xl font-bold">Ban User</h2>
              <button
                onClick={() => {
                  setShowBanModal(false)
                  setBanReason("")
                }}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm mb-2"><span className="font-medium">User:</span> {selectedUser.name}</p>
                <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Ban Reason</label>
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Enter the reason for banning this user..."
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary min-h-[100px]"
                />
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-lg">
                <p className="text-sm text-yellow-600">
                  This user will be banned for 30 minutes and will see a ban message on all devices.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowBanModal(false)
                    setBanReason("")
                  }}
                  className="flex-1 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBanUser}
                  disabled={!banReason.trim()}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Ban className="w-4 h-4" />
                  Ban User
                </button>
              </div>
            </div>
          </motion.div>
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
