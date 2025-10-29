import { useState, useEffect } from "react"
import { toast } from "../../hooks/use-toast"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, Loader2, User, Image as ImageIcon } from "lucide-react"
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { uploadImageToImgBB } from "../../lib/imgbb"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageTeachers() {
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTeacher, setEditingTeacher] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    bio: "",
    imageURL: "",
    expertise: "",
    order: 0,
  })

  useEffect(() => {
    fetchTeachers()
  }, [])

  const fetchTeachers = async () => {
    try {
      const snapshot = await getDocs(collection(db, "teachers"))
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      data.sort((a, b) => (b.order || 0) - (a.order || 0))
      setTeachers(data)
    } catch (error) {
      console.error("Error fetching teachers:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load teachers"
      })
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    try {
      const imageUrl = await uploadImageToImgBB(file)
      setFormData({ ...formData, imageURL: imageUrl })
      toast({
        title: "Success",
        description: "Image uploaded successfully!"
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        variant: "error",
        title: "Upload Failed",
        description: "Failed to upload image. Please try again."
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (editingTeacher) {
        await updateDoc(doc(db, "teachers", editingTeacher.id), {
          ...formData,
          updatedAt: serverTimestamp(),
        })
        toast({
          title: "Success",
          description: "Teacher updated successfully!"
        })
      } else {
        await addDoc(collection(db, "teachers"), {
          ...formData,
          createdAt: serverTimestamp(),
        })
        toast({
          title: "Success",
          description: "Teacher created successfully!"
        })
      }

      setFormData({ name: "", email: "", bio: "", imageURL: "", expertise: "", order: 0 })
      setShowForm(false)
      setEditingTeacher(null)
      fetchTeachers()
    } catch (error) {
      console.error("Error saving teacher:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save teacher. Please try again."
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (teacher) => {
    setEditingTeacher(teacher)
    setFormData({
      name: teacher.name,
      email: teacher.email || "",
      bio: teacher.bio || "",
      imageURL: teacher.imageURL || "",
      expertise: teacher.expertise || "",
      order: teacher.order || 0,
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Teacher",
      message: "Are you sure you want to delete this teacher? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "teachers", id))
          toast({
            title: "Success",
            description: "Teacher deleted successfully"
          })
          fetchTeachers()
        } catch (error) {
          console.error("Error deleting teacher:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete teacher. Please try again."
          })
        }
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Teachers</h1>
        <button
          onClick={() => {
            if (!showForm) {
              // Opening form for new teacher - calculate next order
              const maxOrder = teachers.length > 0 ? Math.max(...teachers.map(t => t.order || 0)) : 0
              setFormData({ name: "", email: "", bio: "", imageURL: "", expertise: "", order: maxOrder + 1 })
            } else {
              // Closing form
              setEditingTeacher(null)
              setFormData({ name: "", email: "", bio: "", imageURL: "", expertise: "", order: 0 })
            }
            setShowForm(!showForm)
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Teacher
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6"
        >
          <h2 className="text-xl font-semibold mb-4">{editingTeacher ? "Edit Teacher" : "Add New Teacher"}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Expertise</label>
              <input
                type="text"
                value={formData.expertise}
                onChange={(e) => setFormData({ ...formData, expertise: e.target.value })}
                placeholder="e.g., Mathematics, Physics, Computer Science"
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                rows={4}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Order</label>
              <input
                type="number"
                value={formData.order}
                onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Auto-calculated if empty"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Teachers are displayed in descending order (highest first). Leave empty for auto-increment.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Profile Photo</label>
              <div className="space-y-3">
                {formData.imageURL && (
                  <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-border mx-auto">
                    <img src={formData.imageURL} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex items-center justify-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg cursor-pointer transition-colors">
                    <ImageIcon className="w-4 h-4" />
                    <span className="text-sm">{uploading ? "Uploading..." : "Choose Photo"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                  {uploading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || uploading}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Saving..." : editingTeacher ? "Update" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setEditingTeacher(null)
                  setFormData({ name: "", email: "", bio: "", imageURL: "", expertise: "", order: 0 })
                }}
                className="px-6 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Teachers Grid */}
      {loading && teachers.length === 0 ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        </div>
      ) : teachers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teachers.map((teacher) => (
            <motion.div
              key={teacher.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-xl p-6 text-center"
            >
              <div className="relative w-24 h-24 mx-auto mb-4">
                {teacher.imageURL ? (
                  <img
                    src={teacher.imageURL}
                    alt={teacher.name}
                    className="w-full h-full rounded-full object-cover border-4 border-primary/20"
                  />
                ) : (
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                    <User className="w-12 h-12 text-white" />
                  </div>
                )}
              </div>

              <h3 className="font-semibold text-lg mb-1">{teacher.name}</h3>
              {teacher.expertise && <p className="text-sm text-primary mb-2">{teacher.expertise}</p>}
              {teacher.email && <p className="text-sm text-muted-foreground mb-3">{teacher.email}</p>}
              {teacher.bio && <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{teacher.bio}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(teacher)}
                  className="flex-1 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(teacher.id)}
                  className="flex-1 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-xl">
          <User className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No teachers yet. Add your first teacher!</p>
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
