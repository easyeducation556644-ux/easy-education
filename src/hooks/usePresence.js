import { useEffect, useRef } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

export function usePresence(currentUser) {
  const heartbeatIntervalRef = useRef(null)
  const isOnlineRef = useRef(false)

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
      if (isOnlineRef.current) {
        setOnlineStatus(false)
      }
    }

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setOnlineStatus(true)
      }
    }

    setOnlineStatus(true)

    heartbeatIntervalRef.current = setInterval(() => {
      setOnlineStatus(true)
    }, 15000)

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
      }
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      setOnlineStatus(false)
    }
  }, [currentUser])
}
