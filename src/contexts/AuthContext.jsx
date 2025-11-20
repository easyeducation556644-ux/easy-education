

import { createContext, useContext, useState, useEffect } from "react"
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
} from "firebase/auth"
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot, collection, addDoc, query, where, getDocs } from "firebase/firestore"
import { auth, db, googleProvider } from "../lib/firebase"
import { getDeviceInfo } from "../lib/deviceTracking"
import { BanOverlay } from "../components/BanOverlay"
import { DeviceLimitWarning } from "../components/DeviceLimitWarning"
import { usePresence } from "../hooks/usePresence"

const AuthContext = createContext({})

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [banInfo, setBanInfo] = useState(null)
  const [deviceWarning, setDeviceWarning] = useState(null)

  usePresence(currentUser)

  const refreshUserProfile = async () => {
    if (currentUser) {
      await fetchUserProfile(currentUser.uid)
    }
  }

  const checkAndHandleDeviceLogin = async (userId, userEmail, userName) => {
    try {
      const deviceInfo = await getDeviceInfo()
      const userRef = doc(db, "users", userId)
      const userDoc = await getDoc(userRef)
      
      if (!userDoc.exists()) return null
      
      const userData = userDoc.data()
      const isAdmin = userData.role === "admin"
      
      if (isAdmin) {
        const devices = userData.devices || []
        const existingDevice = devices.find(d => d.fingerprint === deviceInfo.fingerprint)
        
        if (!existingDevice) {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          const updatedDevices = [...devices.filter(d => {
            if (!d.lastSeen && !d.timestamp) return false
            try {
              const deviceTime = new Date(d.lastSeen || d.timestamp)
              if (isNaN(deviceTime.getTime())) return false
              return deviceTime >= thirtyDaysAgo
            } catch (e) {
              return false
            }
          }), deviceInfo]
          
          await updateDoc(userRef, { devices: updatedDevices })
        } else {
          const updatedDevices = devices.map(d => 
            d.fingerprint === deviceInfo.fingerprint
              ? { ...d, lastSeen: deviceInfo.timestamp, ipAddress: deviceInfo.ipAddress }
              : d
          )
          await updateDoc(userRef, { devices: updatedDevices })
        }
        return deviceInfo
      }
      
      const devices = userData.devices || []
      const banCount = userData.banCount || 0
      const banHistory = userData.banHistory || []
      const permanentBan = userData.permanentBan || false
      const banExpiresAt = userData.banExpiresAt

      if (permanentBan) {
        const banData = {
          isBanned: true,
          type: 'permanent',
          reason: banHistory[banHistory.length - 1]?.reason || 'Multiple violations of simultaneous login policy',
          banCount: banCount
        }
        localStorage.setItem('banInfo', JSON.stringify(banData))
        setBanInfo(banData)
        return deviceInfo
      }

      if (userData.banned === true && !banExpiresAt) {
        const banData = {
          isBanned: true,
          type: 'permanent',
          reason: banHistory[banHistory.length - 1]?.reason || 'Account manually banned by administrator',
          banCount: banCount
        }
        localStorage.setItem('banInfo', JSON.stringify(banData))
        setBanInfo(banData)
        return deviceInfo
      }

      if (banExpiresAt) {
        const banEndTime = banExpiresAt.toDate()
        const now = new Date()
        
        if (banEndTime <= now) {
          await updateDoc(userRef, {
            banned: false,
            banExpiresAt: null
          })
          localStorage.removeItem('banInfo')
        } else {
          const banData = {
            isBanned: true,
            type: 'temporary',
            reason: banHistory[banHistory.length - 1]?.reason || 'Simultaneous login from multiple devices detected',
            bannedUntil: banExpiresAt,
            banCount: banCount
          }
          localStorage.setItem('banInfo', JSON.stringify(banData))
          setBanInfo(banData)
          return deviceInfo
        }
      }

      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      
      const activeDevices = devices.filter(d => {
        if (!d.lastSeen && !d.timestamp) return false
        try {
          const deviceTime = new Date(d.lastSeen || d.timestamp)
          if (isNaN(deviceTime.getTime())) return false
          return deviceTime >= thirtyDaysAgo
        } catch (e) {
          return false
        }
      })
      
      const existingDevice = activeDevices.find(d => {
        if (d.fingerprint === deviceInfo.fingerprint) {
          if (!d.ipAddress || !deviceInfo.ipAddress || d.ipAddress === 'unknown' || deviceInfo.ipAddress === 'unknown') {
            return true
          }
          return d.ipAddress === deviceInfo.ipAddress
        }
        return false
      })
      
      const uniqueDevices = new Map()
      
      activeDevices.forEach(d => {
        const key = d.fingerprint + (d.ipAddress && d.ipAddress !== 'unknown' ? `_${d.ipAddress}` : '')
        uniqueDevices.set(key, d)
      })
      
      const currentDeviceCount = uniqueDevices.size
      const MAX_ALLOWED_DEVICES = 2
      
      if (!existingDevice) {
        const shouldBan = currentDeviceCount >= MAX_ALLOWED_DEVICES && !isAdmin
        
        if (shouldBan) {
          const newBanCount = banCount + 1
          const banExpires = new Date(now.getTime() + 30 * 60 * 1000)
          
          const existingIPs = activeDevices
            .filter(d => d.ipAddress && d.ipAddress !== 'unknown')
            .map(d => `${d.ipAddress} (${d.platform || 'Unknown'})`)
            .join(', ')
          
          const banRecord = {
            timestamp: now.toISOString(),
            reason: `Device limit exceeded - Maximum ${MAX_ALLOWED_DEVICES} devices allowed. Current devices: ${currentDeviceCount}, Attempting to add: ${deviceInfo.ipAddress} (${deviceInfo.platform}). Existing devices: ${existingIPs}`,
            deviceCount: currentDeviceCount,
            bannedUntil: banExpires.toISOString(),
            ipAddress: deviceInfo.ipAddress,
            platform: deviceInfo.platform
          }

          const updateData = {
            devices: activeDevices,
            banCount: newBanCount,
            banHistory: [...banHistory, banRecord],
            banned: true,
            banExpiresAt: banExpires
          }

          if (newBanCount >= 3) {
            updateData.permanentBan = true
            updateData.banned = true
            updateData.banExpiresAt = null
            banRecord.reason = `Permanent ban - ${newBanCount} violations of ${MAX_ALLOWED_DEVICES}-device limit policy`
          }

          await updateDoc(userRef, updateData)

          await addDoc(collection(db, "banNotifications"), {
            userId,
            userEmail,
            userName,
            type: newBanCount >= 3 ? 'permanent' : 'temporary',
            reason: banRecord.reason,
            deviceCount: currentDeviceCount,
            banCount: newBanCount,
            bannedUntil: newBanCount >= 3 ? null : banExpires.toISOString(),
            devices: activeDevices,
            createdAt: serverTimestamp(),
            isRead: false
          })

          const banData = {
            isBanned: true,
            type: newBanCount >= 3 ? 'permanent' : 'temporary',
            reason: banRecord.reason,
            bannedUntil: newBanCount >= 3 ? null : banExpires,
            banCount: newBanCount
          }
          localStorage.setItem('banInfo', JSON.stringify(banData))
          setBanInfo(banData)
        } else {
          const updatedDevices = [...activeDevices, deviceInfo]
          await updateDoc(userRef, {
            devices: updatedDevices
          })
          
          if (currentDeviceCount === 1) {
            const warningExpiresAt = new Date(now.getTime() + 30 * 60 * 1000)
            const warningData = {
              showWarning: true,
              deviceCount: 2,
              expiresAt: warningExpiresAt.toISOString(),
              message: 'আপনি ২য় ডিভাইস থেকে লগইন করেছেন'
            }
            localStorage.setItem('deviceWarning', JSON.stringify(warningData))
            setDeviceWarning(warningData)
          }
        }
      } else {
        if (currentDeviceCount > MAX_ALLOWED_DEVICES && !isAdmin) {
          const newBanCount = banCount + 1
          const banExpires = new Date(now.getTime() + 30 * 60 * 1000)
          
          const banRecord = {
            timestamp: now.toISOString(),
            reason: `Device limit exceeded - More than ${MAX_ALLOWED_DEVICES} devices detected. Current devices: ${currentDeviceCount}`,
            deviceCount: currentDeviceCount,
            bannedUntil: banExpires.toISOString(),
            ipAddress: deviceInfo.ipAddress,
            platform: deviceInfo.platform
          }

          const updateData = {
            devices: activeDevices,
            banCount: newBanCount,
            banHistory: [...banHistory, banRecord],
            banned: true,
            banExpiresAt: banExpires
          }

          if (newBanCount >= 3) {
            updateData.permanentBan = true
            updateData.banned = true
            updateData.banExpiresAt = null
            banRecord.reason = `Permanent ban - ${newBanCount} violations of ${MAX_ALLOWED_DEVICES}-device limit policy`
          }

          await updateDoc(userRef, updateData)

          await addDoc(collection(db, "banNotifications"), {
            userId,
            userEmail,
            userName,
            type: newBanCount >= 3 ? 'permanent' : 'temporary',
            reason: banRecord.reason,
            deviceCount: currentDeviceCount,
            banCount: newBanCount,
            bannedUntil: newBanCount >= 3 ? null : banExpires.toISOString(),
            devices: activeDevices,
            createdAt: serverTimestamp(),
            isRead: false
          })

          const banData = {
            isBanned: true,
            type: newBanCount >= 3 ? 'permanent' : 'temporary',
            reason: banRecord.reason,
            bannedUntil: newBanCount >= 3 ? null : banExpires,
            banCount: newBanCount
          }
          localStorage.setItem('banInfo', JSON.stringify(banData))
          setBanInfo(banData)
        } else {
          const updatedDevices = activeDevices.map(d => {
            const isMatch = d.fingerprint === deviceInfo.fingerprint && 
              (!d.ipAddress || !deviceInfo.ipAddress || d.ipAddress === 'unknown' || deviceInfo.ipAddress === 'unknown' || d.ipAddress === deviceInfo.ipAddress)
            
            return isMatch
              ? { ...d, lastSeen: deviceInfo.timestamp, ipAddress: deviceInfo.ipAddress }
              : d
          })
          await updateDoc(userRef, {
            devices: updatedDevices
          })
        }
      }

      return deviceInfo
    } catch (error) {
      console.error("Device check error:", error)
      throw error
    }
  }

  const ensureAdminRole = async (uid, email) => {
    try {
      if (email === "admin@gmail.com") {
        const userRef = doc(db, "users", uid)
        const userDoc = await getDoc(userRef)

        if (userDoc.exists()) {
          const userData = userDoc.data()
          if (userData.role !== "admin") {
            await updateDoc(userRef, { role: "admin" })
            return true
          }
        }
      }
      return false
    } catch (error) {
      console.error("Error ensuring admin role:", error)
      return false
    }
  }

  const signUp = async (email, password, userData) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)
      const user = userCredential.user

      const isDefaultAdmin = email === "admin@gmail.com"
      const deviceInfo = await getDeviceInfo()

      const newUserData = {
        name: userData.name || "",
        email: user.email,
        institution: userData.institution || "",
        phone: userData.phone || "",
        socialLinks: {
          facebook: "",
          linkedin: "",
          github: "",
        },
        role: isDefaultAdmin ? "admin" : "user",
        banned: false,
        online: true,
        lastActive: serverTimestamp(),
        photoURL: user.photoURL || "",
        createdAt: serverTimestamp(),
        devices: [deviceInfo],
        banCount: 0,
        banHistory: [],
        permanentBan: false,
        banExpiresAt: null
      }

      await setDoc(doc(db, "users", user.uid), newUserData)

      const profile = await fetchUserProfile(user.uid)
      return { userCredential, profile }
    } catch (error) {
      console.error("Sign up error:", error)
      throw error
    }
  }

  const signIn = async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      const userRef = doc(db, "users", userCredential.user.uid)
      const deviceInfo = await getDeviceInfo()

      try {
        const userDoc = await getDoc(userRef)
        const isDefaultAdmin = email === "admin@gmail.com"

        if (!userDoc.exists()) {
          const newUserData = {
            name: userCredential.user.displayName || (isDefaultAdmin ? "Admin" : "User"),
            email: userCredential.user.email,
            institution: "",
            phone: "",
            socialLinks: {
              facebook: "",
              linkedin: "",
              github: "",
            },
            role: isDefaultAdmin ? "admin" : "user",
            banned: false,
            online: true,
            lastActive: serverTimestamp(),
            photoURL: userCredential.user.photoURL || "",
            createdAt: serverTimestamp(),
            devices: [deviceInfo],
            banCount: 0,
            banHistory: [],
            permanentBan: false,
            banExpiresAt: null
          }
          await setDoc(userRef, newUserData)
        } else {
          const userData = userDoc.data()

          await checkAndHandleDeviceLogin(
            userCredential.user.uid,
            userCredential.user.email,
            userData.name || "User"
          )

          const updateData = {
            online: true,
            lastActive: serverTimestamp(),
          }

          if (isDefaultAdmin && userData.role !== "admin") {
            updateData.role = "admin"
          }

          await updateDoc(userRef, updateData)
        }
      } catch (firestoreError) {
        console.error("Firestore error during sign in:", firestoreError)
      }

      const profile = await fetchUserProfile(userCredential.user.uid)

      return { userCredential, profile }
    } catch (error) {
      console.error("Sign in error:", error)
      throw error
    }
  }

  const signInWithGoogle = async () => {
    try {
      const userCredential = await signInWithPopup(auth, googleProvider)
      const user = userCredential.user
      const deviceInfo = await getDeviceInfo()

      try {
        const userRef = doc(db, "users", user.uid)
        const userDoc = await getDoc(userRef)
        const isDefaultAdmin = user.email === "admin@gmail.com"

        if (!userDoc.exists()) {
          const newUserData = {
            name: user.displayName || "",
            email: user.email,
            institution: "",
            phone: "",
            socialLinks: {
              facebook: "",
              linkedin: "",
              github: "",
            },
            role: isDefaultAdmin ? "admin" : "user",
            banned: false,
            online: true,
            lastActive: serverTimestamp(),
            photoURL: user.photoURL || "",
            createdAt: serverTimestamp(),
            devices: [deviceInfo],
            banCount: 0,
            banHistory: [],
            permanentBan: false,
            banExpiresAt: null
          }
          await setDoc(userRef, newUserData)
        } else {
          const userData = userDoc.data()

          await checkAndHandleDeviceLogin(
            user.uid,
            user.email,
            userData.name || user.displayName || "User"
          )

          const updateData = {
            online: true,
            lastActive: serverTimestamp(),
          }

          if (isDefaultAdmin && userData.role !== "admin") {
            updateData.role = "admin"
          }

          await updateDoc(userRef, updateData)
        }
      } catch (firestoreError) {
        console.error("Firestore error during Google sign in:", firestoreError)
      }

      const profile = await fetchUserProfile(user.uid)

      return { userCredential, profile }
    } catch (error) {
      console.error("Google sign in error:", error)
      throw error
    }
  }

  const signOut = async () => {
    try {
      if (currentUser) {
        try {
          await updateDoc(doc(db, "users", currentUser.uid), {
            online: false,
            lastActive: serverTimestamp(),
          })
        } catch (firestoreError) {
          console.error("Firestore error during sign out:", firestoreError)
        }
      }
      await firebaseSignOut(auth)
      setCurrentUser(null)
      setUserProfile(null)
    } catch (error) {
      console.error("Sign out error:", error)
      setCurrentUser(null)
      setUserProfile(null)
      throw error
    }
  }

  const signUpWithEmail = async (email, password, name) => {
    return await signUp(email, password, { name })
  }

  const signInWithEmail = async (email, password) => {
    return await signIn(email, password)
  }

  const sendPasswordResetEmail = async (email) => {
    try {
      await firebaseSendPasswordResetEmail(auth, email)
    } catch (error) {
      console.error("Password reset error:", error)
      throw error
    }
  }

  const fetchUserProfile = async (uid) => {
    try {
      const userDoc = await getDoc(doc(db, "users", uid))
      if (userDoc.exists()) {
        const profile = { id: uid, ...userDoc.data() }
        setUserProfile(profile)
        return profile
      } else {
        const basicProfile = {
          id: uid,
          email: auth.currentUser?.email || "",
          name: auth.currentUser?.displayName || "User",
          role: auth.currentUser?.email === "admin@gmail.com" ? "admin" : "user",
          banned: false,
        }
        setUserProfile(basicProfile)
        return basicProfile
      }
    } catch (error) {
      console.error("Error fetching user profile:", error)
      const fallbackProfile = {
        id: uid,
        email: auth.currentUser?.email || "",
        name: auth.currentUser?.displayName || "User",
        role: auth.currentUser?.email === "admin@gmail.com" ? "admin" : "user",
        banned: false,
      }
      setUserProfile(fallbackProfile)
      return fallbackProfile
    }
  }

  useEffect(() => {
    if (!currentUser) {
      setBanInfo(null)
      localStorage.removeItem('banInfo')
      return
    }

    const userRef = doc(db, "users", currentUser.uid)
    const unsubscribe = onSnapshot(
      userRef,
      async (doc) => {
        if (doc.exists()) {
          const updatedProfile = { id: currentUser.uid, ...doc.data() }
          setUserProfile(updatedProfile)

          if (updatedProfile.role === "admin") {
            setBanInfo(null)
            localStorage.removeItem('banInfo')
            return
          }

          const currentDeviceInfo = await getDeviceInfo()
          const devices = updatedProfile.devices || []
          const deviceExists = devices.some(d => d.fingerprint === currentDeviceInfo.fingerprint)
          
          if (!deviceExists && devices.length >= 0) {
            console.log('Device has been kicked, logging out...')
            localStorage.removeItem('deviceWarning')
            localStorage.removeItem('banInfo')
            await firebaseSignOut(auth)
            window.location.reload()
            return
          }

          if (updatedProfile.permanentBan) {
            const latestBanHistory = updatedProfile.banHistory?.[updatedProfile.banHistory.length - 1]
            const banData = {
              isBanned: true,
              type: 'permanent',
              reason: latestBanHistory?.reason || 'Permanent ban due to multiple violations',
              banCount: updatedProfile.banCount || 0
            }
            setBanInfo(banData)
            localStorage.setItem('banInfo', JSON.stringify(banData))
          } else if (updatedProfile.banned === true) {
            const latestBanHistory = updatedProfile.banHistory?.[updatedProfile.banHistory.length - 1]
            
            if (updatedProfile.banExpiresAt) {
              const banEndTime = updatedProfile.banExpiresAt.toDate()
              const now = new Date()
              
              if (banEndTime <= now) {
                setBanInfo(null)
                localStorage.removeItem('banInfo')
              } else {
                const banData = {
                  isBanned: true,
                  type: 'temporary',
                  bannedUntil: banEndTime,
                  reason: latestBanHistory?.reason || 'Multiple device login detected',
                  banCount: updatedProfile.banCount || 0
                }
                setBanInfo(banData)
                localStorage.setItem('banInfo', JSON.stringify(banData))
              }
            } else {
              const banData = {
                isBanned: true,
                type: 'permanent',
                reason: latestBanHistory?.reason || 'Manual ban by administrator',
                banCount: updatedProfile.banCount || 0
              }
              setBanInfo(banData)
              localStorage.setItem('banInfo', JSON.stringify(banData))
            }
          } else {
            setBanInfo(null)
            localStorage.removeItem('banInfo')
          }
        }
      },
      (error) => {
        console.error("Error listening to profile updates:", error)
      },
    )

    return () => unsubscribe()
  }, [currentUser])

  useEffect(() => {
    const storedBanInfo = localStorage.getItem('banInfo')
    if (storedBanInfo) {
      try {
        const parsed = JSON.parse(storedBanInfo)
        if (parsed.bannedUntil) {
          const bannedUntilDate = new Date(parsed.bannedUntil)
          const now = new Date()
          if (bannedUntilDate <= now) {
            localStorage.removeItem('banInfo')
          } else {
            setBanInfo(parsed)
          }
        } else {
          setBanInfo(parsed)
        }
      } catch (e) {
        console.error('Error parsing ban info:', e)
        localStorage.removeItem('banInfo')
      }
    }

    const loadingTimeout = setTimeout(() => {
      if (loading) {
        console.error("Auth loading timeout - forcing completion")
        setLoading(false)
        setError("Connection timeout. Firebase may not be properly configured.")
      }
    }, 15000)

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        try {
          clearTimeout(loadingTimeout)
          setCurrentUser(user)
          if (user) {
            await ensureAdminRole(user.uid, user.email)
            await fetchUserProfile(user.uid)
          } else {
            setUserProfile(null)
          }
          setLoading(false)
          setError(null)
        } catch (err) {
          console.error("Error in auth state change:", err)
          setLoading(false)
          setError(null)
        }
      },
      (err) => {
        console.error("Auth state listener error:", err)
        clearTimeout(loadingTimeout)
        setLoading(false)
        setError("Authentication error. Please check your Firebase configuration.")
      },
    )

    const handleBeforeUnload = async () => {
      if (currentUser) {
        try {
          await updateDoc(doc(db, "users", currentUser.uid), {
            online: false,
            lastActive: serverTimestamp(),
          })
        } catch (err) {
          console.error("Error updating user status on unload:", err)
        }
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      clearTimeout(loadingTimeout)
      unsubscribe()
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  const value = {
    currentUser,
    userProfile,
    signUp,
    signIn,
    signUpWithEmail,
    signInWithEmail,
    signInWithGoogle,
    sendPasswordResetEmail,
    signOut,
    loading,
    isAdmin: userProfile?.role === "admin",
    refreshUserProfile,
    error,
  }

  if (loading) {
    return (
      <AuthContext.Provider value={value}>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </AuthContext.Provider>
    )
  }

  if (error) {
    return (
      <AuthContext.Provider value={value}>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center max-w-md mx-auto p-6">
            <div className="text-yellow-500 text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold mb-2">Connection Warning</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </AuthContext.Provider>
    )
  }

  const handleUnban = async () => {
    if (banInfo?.type === 'temporary') {
      localStorage.removeItem('banInfo')
      setBanInfo(null)
      window.location.reload()
    }
  }

  const handleDeviceWarningLogout = async () => {
    try {
      if (!currentUser) {
        throw new Error('No current user found during device warning logout')
      }
      
      const deviceInfo = await getDeviceInfo()
      
      if (!deviceInfo || !deviceInfo.fingerprint) {
        throw new Error('Failed to get device fingerprint for cleanup')
      }
      
      const userRef = doc(db, "users", currentUser.uid)
      const userDoc = await getDoc(userRef)
      
      if (!userDoc.exists()) {
        throw new Error('User document not found')
      }
      
      const userData = userDoc.data()
      const devices = userData.devices || []
      const initialDeviceCount = devices.length
      
      const updatedDevices = devices.filter(d => d.fingerprint !== deviceInfo.fingerprint)
      
      if (updatedDevices.length === initialDeviceCount) {
        console.warn('Device fingerprint not found in device list, but proceeding with cleanup')
      }
      
      await updateDoc(userRef, { devices: updatedDevices })
      
      console.log('Device cleanup successful: removed device from Firestore')
      localStorage.removeItem('deviceWarning')
      setDeviceWarning(null)
    } catch (error) {
      console.error('Error during device warning logout cleanup:', error)
      throw error
    }
  }

  useEffect(() => {
    const storedWarning = localStorage.getItem('deviceWarning')
    if (storedWarning) {
      try {
        const parsed = JSON.parse(storedWarning)
        const expiresAt = new Date(parsed.expiresAt)
        const now = new Date()
        
        if (expiresAt <= now) {
          localStorage.removeItem('deviceWarning')
        } else {
          setDeviceWarning(parsed)
        }
      } catch (e) {
        console.error('Error parsing device warning:', e)
        localStorage.removeItem('deviceWarning')
      }
    }
  }, [])

  return (
    <AuthContext.Provider value={value}>
      {children}
      <BanOverlay banInfo={banInfo} onUnban={handleUnban} />
      <DeviceLimitWarning warningInfo={deviceWarning} onAutoLogout={handleDeviceWarningLogout} />
    </AuthContext.Provider>
  )
}
