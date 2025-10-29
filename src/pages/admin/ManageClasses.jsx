"use client"
import { toast } from "../../hooks/use-toast"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, X } from "lucide-react"
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { uploadImageToImgBB } from "../../lib/imgbb"
import { useExam } from "../../contexts/ExamContext"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageClasses() {
  const [courses, setCourses] = useState([])
  const [classes, setClasses] = useState([])
  const [subjects, setSubjects] = useState([])
  const [chapters, setChapters] = useState([])
  const [selectedCourse, setSelectedCourse] = useState("")
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showArchiveModal, setShowArchiveModal] = useState(false)
  const [editingClass, setEditingClass] = useState(null)
  const [videoType, setVideoType] = useState("youtube")
  const [formData, setFormData] = useState({
    title: "",
    chapter: "",
    subject: "",
    order: 0,
    duration: "",
    youtubeLink: "",
    hlsLink: "",
    teacherName: "",
    imageType: "upload",
    imageLink: "",
    teacherImageType: "upload",
    teacherImageLink: "",
    resourceLinks: [],
  })
  const [imageFile, setImageFile] = useState(null)
  const [teacherImageFile, setTeacherImageFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [archiveSourceCourse, setArchiveSourceCourse] = useState("")
  const [archiveClasses, setArchiveClasses] = useState([])
  const [selectedArchiveClasses, setSelectedArchiveClasses] = useState([])
  const [archiveExams, setArchiveExams] = useState([])
  const [selectedArchiveExams, setSelectedArchiveExams] = useState([])
  const [archiveSubject, setArchiveSubject] = useState("")
  const [archiveChapter, setArchiveChapter] = useState("")
  const [archiveSubmitting, setArchiveSubmitting] = useState(false)
  const [teachers, setTeachers] = useState([])
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [showArchivedClasses, setShowArchivedClasses] = useState(false)

  const { getExamsByCourse, copyExamQuestions } = useExam()

  useEffect(() => {
    fetchCourses()
    fetchSubjects()
    fetchChapters()
    fetchTeachers()
  }, [])

  useEffect(() => {
    if (selectedCourse) {
      fetchClasses()
    }
  }, [selectedCourse, showArchivedClasses])

  useEffect(() => {
    if (archiveSourceCourse) {
      fetchArchiveClasses(archiveSourceCourse)
      fetchArchiveExams(archiveSourceCourse)
    }
  }, [archiveSourceCourse])

  const fetchArchiveExams = async (courseId) => {
    if (!courseId) return
    try {
      const examsData = await getExamsByCourse(courseId)
      // Filter out already archived exams
      const nonArchivedExams = examsData.filter((exam) => !exam.isArchived)
      setArchiveExams(nonArchivedExams)
    } catch (error) {
      console.error("Error fetching archive exams:", error)
      setArchiveExams([])
    }
  }

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
    } finally {
      setLoading(false)
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
      setChapters(data)
    } catch (error) {
      console.error("Error fetching chapters:", error)
    }
  }

  const fetchClasses = async () => {
    try {
      const classesQuery = query(collection(db, "classes"), where("courseId", "==", selectedCourse))
      const classesSnapshot = await getDocs(classesQuery)
      const classesData = classesSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        .filter((cls) => {
          const isArchived = cls.isArchived === true
          const subjectIsArchive = Array.isArray(cls.subject)
            ? cls.subject.includes("archive")
            : cls.subject === "archive"
          const chapterIsArchive = Array.isArray(cls.chapter)
            ? cls.chapter.includes("archive")
            : cls.chapter === "archive"
          const classIsArchived = isArchived || subjectIsArchive || chapterIsArchive
          
          // Show archived classes only when showArchivedClasses is true
          // Show active classes only when showArchivedClasses is false
          return showArchivedClasses ? classIsArchived : !classIsArchived
        })
        .sort((a, b) => a.order - b.order)
      setClasses(classesData)
    } catch (error) {
      console.error("Error fetching classes:", error)
    }
  }

  const fetchTeachers = async () => {
    try {
      const snapshot = await getDocs(collection(db, "teachers"))
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setTeachers(data)
      console.log("[v0] Teachers loaded:", data)
    } catch (error) {
      console.error("Error fetching teachers:", error)
    }
  }

  const getNextActiveClassOrder = async () => {
    try {
      const classesQuery = query(collection(db, "classes"), where("courseId", "==", selectedCourse))
      const classesSnapshot = await getDocs(classesQuery)
      const activeClasses = classesSnapshot.docs
        .map((doc) => doc.data())
        .filter((cls) => {
          const isArchived = cls.isArchived === true
          const subjectIsArchive = Array.isArray(cls.subject)
            ? cls.subject.includes("archive")
            : cls.subject === "archive"
          const chapterIsArchive = Array.isArray(cls.chapter)
            ? cls.chapter.includes("archive")
            : cls.chapter === "archive"
          return !isArchived && !subjectIsArchive && !chapterIsArchive
        })
      
      if (activeClasses.length === 0) return 0
      const maxOrder = Math.max(...activeClasses.map(c => c.order || 0))
      return maxOrder + 1
    } catch (error) {
      console.error("Error calculating next order:", error)
      return 0
    }
  }

  const handleOpenModal = async (classItem = null) => {
    if (classItem) {
      setEditingClass(classItem)
      setFormData({
        title: classItem.title || "",
        chapter: Array.isArray(classItem.chapter) ? classItem.chapter : classItem.chapter ? [classItem.chapter] : [],
        subject: Array.isArray(classItem.subject) ? classItem.subject : classItem.subject ? [classItem.subject] : [],
        order: classItem.order || 0,
        duration: classItem.duration || "",
        youtubeLink: classItem.youtubeLink || "",
        hlsLink: classItem.hlsLink || "",
        teacherName: Array.isArray(classItem.teacherName)
          ? classItem.teacherName
          : classItem.teacherName
            ? [classItem.teacherName]
            : [],
        imageType: classItem.imageURL?.startsWith("http") ? "link" : "upload",
        imageLink: classItem.imageURL || "",
        teacherImageType: classItem.teacherImageURL?.startsWith("http") ? "link" : "upload",
        teacherImageLink: classItem.teacherImageURL || "",
        resourceLinks: Array.isArray(classItem.resourceLinks) ? classItem.resourceLinks : [],
      })
      setVideoType(classItem.youtubeLink ? "youtube" : "hls")
    } else {
      setEditingClass(null)
      const nextOrder = await getNextActiveClassOrder()
      setFormData({
        title: "",
        chapter: [],
        subject: [],
        order: nextOrder,
        duration: "",
        youtubeLink: "",
        hlsLink: "",
        teacherName: [],
        imageType: "upload",
        imageLink: "",
        teacherImageType: "upload",
        teacherImageLink: "",
        resourceLinks: [],
      })
      setVideoType("youtube")
    }
    setImageFile(null)
    setTeacherImageFile(null)
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingClass(null)
    setImageFile(null)
    setTeacherImageFile(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      let imageURL = editingClass?.imageURL || ""
      let teacherImageURL = editingClass?.teacherImageURL || ""

      if (imageFile) {
        imageURL = await uploadImageToImgBB(imageFile)
      } else if (formData.imageType === "link") {
        imageURL = formData.imageLink
      }

      if (teacherImageFile) {
        teacherImageURL = await uploadImageToImgBB(teacherImageFile)
      } else if (formData.teacherImageType === "link") {
        teacherImageURL = formData.teacherImageLink
      }

      const classData = {
        courseId: selectedCourse,
        title: formData.title,
        chapter: Array.isArray(formData.chapter) ? formData.chapter : formData.chapter ? [formData.chapter] : [],
        subject: Array.isArray(formData.subject) ? formData.subject : formData.subject ? [formData.subject] : [],
        order: Number.parseInt(formData.order),
        duration: formData.duration,
        youtubeLink: videoType === "youtube" ? formData.youtubeLink : "",
        hlsLink: videoType === "hls" ? formData.hlsLink : "",
        videoURL: videoType === "youtube" ? formData.youtubeLink : formData.hlsLink,
        imageURL,
        teacherName: Array.isArray(formData.teacherName)
          ? formData.teacherName
          : formData.teacherName
            ? [formData.teacherName]
            : [],
        teacherImageURL,
        resourceLinks: Array.isArray(formData.resourceLinks) ? formData.resourceLinks : [],
      }

      if (editingClass) {
        await updateDoc(doc(db, "classes", editingClass.id), classData)
      } else {
        await addDoc(collection(db, "classes"), classData)
      }

      await fetchClasses()
      handleCloseModal()
      toast({
        title: "Success",
        description: editingClass ? "Class updated successfully!" : "Class created successfully!",
      })
    } catch (error) {
      console.error("Error saving class:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save class. " + (error.message || "Please try again."),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (classId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Class",
      message: "Are you sure you want to delete this class? This action cannot be undone.",
      variant: "danger",
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "classes", classId))
          await fetchClasses()
          toast({
            title: "Success",
            description: "Class deleted successfully",
          })
        } catch (error) {
          console.error("Error deleting class:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete class",
          })
        }
      },
    })
  }

  const fetchArchiveClasses = async (courseId) => {
    if (!courseId) return
    try {
      const isClassArchived = (cls) => {
        if (cls.isArchived === true) return true
        const subjectIsArchive = Array.isArray(cls.subject)
          ? cls.subject.includes("archive")
          : cls.subject === "archive"
        const chapterIsArchive = Array.isArray(cls.chapter)
          ? cls.chapter.includes("archive")
          : cls.chapter === "archive"
        return subjectIsArchive || chapterIsArchive
      }

      const classesQuery = query(collection(db, "classes"), where("courseId", "==", courseId))
      const classesSnapshot = await getDocs(classesQuery)
      const classesData = classesSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((cls) => !isClassArchived(cls))
        .sort((a, b) => a.order - b.order)
      setArchiveClasses(classesData)
    } catch (error) {
      console.error("Error fetching archive classes:", error)
    }
  }

  const handleOpenArchiveModal = () => {
    setShowArchiveModal(true)
    setArchiveSourceCourse("")
    setArchiveClasses([])
    setSelectedArchiveClasses([])
    setArchiveExams([])
    setSelectedArchiveExams([])
    setArchiveSubject("")
    setArchiveChapter("")
  }

  const toggleArchiveExam = (examId) => {
    setSelectedArchiveExams((prev) => (prev.includes(examId) ? prev.filter((id) => id !== examId) : [...prev, examId]))
  }

  const toggleAllArchiveExams = () => {
    if (selectedArchiveExams.length === archiveExams.length && archiveExams.length > 0) {
      setSelectedArchiveExams([])
    } else {
      setSelectedArchiveExams(archiveExams.map((e) => e.id))
    }
  }

  const handleArchiveSubmit = async () => {
    if (selectedArchiveClasses.length === 0 && selectedArchiveExams.length === 0) {
      toast({
        variant: "error",
        title: "Selection Required",
        description: "Please select at least one class or exam to archive",
      })
      return
    }

    if (selectedCourseData?.type !== "batch") {
      toast({
        variant: "error",
        title: "Invalid Course Type",
        description: "Archive feature is only available for batch type courses!",
      })
      return
    }

    setArchiveSubmitting(true)
    try {
      let archivedCount = 0

      // Archive classes
      if (selectedArchiveClasses.length > 0) {
        const currentMaxOrder = classes.length > 0 ? Math.max(...classes.map((c) => c.order)) : -1

        for (let i = 0; i < selectedArchiveClasses.length; i++) {
          const sourceClass = archiveClasses.find((c) => c.id === selectedArchiveClasses[i])
          if (!sourceClass) continue

          const newClass = {
            ...sourceClass,
            courseId: selectedCourse,
            isArchived: true,
            archivedAt: new Date().toISOString(),
            archivedFrom: archiveSourceCourse,
            order: currentMaxOrder + i + 1,
          }
          delete newClass.id
          await addDoc(collection(db, "classes"), newClass)
          archivedCount++
        }
      }

      if (selectedArchiveExams.length > 0) {
        for (const examId of selectedArchiveExams) {
          const sourceExam = archiveExams.find((e) => e.id === examId)
          if (!sourceExam) continue

          const newExam = {
            ...sourceExam,
            courseId: selectedCourse,
            isArchived: true,
            archivedAt: new Date().toISOString(),
            archivedFrom: archiveSourceCourse,
          }
          delete newExam.id

          // Create the new exam first
          const newExamRef = await addDoc(collection(db, "exams"), newExam)
          console.log("[v0] Created archived exam:", newExamRef.id)

          // Then copy all questions from the source exam to the new exam
          try {
            const questionsCopied = await copyExamQuestions(examId, newExamRef.id)
            console.log("[v0] Copied", questionsCopied, "questions for exam", newExamRef.id)
          } catch (questionError) {
            console.error("[v0] Error copying questions for exam:", questionError)
            toast({
              variant: "error",
              title: "Warning",
              description: `Exam archived but failed to copy questions: ${questionError.message}`,
            })
          }

          archivedCount++
        }
      }

      await fetchClasses()
      setShowArchiveModal(false)
      setSelectedArchiveClasses([])
      setSelectedArchiveExams([])
      toast({
        title: "Success",
        description: `Successfully archived ${archivedCount} item(s)!`,
      })
    } catch (error) {
      console.error("[v0] Error archiving:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to archive. Please try again.",
      })
    } finally {
      setArchiveSubmitting(false)
    }
  }

  const getFilteredArchiveClasses = () => {
    let filtered = archiveClasses
    if (archiveSubject) {
      filtered = filtered.filter((c) =>
        Array.isArray(c.subject) ? c.subject.includes(archiveSubject) : c.subject === archiveSubject,
      )
    }
    if (archiveChapter) {
      filtered = filtered.filter((c) =>
        Array.isArray(c.chapter) ? c.chapter.includes(archiveChapter) : c.chapter === archiveChapter,
      )
    }
    return filtered
  }

  const toggleArchiveClass = (classId) => {
    setSelectedArchiveClasses((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId],
    )
  }

  const toggleAllArchiveClasses = () => {
    const filtered = getFilteredArchiveClasses()
    if (selectedArchiveClasses.length === filtered.length && filtered.length > 0) {
      setSelectedArchiveClasses([])
    } else {
      setSelectedArchiveClasses(filtered.map((c) => c.id))
    }
  }

  const fixAllVideoURLs = async () => {
    if (!selectedCourse) {
      toast({
        variant: "error",
        title: "Course Required",
        description: "Please select a course first!",
      })
      return
    }

    setConfirmDialog({
      isOpen: true,
      title: "Fix Video URLs",
      message: "This will add videoURL field to all classes in this course that are missing it. Continue?",
      confirmText: "Fix URLs",
      onConfirm: async () => {
        await performFixVideoURLs()
      },
    })
  }

  const performFixVideoURLs = async () => {
    try {
      setSubmitting(true)
      let updatedCount = 0

      for (const classItem of classes) {
        if (!classItem.videoURL && (classItem.youtubeLink || classItem.hlsLink)) {
          const videoURL = classItem.youtubeLink || classItem.hlsLink
          await updateDoc(doc(db, "classes", classItem.id), { videoURL })
          updatedCount++
        }
      }

      await fetchClasses()
      toast({
        title: "Success",
        description: `Successfully updated ${updatedCount} class(es) with videoURL field!`,
      })
    } catch (error) {
      console.error("Error fixing video URLs:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to fix video URLs. Please try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCourseData = courses.find((c) => c.id === selectedCourse)
  const batchCourses = courses.filter((c) => c.type === "batch")
  const archiveSourceCourseData = courses.find((c) => c.id === archiveSourceCourse)
  const uniqueArchiveSubjects = [
    ...new Set(archiveClasses.flatMap((c) => (Array.isArray(c.subject) ? c.subject : [c.subject])).filter(Boolean)),
  ].sort()
  const uniqueArchiveChapters = [
    ...new Set(archiveClasses.flatMap((c) => (Array.isArray(c.chapter) ? c.chapter : [c.chapter])).filter(Boolean)),
  ].sort()

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Manage Classes</h1>
            <p className="text-muted-foreground">Create and manage course classes</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleOpenArchiveModal}
              disabled={!selectedCourse}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-secondary/90 text-secondary-foreground rounded text-sm transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Archive Classes
            </button>
            <button
              onClick={() => handleOpenModal()}
              disabled={!selectedCourse}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-sm transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Class
            </button>
          </div>
        </div>
      </motion.div>

      {/* Course Selection */}
      <div className="mb-6">
        <label className="block text-xs font-medium mb-1.5">Select Course</label>
        <select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-full px-3 py-1.5 text-sm bg-card border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Choose a course...</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title} ({course.type})
            </option>
          ))}
        </select>
      </div>

      {/* Classes Table */}
      {selectedCourse && (
        <div>
          {/* Tab Toggle for Active/Archived */}
          <div className="mb-4 flex gap-2 border-b border-border">
            <button
              onClick={() => setShowArchivedClasses(false)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                !showArchivedClasses
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Active Classes
            </button>
            <button
              onClick={() => setShowArchivedClasses(true)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                showArchivedClasses
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Archived Classes
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium text-xs">Title</th>
                    {selectedCourseData?.type === "batch" && (
                      <th className="text-left p-2 font-medium text-xs">Subject</th>
                    )}
                    <th className="text-left p-2 font-medium text-xs">Chapter</th>
                    <th className="text-left p-2 font-medium text-xs">Teacher</th>
                    <th className="text-left p-2 font-medium text-xs">Order</th>
                    <th className="text-right p-2 font-medium text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {classes.map((classItem) => (
                    <tr key={classItem.id} className="hover:bg-muted/50">
                      <td className="p-2 text-xs">
                        <div className="flex items-center gap-2">
                          {classItem.title}
                          {showArchivedClasses && (
                            <span className="px-2 py-0.5 bg-orange-500/10 text-orange-500 rounded text-xs font-medium">
                              Archived
                            </span>
                          )}
                        </div>
                      </td>
                    {selectedCourseData?.type === "batch" && (
                      <td className="p-2 text-xs text-muted-foreground">{classItem.subject || "N/A"}</td>
                    )}
                    <td className="p-2 text-xs text-muted-foreground">{classItem.chapter || "N/A"}</td>
                    <td className="p-2 text-xs">
                      {classItem.teacherImageURL && (
                        <img
                          src={classItem.teacherImageURL || "/placeholder.svg"}
                          alt={classItem.teacherName}
                          className="w-6 h-6 rounded-full object-cover inline-block mr-1"
                        />
                      )}
                      <span className="text-xs">{classItem.teacherName || "N/A"}</span>
                    </td>
                    <td className="p-2 text-xs">{classItem.order}</td>
                    <td className="p-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleOpenModal(classItem)}
                          className="px-2 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(classItem.id)}
                          className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded transition-colors text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {classes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No classes yet. Add your first class!</p>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Add/Edit Class Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingClass ? "Edit Class" : "Add New Class"}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-muted rounded transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Teacher Name</label>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5 p-2 bg-background border border-border rounded min-h-[60px]">
                    {Array.isArray(formData.teacherName) &&
                      formData.teacherName.map((name, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm flex items-center gap-2"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = formData.teacherName.filter((_, i) => i !== idx)
                              setFormData({ ...formData, teacherName: updated })
                            }}
                            className="text-primary hover:text-primary/70"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                  </div>
                  <select
                    onChange={(e) => {
                      const value = e.target.value
                      if (value) {
                        const current = Array.isArray(formData.teacherName) ? formData.teacherName : []
                        if (!current.includes(value)) {
                          setFormData({ ...formData, teacherName: [...current, value] })
                        }
                        e.target.value = ""
                      }
                    }}
                    className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Add teacher...</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.name}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click to add multiple teachers</p>
              </div>

              {selectedCourseData?.type === "batch" && (
                <div>
                  <label className="block text-xs font-medium mb-1">Subject</label>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5 p-2 bg-background border border-border rounded min-h-[60px]">
                      {Array.isArray(formData.subject) &&
                        formData.subject.map((name, idx) => (
                          <div
                            key={idx}
                            className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs flex items-center gap-1"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() => {
                                const updated = formData.subject.filter((_, i) => i !== idx)
                                setFormData({ ...formData, subject: updated })
                              }}
                              className="text-primary hover:text-primary/70"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                    </div>
                    <select
                      onChange={(e) => {
                        const value = e.target.value
                        if (value) {
                          const current = Array.isArray(formData.subject) ? formData.subject : []
                          if (!current.includes(value)) {
                            setFormData({ ...formData, subject: [...current, value] })
                          }
                          e.target.value = ""
                        }
                      }}
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Add subject...</option>
                      {subjects
                        .filter((subject) => {
                          // Support both old courseId and new courseIds array
                          if (subject.courseIds && Array.isArray(subject.courseIds)) {
                            return subject.courseIds.includes(selectedCourse)
                          }
                          return subject.courseId === selectedCourse
                        })
                        .map((subject) => (
                          <option key={subject.id} value={subject.title}>
                            {subject.title}
                          </option>
                        ))}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Click to add multiple subjects</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1">Chapter</label>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5 p-2 bg-background border border-border rounded min-h-[60px]">
                    {Array.isArray(formData.chapter) &&
                      formData.chapter.map((name, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm flex items-center gap-2"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = formData.chapter.filter((_, i) => i !== idx)
                              setFormData({ ...formData, chapter: updated })
                            }}
                            className="text-primary hover:text-primary/70"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                  </div>
                  <select
                    onChange={(e) => {
                      const value = e.target.value
                      if (value) {
                        const current = Array.isArray(formData.chapter) ? formData.chapter : []
                        if (!current.includes(value)) {
                          setFormData({ ...formData, chapter: [...current, value] })
                        }
                        e.target.value = ""
                      }
                    }}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Add chapter...</option>
                    {chapters
                      .filter((chapter) => {
                        // For batch courses, filter chapters by selected subjects
                        if (selectedCourseData?.type === "batch" && formData.subject.length > 0) {
                          const selectedSubjectIds = subjects
                            .filter(s => formData.subject.includes(s.title))
                            .map(s => s.id)
                          return selectedSubjectIds.includes(chapter.subjectId)
                        }
                        // For non-batch courses, filter by selected course
                        return chapter.courseId === selectedCourse
                      })
                      .map((chapter) => (
                        <option key={chapter.id} value={chapter.title}>
                          {chapter.title}
                        </option>
                      ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click to add multiple chapters</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Order</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: e.target.value })}
                    required
                    className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Duration</label>
                  <input
                    type="text"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    placeholder="e.g., 45 min"
                    className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5">Video Source</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setVideoType("youtube")}
                    className={`flex-1 py-1 px-3 text-sm rounded border-2 transition-colors ${
                      videoType === "youtube"
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    YouTube Link
                  </button>
                </div>

                {videoType === "youtube" ? (
                  <div>
                    <input
                      type="url"
                      value={formData.youtubeLink}
                      onChange={(e) => setFormData({ ...formData, youtubeLink: e.target.value })}
                      placeholder="https://www.youtube.com/watch?v=..."
                      required={videoType === "youtube"}
                      className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Paste a YouTube video URL (supports youtube.com and youtu.be links)
                    </p>
                  </div>
                ) : null}
              </div>

              {/* Class Image Upload/Link */}
              <div>
                <label className="block text-xs font-medium mb-2">Class Image</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, imageType: "upload" })}
                    className={`flex-1 py-1.5 px-3 text-xs rounded transition-colors font-medium ${
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
                    className={`flex-1 py-1.5 px-3 text-xs rounded transition-colors font-medium ${
                      formData.imageType === "link"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                    }`}
                  >
                    Image Link
                  </button>
                </div>

                {formData.imageType === "upload" ? (
                  <div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setImageFile(e.target.files[0])}
                      className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Upload image to ImgBB (JPG, PNG, GIF)</p>
                  </div>
                ) : (
                  <div>
                    <input
                      type="url"
                      value={formData.imageLink}
                      onChange={(e) => setFormData({ ...formData, imageLink: e.target.value })}
                      placeholder="https://example.com/image.jpg"
                      className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Paste direct image URL</p>
                  </div>
                )}

                {/* Image Preview */}
                {(editingClass?.imageURL || formData.imageLink) && formData.imageType === "link" && (
                  <div className="mt-2">
                    <img
                      src={formData.imageLink || editingClass?.imageURL}
                      alt="Class preview"
                      className="w-32 h-32 object-cover rounded border border-border"
                      onError={(e) => {
                        e.target.style.display = "none"
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium">Resource Links</label>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({
                        ...formData,
                        resourceLinks: [...formData.resourceLinks, { label: "", url: "" }]
                      })
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Link
                  </button>
                </div>
                <div className="space-y-2">
                  {formData.resourceLinks.map((link, index) => (
                    <div key={index} className="flex gap-2 items-start p-2 bg-muted/30 rounded border border-border">
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={link.label}
                          onChange={(e) => {
                            const updated = [...formData.resourceLinks]
                            updated[index].label = e.target.value
                            setFormData({ ...formData, resourceLinks: updated })
                          }}
                          placeholder="Button label (e.g., Notes, PDF, Assignment)"
                          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <input
                          type="url"
                          value={link.url}
                          onChange={(e) => {
                            const updated = [...formData.resourceLinks]
                            updated[index].url = e.target.value
                            setFormData({ ...formData, resourceLinks: updated })
                          }}
                          placeholder="Link (PDF, Google Drive, image, etc.)"
                          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.resourceLinks.filter((_, i) => i !== index)
                          setFormData({ ...formData, resourceLinks: updated })
                        }}
                        className="p-1 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Add custom resource links that will appear as buttons below the class
                </p>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors disabled:opacity-50"
                >
                  {submitting ? "Saving..." : editingClass ? "Update Class" : "Create Class"}
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Archive/Transfer Modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-xl p-4 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Archive Classes to Current Course</h2>
              <button
                onClick={() => setShowArchiveModal(false)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1.5">Source Course (Archive)</label>
                <select
                  value={archiveSourceCourse}
                  onChange={(e) => {
                    setArchiveSourceCourse(e.target.value)
                    setSelectedArchiveClasses([])
                    setArchiveSubject("")
                    setArchiveChapter("")
                  }}
                  className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select source course...</option>
                  {courses
                    .filter((c) => c.id !== selectedCourse)
                    .map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title} ({course.type})
                      </option>
                    ))}
                </select>
              </div>

              {archiveSourceCourse && archiveClasses.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5">Filter by Subject</label>
                      <select
                        value={archiveSubject}
                        onChange={(e) => setArchiveSubject(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">All Subjects</option>
                        {uniqueArchiveSubjects.map((subject) => (
                          <option key={subject} value={subject}>
                            {subject}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5">Filter by Chapter</label>
                      <select
                        value={archiveChapter}
                        onChange={(e) => setArchiveChapter(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">All Chapters</option>
                        {uniqueArchiveChapters.map((chapter) => (
                          <option key={chapter} value={chapter}>
                            {chapter}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="border border-border rounded p-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium">
                        Select Classes to Transfer ({selectedArchiveClasses.length} selected)
                      </label>
                      <button
                        type="button"
                        onClick={toggleAllArchiveClasses}
                        className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded transition-colors"
                      >
                        {selectedArchiveClasses.length === getFilteredArchiveClasses().length &&
                        getFilteredArchiveClasses().length > 0
                          ? "Deselect All"
                          : "Select All"}
                      </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {getFilteredArchiveClasses().map((classItem) => (
                        <label
                          key={classItem.id}
                          className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedArchiveClasses.includes(classItem.id)}
                            onChange={() => toggleArchiveClass(classItem.id)}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                          />
                          <div className="flex-1 text-xs">
                            <div className="font-medium">{classItem.title}</div>
                            <div className="text-muted-foreground">
                              {archiveSourceCourseData?.type === "batch" && classItem.subject && (
                                <span className="mr-2">
                                  Subject:{" "}
                                  {Array.isArray(classItem.subject) ? classItem.subject.join(", ") : classItem.subject}
                                </span>
                              )}
                              {classItem.chapter && (
                                <span>
                                  Chapter:{" "}
                                  {Array.isArray(classItem.chapter) ? classItem.chapter.join(", ") : classItem.chapter}
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="border border-border rounded p-2 mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium">
                        Select Exams to Archive ({selectedArchiveExams.length} selected)
                      </label>
                      {archiveExams.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleAllArchiveExams}
                          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded transition-colors"
                        >
                          {selectedArchiveExams.length === archiveExams.length && archiveExams.length > 0
                            ? "Deselect All"
                            : "Select All"}
                        </button>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {archiveExams.length > 0 ? (
                        archiveExams.map((exam) => (
                          <label
                            key={exam.id}
                            className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedArchiveExams.includes(exam.id)}
                              onChange={() => toggleArchiveExam(exam.id)}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                            />
                            <div className="flex-1 text-xs">
                              <div className="font-medium">{exam.title}</div>
                              <div className="text-muted-foreground">
                                Duration: {exam.duration} min • Passing: {exam.passingScore}%
                              </div>
                            </div>
                          </label>
                        ))
                      ) : (
                        <div className="text-center py-4 text-muted-foreground text-xs">
                          No exams found in this course
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleArchiveSubmit}
                      disabled={
                        archiveSubmitting || (selectedArchiveClasses.length === 0 && selectedArchiveExams.length === 0)
                      }
                      className="flex-1 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors disabled:opacity-50"
                    >
                      {archiveSubmitting
                        ? "Transferring..."
                        : `Transfer ${selectedArchiveClasses.length + selectedArchiveExams.length} Item(s)`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowArchiveModal(false)}
                      className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {archiveSourceCourse && archiveClasses.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No classes found in the selected course.
                </div>
              )}
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
