import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { FileQuestion, Clock, Award, CheckCircle, Lock } from "lucide-react"
import { Link } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"

export default function ExamCard({ exam, classId }) {
  const { currentUser } = useAuth()
  const { getExamResult } = useExam()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (currentUser && exam?.id) {
      fetchResult()
    }
  }, [currentUser, exam])

  const fetchResult = async () => {
    try {
      const examResult = await getExamResult(currentUser.uid, exam.id)
      setResult(examResult)
    } catch (error) {
      console.error("Error fetching exam result:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-muted rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-muted rounded w-1/2"></div>
      </div>
    )
  }

  const hasAttempted = result !== null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-4 hover:shadow-lg transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
            <FileQuestion className="w-5 h-5 text-primary" />
            {exam.title}
          </h3>
          {exam.description && (
            <p className="text-sm text-muted-foreground mb-2">{exam.description}</p>
          )}
        </div>
        {hasAttempted && (
          <div className="ml-2 flex items-center gap-1 text-green-600 bg-green-500/10 px-2 py-1 rounded text-sm">
            <CheckCircle className="w-4 h-4" />
            <span>Completed</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
        <div className="flex items-center gap-1">
          <Clock className="w-4 h-4" />
          <span>{exam.duration} mins</span>
        </div>
        <div className="flex items-center gap-1">
          <Award className="w-4 h-4" />
          <span>Pass: {exam.passingScore}%</span>
        </div>
      </div>

      {hasAttempted ? (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Your Score:</span>
            <span className={`text-xl font-bold ${
              result.score >= exam.passingScore ? "text-green-600" : "text-red-600"
            }`}>
              {result.score}%
            </span>
          </div>
          {result.score >= exam.passingScore ? (
            <p className="text-sm text-green-600 mt-1">🎉 Passed!</p>
          ) : (
            <p className="text-sm text-red-600 mt-1">Keep practicing!</p>
          )}
        </div>
      ) : (
        <Link
          to={`/exam/${exam.id}`}
          className="block w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-center font-medium"
        >
          Start Exam
        </Link>
      )}
    </motion.div>
  )
}
