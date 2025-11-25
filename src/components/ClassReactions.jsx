import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { collection, query, where, deleteDoc, doc, serverTimestamp, onSnapshot, setDoc, getDoc } from "firebase/firestore"
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
        
        snapshot.docs.forEach(doc => {
          const data = doc.data()
          const type = data.type
          counts[type] = (counts[type] || 0) + 1
        })
        
        setReactionCounts(counts)
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
    } catch (error) {
      console.error("Error handling reaction:", error)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {REACTIONS.map((reaction) => {
          const count = reactionCounts[reaction.type] || 0
          const isActive = userReaction === reaction.type
          
          return (
            <motion.button
              key={reaction.type}
              onClick={() => handleReaction(reaction.type)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all border-2 ${
                isActive
                  ? "bg-gradient-to-r from-primary/20 to-secondary/20 border-primary shadow-lg"
                  : "bg-muted/50 hover:bg-muted border-transparent hover:border-border"
              }`}
              title={reaction.label}
            >
              <span className="text-2xl sm:text-3xl">{reaction.emoji}</span>
              <span className={`text-xs font-semibold ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                {count}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
