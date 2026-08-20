"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Plus, X, Wrench, Archive } from "lucide-react"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { uploadImageToImgBB } from "../../lib/imgbb"
import { useExam } from "../../contexts/ExamContext"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useAuth } from "../../contexts/AuthContext"
import { toast } from "../../hooks/use-toast"
import {
  ADMIN_PERMISSION_KEYS,
  getAllowedCourseIds,
  hasAdminPermission,
  isFullAdmin,
} from "../../lib/adminPermissions"

const emptyForm = {
  title: "",
  topic: "",
  chapter: [],
  subject: [],
  order: 0,
  duration: "",
  youtubeLink: "",
  hlsLink: "",
  driveLink: "",
  dailymotionLink: "",
  rumbleLink: "",
  teacherName: [],
  imageType: "upload",
  imageLink: "",
  teacherImageType: "upload",
  teacherImageLink: "",
  resourceLinks: [],
}

const isArchivedClass = (item) => {
  if (item?.isArchived === true) return true
  const subjects = Array.isArray(item?.subject) ? item.subject : [item?.subject]
  const chapters = Array.isArray(item?.chapter) ? item.chapter : [item?.chapter]
  return subjects.includes("archive") || chapters.includes("archive")
}

const arrayValue = (value) => Array.isArray(value) ? value : value ? [value] : []

