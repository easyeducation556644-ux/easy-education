import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Trophy, Award, RotateCcw, Eye, ArrowLeft, TrendingUp } from "lucide-react"
import { useExam } from "../contexts/ExamContext"
import { useAuth } from "../contexts/AuthContext"

export default function ExamResult() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { getExamById, getUserExamAttempts } = useExam()
  
  const [exam, setExam] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [bestScore, setBestScore] = useState(0)
  const [latestScore, setLatestScore] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [examId, currentUser])

  const fetchData = async () => {
    if (!currentUser || !examId) return

    try {
      const examData = await getExamById(examId)
      setExam(examData)

      const userAttempts = await getUserExamAttempts(currentUser.uid, examId)
      setAttempts(userAttempts)

      if (userAttempts.length > 0) {
        const scores = userAttempts.map(a => a.totalScore || a.score || 0)
        setBestScore(Math.max(...scores))
        setLatestScore(scores[scores.length - 1])
      }
    } catch (error) {
      console.error("Error fetching data:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!exam || attempts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No results found</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  const passed = latestScore >= (exam.passingScore || 50)

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => {
            if (exam?.courseId) {
              navigate(`/course/${exam.courseId}/exams`)
            } else {
              navigate(-1)
            }
          }}
          className="relative z-50 flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Exams
        </button>

        <div className={`rounded-2xl p-8 text-center mb-8 ${
          passed 
            ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-2 border-green-200 dark:border-green-800"
            : "bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/20 border-2 border-orange-200 dark:border-orange-800"
        }`}>
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-background shadow-lg mb-4">
            {passed ? (
              <Trophy className="w-10 h-10 text-green-600 dark:text-green-400" />
            ) : (
              <Award className="w-10 h-10 text-orange-600 dark:text-orange-400" />
            )}
          </div>

          <h1 className="text-3xl font-bold mb-2">
            {passed ? "Congratulations! 🎉" : "Exam Completed"}
          </h1>
          
          <p className="text-lg text-muted-foreground mb-6">
            {exam.title}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-xl p-4 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Latest Score</p>
              <p className="text-3xl font-bold">{latestScore}%</p>
            </div>
            
            <div className="bg-card rounded-xl p-4 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Best Score</p>
              <p className="text-3xl font-bold text-primary">{bestScore}%</p>
            </div>

            <div className="bg-card rounded-xl p-4 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Attempts</p>
              <p className="text-3xl font-bold">{attempts.length}</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Passing Score: {exam.passingScore || 50}%
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => navigate(`/exam/${examId}/leaderboard`)}
            className="flex items-center justify-center gap-3 p-6 bg-card border-2 border-border hover:border-primary/50 rounded-xl transition-all hover:shadow-lg group"
          >
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <h3 className="font-bold">Leaderboard</h3>
              <p className="text-sm text-muted-foreground">See top performers</p>
            </div>
          </button>

          <button
            onClick={() => navigate(`/exam/${examId}/solutions`)}
            className="flex items-center justify-center gap-3 p-6 bg-card border-2 border-border hover:border-primary/50 rounded-xl transition-all hover:shadow-lg group"
          >
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Eye className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <h3 className="font-bold">View Solutions</h3>
              <p className="text-sm text-muted-foreground">Check correct answers</p>
            </div>
          </button>

          <button
            onClick={() => navigate(`/exam/${examId}`)}
            className="flex items-center justify-center gap-3 p-6 bg-gradient-to-r from-primary to-primary/90 text-primary-foreground rounded-xl transition-all hover:shadow-lg group"
          >
            <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div className="text-left">
              <h3 className="font-bold">Retake Exam</h3>
              <p className="text-sm opacity-90">Try again to improve</p>
            </div>
          </button>

          <button
            onClick={() => navigate(`/exam/${examId}/attempts`)}
            className="flex items-center justify-center gap-3 p-6 bg-card border-2 border-border hover:border-primary/50 rounded-xl transition-all hover:shadow-lg group"
          >
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Award className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <h3 className="font-bold">My Attempts</h3>
              <p className="text-sm text-muted-foreground">View all attempts</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
