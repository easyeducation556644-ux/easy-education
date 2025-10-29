"use client"
import { toast } from "../../hooks/use-toast"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, X, Upload, Loader2 } from "lucide-react"
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where } from "firebase/firestore"
import { db } from "../../lib/firebase"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageSubjects() {
  const [courses, setCourses] = useState([])
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [editingSubject, setEditingSubject] = useState(null)
  const [selectedCourse, setSelectedCourse] = useState("")
  const [bulkSubjects, setBulkSubjects] = useState([{ title: "" }])
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [formData, setFormData] = useState({
    title: "",
    imageUrl: "",
    imageType: "upload",
    imageLink: "",
    courseIds: [],
    order: 0,
  })

  useEffect(() => {
    fetchCourses()
    fetchSubjects()
  }, [])

  const fetchCourses = async () => {
    try {
      const coursesSnapshot = await getDocs(collection(db, "courses"))
      const coursesData = coursesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      setCourses(coursesData)
    } catch (error) {
      console.error("Error fetching courses:", error)
    }
  }

  const fetchSubjects = async () => {
    try {
      const snapshot = await getDocs(collection(db, "subjects"))
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      data.sort((a, b) => (b.order || 0) - (a.order || 0))
      setSubjects(data)
    } catch (error) {
      console.error("Error fetching subjects:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast({
        variant: "error",
        title: "Invalid File",
        description: "Please select an image file.",
      })
      return
    }

    const maxSize = 5 * 1024 * 1024
    if (file.size > maxSize) {
      toast({
        variant: "error",
        title: "File Too Large",
        description: "Image must be less than 5MB.",
      })
      return
    }

    setUploading(true)
    try {
      const reader = new FileReader()
      
      const uploadPromise = new Promise((resolve, reject) => {
        reader.onload = async () => {
          try {
            const base64 = reader.result.split(",")[1]
            
            const response = await fetch("/api/upload-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image: base64 }),
            })

            const data = await response.json()
            
            if (data.success && data.url) {
              resolve(data.url)
            } else {
              reject(new Error(data.error || "Upload failed"))
            }
          } catch (err) {
            reject(err)
          }
        }
        
        reader.onerror = () => reject(new Error("Failed to read file"))
      })

      reader.readAsDataURL(file)
      const url = await uploadPromise
      
      setFormData({ ...formData, imageUrl: url })
      toast({
        variant: "success",
        title: "Success",
        description: "Image uploaded successfully!",
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        variant: "error",
        title: "Upload Failed",
        description: error.message || "Failed to upload image. Please try again.",
      })
    } finally {
      setUploading(false)
    }
  }

  const handleOpenModal = (subject = null) => {
    if (subject) {
      setEditingSubject(subject)
      setFormData({
        title: subject.title,
        imageUrl: subject.imageUrl || "",
        imageType: subject.imageUrl?.startsWith("http") ? "link" : "upload",
        imageLink: subject.imageUrl || "",
        courseIds: Array.isArray(subject.courseIds) ? subject.courseIds : subject.courseId ? [subject.courseId] : [],
        order: subject.order || 0,
      })
    } else {
      setEditingSubject(null)
      const maxOrder = subjects.length > 0 ? Math.max(...subjects.map(s => s.order || 0)) : 0
      setFormData({
        title: "",
        imageUrl: "",
        imageType: "upload",
        imageLink: "",
        courseIds: [],
        order: maxOrder + 1,
      })
    }
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingSubject(null)
    setFormData({
      title: "",
      imageUrl: "",
      imageType: "upload",
      imageLink: "",
      courseIds: [],
      order: 0,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.courseIds || formData.courseIds.length === 0) {
      toast({
        variant: "error",
        title: "Validation Error",
        description: "Please select at least one course for this subject.",
      })
      return
    }

    try {
      let finalImageUrl = formData.imageUrl

      // If imageType is "link", use the imageLink field
      if (formData.imageType === "link") {
        finalImageUrl = formData.imageLink
      }

      const dataToSave = {
        title: formData.title,
        imageUrl: finalImageUrl,
        courseIds: formData.courseIds,
        courseId: formData.courseIds[0] || "", // Legacy field for backwards compatibility
        order: formData.order,
      }

      if (editingSubject) {
        await updateDoc(doc(db, "subjects", editingSubject.id), {
          ...dataToSave,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, "subjects"), {
          ...dataToSave,
          createdAt: serverTimestamp(),
        })
      }

      await fetchSubjects()
      handleCloseModal()
      toast({
        title: "Success",
        description: editingSubject ? "Subject updated successfully!" : "Subject created successfully!",
      })
    } catch (error) {
      console.error("Error saving subject:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save subject",
      })
    }
  }

  const handleDelete = async (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Subject",
      message: "Are you sure you want to delete this subject? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "subjects", id))
          await fetchSubjects()
          toast({
            title: "Success",
            description: "Subject deleted successfully",
          })
        } catch (error) {
          console.error("Error deleting subject:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete subject",
          })
        }
      }
    })
  }

  const handleBulkAdd = (index) => {
    setBulkSubjects([...bulkSubjects.slice(0, index + 1), { title: "" }, ...bulkSubjects.slice(index + 1)])
  }

  const handleBulkRemove = (index) => {
    if (bulkSubjects.length > 1) {
      setBulkSubjects(bulkSubjects.filter((_, i) => i !== index))
    }
  }

  const handleBulkChange = (index, field, value) => {
    const updated = [...bulkSubjects]
    updated[index][field] = value
    setBulkSubjects(updated)
  }

  const handleBulkSubmit = async (e) => {
    e.preventDefault()
    
    if (!selectedCourse) {
      toast({
        variant: "error",
        title: "Course Required",
        description: "Please select a batch course first!",
      })
      return
    }

    const validSubjects = bulkSubjects.filter(s => s.title.trim() !== "")
    if (validSubjects.length === 0) {
      toast({
        variant: "error",
        title: "No Subjects",
        description: "Please add at least one subject with a title!",
      })
      return
    }

    setSubmitting(true)
    try {
      const maxOrder = subjects.length > 0 ? Math.max(...subjects.map(s => s.order || 0)) : 0
      let currentOrder = maxOrder + 1
      
      for (const subject of validSubjects) {
        await addDoc(collection(db, "subjects"), {
          title: subject.title,
          courseIds: [selectedCourse],
          courseId: selectedCourse, // Legacy field for backwards compatibility
          order: currentOrder++,
          createdAt: serverTimestamp(),
        })
      }

      await fetchSubjects()
      setBulkSubjects([{ title: "" }])
      setSelectedCourse("")
      setShowBulkForm(false)
      toast({
        title: "Success",
        description: `Successfully created ${validSubjects.length} subject(s)!`,
      })
    } catch (error) {
      console.error("Error creating subjects:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to create subjects. Please try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const batchCourses = courses.filter(c => c.type === "batch")
  const filteredSubjects = selectedCourse 
    ? subjects.filter(s => {
        // Support both old courseId and new courseIds array
        if (s.courseIds && Array.isArray(s.courseIds)) {
          return s.courseIds.includes(selectedCourse)
        }
        return s.courseId === selectedCourse
      })
    : subjects

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Manage Subjects</h1>
            <p className="text-muted-foreground">Create and manage subjects for batch courses</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowBulkForm(!showBulkForm)}
              className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Bulk Create Subjects
            </button>
          </div>
        </div>
      </motion.div>

      {/* Bulk Create Form */}
      {showBulkForm && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }} 
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 bg-card border border-border rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Bulk Create Subjects</h2>
            <button 
              onClick={() => setShowBulkForm(false)}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Select Batch Course *</label>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                required
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Choose a batch course...</option>
                {batchCourses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
              {batchCourses.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">No batch courses found. Create a batch course first.</p>
              )}
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Subjects</label>
              {bulkSubjects.map((subject, index) => (
                <div key={index} className="flex gap-3 items-start p-4 bg-background border border-border rounded-lg">
                  <div className="flex-1 space-y-3">
                    <input
                      type="text"
                      placeholder="Subject title *"
                      value={subject.title}
                      onChange={(e) => handleBulkChange(index, "title", e.target.value)}
                      className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleBulkAdd(index)}
                      className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
                      title="Add subject below"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    {bulkSubjects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleBulkRemove(index)}
                        className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                        title="Remove this subject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={submitting || !selectedCourse}
                className="flex-1 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {submitting ? "Creating..." : `Create ${bulkSubjects.filter(s => s.title.trim()).length} Subject(s)`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowBulkForm(false)
                  setBulkSubjects([{ title: "" }])
                  setSelectedCourse("")
                }}
                className="px-6 py-3 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Course Filter */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Filter by Course (optional)</label>
        <select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-full max-w-md px-4 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All Subjects</option>
          {batchCourses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
      </div>

      {/* Subjects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="h-6 bg-muted rounded mb-2"></div>
              <div className="h-4 bg-muted rounded"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSubjects.map((subject) => (
            <motion.div
              key={subject.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              {subject.imageUrl && (
                <div className="w-full h-48 overflow-hidden bg-muted">
                  <img 
                    src={subject.imageUrl} 
                    alt={subject.title}
                    className="w-full h-full object-cover"
                    onError={(e) => e.target.style.display = 'none'}
                  />
                </div>
              )}
              <div className="p-6">
                <h3 className="font-semibold text-lg mb-2">{subject.title}</h3>
                {subject.courseId && (
                  <p className="text-xs text-primary mb-3">
                    Course: {courses.find(c => c.id === subject.courseId)?.title || "Unknown"}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenModal(subject)}
                    className="flex-1 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(subject.id)}
                    className="flex-1 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {filteredSubjects.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No subjects found. Create your first subject!</p>
        </div>
      )}

      {/* Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-md w-full"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">{editingSubject ? "Edit Subject" : "Add New Subject"}</h2>
              <button onClick={handleCloseModal} className="p-2 hover:bg-muted rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Courses *</label>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 p-2 bg-background border border-border rounded-lg min-h-[50px]">
                    {formData.courseIds.map((courseId, idx) => {
                      const course = courses.find(c => c.id === courseId)
                      return (
                        <div
                          key={idx}
                          className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm flex items-center gap-2"
                        >
                          {course?.title || courseId}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = formData.courseIds.filter((_, i) => i !== idx)
                              setFormData({ ...formData, courseIds: updated })
                            }}
                            className="text-primary hover:text-primary/70"
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <select
                    onChange={(e) => {
                      const value = e.target.value
                      if (value && !formData.courseIds.includes(value)) {
                        setFormData({ ...formData, courseIds: [...formData.courseIds, value] })
                      }
                      e.target.value = ""
                    }}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Add course...</option>
                    {courses.filter(c => c.type === "batch").map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">Click to add multiple courses</p>
                </div>
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
                  Subjects are displayed in descending order (highest first). Auto-incremented for new subjects.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Subject Image</label>
                <div className="space-y-3">
                  {/* Image Type Toggle */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, imageType: "upload" })}
                      className={`flex-1 px-4 py-2 rounded-lg transition-colors font-medium ${
                        formData.imageType === "upload"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      Upload Image
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, imageType: "link" })}
                      className={`flex-1 px-4 py-2 rounded-lg transition-colors font-medium ${
                        formData.imageType === "link"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      Image Link
                    </button>
                  </div>

                  {/* Upload Option */}
                  {formData.imageType === "upload" && (
                    <div className="flex items-center gap-3">
                      <label className="flex-1 cursor-pointer">
                        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors border border-primary/20">
                          {uploading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="text-sm font-medium">Uploading...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              <span className="text-sm font-medium">Choose File</span>
                            </>
                          )}
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          disabled={uploading}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {/* Link Option */}
                  {formData.imageType === "link" && (
                    <input
                      type="url"
                      value={formData.imageLink}
                      onChange={(e) => setFormData({ ...formData, imageLink: e.target.value })}
                      placeholder="https://example.com/image.jpg"
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  )}
                  
                  {/* Image Preview */}
                  {(formData.imageUrl || formData.imageLink) && (
                    <div className="relative">
                      <img 
                        src={formData.imageType === "link" ? formData.imageLink : formData.imageUrl} 
                        alt="Preview" 
                        className="w-full h-48 object-cover rounded-lg border border-border"
                        onError={(e) => e.target.style.display = 'none'}
                      />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, imageUrl: "", imageLink: "" })}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  
                  <p className="text-xs text-muted-foreground">
                    Upload an image or provide an image link. Recommended size: 800x600px or similar aspect ratio.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
                >
                  {editingSubject ? "Update Subject" : "Create Subject"}
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-6 py-3 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
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
