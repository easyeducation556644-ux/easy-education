import { useEffect } from 'react'
import { doc, updateDoc, serverTimestamp, onDisconnect } from 'firebase/firestore'
import { db } from '../lib/firebase'

export function usePresence(currentUser) {
  useEffect(() => {
    if (!currentUser) return

    const userRef = doc(db, 'users', currentUser.uid)
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

    const handleBeforeUnload = () => {
      navigator.sendBeacon(`/api/user-offline?uid=${currentUser.uid}`)
      setOnlineStatus(false)
    }

    const handlePageHide = () => {
      setOnlineStatus(false)
    }

    setOnlineStatus(true)

    heartbeatInterval = setInterval(() => {
      setOnlineStatus(true)
    }, 30000)

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      clearInterval(heartbeatInterval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
      setOnlineStatus(false)
    }
  }, [currentUser])
}
