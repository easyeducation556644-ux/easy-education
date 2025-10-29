import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Calendar, Trophy, TrendingUp, Award } from "lucide-react"
import { useExam } from "../contexts/ExamContext"
import { useAuth } from "../contexts/AuthContext"

export default function ExamAttempts() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { getExamById, getUserExamAttempts } = useExam()
  
  const [exam, setExam] = useState(null)
  const [attempts, setAttempts] = useState([])
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
          <p className="text-muted-foreground mb-4">No attempts found</p>
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

  const scores = attempts.map(a => a.totalScore || a.score || 0)
  const bestScore = Math.max(...scores)
  const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(`/exam/${examId}/result`)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Results
        </button>

        <div className="bg-gradient-to-br from-primary/10 via-secondary/5 to-primary/5 rounded-2xl p-6 mb-6 border-2 border-primary/20">
          <h1 className="text-2xl font-bold mb-2">{exam.title}</h1>
          <p className="text-muted-foreground mb-4">Your Exam Attempts</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-card rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Award className="w-4 h-4 text-primary" />
                <p className="text-sm text-muted-foreground">Total Attempts</p>
              </div>
              <p className="text-2xl font-bold">{attempts.length}</p>
            </div>
            
            <div className="bg-card rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-primary" />
                <p className="text-sm text-muted-foreground">Best Score</p>
              </div>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{bestScore}%</p>
            </div>

            <div className="bg-card rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <p className="text-sm text-muted-foreground">Average Score</p>
              </div>
              <p className="text-2xl font-bold">{averageScore.toFixed(1)}%</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {attempts.map((attempt, index) => {
            const score = attempt.totalScore || attempt.score || 0
            const passed = score >= (exam.passingScore || 50)
            const submittedDate = attempt.submittedAt?.toDate?.() || new Date()

            return (
              <div
                key={index}
                className={`bg-card rounded-xl p-6 border-2 ${
                  passed 
                    ? 'border-green-200 dark:border-green-800' 
                    : 'border-border'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-2">
                      Attempt {attempt.attemptNumber || (index + 1)} 
                      {index === attempts.length - 1 && (
                        <span className="ml-2 text-xs font-semibold px-2 py-1 bg-primary/10 text-primary rounded-full">
                          Latest
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>
                        {submittedDate.toLocaleDateString()} at {submittedDate.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground mb-1">Score</p>
                      <p className={`text-3xl font-bold ${
                        passed 
                          ? 'text-green-600 dark:text-green-400' 
                          : 'text-orange-600 dark:text-orange-400'
                      }`}>
                        {score}%
                      </p>
                    </div>
                    
                    {passed && (
                      <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                        <Trophy className="w-6 h-6 text-green-600 dark:text-green-400" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
