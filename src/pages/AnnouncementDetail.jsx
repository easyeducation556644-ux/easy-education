import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { ArrowLeft, Calendar, Megaphone } from "lucide-react"
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"
import { isFirebaseId } from "../lib/slug"

export default function AnnouncementDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [announcement, setAnnouncement] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnnouncement()
  }, [id])

  const fetchAnnouncement = async () => {
    try {
      let announcementData = null
      
      if (isFirebaseId(id)) {
        const docRef = doc(db, "announcements", id)
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          announcementData = { id: docSnap.id, ...docSnap.data() }
        }
      } else {
        const q = query(collection(db, "announcements"), where("slug", "==", id))
        const querySnapshot = await getDocs(q)
        if (!querySnapshot.empty) {
          const docSnap = querySnapshot.docs[0]
          announcementData = { id: docSnap.id, ...docSnap.data() }
        }
      }
      
      if (announcementData) {
        setAnnouncement(announcementData)
      } else {
        alert("Announcement not found")
        navigate("/announcements")
      }
    } catch (error) {
      console.error("Error fetching announcement:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!announcement) {
    return null
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="container mx-auto max-w-4xl">
        <button
          onClick={() => navigate("/announcements")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Announcements
        </button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-8"
        >
          <div className="flex items-center gap-3 mb-6">
            <Megaphone className="w-8 h-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">{announcement.title}</h1>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <Calendar className="w-4 h-4" />
            <span>{announcement.date?.toDate?.()?.toLocaleDateString() || "Recently"}</span>
          </div>

          {announcement.imageURL && (
            <img
              src={announcement.imageURL}
              alt={announcement.title}
              className="w-full h-64 object-cover rounded-lg mb-6"
            />
          )}

          <div className="prose prose-lg max-w-none">
            <p className="text-foreground whitespace-pre-line leading-relaxed">
              {announcement.content || announcement.description}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
