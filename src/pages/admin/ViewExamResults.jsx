import { useEffect, useState } from "react"
import { FileQuestion, User, Calendar, Trophy, TrendingUp, Download, Search } from "lucide-react"
import { collection, getDocs, query, orderBy, doc, getDoc } from "../../lib/cacheV2Firestore"
import { db } from "../../lib/firebase"
import { toast } from "../../hooks/use-toast"
import { useAuth } from "../../contexts/AuthContext"
import { ADMIN_PERMISSION_KEYS, getAllowedCourseIds } from "../../lib/adminPermissions"

export default function ViewExamResults() {
  const { userProfile } = useAuth()
  const [results, setResults] = useState([])
  const [exams, setExams] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedExam, setSelectedExam] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => { fetchData() }, [userProfile])

  const fetchData = async () => {
    setLoading(true)
    try {
      const allowedCourseIds = getAllowedCourseIds(userProfile, ADMIN_PERMISSION_KEYS.EXAM_RESULTS)
      const allowed = allowedCourseIds === null ? null : new Set(allowedCourseIds)
      const examsSnapshot = await getDocs(collection(db, "exams"))
      const examsData = examsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((exam) => allowed === null || allowed.has(exam.courseId))
      setExams(examsData)
      const allowedExamIds = new Set(examsData.map((exam) => exam.id))

      const resultsSnapshot = await getDocs(query(collection(db, "examResults"), orderBy("submittedAt", "desc")))
      const resultsData = resultsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((result) => allowedExamIds.has(result.examId))
      setResults(resultsData)

      const usersData = {}
      for (const userId of [...new Set(resultsData.map((result) => result.userId).filter(Boolean))]) {
        const userDoc = await getDoc(doc(db, "users", userId))
        if (userDoc.exists()) usersData[userId] = userDoc.data()
      }
      setUsers(usersData)
    } catch (error) {
      console.error("Error fetching exam results:", error)
      toast({ variant: "error", title: "Error", description: "Failed to load exam results" })
    } finally {
      setLoading(false)
    }
  }

  const filteredResults = results.filter((result) => {
    const matchesExam = !selectedExam || result.examId === selectedExam
    const user = users[result.userId]
    const name = user?.name || user?.displayName || user?.email || ""
    return matchesExam && (!searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase()))
  })

  const exportToCSV = () => {
    const csvData = filteredResults.map((result) => {
      const exam = exams.find((item) => item.id === result.examId)
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
        Date: result.submittedAt?.toDate?.()?.toLocaleString() || "",
      }
    })
    const headers = Object.keys(csvData[0] || {})
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`
    const csv = [headers.join(","), ...csvData.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "exam-results.csv"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    toast({ title: "Success", description: "Exam results exported to CSV" })
  }

  const getExamStats = (examId) => {
    const values = results.filter((result) => result.examId === examId)
    if (values.length === 0) return null
    const scores = values.map((result) => result.totalScore || result.score || 0)
    return {
      totalSubmissions: values.length,
      avgScore: (scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1),
      maxScore: Math.max(...scores),
      minScore: Math.min(...scores),
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" /></div>

  const average = results.length > 0 ? (results.reduce((sum, result) => sum + (result.totalScore || result.score || 0), 0) / results.length).toFixed(1) : 0

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-8"><h1 className="text-3xl font-bold mb-2">Exam Results</h1><p className="text-muted-foreground">Results are limited to your assigned course scope.</p></div>

      <div className="bg-card rounded-xl p-6 mb-6 border-2 border-border grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={FileQuestion} label="Total Exams" value={exams.length} />
        <Stat icon={User} label="Total Submissions" value={results.length} />
        <Stat icon={TrendingUp} label="Avg Score" value={`${average}%`} />
        <Stat icon={Trophy} label="Unique Students" value={Object.keys(users).length} />
      </div>

      <div className="bg-card rounded-xl p-6 mb-6 border-2 border-border">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <label className="flex-1"><span className="block text-sm font-medium mb-2">Filter by Exam</span><select value={selectedExam} onChange={(event) => setSelectedExam(event.target.value)} className="w-full px-4 py-2 bg-background border border-border rounded-lg"><option value="">All allowed exams</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label>
          <label className="flex-1"><span className="block text-sm font-medium mb-2">Search Student</span><span className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by name or email..." className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg" /></span></label>
          <div className="flex items-end"><button onClick={exportToCSV} disabled={filteredResults.length === 0} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"><Download className="w-4 h-4" />Export CSV</button></div>
        </div>

        {selectedExam && (() => {
          const stats = getExamStats(selectedExam)
          const exam = exams.find((item) => item.id === selectedExam)
          return stats ? <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg"><h3 className="font-semibold mb-2">{exam?.title} - Statistics</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"><Mini label="Submissions" value={stats.totalSubmissions} /><Mini label="Average" value={`${stats.avgScore}%`} /><Mini label="Highest" value={`${stats.maxScore}%`} /><Mini label="Lowest" value={`${stats.minScore}%`} /></div></div> : null
        })()}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px]">
            <thead><tr className="border-b border-border"><th className="text-left p-3 text-sm">Student</th><th className="text-left p-3 text-sm">Exam</th><th className="text-center p-3 text-sm">Total</th><th className="text-center p-3 text-sm">MCQ</th><th className="text-center p-3 text-sm">CQ</th><th className="text-center p-3 text-sm">Attempts</th><th className="text-left p-3 text-sm">Date</th></tr></thead>
            <tbody>
              {filteredResults.length === 0 ? <tr><td colSpan={7} className="text-center p-8 text-muted-foreground">No exam results found</td></tr> : filteredResults.map((result) => {
                const exam = exams.find((item) => item.id === result.examId)
                const user = users[result.userId]
                const score = result.totalScore || result.score || 0
                const passed = score >= (exam?.passingScore || 50)
                return <tr key={result.id} className="border-b border-border hover:bg-muted/50"><td className="p-3"><p className="font-medium">{user?.name || user?.displayName || "Unknown"}</p><p className="text-xs text-muted-foreground">{user?.email || ""}</p></td><td className="p-3"><p className="font-medium">{exam?.title || "Unknown Exam"}</p>{exam?.isArchived && <span className="text-xs text-orange-500">Archived</span>}</td><td className="p-3 text-center"><span className={`px-3 py-1 rounded-full text-sm font-bold ${passed ? "bg-green-500/10 text-green-600" : "bg-orange-500/10 text-orange-600"}`}>{score}%</span></td><td className="p-3 text-center text-sm">{result.mcqScore || 0}%</td><td className="p-3 text-center text-sm">{result.cqScore || 0}%</td><td className="p-3 text-center text-sm">{result.attemptNumber || 1}</td><td className="p-3"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="w-4 h-4" />{result.submittedAt?.toDate?.()?.toLocaleDateString() || "N/A"}</span></td></tr>
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return <div className="flex items-center gap-3"><div className="w-11 h-11 bg-primary/10 rounded-lg flex items-center justify-center"><Icon className="w-5 h-5 text-primary" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></div>
}

function Mini({ label, value }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="font-bold">{value}</p></div>
}
