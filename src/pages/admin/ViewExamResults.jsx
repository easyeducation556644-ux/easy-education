import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  FileQuestion,
  User,
  Calendar,
  Trophy,
  TrendingUp,
  Download,
  Filter,
  Search,
} from "lucide-react"
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"

export default function ViewExamResults() {
  const [results, setResults] = useState([])
  const [exams, setExams] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedExam, setSelectedExam] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)

      const examsSnapshot = await getDocs(collection(db, "exams"))
      const examsData = examsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setExams(examsData)

      const resultsQuery = query(collection(db, "examResults"), orderBy("submittedAt", "desc"))
      const resultsSnapshot = await getDocs(resultsQuery)

      const resultsData = []
      const userIds = new Set()

      for (const resultDoc of resultsSnapshot.docs) {
        const result = { id: resultDoc.id, ...resultDoc.data() }
        resultsData.push(result)
        userIds.add(result.userId)
      }

      setResults(resultsData)

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
        description: "Failed to load exam results",
      })
    } finally {
      setLoading(false)
    }
  }

  const filteredResults = results.filter((result) => {
    const matchesExam = !selectedExam || result.examId === selectedExam
    const user = users[result.userId]
    const userName = user?.name || user?.displayName || user?.email || ""
    const matchesSearch = !searchQuery || userName.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesExam && matchesSearch
  })

  const exportToCSV = () => {
    const csvData = filteredResults.map((result) => {
      const exam = exams.find((e) => e.id === result.examId)
      const user = users[result.userId]
      return {
        User: user?.name || user?.displayName || user?.email || "Unknown",
        Email: user?.email || "",
        Exam: exam?.title || "Unknown Exam",
        ExamStatus: exam?.isArchived ? "Archived" : "Active",
        Score: result.totalScore || result.score || 0,
        MCQScore: result.mcqScore || 0,
        CQScore: result.cqScore || 0,
        Attempts: result.attemptNumber || 1,
        Date: result.submittedAt?.toDate?.()?.toLocaleDateString() || "",
      }
    })

    const headers = Object.keys(csvData[0] || {})
    const csvContent = [
      headers.join(","),
      ...csvData.map((row) => headers.map((header) => row[header]).join(",")),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "exam-results.csv"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)

    toast({
      title: "Success",
      description: "Exam results exported to CSV",
    })
  }

  const getExamStats = (examId) => {
    const examResults = results.filter((r) => r.examId === examId)
    if (examResults.length === 0) return null

    const scores = examResults.map((r) => r.totalScore || r.score || 0)
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
    const maxScore = Math.max(...scores)
    const minScore = Math.min(...scores)

    return {
      totalSubmissions: examResults.length,
      avgScore: avgScore.toFixed(1),
      maxScore,
      minScore,
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
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Exam Results</h1>
        <p className="text-muted-foreground">View all student exam scores and analytics</p>
      </div>

      <div className="bg-card rounded-xl p-6 mb-6 border-2 border-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
              <FileQuestion className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Exams</p>
              <p className="text-2xl font-bold">{exams.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
              <User className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Submissions</p>
              <p className="text-2xl font-bold">{results.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Score</p>
              <p className="text-2xl font-bold">
                {results.length > 0
                  ? (
                      results.reduce((sum, r) => sum + (r.totalScore || r.score || 0), 0) /
                      results.length
                    ).toFixed(1)
                  : 0}
                %
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-500/10 rounded-lg flex items-center justify-center">
              <Trophy className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unique Students</p>
              <p className="text-2xl font-bold">{Object.keys(users).length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl p-6 mb-6 border-2 border-border">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Filter by Exam</label>
            <select
              value={selectedExam}
              onChange={(e) => setSelectedExam(e.target.value)}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Exams</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Search Student</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={exportToCSV}
              disabled={filteredResults.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>

        {selectedExam && (
          <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            {(() => {
              const stats = getExamStats(selectedExam)
              const exam = exams.find((e) => e.id === selectedExam)
              return stats ? (
                <div>
                  <h3 className="font-semibold mb-2">{exam?.title} - Statistics</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Submissions</p>
                      <p className="font-bold">{stats.totalSubmissions}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Average Score</p>
                      <p className="font-bold">{stats.avgScore}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Highest Score</p>
                      <p className="font-bold text-green-600 dark:text-green-400">{stats.maxScore}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Lowest Score</p>
                      <p className="font-bold text-red-600 dark:text-red-400">{stats.minScore}%</p>
                    </div>
                  </div>
                </div>
              ) : null
            })()}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-3 text-sm font-semibold">Student</th>
                <th className="text-left p-3 text-sm font-semibold">Exam</th>
                <th className="text-center p-3 text-sm font-semibold">Total Score</th>
                <th className="text-center p-3 text-sm font-semibold">MCQ Score</th>
                <th className="text-center p-3 text-sm font-semibold">CQ Score</th>
                <th className="text-center p-3 text-sm font-semibold">Attempts</th>
                <th className="text-left p-3 text-sm font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center p-8 text-muted-foreground">
                    No exam results found
                  </td>
                </tr>
              ) : (
                filteredResults.map((result) => {
                  const exam = exams.find((e) => e.id === result.examId)
                  const user = users[result.userId]
                  const score = result.totalScore || result.score || 0
                  const passed = score >= (exam?.passingScore || 50)

                  return (
                    <tr key={result.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="p-3">
                        <div>
                          <p className="font-medium">{user?.name || user?.displayName || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
                        </div>
                      </td>
                      <td className="p-3">
                        <div>
                          <p className="font-medium">{exam?.title || "Unknown Exam"}</p>
                          {exam?.isArchived && (
                            <span className="inline-block mt-1 px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs rounded-full">
                              Archived
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${
                            passed
                              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                              : "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                          }`}
                        >
                          {passed && <Trophy className="w-3 h-3" />}
                          {score}%
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm">{result.mcqScore || 0}%</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm">{result.cqScore || 0}%</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm">{result.attemptNumber || 1}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="w-4 h-4" />
                          <span>
                            {result.submittedAt?.toDate?.()?.toLocaleDateString() || "N/A"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
