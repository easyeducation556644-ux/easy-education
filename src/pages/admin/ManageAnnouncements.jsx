import { useState, useEffect } from "react"
import { toast } from "../../hooks/use-toast"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, Megaphone } from "lucide-react"
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp
} from "firebase/firestore"
import { db } from "../../lib/firebase"
import { uploadImageToImgBB } from "../../lib/imgbb"
import { generateSlug } from "../../lib/slug"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageAnnouncements() {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    content: "",
    imageURL: ""
  })

  useEffect(() => {
    fetchAnnouncements()
  }, [])

  const fetchAnnouncements = async () => {
    try {
      const snapshot = await getDocs(collection(db, "announcements"))
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setAnnouncements(data)
    } catch (error) {
      console.error("Error fetching announcements:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const imageUrl = await uploadImageToImgBB(file)
      setFormData({ ...formData, imageURL: imageUrl })
      toast({
        title: "Success",
        description: "Image uploaded successfully!",
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        variant: "error",
        title: "Upload Failed",
        description: "Failed to upload image: " + error.message,
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      const announcementData = {
        ...formData,
        date: Timestamp.now(),
        updatedAt: serverTimestamp()
      }

      if (editingId) {
        const currentAnnouncement = announcements.find(a => a.id === editingId)
        if (!currentAnnouncement?.slug) {
          announcementData.slug = generateSlug(formData.title, editingId)
        }
        await updateDoc(doc(db, "announcements", editingId), announcementData)
        toast({
          title: "Success",
          description: "Announcement updated successfully!",
        })
      } else {
        const docRef = await addDoc(collection(db, "announcements"), announcementData)
        await updateDoc(doc(db, "announcements", docRef.id), {
          slug: generateSlug(formData.title, docRef.id)
        })
        toast({
          title: "Success",
          description: "Announcement created successfully!",
        })
      }

      setShowForm(false)
      setEditingId(null)
      setFormData({ title: "", description: "", content: "", imageURL: "" })
      fetchAnnouncements()
    } catch (error) {
      console.error("Error saving announcement:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save announcement",
      })
    }
  }

  const handleEdit = (announcement) => {
    setFormData({
      title: announcement.title || "",
      description: announcement.description || "",
      content: announcement.content || "",
      imageURL: announcement.imageURL || ""
    })
    setEditingId(announcement.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Announcement",
      message: "Are you sure you want to delete this announcement? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "announcements", id))
          toast({
            title: "Success",
            description: "Announcement deleted successfully!",
          })
          fetchAnnouncements()
        } catch (error) {
          console.error("Error deleting announcement:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete announcement",
          })
        }
      }
    })
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData({ title: "", description: "", content: "", imageURL: "" })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Megaphone className="w-8 h-8 text-primary" />
          Manage Announcements
        </h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Announcement
        </button>
      </div>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6 mb-6"
        >
          <h2 className="text-xl font-semibold mb-4">
            {editingId ? "Edit Announcement" : "Create New Announcement"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Short Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows="3"
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Full Content</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows="6"
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Image (imgbb)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploading}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg"
              />
              {uploading && <p className="text-sm text-muted-foreground mt-2">Uploading...</p>}
              {formData.imageURL && (
                <img
                  src={formData.imageURL}
                  alt="Preview"
                  className="mt-2 w-32 h-32 object-cover rounded-lg"
                />
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={uploading}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {editingId ? "Update" : "Create"} Announcement
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {announcements.map((announcement) => (
          <div
            key={announcement.id}
            className="bg-card border border-border rounded-xl p-6 flex items-center justify-between"
          >
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">{announcement.title}</h3>
              <p className="text-sm text-muted-foreground mb-2">{announcement.description}</p>
              <p className="text-xs text-muted-foreground">
                {announcement.date?.toDate?.()?.toLocaleDateString() || "Recently"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(announcement)}
                className="p-2 hover:bg-primary/10 rounded-lg transition-colors"
              >
                <Edit className="w-5 h-5 text-primary" />
              </button>
              <button
                onClick={() => handleDelete(announcement.id)}
                className="p-2 hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-5 h-5 text-destructive" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {announcements.length === 0 && (
        <div className="text-center py-12">
          <Megaphone className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No announcements yet. Create your first one!</p>
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
