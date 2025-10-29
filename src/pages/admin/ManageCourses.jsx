"use client"
import { toast } from "../../hooks/use-toast"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, Search, Edit2, Trash2, X, BookOpen, Upload, Link as LinkIcon, Tag } from "lucide-react"
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { uploadImageToImgBB } from "../../lib/imgbb"
import { generateSlug } from "../../lib/slug"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageCourses() {
  const [courses, setCourses] = useState([])
  const [categories, setCategories] = useState([])
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCourse, setEditingCourse] = useState(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    instructors: [],
    category: "",
    type: "subject",
    price: "",
    status: "running",
    publishStatus: "published",
    imageType: "upload",
    imageLink: "",
    telegramLink: "",
    tags: [],
  })
  const [tagInput, setTagInput] = useState("")
  const [imageFile, setImageFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [coursesSnap, categoriesSnap, teachersSnap] = await Promise.all([
        getDocs(collection(db, "courses")),
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "teachers")),
      ])

      setCourses(
        coursesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      )
      setCategories(categoriesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
      setTeachers(teachersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
    } catch (error) {
      console.error("Error fetching data:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (course = null) => {
    if (course) {
      setEditingCourse(course)
      setFormData({
        title: course.title || "",
        description: course.description || "",
        instructors: course.instructors || (course.instructorName ? [course.instructorName] : []),
        category: course.category || "",
        type: course.type || "subject",
        price: course.price || "",
        status: course.status || "running",
        publishStatus: course.publishStatus || "published",
        imageType: course.thumbnailURL ? "link" : "upload",
        imageLink: course.thumbnailURL || "",
        telegramLink: course.telegramLink || "",
        tags: course.tags || [],
      })
    } else {
      setEditingCourse(null)
      setFormData({
        title: "",
        description: "",
        instructors: [],
        category: "",
        type: "subject",
        price: "",
        status: "running",
        publishStatus: "published",
        imageType: "upload",
        imageLink: "",
        telegramLink: "",
        tags: [],
      })
    }
    setImageFile(null)
    setTagInput("")
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingCourse(null)
    setImageFile(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.title.trim()) {
      toast({
        variant: "error",
        title: "Title Required",
        description: "Course title is required",
      })
      return
    }

    setSubmitting(true)
    try {
      let thumbnailURL = formData.imageLink

      if (formData.imageType === "upload" && imageFile) {
        thumbnailURL = await uploadImageToImgBB(imageFile)
      }

      const courseData = {
        title: formData.title,
        description: formData.description,
        instructors: formData.instructors,
        instructorName: formData.instructors.join(", "),
        category: formData.category,
        type: formData.type,
        price: Number(formData.price) || 0,
        status: formData.status,
        publishStatus: formData.publishStatus,
        thumbnailURL: thumbnailURL || "",
        telegramLink: formData.telegramLink || "",
        tags: formData.tags || [],
        slug: generateSlug(formData.title),
        updatedAt: serverTimestamp(),
      }

      if (editingCourse) {
        if (!editingCourse.slug) {
          courseData.slug = generateSlug(formData.title)
        } else {
          courseData.slug = editingCourse.slug
        }
        await updateDoc(doc(db, "courses", editingCourse.id), courseData)
      } else {
        courseData.createdAt = serverTimestamp()
        await addDoc(collection(db, "courses"), courseData)
      }

      await fetchData()
      handleCloseModal()
      toast({
        title: "Success",
        description: editingCourse ? "Course updated successfully" : "Course created successfully",
      })
    } catch (error) {
      console.error("Error saving course:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Error saving course: " + error.message,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (courseId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Course",
      message: "Are you sure you want to delete this course? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "courses", courseId))
          await fetchData()
          toast({
            title: "Success",
            description: "Course deleted successfully",
          })
        } catch (error) {
          console.error("Error deleting course:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Error deleting course: " + error.message,
          })
        }
      }
    })
  }

  const filteredCourses = courses.filter(
    (course) =>
      course.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.instructorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.category?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Manage Courses</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Create and manage educational courses</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="w-full sm:w-auto px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Course
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search courses..."
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent"></div>
        </div>
      ) : filteredCourses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filteredCourses.map((course, index) => (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div className="aspect-video bg-gradient-to-br from-primary/10 to-accent/10 relative overflow-hidden">
                {course.thumbnailURL ? (
                  <img src={course.thumbnailURL} alt={course.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BookOpen className="w-12 h-12 text-primary/30" />
                  </div>
                )}
              </div>
              <div className="p-3 sm:p-4">
                <h3 className="font-semibold text-sm mb-1 line-clamp-1">{course.title}</h3>
                <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{course.description}</p>
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
                  <span className="text-xs text-muted-foreground">{course.instructorName || "No instructor"}</span>
                  <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                    {course.category || "Uncategorized"}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground capitalize">{course.type || "subject"}</span>
                  <span className="text-sm font-semibold">৳{course.price || 0}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenModal(course)}
                    className="flex-1 px-2 py-1.5 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Edit2 className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(course.id)}
                    className="flex-1 px-2 py-1.5 bg-red-500/10 text-red-600 rounded hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-1">No courses found</h3>
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "Try a different search term" : "Get started by adding your first course"}
          </p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editingCourse ? "Edit Course" : "Add New Course"}</h2>
              <button
                onClick={handleCloseModal}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Course Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="Enter course title"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="Enter course description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Tags (Max 6)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (tagInput.trim() && formData.tags.length < 6 && !formData.tags.includes(tagInput.trim())) {
                          setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] })
                          setTagInput("")
                        }
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    placeholder="Type a tag and press Enter"
                    disabled={formData.tags.length >= 6}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (tagInput.trim() && formData.tags.length < 6 && !formData.tags.includes(tagInput.trim())) {
                        setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] })
                        setTagInput("")
                      }
                    }}
                    disabled={!tagInput.trim() || formData.tags.length >= 6}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Add
                  </button>
                </div>
                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary text-xs rounded-full"
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, tags: formData.tags.filter((_, i) => i !== index) })
                          }}
                          className="hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formData.tags.length}/6 tags added
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Telegram Group Link</label>
                <input
                  type="url"
                  value={formData.telegramLink}
                  onChange={(e) => setFormData({ ...formData, telegramLink: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="https://t.me/your_group"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Students will see this link to join the course Telegram community
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-2">Instructors</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3 bg-muted/30 rounded-lg border border-border max-h-48 overflow-y-auto">
                    {teachers.length > 0 ? (
                      teachers.map((teacher) => (
                        <label
                          key={teacher.id}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={formData.instructors.includes(teacher.name)}
                            onChange={(e) => {
                              const newInstructors = e.target.checked
                                ? [...formData.instructors, teacher.name]
                                : formData.instructors.filter((name) => name !== teacher.name)
                              setFormData({ ...formData, instructors: newInstructors })
                            }}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                          />
                          <span className="text-xs truncate">{teacher.name}</span>
                        </label>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground col-span-full text-center py-2">
                        No teachers available
                      </p>
                    )}
                  </div>
                  {formData.instructors.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Selected: {formData.instructors.join(", ")}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.title}>
                        {cat.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Course Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  >
                    <option value="subject">Subject</option>
                    <option value="batch">Batch</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Price (৳)</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    placeholder="0"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Course Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  >
                    <option value="running">Running</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Publish Status</label>
                  <select
                    value={formData.publishStatus}
                    onChange={(e) => setFormData({ ...formData, publishStatus: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Thumbnail Image</label>
                <div className="flex gap-3 mb-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, imageType: "upload" })}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      formData.imageType === "upload"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-muted"
                    }`}
                  >
                    <Upload className="w-4 h-4 inline mr-1.5" />
                    Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, imageType: "link" })}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      formData.imageType === "link"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-muted"
                    }`}
                  >
                    <LinkIcon className="w-4 h-4 inline mr-1.5" />
                    Link
                  </button>
                </div>

                {formData.imageType === "upload" ? (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setImageFile(e.target.files[0])}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                  />
                ) : (
                  <input
                    type="url"
                    value={formData.imageLink}
                    onChange={(e) => setFormData({ ...formData, imageLink: e.target.value })}
                    placeholder="https://example.com/image.jpg"
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                )}
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
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  {submitting ? "Saving..." : editingCourse ? "Update Course" : "Add Course"}
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
