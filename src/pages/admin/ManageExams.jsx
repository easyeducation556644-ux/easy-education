import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, FileQuestion, BookOpen, GraduationCap, Upload, Download, Archive } from "lucide-react"
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { useExam } from "../../contexts/ExamContext"
import { toast } from "../../hooks/use-toast"
import { Link } from "react-router-dom"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageExams() {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingExam, setEditingExam] = useState(null)
  const [courses, setCourses] = useState([])
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkCourseId, setBulkCourseId] = useState("")
  const [examNames, setExamNames] = useState("")
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    courseId: "",
    duration: 60,
    passingScore: 70,
    order: 0,
  })

  const { createExam, updateExam, deleteExam } = useExam()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const examsSnapshot = await getDocs(collection(db, "exams"))
      const examsData = await Promise.all(
        examsSnapshot.docs.map(async (examDoc) => {
          const exam = { id: examDoc.id, ...examDoc.data() }
          
          if (exam.courseId) {
            const courseDoc = await getDoc(doc(db, "courses", exam.courseId))
            if (courseDoc.exists()) {
              exam.courseName = courseDoc.data().title
            }
          }
          
          return exam
        })
      )
      // Sort by order (descending), fallback to createdAt if order doesn't exist or is 0
      examsData.sort((a, b) => {
        const orderA = a.order || null
        const orderB = b.order || null
        // If both have order, sort by order
        if (orderA !== null && orderB !== null) {
          return orderB - orderA
        }
        // If only one has order, it comes first
        if (orderA !== null) return -1
        if (orderB !== null) return 1
        // If neither has order, sort by createdAt descending
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      })
      setExams(examsData)

      const coursesSnapshot = await getDocs(collection(db, "courses"))
      const coursesData = coursesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setCourses(coursesData)
    } catch (error) {
      console.error("Error fetching data:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load exams",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.title || !formData.courseId) {
      toast({
        variant: "error",
        title: "Missing Fields",
        description: "Please fill in all required fields",
      })
      return
    }

    try {
      if (editingExam) {
        await updateExam(editingExam.id, formData)
        toast({
          title: "Success",
          description: "Exam updated successfully",
        })
      } else {
        await createExam(formData)
        toast({
          title: "Success",
          description: "Exam created successfully",
        })
      }
      
      setShowModal(false)
      setEditingExam(null)
      setFormData({
        title: "",
        description: "",
        courseId: "",
        duration: 60,
        passingScore: 70,
        order: 0,
      })
      fetchData()
    } catch (error) {
      console.error("Error saving exam:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save exam",
      })
    }
  }

  const handleEdit = (exam) => {
    setEditingExam(exam)
    setFormData({
      title: exam.title,
      description: exam.description || "",
      courseId: exam.courseId,
      duration: exam.duration || 60,
      passingScore: exam.passingScore || 70,
      order: exam.order ?? 0,
    })
    setShowModal(true)
  }

  const handleDelete = async (examId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Exam",
      message: "Are you sure you want to delete this exam? This will also delete all questions. This action cannot be undone.",
      variant: "danger",
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await deleteExam(examId)
          toast({
            title: "Success",
            description: "Exam deleted successfully",
          })
          fetchData()
        } catch (error) {
          console.error("Error deleting exam:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete exam",
          })
        }
      }
    })
  }

  const handleBulkCreate = async () => {
    if (!bulkCourseId) {
      toast({
        variant: "error",
        title: "Course Required",
        description: "Please select a course first",
      })
      return
    }

    if (!examNames.trim()) {
      toast({
        variant: "error",
        title: "Exam Names Required",
        description: "Please enter at least one exam name",
      })
      return
    }

    setBulkProcessing(true)
    try {
      // Parse exam names - support both newline and comma separation
      const names = examNames
        .split(/[\n,]+/)
        .map(name => name.trim())
        .filter(name => name.length > 0)

      if (names.length === 0) {
        toast({
          variant: "error",
          title: "No Valid Names",
          description: "Please enter valid exam names",
        })
        setBulkProcessing(false)
        return
      }

      let successCount = 0
      let errorCount = 0
      const errors = []

      for (const name of names) {
        try {
          const maxOrder = exams.length > 0 ? Math.max(...exams.map(e => e.order ?? 0)) : 0
          await createExam({
            title: name,
            description: "",
            courseId: bulkCourseId,
            duration: 60,
            passingScore: 70,
            order: maxOrder + successCount + 1,
          })
          successCount++
        } catch (err) {
          console.error(`Error creating exam "${name}":`, err)
          errorCount++
          errors.push(name)
        }
      }

      toast({
        title: "Bulk Creation Complete",
        description: `Successfully created ${successCount} exam(s). ${errorCount > 0 ? `Failed: ${errorCount} (${errors.join(", ")})` : ""}`,
      })

      setShowBulkModal(false)
      setBulkCourseId("")
      setExamNames("")
      fetchData()
    } catch (error) {
      console.error("Error in bulk creation:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to create exams",
      })
    } finally {
      setBulkProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Manage Exams</h1>
          <p className="text-muted-foreground mt-1">Create and manage exams for courses</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Quick Add Multiple</span>
          </button>
          <button
            onClick={() => {
              setEditingExam(null)
              const maxOrder = exams.length > 0 ? Math.max(...exams.map(e => e.order ?? 0)) : 0
              setFormData({
                title: "",
                description: "",
                courseId: "",
                duration: 60,
                passingScore: 70,
                order: maxOrder + 1,
              })
              setShowModal(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Create Exam</span>
          </button>
        </div>
      </div>

      {exams.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <FileQuestion className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No exams created yet</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Create Your First Exam
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {exams.map((exam) => (
            <motion.div
              key={exam.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-shadow relative"
            >
              {exam.isArchived && (
                <div className="absolute top-4 right-4 flex items-center gap-1 text-orange-600 bg-orange-500/10 px-2 py-1 rounded text-xs font-medium">
                  <Archive className="w-3 h-3" />
                  <span>Archived</span>
                </div>
              )}
              
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1 pr-16">
                  <h3 className="font-bold text-lg mb-1">{exam.title}</h3>
                  <p className="text-sm text-muted-foreground">{exam.description}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <BookOpen className="w-4 h-4" />
                  <span>{exam.courseName || "Unknown Course"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <GraduationCap className="w-4 h-4" />
                  <span>{exam.duration} minutes • Passing: {exam.passingScore}%</span>
                </div>
                {exam.isArchived && exam.archivedFrom && (
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Archive className="w-3 h-3" />
                    <span>Archived from: {courses.find(c => c.id === exam.archivedFrom)?.title || "Unknown"}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Link
                  to={`/admin/exams/${exam.id}/questions`}
                  className="flex-1 px-3 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors text-center text-sm font-medium"
                >
                  <FileQuestion className="w-4 h-4 inline mr-1" />
                  Questions
                </Link>
                <button
                  onClick={() => handleEdit(exam)}
                  className="px-3 py-2 bg-blue-500/10 text-blue-600 rounded-lg hover:bg-blue-500/20 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(exam.id)}
                  className="px-3 py-2 bg-red-500/10 text-red-600 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-4 sm:p-6 w-full max-w-md my-4 sm:my-8 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">{editingExam ? "Edit Exam" : "Create New Exam"}</h2>
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Exam Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., Physics Chapter 1 Exam"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Brief description of the exam"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Course *</label>
                <select
                  value={formData.courseId}
                  onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                >
                  <option value="">Select a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium mb-2">Duration (minutes)</label>
                  <input
                    type="number"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || 60 })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    min="1"
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-medium mb-2">Passing Score (%)</label>
                  <input
                    type="number"
                    value={formData.passingScore}
                    onChange={(e) => setFormData({ ...formData, passingScore: parseInt(e.target.value) || 70 })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Order</label>
                <input
                  type="number"
                  value={formData.order}
                  onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Auto-calculated if empty"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Exams are displayed in descending order (highest first). Auto-incremented for new exams.
                </p>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingExam(null)
                  }}
                  className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors"
                >
                  {editingExam ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-2xl font-bold mb-4">Quick Add Multiple Exams</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Select a course and enter exam names to create multiple exams at once.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Select Course *</label>
                <select
                  value={bulkCourseId}
                  onChange={(e) => setBulkCourseId(e.target.value)}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={bulkProcessing}
                >
                  <option value="">Choose a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Exam Names *</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Enter one exam name per line, or separate with commas
                </p>
                <textarea
                  value={examNames}
                  onChange={(e) => setExamNames(e.target.value)}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={10}
                  placeholder="Chapter 1 Exam&#10;Midterm Exam&#10;Final Exam&#10;or&#10;Quiz 1, Quiz 2, Quiz 3"
                  disabled={bulkProcessing}
                />
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>Note:</strong> All exams will be created with default settings (Duration: 60 min, Passing Score: 70%). You can edit individual exams later.
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  setShowBulkModal(false)
                  setBulkCourseId("")
                  setExamNames("")
                }}
                className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                disabled={bulkProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkCreate}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                disabled={bulkProcessing}
              >
                {bulkProcessing ? "Creating..." : "Create Exams"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText || "Confirm"}
        cancelText={confirmDialog.cancelText || "Cancel"}
        variant={confirmDialog.variant || "default"}
      />
    </div>
  )
}
