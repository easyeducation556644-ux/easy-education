import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, CheckCircle2, XCircle, Eye, ImageIcon } from "lucide-react"
import { useExam } from "../contexts/ExamContext"
import { useAuth } from "../contexts/AuthContext"

export default function ExamSolutions() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { getExamById, getQuestionsByExam, getExamResult } = useExam()
  
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [userResult, setUserResult] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [examId, currentUser])

  const fetchData = async () => {
    if (!currentUser || !examId) return

    try {
      const examData = await getExamById(examId)
      setExam(examData)

      const questionsData = await getQuestionsByExam(examId)
      setQuestions(questionsData.filter(q => q.type === 'mcq'))

      const result = await getExamResult(currentUser.uid, examId)
      setUserResult(result)
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

  if (!exam || !userResult) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No solutions found</p>
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

  const userAnswers = userResult.answers || {}

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

        <div className="bg-card rounded-2xl p-6 mb-6 border-2 border-border">
          <h1 className="text-2xl font-bold mb-2">{exam.title}</h1>
          <p className="text-muted-foreground">Solutions & Correct Answers</p>
        </div>

        <div className="space-y-6">
          {questions.map((question, index) => {
            const userAnswer = userAnswers[question.id]
            const correctAnswer = question.correctAnswer
            const isCorrect = userAnswer === correctAnswer

            return (
              <div
                key={question.id}
                className={`bg-card rounded-xl p-6 border-2 ${
                  isCorrect 
                    ? 'border-green-200 dark:border-green-800' 
                    : 'border-red-200 dark:border-red-800'
                }`}
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isCorrect 
                      ? 'bg-green-100 dark:bg-green-900/30' 
                      : 'bg-red-100 dark:bg-red-900/30'
                  }`}>
                    {isCorrect ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-2">Question {index + 1}</h3>
                    <p className="text-foreground mb-3">{question.question}</p>
                    
                    {question.questionImageUrl && (
                      <img
                        src={question.questionImageUrl}
                        alt="Question"
                        className="w-full rounded-lg mb-4"
                      />
                    )}

                    <div className="space-y-2">
                      {question.options?.map((option, optIndex) => {
                        const isUserAnswer = userAnswer === optIndex
                        const isCorrectOption = correctAnswer === optIndex
                        
                        return (
                          <div
                            key={optIndex}
                            className={`p-3 rounded-lg border-2 ${
                              isCorrectOption 
                                ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' 
                                : isUserAnswer && !isCorrect
                                  ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                                  : 'border-border'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {isCorrectOption && (
                                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                              )}
                              {isUserAnswer && !isCorrect && (
                                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                              )}
                              <span className="flex-1">{option}</span>
                              {isCorrectOption && (
                                <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                                  Correct Answer
                                </span>
                              )}
                              {isUserAnswer && !isCorrect && (
                                <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                                  Your Answer
                                </span>
                              )}
                            </div>
                            {question.optionImages?.[optIndex] && (
                              <img
                                src={question.optionImages[optIndex]}
                                alt={`Option ${optIndex + 1}`}
                                className="mt-2 w-full rounded-lg"
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
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
