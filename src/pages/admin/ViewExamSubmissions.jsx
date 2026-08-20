"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  FileQuestion,
  User,
  Calendar,
  ImageIcon,
  CheckCircle,
  Award,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react"
import { collection, getDocs, query, orderBy, doc, getDoc, updateDoc } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import { useAuth } from "../../contexts/AuthContext"
import { ADMIN_PERMISSION_KEYS, getAllowedCourseIds } from "../../lib/adminPermissions"

export default function ViewExamSubmissions() {
  const { userProfile } = useAuth()
  const [submissions, setSubmissions] = useState([])
  const [exams, setExams] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedExam, setSelectedExam] = useState("")
  const [markingFilter, setMarkingFilter] = useState("all")
  const [expandedSubmissions, setExpandedSubmissions] = useState({})
  const [editingGrades, setEditingGrades] = useState({})
  const [savingGrades, setSavingGrades] = useState({})

  useEffect(() => {
    fetchData()
  }, [userProfile])

  const fetchData = async () => {
    setLoading(true)
    try {
      const allowedCourseIds = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.EXAM_SUBMISSIONS)
      const allowed = allowedCourseIds === null ? null : new Set(allowedCourseIds)
      const examsSnapshot = await getDocs(collection(db, "exams"))
      const allowedExams = examsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((exam) => allowed === null || allowed.has(exam.courseId))
      setExams(allowedExams)
      const allowedExamIds = new Set(allowedExams.map((exam) => exam.id))

      const submissionsSnapshot = await getDocs(query(collection(db, "examResults"), orderBy("submittedAt", "desc")))
      const allowedSubmissions = submissionsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((submission) => allowedExamIds.has(submission.examId))
        .filter((submission) => Array.isArray(submission.cqAnswers) && submission.cqAnswers.length > 0)
      setSubmissions(allowedSubmissions)

      const usersData = {}
      for (const userId of [...new Set(allowedSubmissions.map((submission) => submission.userId).filter(Boolean))]) {
        const userDoc = await getDoc(doc(db, "users", userId))
        if (userDoc.exists()) usersData[userId] = userDoc.data()
      }
      setUsers(usersData)
    } catch (error) {
      console.error("Error fetching CQ submissions:", error)
      toast({ variant: "error", title: "Error", description: "Failed to load submissions" })
    } finally {
      setLoading(false)
    }
  }

  const toggleExpanded = (submissionId) => {
    setExpandedSubmissions((current) => ({ ...current, [submissionId]: !current[submissionId] }))
  }

  const handleGradeChange = (submissionId, questionIndex, value) => {
    setEditingGrades((current) => ({ ...current, [submissionId]: { ...current[submissionId], [questionIndex]: value } }))
  }

  const saveGrades = async (submissionId) => {
    const submission = submissions.find((item) => item.id === submissionId)
    if (!submission) return

    const allowedCourseIds = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.EXAM_SUBMISSIONS)
    const exam = exams.find((item) => item.id === submission.examId)
    if (!exam || (allowedCourseIds !== null && !allowedCourseIds.includes(exam.courseId))) {
      toast({ variant: "error", title: "Access Denied", description: "This exam is outside your assigned course scope." })
      return
    }

    setSavingGrades((current) => ({ ...current, [submissionId]: true }))
    try {
      const updatedCqAnswers = submission.cqAnswers.map((cqAnswer, index) => ({
        ...cqAnswer,
        obtainedMarks: editingGrades[submissionId]?.[index] !== undefined
          ? Number.parseFloat(editingGrades[submissionId][index]) || 0
          : cqAnswer.obtainedMarks || 0,
      }))
      const totalCqMarks = updatedCqAnswers.reduce((sum, cq) => sum + (Number(cq.marks) || 0), 0)
      const obtainedCqMarks = updatedCqAnswers.reduce((sum, cq) => sum + (Number(cq.obtainedMarks) || 0), 0)
      const mcqScore = Number(submission.score || 0)
      const cqPercentage = totalCqMarks > 0 ? (obtainedCqMarks / totalCqMarks) * 100 : 0
      const totalScore = (mcqScore + cqPercentage) / 2

      await updateDoc(doc(db, "examResults", submissionId), {
        cqAnswers: updatedCqAnswers,
        cqGraded: true,
        cqScore: cqPercentage,
        totalScore,
        gradedAt: new Date().toISOString(),
      })

      setSubmissions((current) => current.map((item) => item.id === submissionId
        ? { ...item, cqAnswers: updatedCqAnswers, cqGraded: true, cqScore: cqPercentage, totalScore }
        : item))
      setEditingGrades((current) => {
        const next = { ...current }
        delete next[submissionId]
        return next
      })
      toast({ title: "Success", description: "Grades saved successfully" })
    } catch (error) {
      console.error("Error saving grades:", error)
      toast({ variant: "error", title: "Error", description: error.message || "Failed to save grades" })
    } finally {
      setSavingGrades((current) => ({ ...current, [submissionId]: false }))
    }
  }

  let filteredSubmissions = selectedExam ? submissions.filter((item) => item.examId === selectedExam) : submissions
  if (markingFilter === "marked") filteredSubmissions = filteredSubmissions.filter((item) => item.cqGraded === true)
  if (markingFilter === "unmarked") filteredSubmissions = filteredSubmissions.filter((item) => !item.cqGraded)

  const getExamTitle = (examId) => exams.find((item) => item.id === examId)?.title || "Unknown Exam"
  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown"
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    if (Number.isNaN(date.getTime())) return "Unknown"
    return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" /></div>

  const baseForSelectedExam = selectedExam ? submissions.filter((item) => item.examId === selectedExam) : submissions

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">CQ Exam Submissions</h1>
        <p className="text-muted-foreground">Only submissions from your assigned course scope are visible and gradable.</p>
      </div>

      <div className="mb-6 space-y-4">
        <label className="block max-w-md">
          <span className="block text-sm font-medium mb-2">Filter by Exam</span>
          <select value={selectedExam} onChange={(event) => setSelectedExam(event.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-lg">
            <option value="">All allowed exams ({submissions.length} submissions)</option>
            {exams.filter((exam) => submissions.some((item) => item.examId === exam.id)).map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.title} ({submissions.filter((item) => item.examId === exam.id).length})</option>
            ))}
          </select>
        </label>

        <div>
          <span className="block text-sm font-medium mb-2">Filter by Marking Status</span>
          <div className="flex gap-2 flex-wrap">
            <FilterButton active={markingFilter === "all"} onClick={() => setMarkingFilter("all")} label={`All (${baseForSelectedExam.length})`} />
            <FilterButton active={markingFilter === "marked"} tone="green" onClick={() => setMarkingFilter("marked")} label={`Marked (${baseForSelectedExam.filter((item) => item.cqGraded).length})`} />
            <FilterButton active={markingFilter === "unmarked"} tone="orange" onClick={() => setMarkingFilter("unmarked")} label={`Unmarked (${baseForSelectedExam.filter((item) => !item.cqGraded).length})`} />
          </div>
        </div>
      </div>

      {filteredSubmissions.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg"><FileQuestion className="w-16 h-16 text-muted-foreground mx-auto mb-4" /><p className="text-muted-foreground">No CQ exam submissions found.</p></div>
      ) : (
        <div className="space-y-4">
          {filteredSubmissions.map((submission) => {
            const expanded = expandedSubmissions[submission.id]
            const user = users[submission.userId]
            return (
              <motion.div key={submission.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                    <div className="flex-1">
                      <h3 className="font-bold text-lg mb-1">{getExamTitle(submission.examId)}</h3>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5"><User className="w-4 h-4" />{user?.name || "Unknown User"}</span>
                        <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" />{formatDate(submission.submittedAt)}</span>
                        <span className="flex items-center gap-1.5"><Award className="w-4 h-4" />Score: {submission.score || 0}%</span>
                      </div>
                    </div>
                    <button onClick={() => toggleExpanded(submission.id)} className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg">
                      {expanded ? <><ChevronUp className="w-4 h-4" />Hide Answers</> : <><ChevronDown className="w-4 h-4" />View Answers ({submission.cqAnswers.length})</>}
                    </button>
                  </div>

                  {expanded && (
                    <div className="border-t border-border pt-4 mt-4 space-y-6">
                      {submission.cqGraded ? (
                        <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/30 rounded-lg"><span className="flex items-center gap-2 text-green-700 dark:text-green-400"><CheckCircle className="w-5 h-5" />Graded</span><span className="text-sm text-green-700 dark:text-green-400">CQ Score: {Number(submission.cqScore || 0).toFixed(1)}%</span></div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-700 dark:text-yellow-400"><Award className="w-5 h-5" /><span className="text-sm font-medium">Pending Grading — enter marks below.</span></div>
                      )}

                      {submission.cqAnswers.map((cqAnswer, index) => (
                        <div key={index} className="bg-accent/5 rounded-lg p-4 border border-border">
                          <div className="flex items-start gap-3 mb-3">
                            <span className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold text-sm">{index + 1}</span>
                            <div className="flex-1"><p className="font-medium mb-2">{cqAnswer.questionText}</p><div className="flex gap-3 text-sm text-muted-foreground"><span>Total Marks: {cqAnswer.marks}</span>{cqAnswer.obtainedMarks !== undefined && <span className="text-green-600">Obtained: {cqAnswer.obtainedMarks}</span>}</div></div>
                          </div>

                          {cqAnswer.textAnswer && <div className="ml-11 mb-4"><p className="text-sm font-medium mb-2">Written Answer:</p><div className="bg-background border border-border rounded-lg p-3 whitespace-pre-wrap">{cqAnswer.textAnswer}</div></div>}

                          {Array.isArray(cqAnswer.images) && cqAnswer.images.length > 0 && (
                            <div className="ml-11 mb-4"><p className="text-sm font-medium mb-3 flex items-center gap-2"><ImageIcon className="w-4 h-4" />Uploaded Answer Images ({cqAnswer.images.length})</p><div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">{cqAnswer.images.map((imageUrl, imageIndex) => <a key={imageIndex} href={imageUrl} target="_blank" rel="noopener noreferrer"><img src={imageUrl || "/placeholder.svg"} alt={`Answer ${imageIndex + 1}`} className="w-full h-48 object-cover rounded-lg border-2 border-border hover:border-primary" /></a>)}</div></div>
                          )}

                          <label className="ml-11 flex items-center gap-3 max-w-xs"><span className="text-sm font-medium whitespace-nowrap">Marks:</span><input type="number" min="0" max={cqAnswer.marks || 0} step="0.5" value={editingGrades[submission.id]?.[index] ?? cqAnswer.obtainedMarks ?? ""} onChange={(event) => handleGradeChange(submission.id, index, event.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg" /><span className="text-sm text-muted-foreground">/ {cqAnswer.marks}</span></label>
                        </div>
                      ))}

                      <div className="flex justify-end"><button onClick={() => saveGrades(submission.id)} disabled={savingGrades[submission.id]} className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"><Save className="w-4 h-4" />{savingGrades[submission.id] ? "Saving..." : "Save Grades"}</button></div>
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterButton({ active, onClick, label, tone = "primary" }) {
  const activeClass = tone === "green" ? "bg-green-600 text-white" : tone === "orange" ? "bg-orange-600 text-white" : "bg-primary text-primary-foreground"
  return <button onClick={onClick} className={`px-4 py-2 rounded-lg font-medium ${active ? activeClass : "bg-muted hover:bg-muted/80"}`}>{label}</button>
}
