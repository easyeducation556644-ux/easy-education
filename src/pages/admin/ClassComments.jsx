import { toast } from "../../hooks/use-toast"
import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, Trash2, ExternalLink, MessageSquare, CornerDownRight } from "lucide-react"
import { collection, getDocs, deleteDoc, doc, query, orderBy } from "firebase/firestore"
import { db } from "../../lib/firebase"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useNavigate } from "react-router-dom"

export default function ClassComments() {
  const navigate = useNavigate()
  const [comments, setComments] = useState([])
  const [courses, setCourses] = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [commentsSnap, coursesSnap, classesSnap] = await Promise.all([
        getDocs(query(collection(db, "classComments"), orderBy("timestamp", "desc"))),
        getDocs(collection(db, "courses")),
        getDocs(collection(db, "classes")),
      ])

      const coursesData = coursesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      const classesData = classesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      
      setCourses(coursesData)
      setClasses(classesData)

      const commentsData = commentsSnap.docs.map((doc) => {
        const comment = { id: doc.id, ...doc.data() }
        const classInfo = classesData.find(c => c.id === comment.classId)
        const courseInfo = coursesData.find(c => c.id === classInfo?.courseId)
        
        return {
          ...comment,
          className: classInfo?.title || "Unknown Class",
          courseName: courseInfo?.title || "Unknown Course",
          courseId: classInfo?.courseId || null,
        }
      })

      setComments(commentsData)
    } catch (error) {
      console.error("Error fetching data:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load comments",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (commentId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Comment",
      message: "Are you sure you want to delete this comment? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "classComments", commentId))
          await fetchData()
          toast({
            title: "Success",
            description: "Comment deleted successfully",
          })
        } catch (error) {
          console.error("Error deleting comment:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete comment",
          })
        }
      }
    })
  }

  const handleGoToClass = (classId) => {
    navigate(`/courses/class/${classId}`)
  }

  const filteredComments = comments.filter(
    (comment) =>
      comment.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      comment.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      comment.courseName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      comment.className?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getReplyInfo = (comment) => {
    if (comment.replyTo) {
      const parentComment = comments.find(c => c.id === comment.replyTo)
      return parentComment
    }
    return null
  }

  const getReplies = (commentId) => {
    return comments.filter(c => c.replyTo === commentId)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Class Comments</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage all comments and replies</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search comments..."
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent"></div>
        </div>
      ) : filteredComments.length > 0 ? (
        <div className="space-y-3">
          {filteredComments.map((comment, index) => {
            const replyInfo = getReplyInfo(comment)
            const replies = getReplies(comment.id)
            const isReply = !!comment.replyTo

            return (
              <motion.div
                key={comment.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`bg-card border border-border rounded-lg p-4 ${isReply ? 'ml-8 border-l-4 border-l-primary/30' : ''}`}
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    {isReply && (
                      <CornerDownRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 text-xs rounded-full font-medium">
                          {comment.courseName}
                        </span>
                        <span className="text-muted-foreground text-xs">›</span>
                        <span className="px-2 py-0.5 bg-purple-500/10 text-purple-600 text-xs rounded-full font-medium">
                          {comment.className}
                        </span>
                        {isReply && replyInfo && (
                          <>
                            <span className="text-muted-foreground text-xs">›</span>
                            <span className="px-2 py-0.5 bg-orange-500/10 text-orange-600 text-xs rounded-full font-medium inline-flex items-center gap-1">
                              <CornerDownRight className="w-3 h-3" />
                              Reply to {replyInfo.userName}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{comment.userName}</span>
                          <span className="text-xs text-muted-foreground">
                            {comment.timestamp?.toDate().toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{comment.text}</p>
                      </div>

                      {replies.length > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                          <MessageSquare className="w-3 h-3" />
                          <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => handleGoToClass(comment.classId)}
                      className="flex-1 px-3 py-1.5 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5 text-xs font-medium"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Go to Class
                    </button>
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="flex-1 px-3 py-1.5 bg-red-500/10 text-red-600 rounded hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5 text-xs font-medium"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-1">No comments found</h3>
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "Try a different search term" : "No comments have been posted yet"}
          </p>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
      />
    </div>
  )
}
