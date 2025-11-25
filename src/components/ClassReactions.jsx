import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp, onSnapshot, setDoc, getDoc } from "firebase/firestore"
import { db } from "../lib/firebase"

const REACTIONS = [
  { type: "like", emoji: "👍", label: "Like", color: "#1877f2" },
  { type: "love", emoji: "❤️", label: "Love", color: "#f33e58" },
  { type: "haha", emoji: "😂", label: "Haha", color: "#f7b125" },
  { type: "wow", emoji: "😮", label: "Wow", color: "#f7b125" },
  { type: "sad", emoji: "😢", label: "Sad", color: "#f7b125" },
  { type: "angry", emoji: "😠", label: "Angry", color: "#f15268" },
]

export default function ClassReactions({ classId, currentUser }) {
  const [userReaction, setUserReaction] = useState(null)
  const [reactionDocId, setReactionDocId] = useState(null)
  const [reactionCounts, setReactionCounts] = useState({})
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [showReactionDetails, setShowReactionDetails] = useState(false)
  const [reactionUsers, setReactionUsers] = useState({})
  const pickerRef = useRef(null)
  const buttonRef = useRef(null)
  const longPressTimer = useRef(null)

  useEffect(() => {
    if (classId) {
      const unsubscribe = setupReactionListener()
      return () => unsubscribe && unsubscribe()
    }
  }, [classId])

  useEffect(() => {
    if (classId && currentUser) {
      checkUserReaction()
    }
  }, [classId, currentUser])

  useEffect(() => {
    function handleClickOutside(event) {
      if (pickerRef.current && !pickerRef.current.contains(event.target) && 
          buttonRef.current && !buttonRef.current.contains(event.target)) {
        setShowReactionPicker(false)
      }
    }

    if (showReactionPicker) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showReactionPicker])

  const checkUserReaction = async () => {
    try {
      const reactionDocId = `${currentUser.uid}_${classId}`
      const reactionDocRef = doc(db, "classReactions", reactionDocId)
      const reactionDoc = await getDoc(reactionDocRef)
      
      if (reactionDoc.exists()) {
        setUserReaction(reactionDoc.data().type)
        setReactionDocId(reactionDoc.id)
      } else {
        setUserReaction(null)
        setReactionDocId(null)
      }
    } catch (error) {
      console.error("Error checking reaction:", error)
    }
  }

  const setupReactionListener = () => {
    try {
      const reactionsQuery = query(
        collection(db, "classReactions"),
        where("classId", "==", classId)
      )
      
      const unsubscribe = onSnapshot(reactionsQuery, (snapshot) => {
        const counts = {}
        const users = {}
        
        snapshot.docs.forEach(doc => {
          const data = doc.data()
          const type = data.type
          counts[type] = (counts[type] || 0) + 1
          
          if (!users[type]) users[type] = []
          users[type].push({
            userId: data.userId,
            userName: data.userName || "User",
            userPhoto: data.userPhoto || null
          })
        })
        
        setReactionCounts(counts)
        setReactionUsers(users)
      })
      
      return unsubscribe
    } catch (error) {
      console.error("Error setting up reaction listener:", error)
      return null
    }
  }

  const handleReaction = async (type) => {
    if (!currentUser || !classId) return

    try {
      const reactionDocId = `${currentUser.uid}_${classId}`
      const reactionDocRef = doc(db, "classReactions", reactionDocId)

      if (userReaction === type) {
        await deleteDoc(reactionDocRef)
        setUserReaction(null)
        setReactionDocId(null)
      } else {
        const reactionData = {
          userId: currentUser.uid,
          userName: currentUser.displayName || currentUser.email || "User",
          userPhoto: currentUser.photoURL || null,
          classId: classId,
          type: type,
          timestamp: serverTimestamp(),
        }
        
        await setDoc(reactionDocRef, reactionData)
        setUserReaction(type)
        setReactionDocId(reactionDocId)
      }
      
      setShowReactionPicker(false)
    } catch (error) {
      console.error("Error handling reaction:", error)
    }
  }

  const handleMouseEnter = () => {
    longPressTimer.current = setTimeout(() => {
      setShowReactionPicker(true)
    }, 500)
  }

  const handleMouseLeave = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
  }

  const handleTouchStart = (e) => {
    longPressTimer.current = setTimeout(() => {
      setShowReactionPicker(true)
      e.preventDefault()
    }, 500)
  }

  const handleTouchEnd = (e) => {
    if (longPressTimer.current) {
      const timerStillActive = longPressTimer.current
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      
      if (!showReactionPicker && timerStillActive) {
        handleReaction("like")
      }
    }
  }

  const handleClick = (e) => {
    if (!showReactionPicker) {
      handleReaction("like")
    }
  }

  const totalReactions = Object.values(reactionCounts).reduce((sum, count) => sum + count, 0)
  const topReactions = Object.entries(reactionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type)

  const getUserReaction = () => {
    return REACTIONS.find(r => r.type === userReaction)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative" ref={buttonRef}>
          <button
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all text-sm sm:text-base font-medium ${
              userReaction
                ? `bg-gradient-to-r from-primary/20 to-secondary/20 border-2 border-primary shadow-lg`
                : "bg-muted hover:bg-muted/80 text-foreground border-2 border-transparent"
            }`}
          >
            <span className="text-2xl">{getUserReaction()?.emoji || "👍"}</span>
            <span>{getUserReaction()?.label || "Like"}</span>
          </button>

          <AnimatePresence>
            {showReactionPicker && (
              <motion.div
                ref={pickerRef}
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className="absolute bottom-full left-0 mb-2 bg-card border-2 border-border rounded-full shadow-2xl p-2 flex gap-1 z-50"
              >
                {REACTIONS.map((reaction) => (
                  <motion.button
                    key={reaction.type}
                    onClick={() => handleReaction(reaction.type)}
                    whileHover={{ scale: 1.3 }}
                    whileTap={{ scale: 0.9 }}
                    className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
                    title={reaction.label}
                  >
                    <span className="text-3xl">{reaction.emoji}</span>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {totalReactions > 0 && (
          <button
            onClick={() => setShowReactionDetails(!showReactionDetails)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="flex -space-x-1">
              {topReactions.map((type) => {
                const reaction = REACTIONS.find(r => r.type === type)
                return (
                  <span 
                    key={type} 
                    className="inline-block w-6 h-6 bg-white rounded-full border-2 border-background flex items-center justify-center text-sm"
                  >
                    {reaction.emoji}
                  </span>
                )
              })}
            </div>
            <span className="text-sm text-muted-foreground font-medium">{totalReactions}</span>
          </button>
        )}
      </div>

      <AnimatePresence>
        {showReactionDetails && totalReactions > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-card border border-border rounded-lg p-4 overflow-hidden"
          >
            <h3 className="font-semibold mb-3">Reactions</h3>
            <div className="space-y-2">
              {REACTIONS.filter(r => reactionCounts[r.type] > 0).map((reaction) => (
                <div key={reaction.type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{reaction.emoji}</span>
                    <span className="font-medium">{reaction.label}</span>
                  </div>
                  <span className="text-muted-foreground font-semibold">{reactionCounts[reaction.type]}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
