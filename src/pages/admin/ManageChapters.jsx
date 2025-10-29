"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, X, Upload, Loader2 } from "lucide-react"
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageChapters() {
  const [courses, setCourses] = useState([])
  const [subjects, setSubjects] = useState([])
  const [chapters, setChapters] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [editingChapter, setEditingChapter] = useState(null)
  const [selectedCourse, setSelectedCourse] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("")
  const [bulkChapters, setBulkChapters] = useState([{ title: "" }])
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [formData, setFormData] = useState({
    title: "",
    imageUrl: "",
    imageType: "upload",
    imageLink: "",
    courseId: "",
    subjectId: "",
    order: 0,
  })

  useEffect(() => {
    fetchCourses()
    fetchSubjects()
    fetchChapters()
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
      setSubjects(data)
    } catch (error) {
      console.error("Error fetching subjects:", error)
    }
  }

  const fetchChapters = async () => {
    try {
      const snapshot = await getDocs(collection(db, "chapters"))
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      data.sort((a, b) => (b.order || 0) - (a.order || 0))
      setChapters(data)
    } catch (error) {
      console.error("Error fetching chapters:", error)
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

  const handleOpenModal = (chapter = null) => {
    if (chapter) {
      setEditingChapter(chapter)
      setFormData({
        title: chapter.title,
        imageUrl: chapter.imageUrl || "",
        imageType: chapter.imageUrl?.startsWith("http") ? "link" : "upload",
        imageLink: chapter.imageUrl || "",
        courseId: chapter.courseId || "",
        subjectId: chapter.subjectId || "",
        order: chapter.order || 0,
      })
    } else {
      setEditingChapter(null)
      const maxOrder = chapters.length > 0 ? Math.max(...chapters.map(c => c.order || 0)) : 0
      setFormData({
        title: "",
        imageUrl: "",
        imageType: "upload",
        imageLink: "",
        courseId: "",
        subjectId: "",
        order: maxOrder + 1,
      })
    }
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingChapter(null)
    setFormData({
      title: "",
      imageUrl: "",
      imageType: "upload",
      imageLink: "",
      courseId: "",
      subjectId: "",
      order: 0,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.courseId) {
      toast({
        variant: "error",
        title: "Validation Error",
        description: "Please select a course for this chapter.",
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
        courseId: formData.courseId,
        subjectId: formData.subjectId,
        order: formData.order,
      }

      if (editingChapter) {
        await updateDoc(doc(db, "chapters", editingChapter.id), {
          ...dataToSave,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, "chapters"), {
          ...dataToSave,
          createdAt: serverTimestamp(),
        })
      }

      await fetchChapters()
      handleCloseModal()
      toast({
        variant: "success",
        title: editingChapter ? "Chapter Updated" : "Chapter Created",
        description: editingChapter ? "Chapter updated successfully!" : "Chapter created successfully!",
      })
    } catch (error) {
      console.error("Error saving chapter:", error)
      toast({
        variant: "error",
        title: "Save Failed",
        description: "Failed to save chapter",
      })
    }
  }

  const handleDelete = async (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Chapter",
      message: "Are you sure you want to delete this chapter? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "chapters", id))
          await fetchChapters()
          toast({
            variant: "success",
            title: "Chapter Deleted",
            description: "Chapter deleted successfully!",
          })
        } catch (error) {
          console.error("Error deleting chapter:", error)
          toast({
            variant: "error",
            title: "Deletion Failed",
            description: "Failed to delete chapter",
          })
        }
      }
    })
  }

  const handleBulkAdd = (index) => {
    setBulkChapters([...bulkChapters.slice(0, index + 1), { title: "" }, ...bulkChapters.slice(index + 1)])
  }

  const handleBulkRemove = (index) => {
    if (bulkChapters.length > 1) {
      setBulkChapters(bulkChapters.filter((_, i) => i !== index))
    }
  }

  const handleBulkChange = (index, field, value) => {
    const updated = [...bulkChapters]
    updated[index][field] = value
    setBulkChapters(updated)
  }

  const handleBulkSubmit = async (e) => {
    e.preventDefault()
    
    if (!selectedCourse) {
      toast({
        variant: "error",
        title: "Course Required",
        description: "Please select a course first!",
      })
      return
    }

    const validChapters = bulkChapters.filter(c => c.title.trim() !== "")
    if (validChapters.length === 0) {
      toast({
        variant: "error",
        title: "Chapters Required",
        description: "Please add at least one chapter with a title!",
      })
      return
    }

    setSubmitting(true)
    try {
      const maxOrder = chapters.length > 0 ? Math.max(...chapters.map(c => c.order || 0)) : 0
      let currentOrder = maxOrder + 1
      
      const selectedCourseData = courses.find(c => c.id === selectedCourse)
      for (const chapter of validChapters) {
        const chapterData = {
          title: chapter.title,
          courseId: selectedCourse,
          order: currentOrder++,
          createdAt: serverTimestamp(),
        }
        
        if (selectedCourseData?.type === "batch" && selectedSubject) {
          chapterData.subjectId = selectedSubject
        }
        
        await addDoc(collection(db, "chapters"), chapterData)
      }

      await fetchChapters()
      setBulkChapters([{ title: "" }])
      setSelectedCourse("")
      setSelectedSubject("")
      setShowBulkForm(false)
      toast({
        variant: "success",
        title: "Chapters Created",
        description: `Successfully created ${validChapters.length} chapter(s)!`,
      })
    } catch (error) {
      console.error("Error creating chapters:", error)
      toast({
        variant: "error",
        title: "Creation Failed",
        description: "Failed to create chapters. Please try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCourseData = courses.find(c => c.id === selectedCourse)
  const isBatchCourse = selectedCourseData?.type === "batch"
  const courseSubjects = subjects.filter(s => {
    // Support both old courseId and new courseIds array
    if (s.courseIds && Array.isArray(s.courseIds)) {
      return s.courseIds.includes(selectedCourse)
    }
    return s.courseId === selectedCourse
  })
  const filteredChapters = selectedCourse 
    ? chapters.filter(c => c.courseId === selectedCourse)
    : chapters

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold mb-1">Manage Chapters</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Create and manage chapters for courses</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowBulkForm(!showBulkForm)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              Bulk Create Chapters
            </button>
          </div>
        </div>
      </motion.div>

      {showBulkForm && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }} 
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-card border border-border rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Bulk Create Chapters</h2>
            <button 
              onClick={() => setShowBulkForm(false)}
              className="p-1.5 hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Select Course *</label>
              <select
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value)
                  setSelectedSubject("")
                }}
                required
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              >
                <option value="">Choose a course...</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} ({course.type})
                  </option>
                ))}
              </select>
            </div>

            {isBatchCourse && courseSubjects.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-2">Select Subject (optional for batch courses)</label>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                  <option value="">All subjects / No specific subject</option>
                  {courseSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-sm font-medium">Chapters</label>
              {bulkChapters.map((chapter, index) => (
                <div key={index} className="flex gap-3 items-start p-3 bg-background border border-border rounded-lg">
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="Chapter title *"
                      value={chapter.title}
                      onChange={(e) => handleBulkChange(index, "title", e.target.value)}
                      className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleBulkAdd(index)}
                      className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
                      title="Add chapter below"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    {bulkChapters.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleBulkRemove(index)}
                        className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                        title="Remove this chapter"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setShowBulkForm(false)
                  setBulkChapters([{ title: "" }])
                  setSelectedCourse("")
                  setSelectedSubject("")
                }}
                className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !selectedCourse}
                className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating..." : `Create ${bulkChapters.filter(c => c.title.trim()).length} Chapter(s)`}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Filter by Course (optional)</label>
        <select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-full max-w-md px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        >
          <option value="">All Chapters</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title} ({course.type})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-3 sm:p-4 animate-pulse">
              <div className="h-5 bg-muted rounded mb-2"></div>
              <div className="h-4 bg-muted rounded"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filteredChapters.map((chapter) => (
            <motion.div
              key={chapter.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-lg overflow-hidden"
            >
              {chapter.imageUrl && (
                <div className="w-full h-40 overflow-hidden bg-muted">
                  <img 
                    src={chapter.imageUrl} 
                    alt={chapter.title}
                    className="w-full h-full object-cover"
                    onError={(e) => e.target.style.display = 'none'}
                  />
                </div>
              )}
              <div className="p-3 sm:p-4">
                <h3 className="font-semibold text-sm sm:text-base mb-3">{chapter.title}</h3>
                {chapter.courseId && (
                  <p className="text-xs text-primary mb-2">
                    Course: {courses.find(c => c.id === chapter.courseId)?.title || "Unknown"}
                  </p>
                )}
                {chapter.subjectId && (
                  <p className="text-xs text-secondary mb-2">
                    Subject: {subjects.find(s => s.id === chapter.subjectId)?.title || "Unknown"}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenModal(chapter)}
                    className="flex-1 px-2 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Edit className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(chapter.id)}
                    className="flex-1 px-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {filteredChapters.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No chapters found. Create your first chapter!</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editingChapter ? "Edit Chapter" : "Add New Chapter"}</h2>
              <button onClick={handleCloseModal} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="Enter chapter title"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Course *</label>
                <select
                  value={formData.courseId}
                  onChange={(e) => {
                    setFormData({ ...formData, courseId: e.target.value, subjectId: "" })
                  }}
                  required
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                  <option value="">Select a course...</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title} ({course.type})
                    </option>
                  ))}
                </select>
              </div>

              {formData.courseId && courses.find(c => c.id === formData.courseId)?.type === "batch" && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">Subject (optional for batch courses)</label>
                  <select
                    value={formData.subjectId}
                    onChange={(e) => setFormData({ ...formData, subjectId: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  >
                    <option value="">All subjects / No specific subject</option>
                    {subjects.filter(s => {
                      // Support both old courseId and new courseIds array
                      if (s.courseIds && Array.isArray(s.courseIds)) {
                        return s.courseIds.includes(formData.courseId)
                      }
                      return s.courseId === formData.courseId
                    }).map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5">Order</label>
                <input
                  type="number"
                  value={formData.order}
                  onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="Auto-calculated if empty"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Chapters are displayed in descending order (highest first). Auto-incremented for new chapters.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Chapter Image</label>
                <div className="space-y-3">
                  {/* Image Type Toggle */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, imageType: "upload" })}
                      className={`flex-1 px-3 py-2 rounded-lg transition-colors font-medium text-sm ${
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
                      className={`flex-1 px-3 py-2 rounded-lg transition-colors font-medium text-sm ${
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
                        <div className="flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors border border-primary/20">
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
                      className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                  )}

                  {/* Image Preview */}
                  {(formData.imageUrl || formData.imageLink) && (
                    <div className="relative">
                      <img 
                        src={formData.imageType === "link" ? formData.imageLink : formData.imageUrl} 
                        alt="Preview" 
                        className="w-full h-40 object-cover rounded-lg border border-border"
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
                    {formData.imageType === "upload" 
                      ? "Upload an image to ImgBB (recommended: 800x600px)"
                      : "Enter a direct image URL"
                    }
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm font-medium"
                >
                  {editingChapter ? "Update" : "Create"}
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
