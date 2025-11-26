import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { ThumbsUp, Heart, Laugh, Sparkles, Angry } from "lucide-react"
import { collection, query, where, deleteDoc, doc, serverTimestamp, onSnapshot, setDoc, getDoc } from "firebase/firestore"
import { db } from "../lib/firebase"

const REACTIONS = [
  { 
    type: "like", 
    icon: ThumbsUp, 
    label: "Like", 
    color: "#1778F2",
    bgColor: "rgba(23, 120, 242, 0.15)",
    hoverBgColor: "rgba(23, 120, 242, 0.25)"
  },
  { 
    type: "love", 
    icon: Heart, 
    label: "Love", 
    color: "#F0284A",
    bgColor: "rgba(240, 40, 74, 0.15)",
    hoverBgColor: "rgba(240, 40, 74, 0.25)"
  },
  { 
    type: "haha", 
    icon: Laugh, 
    label: "Haha", 
    color: "#F7B125",
    bgColor: "rgba(247, 177, 37, 0.15)",
    hoverBgColor: "rgba(247, 177, 37, 0.25)"
  },
  { 
    type: "wow", 
    icon: Sparkles, 
    label: "Wow", 
    color: "#FAD664",
    bgColor: "rgba(250, 214, 100, 0.15)",
    hoverBgColor: "rgba(250, 214, 100, 0.25)"
  },
  { 
    type: "angry", 
    icon: Angry, 
    label: "Angry", 
    color: "#E9710F",
    bgColor: "rgba(233, 113, 15, 0.15)",
    hoverBgColor: "rgba(233, 113, 15, 0.25)"
  },
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
          const Icon = reaction.icon
          
          return (
            <motion.button
              key={reaction.type}
              onClick={() => handleReaction(reaction.type)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              style={{
                backgroundColor: isActive ? reaction.bgColor : undefined,
                borderColor: isActive ? reaction.color : undefined,
              }}
              className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl transition-all border-2 ${
                isActive
                  ? "shadow-lg"
                  : "bg-muted/50 hover:bg-muted border-transparent hover:border-border"
              }`}
              title={reaction.label}
            >
              <Icon 
                className="w-6 h-6 sm:w-7 sm:h-7" 
                strokeWidth={2.5}
                style={{ color: isActive ? reaction.color : undefined }}
                color={isActive ? reaction.color : "currentColor"}
              />
              <span 
                className="text-xs font-bold"
                style={{ color: isActive ? reaction.color : undefined }}
              >
                {count}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
