import { createContext, useContext, useState, useEffect } from "react"
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
} from "firebase/auth"
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot, collection, addDoc, query, where, getDocs, deleteField } from "firebase/firestore"
import { auth, db, googleProvider } from "../lib/firebase"
import { getDeviceInfo } from "../lib/deviceTracking"
import { BanOverlay } from "../components/BanOverlay"
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
  const [lastLoginTimestamp, setLastLoginTimestamp] = useState(null)
  const [currentDeviceFingerprint, setCurrentDeviceFingerprint] = useState(null)

  usePresence(currentUser)

  const refreshUserProfile = async () => {
    if (currentUser) {
      await fetchUserProfile(currentUser.uid)
    }
  }

  const checkAndHandleDeviceLogin = async (userId, userEmail, userName) => {
    try {
      const deviceInfo = await getDeviceInfo()
      if (deviceInfo && deviceInfo.fingerprint) {
        setCurrentDeviceFingerprint(deviceInfo.fingerprint)
        localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
      }
      const userRef = doc(db, "users", userId)
      const userDoc = await getDoc(userRef)

      if (!userDoc.exists()) return null

      const userData = userDoc.data()
      const isAdmin = userData.role === "admin"

      // Admin bypass - no device limits
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

      // Check for permanent ban - just show ban info, DON'T logout
      if (permanentBan) {
        const banData = {
          isBanned: true,
          type: 'permanent',
          reason: banHistory[banHistory.length - 1]?.reason || 'Multiple violations of simultaneous login policy',
          banCount: banCount
        }
        localStorage.setItem('banInfo', JSON.stringify(banData))
        setBanInfo(banData)
        // IMPORTANT: Still return deviceInfo so user stays logged in to see ban
        return deviceInfo
      }

      // Check for manual admin ban without expiration
      if (userData.banned === true && !banExpiresAt) {
        const banData = {
          isBanned: true,
          type: 'permanent',
          reason: banHistory[banHistory.length - 1]?.reason || 'Account manually banned by administrator',
          banCount: banCount
        }
        localStorage.setItem('banInfo', JSON.stringify(banData))
        setBanInfo(banData)
        // IMPORTANT: Still return deviceInfo
        return deviceInfo
      }

      // Check for temporary ban
      if (banExpiresAt) {
        const banEndTime = banExpiresAt.toDate()
        const now = new Date()

        if (banEndTime <= now) {
          // 💡 FIX: Ban expired - clear ban flags and set forceLogoutAt. 
          // Do NOT clear 'devices' array here. The useEffect listener will handle the logout.
          console.log('✅ Ban has expired during login - setting forceLogoutAt for all devices')
          await updateDoc(userRef, {
            banned: false,
            banExpiresAt: null,
            kickedDevices: [],
            forceLogoutAt: serverTimestamp(),
            forceLogoutReason: 'Ban expired - all devices logged out'
          })
          localStorage.removeItem('banInfo')
          setBanInfo(null)
          return deviceInfo
        } else {
          // Ban still active - show ban overlay
          const banData = {
            isBanned: true,
            type: 'temporary',
            reason: banHistory[banHistory.length - 1]?.reason || 'Simultaneous login from multiple devices detected',
            bannedUntil: banExpiresAt,
            banCount: banCount
          }
          localStorage.setItem('banInfo', JSON.stringify(banData))
          setBanInfo(banData)
          // IMPORTANT: Return deviceInfo so user stays logged in
          return deviceInfo
        }
      }

      // No active ban - clear any cached ban info
      localStorage.removeItem('banInfo')
      setBanInfo(null)

      const now = new Date()
      const existingDevice = devices.find(d => d.fingerprint === deviceInfo.fingerprint)

      console.log('🔍 Device Login Check:', {
        userName,
        devicesCount: devices.length,
        currentDevice: deviceInfo.fingerprint,
        currentIP: deviceInfo.ipAddress,
        existingDevice: !!existingDevice
      })

      // NEW DEVICE DETECTED - This is where ban happens
      if (!existingDevice) {
        if (devices.length > 0) {
          const newBanCount = banCount + 1
          const banExpires = new Date(now.getTime() + 30 * 60 * 1000)

          const existingIPs = devices
            .filter(d => d.ipAddress && d.ipAddress !== 'unknown')
            .map(d => `${d.ipAddress} (${d.platform || 'Unknown'})`)
            .join(', ')

          const banRecord = {
            timestamp: now.toISOString(),
            reason: `একাধিক ডিভাইস থেকে লগইন সনাক্ত করা হয়েছে। বর্তমান ডিভাইস: ${devices.length}, নতুন ডিভাইস: ${deviceInfo.ipAddress} (${deviceInfo.platform}). বিদ্যমান ডিভাইস: ${existingIPs}`,
            deviceCount: devices.length,
            bannedUntil: banExpires.toISOString(),
            ipAddress: deviceInfo.ipAddress,
            platform: deviceInfo.platform
          }

          const updateData = {
            // 💡 CRITICAL FIX: Add new device to array when banning,
            // so onSnapshot doesn't treat it as a "removed device" and instantly log out.
            devices: [...devices, deviceInfo],
            banCount: newBanCount,
            banHistory: [...banHistory, banRecord],
            banned: true
          }

          if (newBanCount >= 3) {
            updateData.permanentBan = true
            updateData.banned = true
            updateData.banExpiresAt = null
            banRecord.reason = `স্থায়ী নিষেধাজ্ঞা - ${newBanCount} বার একাধিক ডিভাইস থেকে লগইন করার চেষ্টা করা হয়েছে`
          } else {
            updateData.banExpiresAt = banExpires
          }

          await updateDoc(userRef, updateData)

          await addDoc(collection(db, "banNotifications"), {
            userId,
            userEmail,
            userName,
            type: newBanCount >= 3 ? 'permanent' : 'temporary',
            reason: banRecord.reason,
            deviceCount: devices.length,
            banCount: newBanCount,
            bannedUntil: newBanCount >= 3 ? null : banExpires.toISOString(),
            devices: devices,
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

          // CRITICAL: Return deviceInfo so user stays logged in to see ban overlay
          return deviceInfo
        } else {
          // First device - just add it
          await updateDoc(userRef, {
            devices: [deviceInfo]
          })
        }
      } else {
        // Existing device - update last seen
        const updatedDevices = devices.map(d =>
          d.fingerprint === deviceInfo.fingerprint
            ? { ...d, lastSeen: deviceInfo.timestamp, ipAddress: deviceInfo.ipAddress }
            : d
        )
        await updateDoc(userRef, { devices: updatedDevices })
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

      if (deviceInfo && deviceInfo.fingerprint) {
        setCurrentDeviceFingerprint(deviceInfo.fingerprint)
        localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
      }

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

      if (deviceInfo && deviceInfo.fingerprint) {
        setCurrentDeviceFingerprint(deviceInfo.fingerprint)
        localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
      }

      const loginTimestamp = Date.now()
      setLastLoginTimestamp(loginTimestamp)

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

      if (profile.forceLogoutAt) {
        try {
          const forceLogoutTimestamp = profile.forceLogoutAt.toMillis ?
            profile.forceLogoutAt.toMillis() :
            new Date(profile.forceLogoutAt).getTime()
          const timeSinceForceLogout = Date.now() - forceLogoutTimestamp
          const CLEANUP_THRESHOLD = 2 * 60 * 1000

          if (timeSinceForceLogout > CLEANUP_THRESHOLD) {
            console.log('🧹 Cleaning up old forceLogoutAt on successful sign-in')
            await updateDoc(doc(db, "users", userCredential.user.uid), {
              forceLogoutAt: deleteField(),
              forceLogoutReason: deleteField(),
              forcedBy: deleteField()
            })
          }
        } catch (err) {
          console.warn('Failed to cleanup old forceLogoutAt:', err)
        }
      }

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

      if (deviceInfo && deviceInfo.fingerprint) {
        setCurrentDeviceFingerprint(deviceInfo.fingerprint)
        localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
      }

      const loginTimestamp = Date.now()
      setLastLoginTimestamp(loginTimestamp)

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

      if (profile.forceLogoutAt) {
        try {
          const forceLogoutTimestamp = profile.forceLogoutAt.toMillis ?
            profile.forceLogoutAt.toMillis() :
            new Date(profile.forceLogoutAt).getTime()
          const timeSinceForceLogout = Date.now() - forceLogoutTimestamp
          const CLEANUP_THRESHOLD = 2 * 60 * 1000

          if (timeSinceForceLogout > CLEANUP_THRESHOLD) {
            console.log('🧹 Cleaning up old forceLogoutAt on successful Google sign-in')
            await updateDoc(doc(db, "users", user.uid), {
              forceLogoutAt: deleteField(),
              forceLogoutReason: deleteField(),
              forcedBy: deleteField()
            })
          }
        } catch (err) {
          console.warn('Failed to cleanup old forceLogoutAt:', err)
        }
      }

      return { userCredential, profile }
    } catch (error) {
      console.error("Google sign in error:", error)
      throw error
    }
  }

  const signOut = async () => {
    try {
      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid)
        let deviceID = localStorage.getItem('deviceID')
        let fingerprint = currentDeviceFingerprint || localStorage.getItem('currentDeviceFingerprint')

        try {
          const deviceInfo = await getDeviceInfo()
          if (deviceInfo) {
            if (deviceInfo.id) deviceID = deviceInfo.id
            if (deviceInfo.fingerprint) fingerprint = deviceInfo.fingerprint
          }
        } catch (deviceError) {
          console.warn("getDeviceInfo failed during logout, using stored identifiers:", deviceError)
        }

        try {
          if (deviceID || fingerprint) {
            const userDoc = await getDoc(userRef)

            if (userDoc.exists()) {
              const userData = userDoc.data()
              const devices = userData.devices || []

              const updatedDevices = devices.filter(d => {
                if (deviceID && d.id === deviceID) return false
                if (fingerprint && d.fingerprint === fingerprint) return false
                return true
              })

              await updateDoc(userRef, {
                online: false,
                lastActive: serverTimestamp(),
                devices: updatedDevices
              })
              console.log('✅ Device removed from database during logout (using ID or fingerprint)')
            } else {
              await updateDoc(userRef, {
                online: false,
                lastActive: serverTimestamp(),
              })
            }
          } else {
            await updateDoc(userRef, {
              online: false,
              lastActive: serverTimestamp(),
            })
            console.warn("No device identifier available, could not remove device from database")
          }
        } catch (firestoreError) {
          console.error("Firestore error during sign out:", firestoreError)
          try {
            await updateDoc(userRef, {
              online: false,
              lastActive: serverTimestamp(),
            })
          } catch (fallbackError) {
            console.error("Fallback update also failed:", fallbackError)
          }
        }

        localStorage.removeItem('currentDeviceFingerprint')
        localStorage.removeItem('deviceID')
        setCurrentDeviceFingerprint(null)
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

  // **CRITICAL: onSnapshot Listener to handle real-time updates and logouts**
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

          // Admin bypass - never ban admins
          if (updatedProfile.role === "admin") {
            setBanInfo(null)
            localStorage.removeItem('banInfo')
            return
          }

          // Clear ban cache if admin requested
          if (updatedProfile.clearBanCacheAt) {
            const clearCacheTimestamp = updatedProfile.clearBanCacheAt.toMillis ?
              updatedProfile.clearBanCacheAt.toMillis() :
              new Date(updatedProfile.clearBanCacheAt).getTime()

            const lastClearedAt = localStorage.getItem('lastClearedBanCacheAt')
            const lastClearedTimestamp = lastClearedAt ? parseInt(lastClearedAt) : 0

            if (clearCacheTimestamp > lastClearedTimestamp) {
              console.log('✅ Clearing ban cache as requested by admin')
              localStorage.removeItem('banInfo')
              localStorage.removeItem('deviceWarning')
              localStorage.removeItem('lastAckedLogoutAt')
              localStorage.setItem('lastClearedBanCacheAt', clearCacheTimestamp.toString())
              setBanInfo(null)
              setDeviceWarning(null)
            }
          }

          const currentDeviceInfo = await getDeviceInfo()
          const kickedDevices = updatedProfile.kickedDevices || []
          const storedFingerprint = currentDeviceFingerprint || localStorage.getItem('currentDeviceFingerprint')

          const deviceFingerprintToCheck = currentDeviceInfo?.fingerprint || storedFingerprint

          // Check if this specific device was kicked
          if (deviceFingerprintToCheck && kickedDevices.includes(deviceFingerprintToCheck)) {
            console.log('✅ This device has been kicked - logging out immediately')
            localStorage.removeItem('deviceWarning')
            localStorage.removeItem('banInfo')
            localStorage.removeItem('lastAckedLogoutAt')
            localStorage.removeItem('currentDeviceFingerprint')

            const updatedKickedDevices = kickedDevices.filter(fp => fp !== deviceFingerprintToCheck)
            await updateDoc(userRef, {
              kickedDevices: updatedKickedDevices
            })

            await firebaseSignOut(auth)
            window.location.reload()
            return
          }

          // Check ban status
          const isBanned = updatedProfile.banned || updatedProfile.permanentBan
          const banExpiresAt = updatedProfile.banExpiresAt
          let isBanActive = false

          if (isBanned) {
            if (!banExpiresAt) {
              // Permanent ban or manual ban
              isBanActive = true
            } else {
              try {
                const banEndTime = banExpiresAt.toDate ? banExpiresAt.toDate() : new Date(banExpiresAt)
                isBanActive = banEndTime > new Date()
              } catch (e) {
                console.error('Error parsing ban expiration:', e)
                isBanActive = true
              }
            }
          }

          // CRITICAL FIX: If ban expired, clear everything and force logout (Your desired behavior)
          if (isBanned && !isBanActive && banExpiresAt) {
            console.log('✅ Ban has expired - auto logout triggered to clear session')
            localStorage.removeItem('deviceWarning')
            localStorage.removeItem('banInfo')
            localStorage.removeItem('lastAckedLogoutAt')
            await firebaseSignOut(auth)
            window.location.reload()
            return
          }

          // CRITICAL FIX: If user is actively banned, DON'T logout
          // Just update ban info and show overlay. THEN return.
          if (isBanActive) {
            console.log('ℹ️ User is actively banned - showing ban overlay')

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
                const banData = {
                  isBanned: true,
                  type: 'temporary',
                  bannedUntil: banEndTime,
                  reason: latestBanHistory?.reason || 'Multiple device login detected',
                  banCount: updatedProfile.banCount || 0
                }
                setBanInfo(banData)
                localStorage.setItem('banInfo', JSON.stringify(banData))
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
            }

            // 💡 FIX: Return here! This prevents any further force logout checks.
            return
          }

          // No active ban - clear ban info
          setBanInfo(null)
          localStorage.removeItem('banInfo')

          // 💡 CRITICAL FIX: Only run Force Logout and Device Removal checks if the user is NOT actively BANNED.
          if (!isBanActive) {

            // Now check force logout
            const lastAckedLogoutAt = localStorage.getItem('lastAckedLogoutAt')
            const lastAckedTimestamp = lastAckedLogoutAt ? parseInt(lastAckedLogoutAt) : 0

            if (updatedProfile.forceLogoutAt) {
              const forceLogoutTimestamp = updatedProfile.forceLogoutAt.toMillis ?
                updatedProfile.forceLogoutAt.toMillis() :
                new Date(updatedProfile.forceLogoutAt).getTime()

              const timeSinceForceLogout = Date.now() - forceLogoutTimestamp
              const MAX_LOGOUT_VALIDITY = 5 * 60 * 1000

              const shouldForceLogout = (
                timeSinceForceLogout < MAX_LOGOUT_VALIDITY &&
                forceLogoutTimestamp > lastAckedTimestamp
              )

              if (shouldForceLogout) {
                const reason = updatedProfile.forceLogoutReason || 'Device removed by administrator'
                console.log(`✅ Force logout triggered: ${reason}`)
                localStorage.removeItem('deviceWarning')
                localStorage.removeItem('banInfo')
                localStorage.setItem('lastAckedLogoutAt', forceLogoutTimestamp.toString())
                await firebaseSignOut(auth)
                window.location.reload()
                return
              }
            }

            // Check if device was removed (This was the source of instant logout on second device)
            const devices = updatedProfile.devices || []
            const deviceFingerprint = currentDeviceInfo?.fingerprint || storedFingerprint
            const deviceExists = deviceFingerprint ? devices.some(d => d.fingerprint === deviceFingerprint) : false

            const timeSinceLogin = lastLoginTimestamp ? Date.now() - lastLoginTimestamp : Infinity
            const isRecentLogin = timeSinceLogin < 30000 // 30 seconds grace period

            if (!deviceExists && devices.length > 0 && !isRecentLogin && deviceFingerprint) {
              console.log('✅ Device has been removed (not banned) - Auto logout triggered')
              localStorage.removeItem('deviceWarning')
              localStorage.removeItem('banInfo')
              localStorage.removeItem('lastAckedLogoutAt')
              await firebaseSignOut(auth)
              window.location.reload()
              return
            }
          }
        }
      },
      (error) => {
        console.error("Error listening to profile updates:", error)
      }
    )

    return () => unsubscribe()
  }, [currentUser, lastLoginTimestamp, currentDeviceFingerprint]) // lastLoginTimestamp added as dependency

  // useEffect for deviceWarning (unchanged)
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

  // useEffect for banInfo (unchanged)
  useEffect(() => {
    if (currentUser && userProfile) {
      const storedBanInfo = localStorage.getItem('banInfo')
      if (storedBanInfo) {
        try {
          const parsed = JSON.parse(storedBanInfo)

          if (!userProfile.banned && !userProfile.permanentBan) {
            console.log('✅ User is not banned but has cached ban info - clearing it')
            localStorage.removeItem('banInfo')
            setBanInfo(null)
          } else if (parsed.bannedUntil) {
            const bannedUntilDate = new Date(parsed.bannedUntil)
            const now = new Date()
            if (bannedUntilDate <= now) {
              console.log('✅ Cached ban has expired - clearing it')
              localStorage.removeItem('banInfo')
              setBanInfo(null)
            } else {
              setBanInfo(parsed)
            }
          } else {
            setBanInfo(parsed)
          }
        } catch (e) {
          console.error('Error parsing ban info:', e)
          localStorage.removeItem('banInfo')
          setBanInfo(null)
        }
      }
    }
  }, [currentUser, userProfile])

  // useEffect for onAuthStateChanged (unchanged)
  useEffect(() => {
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
            try {
              const deviceInfo = await getDeviceInfo()
              if (deviceInfo && deviceInfo.fingerprint) {
                const storedFingerprint = localStorage.getItem('currentDeviceFingerprint')
                if (storedFingerprint !== deviceInfo.fingerprint || !currentDeviceFingerprint) {
                  setCurrentDeviceFingerprint(deviceInfo.fingerprint)
                  localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
                  console.log('✅ Device fingerprint captured/updated on auth state change')
                }
              }
            } catch (e) {
              console.warn('Could not capture device fingerprint on auth state change:', e)
            }
            await ensureAdminRole(user.uid, user.email)
            await fetchUserProfile(user.uid)
          } else {
            setUserProfile(null)
            localStorage.removeItem('currentDeviceFingerprint')
            setCurrentDeviceFingerprint(null)
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
    isBanned: banInfo?.isBanned || false,
    banInfo,
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
      try {
        if (currentUser) {
          const userRef = doc(db, "users", currentUser.uid)
          const userDoc = await getDoc(userRef)

          if (userDoc.exists()) {
            await updateDoc(userRef, {
              // 💡 FIX: ডিভাইস অ্যারে ক্লিয়ার করার বদলে forceLogoutAt সেট করা
              banned: false,
              banExpiresAt: null,
              forceLogoutAt: serverTimestamp(),
              forceLogoutReason: 'Ban expired - all devices logged out'
            })
            console.log('✅ Ban expired: Triggered force logout on all devices')
          }
        }
      } catch (error) {
        console.error('Error clearing devices after ban expiry:', error)
      }

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

  return (
    <AuthContext.Provider value={value}>
      {children}
      <BanOverlay banInfo={banInfo} onUnban={handleUnban} />
    </AuthContext.Provider>
  )
              }
