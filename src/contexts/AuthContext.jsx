import { createContext, useContext, useState, useEffect } from "react"
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
} from "firebase/auth"
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot, collection, addDoc, query, where, getDocs, deleteField, Timestamp } from "firebase/firestore"
import { auth, db, googleProvider } from "../lib/firebase"
import { getDeviceInfo } from "../lib/deviceTracking"
import { BanOverlay } from "../components/BanOverlay"
import { usePresence } from "../hooks/usePresence"
import { toast } from "../hooks/use-toast"

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
  const [loginFlowComplete, setLoginFlowComplete] = useState(false)

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

      let devices = userData.devices || []
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
        const banEndTime = banExpiresAt.toDate ? banExpiresAt.toDate() : new Date(banExpiresAt)
        const now = new Date()

        if (banEndTime <= now) {
          console.log('✅ Ban expired during login - clearing all devices for fresh start')
          console.log(`📊 Current ban count: ${banCount} (will be preserved for tracking violations)`)
          
          // CRITICAL: Clear ALL devices when ban expires
          // This ensures fresh login required from ALL devices
          // Current device will be added below in normal flow
          await updateDoc(userRef, {
            banned: false,
            banExpiresAt: null,
            devices: []  // ✅ Clear all devices in database
            // banCount intentionally preserved for violation tracking
            // Current device will be added in normal flow below
          })
          
          // ✅ FIX: Also clear local devices variable to prevent re-ban
          devices = []
          
          localStorage.removeItem('banInfo')
          setBanInfo(null)
          
          // DO NOT return - continue to normal device management flow below
          // This allows current device to be added as the ONLY device
        } else {
          const banData = {
            isBanned: true,
            type: 'temporary',
            reason: banHistory[banHistory.length - 1]?.reason || 'Simultaneous login from multiple devices detected',
            bannedUntil: banEndTime,
            banCount: banCount
          }
          localStorage.setItem('banInfo', JSON.stringify(banData))
          setBanInfo(banData)
          return deviceInfo
        }
      }

      // No active ban - clear any cached ban info
      localStorage.removeItem('banInfo')
      setBanInfo(null)

      const now = new Date()
      const existingDevice = devices.find(d => d.fingerprint === deviceInfo.fingerprint)

      const storedDeviceID = localStorage.getItem('deviceID')
      const matchByDeviceID = storedDeviceID ? devices.find(d => d.id === storedDeviceID) : null

      if (!existingDevice && matchByDeviceID) {
        console.log('✅ Same device detected by ID but fingerprint changed (likely browser update) - updating fingerprint')
        const updatedDevices = devices.map(d =>
          d.id === storedDeviceID
            ? { ...d, fingerprint: deviceInfo.fingerprint, lastSeen: deviceInfo.timestamp, ipAddress: deviceInfo.ipAddress, userAgent: deviceInfo.userAgent }
            : d
        )
        await updateDoc(userRef, { devices: updatedDevices })
        return deviceInfo
      }

      if (!existingDevice) {
        toast({ title: "DEBUG 3", description: `New device - replacing ${devices.length} old device(s) with this one` })
        await updateDoc(userRef, {
          devices: [deviceInfo]
        })
        toast({ title: "DEBUG 4", description: "Device array updated in Firestore" })
      } else {
        toast({ title: "DEBUG 3", description: "Same device - updating last seen" })
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
      toast({ title: "DEBUG ERROR", description: `Device check error: ${error.message}` })
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

      const loginTimestamp = Date.now()
      setLastLoginTimestamp(loginTimestamp)
      localStorage.setItem('lastLoginTimestamp', loginTimestamp.toString())

      const profile = await fetchUserProfile(user.uid)
      setLoginFlowComplete(true)
      return { userCredential, profile }
    } catch (error) {
      console.error("Sign up error:", error)
      setLoginFlowComplete(true)
      throw error
    }
  }

  const signIn = async (email, password) => {
    try {
      setLoginFlowComplete(false)
      toast({ title: "DEBUG 1", description: "Login started - loginFlowComplete=false" })
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      toast({ title: "DEBUG 1.1", description: "Firebase auth success" })
      const userRef = doc(db, "users", userCredential.user.uid)

      const loginTimestamp = Date.now()
      setLastLoginTimestamp(loginTimestamp)
      localStorage.setItem('lastLoginTimestamp', loginTimestamp.toString())
      localStorage.setItem('lastAckedLogoutAt', loginTimestamp.toString())
      
      const deviceInfo = await getDeviceInfo()
      toast({ title: "DEBUG 1.2", description: `Got device fingerprint: ${deviceInfo?.fingerprint?.substring(0, 8)}...` })

      if (deviceInfo && deviceInfo.fingerprint) {
        setCurrentDeviceFingerprint(deviceInfo.fingerprint)
        localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
      }

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

          toast({ title: "DEBUG 2", description: `User exists, devices in DB: ${(userData.devices || []).length}` })
          await checkAndHandleDeviceLogin(
            userCredential.user.uid,
            userCredential.user.email,
            userData.name || "User"
          )
          toast({ title: "DEBUG 5", description: "checkAndHandleDeviceLogin done" })

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
        toast({ title: "DEBUG ERROR", description: `Firestore error: ${firestoreError.message}` })
      }

      const profile = await fetchUserProfile(userCredential.user.uid)
      toast({ title: "DEBUG 6", description: "Profile fetched" })

      if (profile.forceLogoutAt) {
        try {
          const forceLogoutTimestamp = profile.forceLogoutAt.toMillis ?
            profile.forceLogoutAt.toMillis() :
            new Date(profile.forceLogoutAt).getTime()
          const timeSinceForceLogout = Date.now() - forceLogoutTimestamp
          const CLEANUP_THRESHOLD = 2 * 60 * 1000

          if (timeSinceForceLogout > CLEANUP_THRESHOLD) {
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

      setLoginFlowComplete(true)
      toast({ title: "DEBUG 7", description: "Login flow COMPLETE - loginFlowComplete=true" })
      return { userCredential, profile }
    } catch (error) {
      console.error("Sign in error:", error)
      setLoginFlowComplete(true)
      throw error
    }
  }

  const signInWithGoogle = async () => {
    try {
      setLoginFlowComplete(false)
      toast({ title: "DEBUG G1", description: "Google login started - loginFlowComplete=false" })
      const userCredential = await signInWithPopup(auth, googleProvider)
      toast({ title: "DEBUG G1.1", description: "Google auth success" })
      const user = userCredential.user
      const userRef = doc(db, "users", user.uid)

      const loginTimestamp = Date.now()
      setLastLoginTimestamp(loginTimestamp)
      localStorage.setItem('lastLoginTimestamp', loginTimestamp.toString())
      localStorage.setItem('lastAckedLogoutAt', loginTimestamp.toString())
      
      const deviceInfo = await getDeviceInfo()
      toast({ title: "DEBUG G1.2", description: `Got device fingerprint: ${deviceInfo?.fingerprint?.substring(0, 8)}...` })

      if (deviceInfo && deviceInfo.fingerprint) {
        setCurrentDeviceFingerprint(deviceInfo.fingerprint)
        localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
      }

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

          toast({ title: "DEBUG G2", description: `User exists, devices in DB: ${(userData.devices || []).length}` })
          await checkAndHandleDeviceLogin(
            user.uid,
            user.email,
            userData.name || user.displayName || "User"
          )
          toast({ title: "DEBUG G5", description: "checkAndHandleDeviceLogin done" })

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
        toast({ title: "DEBUG G ERROR", description: `Firestore error: ${firestoreError.message}` })
      }

      const profile = await fetchUserProfile(user.uid)
      toast({ title: "DEBUG G6", description: "Profile fetched" })

      if (profile.forceLogoutAt) {
        try {
          const forceLogoutTimestamp = profile.forceLogoutAt.toMillis ?
            profile.forceLogoutAt.toMillis() :
            new Date(profile.forceLogoutAt).getTime()
          const timeSinceForceLogout = Date.now() - forceLogoutTimestamp
          const CLEANUP_THRESHOLD = 2 * 60 * 1000

          if (timeSinceForceLogout > CLEANUP_THRESHOLD) {
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

      setLoginFlowComplete(true)
      toast({ title: "DEBUG G7", description: "Google login flow COMPLETE - loginFlowComplete=true" })
      return { userCredential, profile }
    } catch (error) {
      console.error("Google sign in error:", error)
      setLoginFlowComplete(true)
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
        localStorage.removeItem('lastLoginTimestamp')
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

          const storedFingerprint = currentDeviceFingerprint || localStorage.getItem('currentDeviceFingerprint')

          // ===============================================
          // Check Ban Status FIRST
          // ===============================================
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

          // If ban expired, clear ban flags and force logout on ALL devices
          if (isBanned && !isBanActive && banExpiresAt) {
            console.log('✅ Ban has expired in snapshot listener - clearing all devices for fresh start')
            console.log(`📊 Preserving ban count: ${updatedProfile.banCount || 0} for violation tracking`)
            try {
              const userRef = doc(db, "users", currentUser.uid)
              
              const forceLogoutTimestamp = Timestamp.now()
              localStorage.setItem('lastAckedLogoutAt', (forceLogoutTimestamp.toMillis() + 2000).toString())
              
              // CRITICAL: Clear ALL devices when ban expires
              // This forces ALL devices to logout and require fresh login
              // banCount persists to track cumulative violations
              await updateDoc(userRef, {
                banned: false,
                banExpiresAt: null,
                devices: [],  // ✅ Clear all devices - force logout on ALL devices
                forceLogoutAt: forceLogoutTimestamp,
                forceLogoutReason: 'নিষেধাজ্ঞা সমাপ্ত - অনুগ্রহ করে আবার লগইন করুন'
                // banCount intentionally preserved for violation tracking
              })
              
              console.log(`✅ Ban cleared - ALL devices removed, users must login again`)
            } catch (error) {
              console.error('Error clearing ban on expiry:', error)
            }
            localStorage.removeItem('deviceWarning')
            localStorage.removeItem('banInfo')
            localStorage.removeItem('currentDeviceFingerprint')
            localStorage.removeItem('deviceID')
            localStorage.removeItem('lastLoginTimestamp')
            await firebaseSignOut(auth)
            window.location.reload()
            return
          }

          // 🔥 FIX: If user is actively banned, show ban overlay and STOP here
          if (isBanActive) {
            console.log('🚫 User is banned - showing overlay')
            console.log('🚫 Ban type:', updatedProfile.permanentBan ? 'permanent' : 'temporary')

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
                try {
                  const banEndTime = updatedProfile.banExpiresAt.toDate ? 
                    updatedProfile.banExpiresAt.toDate() : 
                    new Date(updatedProfile.banExpiresAt)
                  const banData = {
                    isBanned: true,
                    type: 'temporary',
                    bannedUntil: banEndTime,
                    reason: latestBanHistory?.reason || 'Multiple device login detected',
                    banCount: updatedProfile.banCount || 0
                  }
                  setBanInfo(banData)
                  localStorage.setItem('banInfo', JSON.stringify(banData))
                } catch (e) {
                  console.error('Error parsing ban expiration date')
                  const banData = {
                    isBanned: true,
                    type: 'permanent',
                    reason: latestBanHistory?.reason || 'Ban date parsing error',
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
            }

            return
          }

          setBanInfo(null)
          localStorage.removeItem('banInfo')

          if (updatedProfile.forceLogoutAt) {
            const forceLogoutTimestamp = updatedProfile.forceLogoutAt.toMillis ?
              updatedProfile.forceLogoutAt.toMillis() :
              new Date(updatedProfile.forceLogoutAt).getTime()
            const lastAckedLogoutAt = localStorage.getItem('lastAckedLogoutAt')
            const lastAckedTimestamp = lastAckedLogoutAt ? parseInt(lastAckedLogoutAt) : 0
            const timeSinceForceLogout = Date.now() - forceLogoutTimestamp

            if (timeSinceForceLogout < 300000 && forceLogoutTimestamp > lastAckedTimestamp) {
              toast({ title: "SNAPSHOT FORCE-LOGOUT", description: `Admin force logout! timeSince=${Math.round(timeSinceForceLogout/1000)}s` })
              localStorage.setItem('lastAckedLogoutAt', forceLogoutTimestamp.toString())
              localStorage.removeItem('currentDeviceFingerprint')
              localStorage.removeItem('lastLoginTimestamp')
              await firebaseSignOut(auth)
              window.location.reload()
              return
            }
          }

          const devices = updatedProfile.devices || []
          const deviceFingerprint = storedFingerprint
          const savedDeviceID = localStorage.getItem('deviceID')
          toast({ title: "SNAPSHOT", description: `loginFlowComplete=${loginFlowComplete}, devices=${devices.length}, myFP=${deviceFingerprint?.substring(0,8) || 'null'}, devicesInDB=${devices.map(d=>d.fingerprint?.substring(0,8)).join(',')}` })

          if (loginFlowComplete) {
            if (deviceFingerprint && devices.length > 0) {
              const deviceExists = devices.some(d => d.fingerprint === deviceFingerprint)
              const deviceExistsByID = savedDeviceID ? devices.some(d => d.id === savedDeviceID) : false

              if (!deviceExists && !deviceExistsByID) {
                toast({ title: "SNAPSHOT LOGOUT", description: "Device NOT in list - logging out!" })
                localStorage.removeItem('currentDeviceFingerprint')
                localStorage.removeItem('deviceID')
                localStorage.removeItem('lastLoginTimestamp')
                await firebaseSignOut(auth)
                window.location.reload()
                return
              } else {
                toast({ title: "SNAPSHOT OK", description: "Device found in list - staying logged in" })
              }
            }
          } else {
            toast({ title: "SNAPSHOT SKIP", description: "Skipping device check - login flow not complete" })
          }
        }
      },
      (error) => {
        console.error("Error listening to profile updates:", error)
      }
    )

    return () => unsubscribe()
  }, [currentUser, currentDeviceFingerprint, loginFlowComplete]) 
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
            const existingFingerprint = localStorage.getItem('currentDeviceFingerprint')
            if (existingFingerprint) {
              if (!currentDeviceFingerprint) {
                setCurrentDeviceFingerprint(existingFingerprint)
              }
            } else {
              try {
                const deviceInfo = await getDeviceInfo()
                if (deviceInfo && deviceInfo.fingerprint) {
                  setCurrentDeviceFingerprint(deviceInfo.fingerprint)
                  localStorage.setItem('currentDeviceFingerprint', deviceInfo.fingerprint)
                }
              } catch (e) {
                console.warn('Could not capture device fingerprint on auth state change:', e)
              }
            }

            const savedLoginTimestamp = localStorage.getItem('lastLoginTimestamp')
            if (savedLoginTimestamp && !lastLoginTimestamp) {
              setLastLoginTimestamp(parseInt(savedLoginTimestamp))
            }
            await ensureAdminRole(user.uid, user.email)
            await fetchUserProfile(user.uid)
            toast({ title: "AUTH STATE", description: `Returning user detected, setting loginFlowComplete=true, fp=${localStorage.getItem('currentDeviceFingerprint')?.substring(0,8) || 'null'}` })
            setLoginFlowComplete(true)
          } else {
            setUserProfile(null)
            localStorage.removeItem('currentDeviceFingerprint')
            localStorage.removeItem('lastLoginTimestamp')
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
            const userData = userDoc.data()
            const currentBanCount = userData.banCount || 0
            console.log('✅ Ban countdown expired - clearing ban status only')
            console.log(`📊 Preserving ban count: ${currentBanCount} and devices for proper violation tracking`)
            
            const forceLogoutTimestamp = Timestamp.now()
            localStorage.setItem('lastAckedLogoutAt', (forceLogoutTimestamp.toMillis() + 2000).toString())
            
            // CRITICAL FIX: Only clear ban flags, NOT devices
            // Preserving devices ensures next multi-device login properly triggers violation
            // banCount persists to track cumulative violations
            await updateDoc(userRef, {
              banned: false,
              banExpiresAt: null,
              forceLogoutAt: forceLogoutTimestamp,
              forceLogoutReason: 'Ban expired - please log in again'
              // banCount and devices intentionally NOT touched - preserved for violation tracking
            })
          }
        }
      } catch (error) {
        console.error('Error clearing ban after countdown expiry:', error)
      }

      localStorage.removeItem('deviceWarning')
      localStorage.removeItem('banInfo')
      localStorage.removeItem('currentDeviceFingerprint')
      localStorage.removeItem('deviceID')
      setBanInfo(null)
      
      await firebaseSignOut(auth)
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