export default function ManageClasses() {
  const { userProfile } = useAuth()
  const { getExamsByCourse, copyExamQuestions } = useExam()
  const [courses, setCourses] = useState([])
  const [classes, setClasses] = useState([])
  const [subjects, setSubjects] = useState([])
  const [chapters, setChapters] = useState([])
  const [teachers, setTeachers] = useState([])
  const [selectedCourse, setSelectedCourse] = useState("")
  const [classSubjectFilter, setClassSubjectFilter] = useState("")
  const [classChapterFilter, setClassChapterFilter] = useState("")
  const [courseSearchQuery, setCourseSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [showArchivedClasses, setShowArchivedClasses] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editingClass, setEditingClass] = useState(null)
  const [videoType, setVideoType] = useState("youtube")
  const [formData, setFormData] = useState(emptyForm)
  const [imageFile, setImageFile] = useState(null)
  const [teacherImageFile, setTeacherImageFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [showArchiveModal, setShowArchiveModal] = useState(false)
  const [archiveSourceCourse, setArchiveSourceCourse] = useState("")
  const [archiveClasses, setArchiveClasses] = useState([])
  const [selectedArchiveClasses, setSelectedArchiveClasses] = useState([])
  const [archiveExams, setArchiveExams] = useState([])
  const [selectedArchiveExams, setSelectedArchiveExams] = useState([])
  const [archiveSubject, setArchiveSubject] = useState("")
  const [archiveChapter, setArchiveChapter] = useState("")
  const [archiveCourseSearchQuery, setArchiveCourseSearchQuery] = useState("")
  const [archiveSubmitting, setArchiveSubmitting] = useState(false)

  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  })

  const fullAdmin = isFullAdmin(userProfile)
  const canArchiveExams = fullAdmin || hasAdminPermission(userProfile, ADMIN_PERMISSION_KEYS.EXAMS)

  useEffect(() => {
    Promise.all([fetchCourses(), fetchSubjects(), fetchChapters(), fetchTeachers()]).finally(() => setLoading(false))
  }, [userProfile])

  useEffect(() => {
    if (selectedCourse) fetchClasses()
    else setClasses([])
  }, [selectedCourse, showArchivedClasses])

  useEffect(() => {
    setClassSubjectFilter("")
    setClassChapterFilter("")
  }, [selectedCourse, showArchivedClasses])

  useEffect(() => {
    if (!archiveSourceCourse) {
      setArchiveClasses([])
      setArchiveExams([])
      return
    }
    fetchArchiveClasses(archiveSourceCourse)
    if (canArchiveExams) fetchArchiveExams(archiveSourceCourse)
  }, [archiveSourceCourse, canArchiveExams])

  const fetchCourses = async () => {
    try {
      const snapshot = await getDocs(collection(db, "courses"))
      const data = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      const allowedCourseIds = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.CLASSES)
      setCourses(allowedCourseIds === null ? data : data.filter((course) => allowedCourseIds.includes(course.id)))
    } catch (error) {
      console.error("Error fetching courses:", error)
      toast({ variant: "error", title: "Error", description: "Failed to load allowed courses." })
    }
  }

  const fetchSubjects = async () => {
    try {
      const snapshot = await getDocs(collection(db, "subjects"))
      setSubjects(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    } catch (error) {
      console.error("Error fetching subjects:", error)
    }
  }

  const fetchChapters = async () => {
    try {
      const snapshot = await getDocs(collection(db, "chapters"))
      setChapters(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    } catch (error) {
      console.error("Error fetching chapters:", error)
    }
  }

  const fetchTeachers = async () => {
    try {
      const snapshot = await getDocs(collection(db, "teachers"))
      setTeachers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    } catch (error) {
      console.error("Error fetching teachers:", error)
    }
  }

  const fetchClasses = async () => {
    try {
      const snapshot = await getDocs(query(collection(db, "classes"), where("courseId", "==", selectedCourse)))
      setClasses(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => showArchivedClasses ? isArchivedClass(item) : !isArchivedClass(item))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
      )
    } catch (error) {
      console.error("Error fetching classes:", error)
      toast({ variant: "error", title: "Error", description: "Failed to load classes." })
    }
  }

  const fetchArchiveClasses = async (courseId) => {
    try {
      const snapshot = await getDocs(query(collection(db, "classes"), where("courseId", "==", courseId)))
      setArchiveClasses(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => !isArchivedClass(item))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
      )
    } catch (error) {
      console.error("Error fetching archive classes:", error)
      setArchiveClasses([])
    }
  }

  const fetchArchiveExams = async (courseId) => {
    try {
      const data = await getExamsByCourse(courseId)
      setArchiveExams(data.filter((exam) => !exam.isArchived))
    } catch (error) {
      console.error("Error fetching archive exams:", error)
      setArchiveExams([])
    }
  }

  const getNextActiveClassOrder = async () => {
    try {
      const snapshot = await getDocs(query(collection(db, "classes"), where("courseId", "==", selectedCourse)))
      const active = snapshot.docs.map((item) => item.data()).filter((item) => !isArchivedClass(item))
      if (active.length === 0) return 0
      return Math.max(...active.map((item) => Number(item.order || 0))) + 1
    } catch {
      return 0
    }
  }

  const handleOpenModal = async (classItem = null) => {
    if (classItem) {
      setEditingClass(classItem)
      setFormData({
        ...emptyForm,
        title: classItem.title || "",
        topic: classItem.topic || "",
        chapter: arrayValue(classItem.chapter),
        subject: arrayValue(classItem.subject),
        order: classItem.order || 0,
        duration: classItem.duration || "",
        youtubeLink: classItem.youtubeLink || "",
        hlsLink: classItem.hlsLink || "",
        driveLink: classItem.driveLink || "",
        dailymotionLink: classItem.dailymotionLink || "",
        rumbleLink: classItem.rumbleLink || "",
        teacherName: arrayValue(classItem.teacherName),
        imageType: classItem.imageURL?.startsWith("http") ? "link" : "upload",
        imageLink: classItem.imageURL || "",
        teacherImageType: classItem.teacherImageURL?.startsWith("http") ? "link" : "upload",
        teacherImageLink: classItem.teacherImageURL || "",
        resourceLinks: Array.isArray(classItem.resourceLinks) ? classItem.resourceLinks : [],
      })
      setVideoType(
        classItem.youtubeLink ? "youtube"
          : classItem.driveLink ? "drive"
            : classItem.dailymotionLink ? "dailymotion"
              : classItem.rumbleLink ? "rumble"
                : "hls",
      )
    } else {
      setEditingClass(null)
      setFormData({ ...emptyForm, order: await getNextActiveClassOrder() })
      setVideoType("youtube")
    }
    setImageFile(null)
    setTeacherImageFile(null)
    setShowModal(true)
  }

  const closeEditor = () => {
    setShowModal(false)
    setEditingClass(null)
    setImageFile(null)
    setTeacherImageFile(null)
  }

  const selectedVideoUrl = () => {
    if (videoType === "youtube") return formData.youtubeLink
    if (videoType === "drive") return formData.driveLink
    if (videoType === "dailymotion") return formData.dailymotionLink
    if (videoType === "rumble") return formData.rumbleLink
    if (videoType === "hls") return formData.hlsLink
    return ""
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!selectedCourse) return
    setSubmitting(true)

    try {
      let imageURL = editingClass?.imageURL || ""
      let teacherImageURL = editingClass?.teacherImageURL || ""
      if (imageFile) imageURL = await uploadImageToImgBB(imageFile)
      else if (formData.imageType === "link") imageURL = formData.imageLink
      if (teacherImageFile) teacherImageURL = await uploadImageToImgBB(teacherImageFile)
      else if (formData.teacherImageType === "link") teacherImageURL = formData.teacherImageLink

      const classData = {
        courseId: selectedCourse,
        title: formData.title.trim(),
        topic: formData.topic.trim(),
        chapter: arrayValue(formData.chapter),
        subject: arrayValue(formData.subject),
        order: Number.parseInt(formData.order, 10) || 0,
        duration: formData.duration,
        youtubeLink: videoType === "youtube" ? formData.youtubeLink.trim() : "",
        hlsLink: videoType === "hls" ? formData.hlsLink.trim() : "",
        driveLink: videoType === "drive" ? formData.driveLink.trim() : "",
        dailymotionLink: videoType === "dailymotion" ? formData.dailymotionLink.trim() : "",
        rumbleLink: videoType === "rumble" ? formData.rumbleLink.trim() : "",
        videoURL: selectedVideoUrl().trim(),
        imageURL,
        teacherName: arrayValue(formData.teacherName),
        teacherImageURL,
        resourceLinks: Array.isArray(formData.resourceLinks)
          ? formData.resourceLinks.filter((item) => item?.label?.trim() && item?.url?.trim())
          : [],
        updatedAt: serverTimestamp(),
      }

      if (editingClass) {
        // Keep the original upload time intact. Old classes without createdAt remain legacy records.
        await updateDoc(doc(db, "classes", editingClass.id), classData)
      } else {
        // Server time is authoritative, so uploader clock/timezone cannot corrupt the upload date.
        await addDoc(collection(db, "classes"), { ...classData, createdAt: serverTimestamp() })
      }

      // cacheV2Firestore emits a targeted mutation hint. Other students keep their persistent
      // cache and fetch only this changed class document from the server.
      await fetchClasses()
      closeEditor()
      toast({ title: "Success", description: editingClass ? "Class updated successfully!" : "Class created successfully!" })
    } catch (error) {
      console.error("Error saving class:", error)
      toast({ variant: "error", title: "Error", description: `Failed to save class. ${error.message || "Please try again."}` })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = (classId) => {
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
          toast({ title: "Success", description: "Class deleted successfully" })
        } catch (error) {
          toast({ variant: "error", title: "Error", description: error.message || "Failed to delete class" })
        }
      },
    })
  }

  const fixAllVideoURLs = () => {
    if (!selectedCourse) return
    setConfirmDialog({
      isOpen: true,
      title: "Fix Video URLs",
      message: "Add videoURL to classes in this course that are missing it?",
      confirmText: "Fix URLs",
      onConfirm: async () => {
        setSubmitting(true)
        try {
          let updatedCount = 0
          for (const item of classes) {
            if (!item.videoURL && (item.youtubeLink || item.hlsLink || item.driveLink || item.dailymotionLink || item.rumbleLink)) {
              const videoURL = item.youtubeLink || item.driveLink || item.dailymotionLink || item.rumbleLink || item.hlsLink
              await updateDoc(doc(db, "classes", item.id), { videoURL, updatedAt: serverTimestamp() })
              updatedCount += 1
            }
          }
          await fetchClasses()
          toast({ title: "Success", description: `Updated ${updatedCount} class(es).` })
        } finally {
          setSubmitting(false)
        }
      },
    })
  }

  const openArchiveModal = () => {
    setShowArchiveModal(true)
    setArchiveSourceCourse("")
    setArchiveClasses([])
    setSelectedArchiveClasses([])
    setArchiveExams([])
    setSelectedArchiveExams([])
    setArchiveSubject("")
    setArchiveChapter("")
    setArchiveCourseSearchQuery("")
  }

  const archiveSourceCourseData = courses.find((course) => course.id === archiveSourceCourse)
  const selectedCourseData = courses.find((course) => course.id === selectedCourse)

  const archiveFilteredClasses = useMemo(() => archiveClasses.filter((item) => {
    const matchesSubject = !archiveSubject || arrayValue(item.subject).includes(archiveSubject)
    const matchesChapter = !archiveChapter || arrayValue(item.chapter).includes(archiveChapter)
    return matchesSubject && matchesChapter
  }), [archiveClasses, archiveSubject, archiveChapter])

  const handleArchiveSubmit = async () => {
    if (selectedArchiveClasses.length === 0 && selectedArchiveExams.length === 0) {
      toast({ variant: "error", title: "Selection Required", description: "Select at least one class or exam." })
      return
    }
    if (!archiveSourceCourseData || archiveSourceCourseData.type !== selectedCourseData?.type) {
      toast({ variant: "error", title: "Course Type Mismatch", description: "Archive source and destination courses must have the same type." })
      return
    }

    setArchiveSubmitting(true)
    try {
      let count = 0
      let nextOrder = classes.length > 0 ? Math.max(...classes.map((item) => Number(item.order || 0))) + 1 : 0
      for (const classId of selectedArchiveClasses) {
        const source = archiveClasses.find((item) => item.id === classId)
        if (!source) continue
        const { id, ...copy } = source
        await addDoc(collection(db, "classes"), {
          ...copy,
          courseId: selectedCourse,
          isArchived: true,
          archivedAt: new Date().toISOString(),
          archivedFrom: archiveSourceCourse,
          order: nextOrder,
          createdAt: source.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        nextOrder += 1
        count += 1
      }

      if (canArchiveExams) {
        for (const examId of selectedArchiveExams) {
          const source = archiveExams.find((item) => item.id === examId)
          if (!source) continue
          const { id, ...copy } = source
          const ref = await addDoc(collection(db, "exams"), {
            ...copy,
            courseId: selectedCourse,
            isArchived: true,
            archivedAt: new Date().toISOString(),
            archivedFrom: archiveSourceCourse,
          })
          try {
            await copyExamQuestions(examId, ref.id)
          } catch (error) {
            console.error("Archived exam created but question copy failed:", error)
          }
          count += 1
        }
      }

      await fetchClasses()
      setShowArchiveModal(false)
      toast({ title: "Success", description: `Archived ${count} item(s).` })
    } catch (error) {
      toast({ variant: "error", title: "Archive Failed", description: error.message || "Failed to archive." })
    } finally {
      setArchiveSubmitting(false)
    }
  }

  const availableClassSubjects = useMemo(() => [...new Set(
    classes.flatMap((item) => arrayValue(item.subject)).filter((value) => value && value !== "archive"),
  )].sort(), [classes])

  const availableClassChapters = useMemo(() => [...new Set(
    classes
      .filter((item) => selectedCourseData?.type !== "batch" || !classSubjectFilter || arrayValue(item.subject).includes(classSubjectFilter))
      .flatMap((item) => arrayValue(item.chapter))
      .filter((value) => value && value !== "archive"),
  )].sort(), [classes, selectedCourseData?.type, classSubjectFilter])

  const filteredClasses = useMemo(() => classes.filter((item) => {
    const subjectMatches = selectedCourseData?.type !== "batch" || !classSubjectFilter || arrayValue(item.subject).includes(classSubjectFilter)
    const chapterMatches = !classChapterFilter || arrayValue(item.chapter).includes(classChapterFilter)
    return subjectMatches && chapterMatches
  }), [classes, selectedCourseData?.type, classSubjectFilter, classChapterFilter])

  const courseSubjects = subjects.filter((item) => !item.courseId || item.courseId === selectedCourse)
  const courseChapters = chapters.filter((item) => !item.courseId || item.courseId === selectedCourse)

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading classes...</div>

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold mb-2">Manage Classes</h1>
            <p className="text-muted-foreground">Create and manage course classes. Changes sync to students without clearing their persistent cache.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={fixAllVideoURLs} disabled={!selectedCourse || submitting} className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm disabled:opacity-50"><Wrench className="w-4 h-4" />Fix Video URLs</button>
            <button onClick={openArchiveModal} disabled={!selectedCourse} className="flex items-center gap-1.5 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm disabled:opacity-50"><Archive className="w-4 h-4" />Archive</button>
            <button onClick={() => handleOpenModal()} disabled={!selectedCourse} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50"><Plus className="w-4 h-4" />Add Class</button>
          </div>
        </div>
      </motion.div>

      <div className="mb-6">
        <label className="block text-xs font-medium mb-1.5">Select Course</label>
        <input value={courseSearchQuery} onChange={(event) => setCourseSearchQuery(event.target.value)} placeholder="Search allowed courses..." className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg mb-2" />
        <select value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)} className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg">
          <option value="">Choose a course...</option>
          {courses.filter((course) => course.title?.toLowerCase().includes(courseSearchQuery.toLowerCase())).map((course) => <option key={course.id} value={course.id}>{course.title} ({course.type})</option>)}
        </select>
      </div>

      {selectedCourse && (
        <>
          <div className="mb-4 flex gap-2 border-b border-border">
            <button onClick={() => setShowArchivedClasses(false)} className={`px-4 py-2 text-sm font-medium border-b-2 ${!showArchivedClasses ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>Active Classes</button>
            <button onClick={() => setShowArchivedClasses(true)} className={`px-4 py-2 text-sm font-medium border-b-2 ${showArchivedClasses ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>Archived Classes</button>
          </div>

          <div className={`mb-4 grid gap-3 ${selectedCourseData?.type === "batch" ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
            {selectedCourseData?.type === "batch" && (
              <FilterSelect label="Filter by Subject" value={classSubjectFilter} onChange={(value) => { setClassSubjectFilter(value); setClassChapterFilter("") }} options={availableClassSubjects} />
            )}
            <FilterSelect label="Filter by Chapter" value={classChapterFilter} onChange={setClassChapterFilter} options={availableClassChapters} />
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-muted"><tr><th className="text-left p-3 text-xs">Title</th>{selectedCourseData?.type === "batch" && <th className="text-left p-3 text-xs">Subject</th>}<th className="text-left p-3 text-xs">Chapter</th><th className="text-left p-3 text-xs">Teacher</th><th className="text-left p-3 text-xs">Order</th><th className="text-right p-3 text-xs">Actions</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {filteredClasses.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/50">
                      <td className="p-3 text-sm"><span className="font-medium">{item.title}</span>{showArchivedClasses && <span className="ml-2 px-2 py-0.5 bg-orange-500/10 text-orange-500 rounded text-[11px]">Archived</span>}</td>
                      {selectedCourseData?.type === "batch" && <td className="p-3 text-xs text-muted-foreground">{arrayValue(item.subject).join(", ") || "N/A"}</td>}
                      <td className="p-3 text-xs text-muted-foreground">{arrayValue(item.chapter).join(", ") || "N/A"}</td>
                      <td className="p-3 text-xs">{arrayValue(item.teacherName).join(", ") || "N/A"}</td>
                      <td className="p-3 text-xs">{item.order ?? 0}</td>
                      <td className="p-3"><div className="flex justify-end gap-2"><button onClick={() => handleOpenModal(item)} className="px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg">Edit</button><button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 text-xs bg-red-500/10 text-red-500 rounded-lg">Delete</button></div></td>
                    </tr>
                  ))}
                  {filteredClasses.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No matching classes.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5"><h2 className="text-xl font-bold">{editingClass ? "Edit Class" : "Add Class"}</h2><button onClick={closeEditor} className="p-2 hover:bg-muted rounded-lg"><X className="w-5 h-5" /></button></div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <TextField label="Class title" required value={formData.title} onChange={(value) => setFormData((data) => ({ ...data, title: value }))} />
                <TextField label="Topic" value={formData.topic} onChange={(value) => setFormData((data) => ({ ...data, topic: value }))} />
                <TextField label="Duration" value={formData.duration} onChange={(value) => setFormData((data) => ({ ...data, duration: value }))} placeholder="e.g. 1:26:18" />
                <TextField label="Order" type="number" value={formData.order} onChange={(value) => setFormData((data) => ({ ...data, order: value }))} />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <MultiSelect label="Subjects" options={courseSubjects.map((item) => item.title || item.name).filter(Boolean)} selected={formData.subject} onToggle={(value) => setFormData((data) => ({ ...data, subject: data.subject.includes(value) ? data.subject.filter((item) => item !== value) : [...data.subject, value] }))} />
                <MultiSelect label="Chapters" options={courseChapters.map((item) => item.title || item.name).filter(Boolean)} selected={formData.chapter} onToggle={(value) => setFormData((data) => ({ ...data, chapter: data.chapter.includes(value) ? data.chapter.filter((item) => item !== value) : [...data.chapter, value] }))} />
              </div>

              <MultiSelect label="Teachers" options={teachers.map((item) => item.name || item.title).filter(Boolean)} selected={formData.teacherName} onToggle={(value) => setFormData((data) => ({ ...data, teacherName: data.teacherName.includes(value) ? data.teacherName.filter((item) => item !== value) : [...data.teacherName, value] }))} />

              <div>
                <label className="block text-sm font-medium mb-2">Video source</label>
                <div className="flex flex-wrap gap-2 mb-3">{["youtube", "drive", "dailymotion", "rumble", "hls"].map((type) => <button key={type} type="button" onClick={() => setVideoType(type)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${videoType === type ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{type}</button>)}</div>
                <TextField label={`${videoType} URL`} required value={formData[`${videoType}Link`] || ""} onChange={(value) => setFormData((data) => ({ ...data, [`${videoType}Link`]: value }))} placeholder="https://..." />
              </div>

              <ImageField label="Class image" type={formData.imageType} link={formData.imageLink} onType={(value) => setFormData((data) => ({ ...data, imageType: value }))} onLink={(value) => setFormData((data) => ({ ...data, imageLink: value }))} onFile={setImageFile} />
              <ImageField label="Teacher image" type={formData.teacherImageType} link={formData.teacherImageLink} onType={(value) => setFormData((data) => ({ ...data, teacherImageType: value }))} onLink={(value) => setFormData((data) => ({ ...data, teacherImageLink: value }))} onFile={setTeacherImageFile} />

              <div>
                <div className="flex items-center justify-between mb-2"><label className="text-sm font-medium">Resource links</label><button type="button" onClick={() => setFormData((data) => ({ ...data, resourceLinks: [...data.resourceLinks, { label: "", url: "" }] }))} className="text-sm text-primary">+ Add resource</button></div>
                <div className="space-y-2">{formData.resourceLinks.map((resource, index) => <div key={index} className="grid grid-cols-[1fr_2fr_auto] gap-2"><input value={resource.label || ""} onChange={(event) => setFormData((data) => ({ ...data, resourceLinks: data.resourceLinks.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} placeholder="Label" className="px-3 py-2 bg-background border border-border rounded-lg text-sm" /><input value={resource.url || ""} onChange={(event) => setFormData((data) => ({ ...data, resourceLinks: data.resourceLinks.map((item, i) => i === index ? { ...item, url: event.target.value } : item) }))} placeholder="https://..." className="px-3 py-2 bg-background border border-border rounded-lg text-sm" /><button type="button" onClick={() => setFormData((data) => ({ ...data, resourceLinks: data.resourceLinks.filter((_, i) => i !== index) }))} className="p-2 text-red-500"><X className="w-4 h-4" /></button></div>)}</div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-border"><button type="button" onClick={closeEditor} className="flex-1 py-2 bg-muted rounded-lg">Cancel</button><button type="submit" disabled={submitting} className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50">{submitting ? "Saving..." : editingClass ? "Update Class" : "Create Class"}</button></div>
            </form>
          </div>
        </div>
      )}

      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5"><h2 className="text-xl font-bold">Archive from another course</h2><button onClick={() => setShowArchiveModal(false)} className="p-2 hover:bg-muted rounded-lg"><X className="w-5 h-5" /></button></div>
            <input value={archiveCourseSearchQuery} onChange={(event) => setArchiveCourseSearchQuery(event.target.value)} placeholder="Search source course..." className="w-full px-3 py-2 bg-background border border-border rounded-lg mb-2" />
            <select value={archiveSourceCourse} onChange={(event) => { setArchiveSourceCourse(event.target.value); setSelectedArchiveClasses([]); setSelectedArchiveExams([]) }} className="w-full px-3 py-2 bg-background border border-border rounded-lg mb-4"><option value="">Choose source course...</option>{courses.filter((course) => course.id !== selectedCourse && course.type === selectedCourseData?.type && course.title?.toLowerCase().includes(archiveCourseSearchQuery.toLowerCase())).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>

            {archiveSourceCourse && (
              <>
                <div className="grid md:grid-cols-2 gap-3 mb-4">
                  <FilterSelect label="Archive subject" value={archiveSubject} onChange={setArchiveSubject} options={[...new Set(archiveClasses.flatMap((item) => arrayValue(item.subject)).filter(Boolean))].sort()} />
                  <FilterSelect label="Archive chapter" value={archiveChapter} onChange={setArchiveChapter} options={[...new Set(archiveClasses.flatMap((item) => arrayValue(item.chapter)).filter(Boolean))].sort()} />
                </div>
                <h3 className="font-semibold mb-2">Classes</h3>
                <div className="max-h-56 overflow-y-auto space-y-2 mb-5">{archiveFilteredClasses.map((item) => <label key={item.id} className="flex items-center gap-3 p-3 border border-border rounded-lg"><input type="checkbox" checked={selectedArchiveClasses.includes(item.id)} onChange={() => setSelectedArchiveClasses((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span className="text-sm">{item.title}</span></label>)}{archiveFilteredClasses.length === 0 && <p className="text-sm text-muted-foreground">No classes found.</p>}</div>

                {canArchiveExams && <><h3 className="font-semibold mb-2">Exams</h3><div className="max-h-44 overflow-y-auto space-y-2 mb-5">{archiveExams.map((exam) => <label key={exam.id} className="flex items-center gap-3 p-3 border border-border rounded-lg"><input type="checkbox" checked={selectedArchiveExams.includes(exam.id)} onChange={() => setSelectedArchiveExams((current) => current.includes(exam.id) ? current.filter((id) => id !== exam.id) : [...current, exam.id])} /><span className="text-sm">{exam.title}</span></label>)}{archiveExams.length === 0 && <p className="text-sm text-muted-foreground">No exams found.</p>}</div></>}
              </>
            )}

            <div className="flex gap-3 pt-3 border-t border-border"><button onClick={() => setShowArchiveModal(false)} className="flex-1 py-2 bg-muted rounded-lg">Cancel</button><button onClick={handleArchiveSubmit} disabled={archiveSubmitting || (!selectedArchiveClasses.length && !selectedArchiveExams.length)} className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50">{archiveSubmitting ? "Archiving..." : "Archive selected"}</button></div>
          </div>
        </div>
      )}

      <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} variant={confirmDialog.variant} confirmText={confirmDialog.confirmText} onConfirm={async () => { const callback = confirmDialog.onConfirm; setConfirmDialog({ isOpen: false, title: "", message: "", onConfirm: () => {} }); await callback?.() }} onCancel={() => setConfirmDialog({ isOpen: false, title: "", message: "", onConfirm: () => {} })} />
    </div>
  )
}

function TextField({ label, value, onChange, required = false, type = "text", placeholder = "" }) {
  return <label className="block"><span className="block text-sm font-medium mb-1.5">{label}</span><input type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" /></label>
}

function FilterSelect({ label, value, onChange, options }) {
  return <label className="block"><span className="block text-xs font-medium mb-1.5">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm"><option value="">All</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
}

function MultiSelect({ label, options, selected, onToggle }) {
  return <div><p className="text-sm font-medium mb-2">{label}</p><div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-muted/20 rounded-lg">{options.map((option) => <label key={option} className="flex items-center gap-2 p-2 bg-card border border-border rounded-lg text-sm"><input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />{option}</label>)}{options.length === 0 && <span className="text-xs text-muted-foreground p-2">No options found.</span>}</div></div>
}

function ImageField({ label, type, link, onType, onLink, onFile }) {
  return <div><p className="text-sm font-medium mb-2">{label}</p><div className="flex gap-2 mb-2"><button type="button" onClick={() => onType("upload")} className={`px-3 py-1.5 text-sm rounded-lg ${type === "upload" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>Upload</button><button type="button" onClick={() => onType("link")} className={`px-3 py-1.5 text-sm rounded-lg ${type === "link" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>Link</button></div>{type === "upload" ? <input type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0] || null)} className="w-full text-sm" /> : <input value={link} onChange={(event) => onLink(event.target.value)} placeholder="https://..." className="w-full px-3 py-2 bg-background border border-border rounded-lg" />}</div>
}
