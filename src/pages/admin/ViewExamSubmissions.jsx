"use client"

import { useState, useEffect } from "react"
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
  Edit2,
} from "lucide-react"
import { collection, getDocs, query, orderBy, doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"

export default function ViewExamSubmissions() {
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
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)

      // Fetch all exams
      const examsSnapshot = await getDocs(collection(db, "exams"))
      const examsData = examsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setExams(examsData)

      // Fetch all submissions
      const submissionsQuery = query(collection(db, "examResults"), orderBy("submittedAt", "desc"))
      const submissionsSnapshot = await getDocs(submissionsQuery)

      const submissionsData = []
      const userIds = new Set()

      for (const submissionDoc of submissionsSnapshot.docs) {
        const submission = { id: submissionDoc.id, ...submissionDoc.data() }

        // Only include submissions with CQ answers
        if (submission.cqAnswers && submission.cqAnswers.length > 0) {
          submissionsData.push(submission)
          userIds.add(submission.userId)
        }
      }

      setSubmissions(submissionsData)

      // Fetch user data
      const usersData = {}
      for (const userId of userIds) {
        const userDoc = await getDoc(doc(db, "users", userId))
        if (userDoc.exists()) {
          usersData[userId] = userDoc.data()
        }
      }
      setUsers(usersData)
    } catch (error) {
      console.error("Error fetching data:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load submissions",
      })
    } finally {
      setLoading(false)
    }
  }

  const toggleExpanded = (submissionId) => {
    setExpandedSubmissions((prev) => ({
      ...prev,
      [submissionId]: !prev[submissionId],
    }))
  }

  const handleGradeChange = (submissionId, questionIndex, value) => {
    setEditingGrades((prev) => ({
      ...prev,
      [submissionId]: {
        ...prev[submissionId],
        [questionIndex]: value,
      },
    }))
  }

  const saveGrades = async (submissionId) => {
    const submission = submissions.find((s) => s.id === submissionId)
    if (!submission) return

    setSavingGrades((prev) => ({ ...prev, [submissionId]: true }))

    try {
      const updatedCqAnswers = submission.cqAnswers.map((cqAnswer, index) => ({
        ...cqAnswer,
        obtainedMarks:
          editingGrades[submissionId]?.[index] !== undefined
            ? Number.parseFloat(editingGrades[submissionId][index]) || 0
            : cqAnswer.obtainedMarks || 0,
      }))

      // Calculate total CQ marks
      const totalCqMarks = updatedCqAnswers.reduce((sum, cq) => sum + (cq.marks || 0), 0)
      const obtainedCqMarks = updatedCqAnswers.reduce((sum, cq) => sum + (cq.obtainedMarks || 0), 0)

      const mcqScore = submission.score || 0
      const cqPercentage = totalCqMarks > 0 ? (obtainedCqMarks / totalCqMarks) * 100 : 0
      const totalScore = (mcqScore + cqPercentage) / 2

      // Update submission with graded CQ answers and new total score
      await updateDoc(doc(db, "examResults", submissionId), {
        cqAnswers: updatedCqAnswers,
        cqGraded: true,
        cqScore: cqPercentage,
        totalScore: totalScore,
        gradedAt: new Date().toISOString(),
      })

      // Update local state
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? { ...s, cqAnswers: updatedCqAnswers, cqGraded: true, cqScore: cqPercentage, totalScore: totalScore }
            : s,
        ),
      )

      // Clear editing state for this submission
      setEditingGrades((prev) => {
        const newState = { ...prev }
        delete newState[submissionId]
        return newState
      })

      toast({
        title: "Success",
        description: "Grades saved successfully",
      })
    } catch (error) {
      console.error("Error saving grades:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save grades",
      })
    } finally {
      setSavingGrades((prev) => ({ ...prev, [submissionId]: false }))
    }
  }

  let filteredSubmissions = selectedExam ? submissions.filter((s) => s.examId === selectedExam) : submissions
  
  if (markingFilter === "marked") {
    filteredSubmissions = filteredSubmissions.filter((s) => s.cqGraded === true)
  } else if (markingFilter === "unmarked") {
    filteredSubmissions = filteredSubmissions.filter((s) => !s.cqGraded)
  }

  const getExamTitle = (examId) => {
    const exam = exams.find((e) => e.id === examId)
    return exam?.title || "Unknown Exam"
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown"
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
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
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">CQ Exam Submissions</h1>
        <p className="text-muted-foreground">View and review creative question exam submissions</p>
      </div>

      <div className="mb-6 space-y-4">
        <div className="flex-1 max-w-md">
          <label className="block text-sm font-medium mb-2">Filter by Exam</label>
          <select
            value={selectedExam}
            onChange={(e) => setSelectedExam(e.target.value)}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Exams ({submissions.length} submissions)</option>
            {exams
              .filter((exam) => submissions.some((s) => s.examId === exam.id))
              .map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title} ({submissions.filter((s) => s.examId === exam.id).length})
                </option>
              ))}
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-2">Filter by Marking Status</label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setMarkingFilter("all")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                markingFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              All ({(selectedExam ? submissions.filter((s) => s.examId === selectedExam) : submissions).length})
            </button>
            <button
              onClick={() => setMarkingFilter("marked")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                markingFilter === "marked"
                  ? "bg-green-600 text-white"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              Marked ({(selectedExam ? submissions.filter((s) => s.examId === selectedExam && s.cqGraded === true) : submissions.filter((s) => s.cqGraded === true)).length})
            </button>
            <button
              onClick={() => setMarkingFilter("unmarked")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                markingFilter === "unmarked"
                  ? "bg-orange-600 text-white"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              Unmarked ({(selectedExam ? submissions.filter((s) => s.examId === selectedExam && !s.cqGraded) : submissions.filter((s) => !s.cqGraded)).length})
            </button>
          </div>
        </div>
      </div>

      {filteredSubmissions.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <FileQuestion className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No CQ exam submissions yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSubmissions.map((submission) => {
            const isExpanded = expandedSubmissions[submission.id]
            const user = users[submission.userId]

            return (
              <motion.div
                key={submission.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border border-border rounded-lg overflow-hidden"
              >
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                    <div className="flex-1">
                      <h3 className="font-bold text-lg mb-1">{getExamTitle(submission.examId)}</h3>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <User className="w-4 h-4" />
                          <span>{user?.name || "Unknown User"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" />
                          <span>{formatDate(submission.submittedAt)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Award className="w-4 h-4" />
                          <span className="font-medium">Score: {submission.score}%</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleExpanded(submission.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-4 h-4" />
                          <span>Hide Answers</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          <span>View Answers ({submission.cqAnswers.length})</span>
                        </>
                      )}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border pt-4 mt-4 space-y-6">
                      {submission.cqGraded && (
                        <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <span className="font-medium text-green-700 dark:text-green-400">Graded</span>
                          </div>
                          <div className="text-sm text-green-700 dark:text-green-400">
                            CQ Score: {submission.cqScore?.toFixed(1) || 0}%
                          </div>
                        </div>
                      )}

                      {!submission.cqGraded && (
                        <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                          <Award className="w-5 h-5 text-yellow-600" />
                          <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                            অপেক্ষমাণ / Pending Grading - Enter marks below
                          </span>
                        </div>
                      )}

                      {submission.cqAnswers.map((cqAnswer, index) => (
                        <div key={index} className="bg-accent/5 rounded-lg p-4 border border-border">
                          <div className="flex items-start gap-3 mb-3">
                            <span className="flex-shrink-0 w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold text-sm">
                              {index + 1}
                            </span>
                            <div className="flex-1">
                              <p className="font-medium mb-2">{cqAnswer.questionText}</p>
                              <div className="flex items-center gap-3 text-sm">
                                <span className="text-muted-foreground">Total Marks: {cqAnswer.marks}</span>
                                {cqAnswer.obtainedMarks !== undefined && (
                                  <span className="text-green-600 font-medium">Obtained: {cqAnswer.obtainedMarks}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {cqAnswer.textAnswer && (
                            <div className="ml-11 mb-4">
                              <label className="block text-sm font-medium mb-2">Written Answer:</label>
                              <div className="bg-background border border-border rounded-lg p-3 whitespace-pre-wrap">
                                {cqAnswer.textAnswer}
                              </div>
                            </div>
                          )}

                          {cqAnswer.images && cqAnswer.images.length > 0 && (
                            <div className="ml-11 mb-4">
                              <label className="block text-sm font-medium mb-3 flex items-center gap-2">
                                <ImageIcon className="w-4 h-4" />
                                Uploaded Answer Images ({cqAnswer.images.length})
                              </label>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {cqAnswer.images.map((imageUrl, imgIdx) => (
                                  <a
                                    key={imgIdx}
                                    href={imageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group relative block"
                                  >
                                    <img
                                      src={imageUrl || "/placeholder.svg"}
                                      alt={`Answer image ${imgIdx + 1}`}
                                      className="w-full h-48 object-cover rounded-lg border-2 border-border group-hover:border-primary transition-all"
                                    />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                                      <span className="text-white text-sm font-medium">Click to view full size</span>
                                    </div>
                                    <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 text-white text-xs rounded">
                                      Image {imgIdx + 1}
                                    </div>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="ml-11 mt-4">
                            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                              <Edit2 className="w-4 h-4" />
                              নম্বর দিন / Give Marks
                            </label>
                            <div className="flex items-center gap-3">
                              <input
                                type="number"
                                min="0"
                                max={cqAnswer.marks}
                                step="0.5"
                                value={editingGrades[submission.id]?.[index] ?? cqAnswer.obtainedMarks ?? ""}
                                onChange={(e) => handleGradeChange(submission.id, index, e.target.value)}
                                className="w-32 px-3 py-2 bg-input border-2 border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                                placeholder="0"
                              />
                              <span className="text-sm text-muted-foreground">/ {cqAnswer.marks}</span>
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="flex justify-end gap-3 pt-4 border-t border-border">
                        <button
                          onClick={() => saveGrades(submission.id)}
                          disabled={savingGrades[submission.id]}
                          className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 font-medium"
                        >
                          <Save className="w-4 h-4" />
                          {savingGrades[submission.id] ? "সংরক্ষণ করা হচ্ছে... / Saving..." : "সংরক্ষণ করুন / Save Grades"}
                        </button>
                      </div>
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
