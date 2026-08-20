import { toast } from "../../hooks/use-toast"
import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Search, Trash2, ExternalLink, MessageSquare, CornerDownRight } from "lucide-react"
import { collection, getDocs, deleteDoc, doc, query, orderBy } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../contexts/AuthContext"
import { ADMIN_PERMISSION_KEYS, getAllowedCourseIds } from "../../lib/adminPermissions"

export default function ClassComments() {
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  useEffect(() => {
    fetchData()
  }, [userProfile])

  const fetchData = async () => {
    setLoading(true)
    try {
      const allowedCourseIds = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.CLASS_COMMENTS)
      const [commentsSnap, coursesSnap, classesSnap] = await Promise.all([
        getDocs(query(collection(db, "classComments"), orderBy("timestamp", "desc"))),
        getDocs(collection(db, "courses")),
        getDocs(collection(db, "classes")),
      ])

      const allowed = allowedCourseIds === null ? null : new Set(allowedCourseIds)
      const coursesData = coursesSnap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((course) => allowed === null || allowed.has(course.id))
      const courseIds = new Set(coursesData.map((course) => course.id))
      const classesData = classesSnap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((classItem) => courseIds.has(classItem.courseId))
      const classById = new Map(classesData.map((classItem) => [classItem.id, classItem]))
      const courseById = new Map(coursesData.map((course) => [course.id, course]))

      setComments(
        commentsSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .map((comment) => {
            const classInfo = classById.get(comment.classId)
            if (!classInfo) return null
            const courseInfo = courseById.get(classInfo.courseId)
            return {
              ...comment,
              className: classInfo.title || "Unknown Class",
              courseName: courseInfo?.title || "Unknown Course",
              courseId: classInfo.courseId,
            }
          })
          .filter(Boolean),
      )
    } catch (error) {
      console.error("Error fetching comments:", error)
      toast({ variant: "error", title: "Error", description: "Failed to load comments" })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = (commentId) => {
    const comment = comments.find((item) => item.id === commentId)
    if (!comment) return
    const allowed = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.CLASS_COMMENTS)
    if (allowed !== null && !allowed.includes(comment.courseId)) return

    setConfirmDialog({
      isOpen: true,
      title: "Delete Comment",
      message: "Are you sure you want to delete this comment? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "classComments", commentId))
          await fetchData()
          toast({ title: "Success", description: "Comment deleted successfully" })
        } catch (error) {
          toast({ variant: "error", title: "Error", description: error.message || "Failed to delete comment" })
        }
      },
    })
  }

  const filteredComments = comments.filter((comment) => {
    const search = searchQuery.toLowerCase()
    return comment.text?.toLowerCase().includes(search)
      || comment.userName?.toLowerCase().includes(search)
      || comment.courseName?.toLowerCase().includes(search)
      || comment.className?.toLowerCase().includes(search)
  })

  const parentFor = (comment) => comment.replyTo ? comments.find((item) => item.id === comment.replyTo) : null
  const repliesFor = (commentId) => comments.filter((item) => item.replyTo === commentId)

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl sm:text-2xl font-bold">Class Comments</h1><p className="text-xs sm:text-sm text-muted-foreground">Only comments from your assigned course scope are visible.</p></div>
      <div className="bg-card border border-border rounded-lg p-3 sm:p-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search comments..." className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg text-sm" /></div></div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent" /></div>
      ) : filteredComments.length > 0 ? (
        <div className="space-y-3">
          {filteredComments.map((comment, index) => {
            const parent = parentFor(comment)
            const replies = repliesFor(comment.id)
            const isReply = Boolean(comment.replyTo)
            return (
              <motion.div key={comment.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.04, 0.28) }} className={`bg-card border border-border rounded-lg p-4 ${isReply ? "ml-8 border-l-4 border-l-primary/30" : ""}`}>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    {isReply && <CornerDownRight className="w-4 h-4 text-muted-foreground mt-1" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap"><span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 text-xs rounded-full">{comment.courseName}</span><span className="text-xs text-muted-foreground">›</span><span className="px-2 py-0.5 bg-purple-500/10 text-purple-600 text-xs rounded-full">{comment.className}</span>{isReply && parent && <span className="px-2 py-0.5 bg-orange-500/10 text-orange-600 text-xs rounded-full">Reply to {parent.userName}</span>}</div>
                      <div className="flex items-center gap-2 mb-2"><span className="font-semibold text-sm">{comment.userName}</span><span className="text-xs text-muted-foreground">{comment.timestamp?.toDate?.()?.toLocaleString?.() || "Unknown time"}</span></div>
                      <p className="text-sm whitespace-pre-wrap">{comment.text}</p>
                      {replies.length > 0 && <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><MessageSquare className="w-3 h-3" />{replies.length} {replies.length === 1 ? "reply" : "replies"}</div>}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-border"><button onClick={() => comment.courseId && comment.classId ? navigate(`/course/${comment.courseId}/watch/${comment.classId}`) : toast({ variant: "error", title: "Class unavailable" })} className="flex-1 px-3 py-1.5 bg-primary/10 text-primary rounded flex items-center justify-center gap-1.5 text-xs"><ExternalLink className="w-3 h-3" />Go to Class</button><button onClick={() => handleDelete(comment.id)} className="flex-1 px-3 py-1.5 bg-red-500/10 text-red-600 rounded flex items-center justify-center gap-1.5 text-xs"><Trash2 className="w-3 h-3" />Delete</button></div>
                </div>
              </motion.div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-lg"><MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" /><h3 className="text-base font-semibold mb-1">No comments found</h3><p className="text-sm text-muted-foreground">{searchQuery ? "Try a different search term" : "No comments exist in the assigned courses."}</p></div>
      )}

      <ConfirmDialog isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog((current) => ({ ...current, isOpen: false }))} onConfirm={confirmDialog.onConfirm} title={confirmDialog.title} message={confirmDialog.message} variant={confirmDialog.variant} />
    </div>
  )
}
