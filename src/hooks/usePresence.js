import { useEffect, useRef } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

export function usePresence(currentUser) {
  const heartbeatIntervalRef = useRef(null)
  const isOnlineRef = useRef(false)
  const isSettingOfflineRef = useRef(false)

  useEffect(() => {
    if (!currentUser) return

    const userRef = doc(db, 'users', currentUser.uid)

    const setOnlineStatus = async (online) => {
      try {
        isOnlineRef.current = online
        await updateDoc(userRef, {
          online,
          lastActive: serverTimestamp()
        })
      } catch (error) {
        console.error('Error updating online status:', error)
      }
    }

    const setOfflineStatus = async () => {
      if (!isSettingOfflineRef.current && isOnlineRef.current) {
        isSettingOfflineRef.current = true
        try {
          await updateDoc(userRef, {
            online: false,
            lastActive: serverTimestamp()
          })
          isOnlineRef.current = false
        } catch (error) {
          console.error('Error setting offline status:', error)
        }
      }
    }

    const handleBeforeUnload = (e) => {
      if (isOnlineRef.current) {
        const blob = new Blob([JSON.stringify({ uid: currentUser.uid })], { type: 'application/json' })
        navigator.sendBeacon('/api/user-offline', blob)
        
        try {
          updateDoc(userRef, {
            online: false,
            lastActive: serverTimestamp()
          })
        } catch (error) {
          console.error('Error in beforeunload:', error)
        }
      }
    }

    const handlePageHide = () => {
      setOfflineStatus()
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setOfflineStatus()
      } else {
        isSettingOfflineRef.current = false
        setOnlineStatus(true)
      }
    }

    const handleBlur = () => {
      setTimeout(() => {
        if (document.hidden) {
          setOfflineStatus()
        }
      }, 1000)
    }

    setOnlineStatus(true)

    heartbeatIntervalRef.current = setInterval(() => {
      if (!document.hidden && isOnlineRef.current) {
        setOnlineStatus(true)
      }
    }, 30000)

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
      }
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      setOfflineStatus()
    }
  }, [currentUser])
}
