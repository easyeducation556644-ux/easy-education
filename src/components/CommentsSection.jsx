import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageCircle, Reply, Send, User as UserIcon, Trash2, MoreVertical } from "lucide-react"
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  serverTimestamp,
  onSnapshot
} from "firebase/firestore"
import { db } from "../lib/firebase"
import { formatDistanceToNow } from "date-fns"

function CommentItem({ comment, currentUser, isAdmin, onReply, onDelete, depth = 0 }) {
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [replyText, setReplyText] = useState("")
  const [replies, setReplies] = useState([])
  const [showReplies, setShowReplies] = useState(true)
  const [showMenu, setShowMenu] = useState(false)

  useEffect(() => {
    if (depth > 10) return

    const repliesQuery = query(
      collection(db, "classComments"),
      where("parentId", "==", comment.id)
    )

    const unsubscribe = onSnapshot(repliesQuery, (snapshot) => {
      const repliesData = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .sort((a, b) => {
          if (!a.timestamp || !b.timestamp) return 0
          return a.timestamp.toDate() - b.timestamp.toDate()
        })
      setReplies(repliesData)
    })

    return () => unsubscribe()
  }, [comment.id, depth])

  const handleReplySubmit = async (e) => {
    e.preventDefault()
    if (!replyText.trim()) return

    await onReply(comment.id, replyText)
    setReplyText("")
    setShowReplyInput(false)
    setShowReplies(true)
  }

  const canDelete = currentUser && (currentUser.uid === comment.userId || isAdmin)

  return (
    <div className={`${depth > 0 ? 'ml-4 sm:ml-8 mt-3' : 'mt-4'}`}>
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {comment.userPhoto ? (
            <img
              src={comment.userPhoto}
              alt={comment.userName}
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover border-2 border-border"
            />
          ) : (
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="bg-muted rounded-2xl px-4 py-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-semibold text-sm">{comment.userName}</p>
              {canDelete && (
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-1 hover:bg-background rounded-full transition-colors"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg py-1 z-10">
                      <button
                        onClick={() => {
                          onDelete(comment.id)
                          setShowMenu(false)
                        }}
                        className="flex items-center gap-2 px-4 py-2 hover:bg-muted w-full text-left text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-sm">Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm break-words">{comment.text}</p>
          </div>

          <div className="flex items-center gap-4 mt-1 px-4">
            <span className="text-xs text-muted-foreground">
              {comment.timestamp ? formatDistanceToNow(comment.timestamp.toDate(), { addSuffix: true }) : "Just now"}
            </span>
            <button
              onClick={() => setShowReplyInput(!showReplyInput)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Reply
            </button>
            {replies.length > 0 && (
              <button
                onClick={() => setShowReplies(!showReplies)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {showReplies ? 'Hide' : 'Show'} {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>

          {showReplyInput && (
            <form onSubmit={handleReplySubmit} className="mt-2 flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply..."
                className="flex-1 px-4 py-2 bg-muted border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                autoFocus
              />
              <button
                type="submit"
                disabled={!replyText.trim()}
                className="p-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}

          {showReplies && replies.length > 0 && depth < 10 && (
            <div className="mt-2">
              {replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  currentUser={currentUser}
                  isAdmin={isAdmin}
                  onReply={onReply}
                  onDelete={onDelete}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CommentsSection({ classId, currentUser, isAdmin }) {
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!classId) return

    const commentsQuery = query(
      collection(db, "classComments"),
      where("classId", "==", classId)
    )

    const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
      const allComments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      
      const classTopLevelKey = `${classId}_toplevel`
      const topLevelComments = allComments
        .filter(comment => {
          const hasNewKey = comment.classTopLevelKey === classTopLevelKey
          const isLegacyTopLevel = comment.isTopLevel === true
          const hasNoParent = !comment.parentId || comment.parentId === "" || comment.parentId === null
          
          return hasNewKey || isLegacyTopLevel || hasNoParent
        })
        .filter(comment => {
          const hasParentId = comment.parentId && comment.parentId !== "" && comment.parentId !== null
          return !hasParentId || comment.classTopLevelKey === classTopLevelKey
        })
        .sort((a, b) => {
          if (!a.timestamp || !b.timestamp) return 0
          return b.timestamp.toDate() - a.timestamp.toDate()
        })
      
      setComments(topLevelComments)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [classId])

  const handleCommentSubmit = async (e) => {
    e.preventDefault()
    if (!commentText.trim() || !currentUser) return

    try {
      const classTopLevelKey = `${classId}_toplevel`
      await addDoc(collection(db, "classComments"), {
        classId,
        classTopLevelKey,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || "User",
        userPhoto: currentUser.photoURL || null,
        text: commentText,
        parentId: "",
        isTopLevel: true,
        timestamp: serverTimestamp(),
      })

      setCommentText("")
    } catch (error) {
      console.error("Error posting comment:", error)
    }
  }

  const handleReply = async (parentId, text) => {
    if (!text.trim() || !currentUser) return

    try {
      await addDoc(collection(db, "classComments"), {
        classId,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || "User",
        userPhoto: currentUser.photoURL || null,
        text: text,
        parentId: parentId,
        isTopLevel: false,
        timestamp: serverTimestamp(),
      })
    } catch (error) {
      console.error("Error posting reply:", error)
    }
  }

  const handleDelete = async (commentId) => {
    const confirmed = window.confirm("Are you sure you want to delete this comment?")
    if (!confirmed) return

    try {
      await deleteDoc(doc(db, "classComments", commentId))
    } catch (error) {
      console.error("Error deleting comment:", error)
    }
  }

  if (!currentUser) {
    return (
      <div className="bg-card border border-border rounded-lg sm:rounded-xl p-6 text-center">
        <MessageCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">Please log in to view and post comments</p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg sm:rounded-xl p-4 sm:p-6 shadow-lg">
      <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 mb-4">
        <MessageCircle className="w-5 h-5 text-primary" />
        Comments
      </h2>

      <form onSubmit={handleCommentSubmit} className="mb-6">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            {currentUser.photoURL ? (
              <img
                src={currentUser.photoURL}
                alt={currentUser.displayName || "User"}
                className="w-10 h-10 rounded-full object-cover border-2 border-border"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <UserIcon className="w-5 h-5 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment..."
              className="flex-1 px-4 py-2 bg-muted border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!commentText.trim()}
              className="p-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </form>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No comments yet. Be the first to comment!</p>
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUser={currentUser}
              isAdmin={isAdmin}
              onReply={handleReply}
              onDelete={handleDelete}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  )
}
