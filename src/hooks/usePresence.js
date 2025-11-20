import { useEffect } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

export function usePresence(currentUser) {
  useEffect(() => {
    if (!currentUser) return

    const userRef = doc(db, 'users', currentUser.uid)
    let isVisible = !document.hidden
    let heartbeatInterval = null

    const setOnlineStatus = async (online) => {
      try {
        await updateDoc(userRef, {
          online,
          lastActive: serverTimestamp()
        })
      } catch (error) {
        console.error('Error updating online status:', error)
      }
    }

    const handleVisibilityChange = () => {
      isVisible = !document.hidden
      setOnlineStatus(isVisible)
    }

    const handleBeforeUnload = () => {
      setOnlineStatus(false)
    }

    const handleFocus = () => {
      setOnlineStatus(true)
    }

    const handleBlur = () => {
      setOnlineStatus(false)
    }

    setOnlineStatus(true)

    heartbeatInterval = setInterval(() => {
      if (isVisible) {
        setOnlineStatus(true)
      }
    }, 30000)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      clearInterval(heartbeatInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      setOnlineStatus(false)
    }
  }, [currentUser])
}
