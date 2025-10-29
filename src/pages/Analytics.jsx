"use client"

import { useState, useEffect, useMemo } from "react"
import { useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import {
  TrendingUp,
  Award,
  FileQuestion,
  CheckCircle,
  XCircle,
  Clock,
  BookOpen,
  ArrowLeft,
  AlertCircle,
  Filter,
} from "lucide-react"
import { doc, getDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts"

export default function Analytics() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { getUserExamResults } = useExam()
  const [examResults, setExamResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedResult, setSelectedResult] = useState(null)
  const [courseFilter, setCourseFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")

  useEffect(() => {
    if (!currentUser) {
      navigate("/login")
      return
    }
    fetchResults()
  }, [currentUser])

  const fetchResults = async () => {
    try {
      setLoading(true)
      const results = await getUserExamResults(currentUser.uid)

      const enrichedResults = await Promise.all(
        results.map(async (result) => {
          const examDoc = await getDoc(doc(db, "exams", result.examId))
          if (examDoc.exists()) {
            const examData = examDoc.data()
            const courseDoc = await getDoc(doc(db, "courses", examData.courseId))
            return {
              ...result,
              examTitle: examData.title,
              examDuration: examData.duration,
              passingScore: examData.passingScore,
              courseName: courseDoc.exists() ? courseDoc.data().title : "Unknown Course",
            }
          }
          return result
        }),
      )

      enrichedResults.sort((a, b) => {
        const aTime = a.submittedAt?.seconds || 0
        const bTime = b.submittedAt?.seconds || 0
        return bTime - aTime
      })

      setExamResults(enrichedResults)
    } catch (error) {
      console.error("Error fetching exam results:", error)
    } finally {
      setLoading(false)
    }
  }

  const uniqueCourses = useMemo(() => {
    const courses = new Set()
    examResults.forEach((result) => {
      if (result.courseName) courses.add(result.courseName)
    })
    return Array.from(courses)
  }, [examResults])

  const filteredResults = useMemo(() => {
    let filtered = [...examResults]

    if (courseFilter !== "all") {
      filtered = filtered.filter((result) => result.courseName === courseFilter)
    }

    if (dateFilter !== "all") {
      const now = new Date()
      filtered = filtered.filter((result) => {
        const examDate = result.submittedAt?.toDate?.() || new Date()
        const daysDiff = Math.floor((now - examDate) / (1000 * 60 * 60 * 24))

        switch (dateFilter) {
          case "week":
            return daysDiff <= 7
          case "month":
            return daysDiff <= 30
          case "3months":
            return daysDiff <= 90
          default:
            return true
        }
      })
    }

    return filtered
  }, [examResults, courseFilter, dateFilter])

  const stats = useMemo(() => {
    if (filteredResults.length === 0) {
      return { totalExams: 0, averageScore: 0, passedExams: 0, passRate: 0 }
    }

    const totalExams = filteredResults.length
    const totalScore = filteredResults.reduce((sum, result) => sum + (result.totalScore || result.score || 0), 0)
    const averageScore = totalScore / totalExams
    const passedExams = filteredResults.filter((result) => {
      const finalScore = result.totalScore || result.score || 0
      return finalScore >= (result.passingScore || 70)
    }).length
    const passRate = (passedExams / totalExams) * 100

    return {
      totalExams,
      averageScore: Math.round(averageScore),
      passedExams,
      passRate: Math.round(passRate),
    }
  }, [filteredResults])

  const chartData = useMemo(() => {
    return filteredResults
      .map((result) => ({
        date: result.submittedAt?.toDate?.().toLocaleDateString() || "N/A",
        score: result.score || 0,
        exam: result.examTitle?.substring(0, 20) || "Exam",
        timestamp: result.submittedAt?.seconds || 0,
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-10)
  }, [filteredResults])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-12">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">Exam Analytics</h1>
            <p className="text-muted-foreground">Track your exam performance and see areas for improvement</p>
          </div>
        </div>

        {examResults.length === 0 ? (
          <div className="text-center py-16 bg-muted/30 border border-border rounded-lg">
            <FileQuestion className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-6">You haven't taken any exams yet.</p>
            <Link
              to="/courses"
              className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors font-medium"
            >
              Browse Courses
            </Link>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div className="bg-card border border-border rounded-lg p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-5 h-5 text-foreground" />
                <h2 className="text-lg font-bold text-foreground">Filters</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Filter by Course</label>
                  <select
                    value={courseFilter}
                    onChange={(e) => setCourseFilter(e.target.value)}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                  >
                    <option value="all">All Courses</option>
                    {uniqueCourses.map((course) => (
                      <option key={course} value={course}>
                        {course}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Filter by Date</label>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                  >
                    <option value="all">All Time</option>
                    <option value="week">Last 7 Days</option>
                    <option value="month">Last 30 Days</option>
                    <option value="3months">Last 3 Months</option>
                  </select>
                </div>
              </div>
              {(courseFilter !== "all" || dateFilter !== "all") && (
                <button
                  onClick={() => {
                    setCourseFilter("all")
                    setDateFilter("all")
                  }}
                  className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                  Clear all filters
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0 }}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                    <FileQuestion className="w-6 h-6 text-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Total Exams</p>
                    <p className="text-3xl font-bold text-foreground">{stats.totalExams}</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Average Score</p>
                    <p className="text-3xl font-bold text-foreground">{stats.averageScore}%</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                    <Award className="w-6 h-6 text-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Passed Exams</p>
                    <p className="text-3xl font-bold text-foreground">{stats.passedExams}</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Pass Rate</p>
                    <p className="text-3xl font-bold text-foreground">{stats.passRate}%</p>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Performance Trends Chart */}
            {chartData.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-card border border-border rounded-lg p-6 mb-8"
              >
                <div className="flex items-center gap-2 mb-6">
                  <TrendingUp className="w-5 h-5 text-foreground" />
                  <h2 className="text-2xl font-bold text-foreground">Performance Trends</h2>
                  <span className="text-sm text-muted-foreground ml-auto">Last {chartData.length} exams</span>
                </div>
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          padding: "8px 12px",
                        }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorScore)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <h2 className="text-2xl font-bold text-foreground">Exam History</h2>
                {filteredResults.length === 0 ? (
                  <div className="text-center py-12 bg-muted/30 border border-border rounded-lg">
                    <FileQuestion className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No exams match the selected filters.</p>
                  </div>
                ) : (
                  filteredResults.map((result, index) => {
                    const passed = result.score >= (result.passingScore || 70)
                    const submittedDate = result.submittedAt?.toDate?.() || new Date()
                    const hasCQAnswers = result.cqAnswers && result.cqAnswers.length > 0
                    const cqPending = hasCQAnswers && !result.cqGraded

                    return (
                      <motion.div
                        key={result.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => setSelectedResult(result)}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex-1">
                            <h3 className="text-xl font-bold text-foreground mb-1">
                              {result.examTitle || "Untitled Exam"}
                            </h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                              <BookOpen className="w-4 h-4" />
                              <span>{result.courseName}</span>
                            </div>
                            {cqPending && (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-50 border border-yellow-200 rounded-full text-yellow-700 text-xs font-medium">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>CQ Grading Pending</span>
                              </div>
                            )}
                            {hasCQAnswers && result.cqGraded && (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-muted border border-border rounded-full text-foreground text-xs font-medium">
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>CQ Graded: {result.cqScore?.toFixed(1) || 0}%</span>
                              </div>
                            )}
                          </div>
                          <div
                            className={`px-4 py-2 rounded-lg ${
                              passed ? "bg-muted text-foreground" : "bg-muted text-foreground"
                            }`}
                          >
                            <div className="text-2xl font-bold">
                              {result.totalScore !== undefined ? result.totalScore.toFixed(1) : result.score}%
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {cqPending ? "MCQ Only" : passed ? "Passed" : "Failed"}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span>{result.examDuration || "N/A"} mins</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <CheckCircle className="w-4 h-4" />
                            <span>
                              {result.totalQuestions - (result.wrongAnswers?.length || 0)} / {result.totalQuestions}{" "}
                              correct
                            </span>
                          </div>
                          <div className="ml-auto">{submittedDate.toLocaleDateString()}</div>
                        </div>

                        {selectedResult?.id === result.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="mt-4 pt-4 border-t border-border space-y-4"
                          >
                            {result.wrongAnswers && result.wrongAnswers.length > 0 && (
                              <div>
                                <h4 className="font-semibold mb-3 flex items-center gap-2 text-foreground">
                                  <XCircle className="w-5 h-5 text-red-600" />
                                  Mistakes ({result.wrongAnswers.length})
                                </h4>
                                <div className="space-y-3">
                                  {result.wrongAnswers.map((mistake, idx) => (
                                    <div key={idx} className="bg-red-50 border border-red-200 rounded-lg p-3">
                                      <p className="font-medium text-foreground mb-2">{mistake.questionText}</p>
                                      <div className="space-y-1 text-sm">
                                        <div className="flex items-center gap-2">
                                          <XCircle className="w-4 h-4 text-red-600" />
                                          <span className="text-red-600">
                                            Your answer: {mistake.options?.[mistake.userAnswer] || "Not answered"}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <CheckCircle className="w-4 h-4 text-green-600" />
                                          <span className="text-green-600">
                                            Correct answer: {mistake.options?.[mistake.correctAnswer] || "N/A"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {result.cqAnswers && result.cqAnswers.length > 0 && result.cqGraded && (
                              <div>
                                <h4 className="font-semibold mb-3 flex items-center gap-2 text-foreground">
                                  <CheckCircle className="w-5 h-5 text-green-600" />
                                  Creative Questions ({result.cqAnswers.length})
                                </h4>
                                <div className="space-y-3">
                                  {result.cqAnswers.map((cq, idx) => (
                                    <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                      <div className="flex justify-between items-start mb-2">
                                        <p className="font-medium text-foreground flex-1">
                                          Q{idx + 1}. {cq.questionText}
                                        </p>
                                        <div className="text-sm font-bold text-green-600">
                                          {cq.obtainedMarks || 0} / {cq.marks}
                                        </div>
                                      </div>
                                      {cq.textAnswer && (
                                        <div className="text-sm text-muted-foreground mt-2 p-2 bg-background rounded border border-border">
                                          <strong>Your Answer:</strong> {cq.textAnswer}
                                        </div>
                                      )}
                                      {cq.images && cq.images.length > 0 && (
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                          {cq.images.map((img, imgIdx) => (
                                            <img
                                              key={imgIdx}
                                              src={img || "/placeholder.svg"}
                                              alt={`Answer ${imgIdx + 1}`}
                                              className="rounded border border-border w-full h-24 object-cover"
                                            />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </motion.div>
                    )
                  })
                )}
              </div>

              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-foreground">Quick Stats</h2>
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="font-semibold text-foreground mb-4">Performance Breakdown</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Passed</span>
                        <span className="font-medium text-foreground">{stats.passedExams}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${stats.passRate}%` }}
                        ></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Failed</span>
                        <span className="font-medium text-foreground">{stats.totalExams - stats.passedExams}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-muted-foreground h-2 rounded-full transition-all"
                          style={{ width: `${100 - stats.passRate}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="font-semibold text-foreground mb-2">Keep Going!</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    You're making great progress. Keep practicing to improve your scores!
                  </p>
                  <Link
                    to="/courses"
                    className="block w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-center font-medium"
                  >
                    Browse Courses
                  </Link>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
