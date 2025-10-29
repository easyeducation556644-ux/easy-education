"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { Clock, Send, AlertCircle, ImageIcon, Upload, X, CheckCircle2 } from "lucide-react"
import { useAuth } from "../contexts/AuthContext"
import { useExam } from "../contexts/ExamContext"
import { toast } from "../hooks/use-toast"
import { uploadImageToImgBB } from "../lib/imgbb"
import ConfirmDialog from "../components/ConfirmDialog"
import { isFirebaseId } from "../lib/slug"
import { collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"

export default function ExamView() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { getExamById, getQuestionsByExam, submitExamResult, getExamResult } = useExam()

  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [cqImages, setCqImages] = useState({})
  const [uploadingImages, setUploadingImages] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [reviewMode, setReviewMode] = useState(false)
  const [userResult, setUserResult] = useState(null)
  const [actualExamId, setActualExamId] = useState(null)
  const [imagesPreloading, setImagesPreloading] = useState(false)
  const [imagesLoaded, setImagesLoaded] = useState(false)

  useEffect(() => {
    if (!currentUser) {
      navigate("/login")
      return
    }
    fetchExamData()
  }, [examId, currentUser])

  const fetchExamData = async () => {
    try {
      setLoading(true)

      let examData = null
      let resolvedExamId = examId
      
      if (isFirebaseId(examId)) {
        examData = await getExamById(examId)
      } else {
        const q = query(collection(db, "exams"), where("slug", "==", examId))
        const snapshot = await getDocs(q)
        if (!snapshot.empty) {
          const examDoc = snapshot.docs[0]
          resolvedExamId = examDoc.id
          examData = { id: examDoc.id, ...examDoc.data() }
        }
      }
      
      if (!examData) {
        toast({
          variant: "error",
          title: "Error",
          description: "Exam not found",
        })
        navigate(-1)
        return
      }

      setActualExamId(resolvedExamId)
      const questionsData = await getQuestionsByExam(resolvedExamId)
      console.log("[v0] Fetched questions for exam:", resolvedExamId, "Count:", questionsData.length)

      const existingResult = await getExamResult(currentUser.uid, resolvedExamId)

      if (questionsData.length === 0) {
        console.warn("[v0] No questions found for exam:", examId)
        toast({
          variant: "error",
          title: "No Questions",
          description: "This exam has no questions yet. Please contact your instructor.",
        })
        navigate(-1)
        return
      }

      setExam(examData)
      setQuestions(questionsData)
      if (!reviewMode) {
        setTimeLeft(examData.duration * 60)
      }
    } catch (error) {
      console.error("[v0] Error fetching exam:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load exam: " + error.message,
      })
      navigate(-1)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!hasStarted || timeLeft <= 0) return

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          handleSubmit()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [hasStarted, timeLeft])

  const preloadImages = async () => {
    if (!questions || questions.length === 0) {
      return Promise.resolve()
    }
    
    const imageUrls = []
    
    questions.forEach(question => {
      if (question.questionImageUrl) {
        imageUrls.push(question.questionImageUrl)
      }
      if (question.optionImages && Array.isArray(question.optionImages)) {
        question.optionImages.forEach(imgUrl => {
          if (imgUrl) imageUrls.push(imgUrl)
        })
      }
    })
    
    if (imageUrls.length === 0) {
      return Promise.resolve()
    }
    
    const loadImage = (url) => {
      return new Promise((resolve, reject) => {
        const img = new Image()
        const timeout = setTimeout(() => {
          reject(new Error(`Image load timeout: ${url}`))
        }, 30000)
        
        img.onload = () => {
          clearTimeout(timeout)
          resolve(url)
        }
        img.onerror = () => {
          clearTimeout(timeout)
          reject(new Error(`Failed to load image: ${url}`))
        }
        img.src = url
      })
    }
    
    const results = await Promise.allSettled(imageUrls.map(url => loadImage(url)))
    const failed = results.filter(r => r.status === 'rejected')
    
    if (failed.length > 0) {
      const failedUrls = failed.map(r => r.reason?.message || 'Unknown').join(', ')
      console.error(`${failed.length} image(s) failed to load:`, failedUrls)
      throw new Error(`Failed to load ${failed.length} image(s). Please check your connection.`)
    }
    
    return Promise.resolve()
  }

  const startExam = async () => {
    if (imagesPreloading || hasStarted) return
    
    setImagesPreloading(true)
    try {
      await preloadImages()
      setImagesLoaded(true)
      setHasStarted(true)
    } catch (error) {
      console.error("Error preloading images:", error)
      toast({
        variant: "error",
        title: "Image Loading Error",
        description: "Some images failed to load. Please check your connection and try again.",
      })
      setImagesPreloading(false)
    } finally {
      setImagesPreloading(false)
    }
  }

  const handleAnswerChange = (questionId, answer) => {
    setAnswers({
      ...answers,
      [questionId]: answer,
    })
  }

  const handleImageUpload = async (questionId, files) => {
    if (!files || files.length === 0) return

    setUploadingImages((prev) => ({ ...prev, [questionId]: true }))

    try {
      const uploadedUrls = []

      for (const file of Array.from(files)) {
        const url = await uploadImageToImgBB(file)
        uploadedUrls.push(url)
      }

      setCqImages((prev) => ({
        ...prev,
        [questionId]: [...(prev[questionId] || []), ...uploadedUrls],
      }))

      toast({
        title: "Success",
        description: `${uploadedUrls.length} image(s) uploaded successfully`,
      })
    } catch (error) {
      console.error("Error uploading images:", error)
      toast({
        variant: "error",
        title: "Upload Failed",
        description: error.message || "Failed to upload images",
      })
    } finally {
      setUploadingImages((prev) => ({ ...prev, [questionId]: false }))
    }
  }

  const removeImage = (questionId, imageIndex) => {
    setCqImages((prev) => ({
      ...prev,
      [questionId]: prev[questionId].filter((_, idx) => idx !== imageIndex),
    }))
  }

  const calculateScore = () => {
    let totalMarks = 0
    let earnedMarks = 0

    questions.forEach((question) => {
      totalMarks += question.marks || 1
      if (question.type === "mcq") {
        if (answers[question.id] === question.correctAnswer) {
          earnedMarks += question.marks || 1
        }
      }
    })

    return totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0
  }

  const handleSubmit = async () => {
    if (!hasStarted) return

    const answeredCount = Object.keys(answers).length
    const mcqCount = questions.filter((q) => q.type === "mcq").length

    if (answeredCount < mcqCount) {
      setConfirmDialog({
        isOpen: true,
        title: "Incomplete Answers",
        message: `You have only answered ${answeredCount} out of ${mcqCount} MCQ questions. Do you want to submit anyway?`,
        variant: "default",
        confirmText: "Submit Anyway",
        onConfirm: () => performSubmit(),
      })
      return
    }

    await performSubmit()
  }

  const performSubmit = async () => {
    setSubmitting(true)

    try {
      const score = calculateScore()
      if (!currentUser?.uid) {
        throw new Error("User not authenticated")
      }
      if (!actualExamId) {
        throw new Error("Exam ID is missing")
      }
      if (questions.length === 0) {
        throw new Error("No questions found in exam")
      }

      console.log("[v0] Starting exam submission...", {
        userId: currentUser.uid,
        examId: actualExamId,
        score,
        questionsCount: questions.length,
        answersCount: Object.keys(answers).length,
        cqImagesCount: Object.keys(cqImages).length,
      })

      await submitExamResult(currentUser.uid, actualExamId, answers, score, questions, cqImages)

      toast({
        title: "Exam Submitted!",
        description: `You scored ${score}%${score >= exam.passingScore ? " - Passed! 🎉" : ""}`,
      })

      setTimeout(() => navigate(`/exam/${actualExamId}/result`), 1500)
    } catch (error) {
      console.error("[v0] Error submitting exam:", error)
      toast({
        variant: "error",
        title: "Submission Failed",
        description: error.message || "Failed to submit exam. Please try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!exam) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <p className="text-lg">Exam not found</p>
        </div>
      </div>
    )
  }

  if (!hasStarted && !reviewMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-border rounded-lg p-8 max-w-2xl w-full"
        >
          <h1 className="text-3xl font-bold mb-4">{exam.title}</h1>
          {exam.description && <p className="text-muted-foreground mb-6">{exam.description}</p>}

          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-5 h-5" />
              <span>Duration: {exam.duration} minutes</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="w-5 h-5" />
              <span>Total Questions: {questions.length}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="w-5 h-5" />
              <span>Passing Score: {exam.passingScore}%</span>
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow-700 dark:text-yellow-400">
              <strong>Important:</strong> Once you start the exam, the timer will begin. You can only attempt this exam
              once.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate(-1)}
              className="flex-1 px-6 py-3 bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium"
              disabled={imagesPreloading}
            >
              Go Back
            </button>
            <button
              onClick={startExam}
              disabled={imagesPreloading}
              className="flex-1 px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {imagesPreloading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Loading Images...</span>
                </>
              ) : (
                "Start Exam"
              )}
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-2 sm:p-4 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border pb-4 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">{exam.title}</h1>
              {reviewMode && (
                <p className="text-sm text-muted-foreground mt-1">
                  Review Mode - Your Score: {userResult?.score || 0}%
                </p>
              )}
            </div>
            {!reviewMode && (
              <div
                className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                  timeLeft < 300 ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary"
                }`}
              >
                <Clock className="w-5 h-5" />
                <span className="font-mono font-bold text-lg">{formatTime(timeLeft)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {questions.map((question, index) => (
            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-card border border-border rounded-lg p-3 sm:p-6"
            >
              <div className="mb-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold shadow-lg">
                    {index + 1}
                  </span>
                  <div className="flex-1">
                    {question.questionText && <p className="text-base mb-2">{question.questionText}</p>}
                    <span className="text-sm text-muted-foreground">
                      ({question.marks} mark{question.marks !== 1 ? "s" : ""})
                    </span>
                  </div>
                </div>
                {question.questionImageUrl && (
                  <div className="w-full mb-3">
                    <img
                      src={question.questionImageUrl || "/placeholder.svg"}
                      alt="Question"
                      className="w-full rounded-lg"
                    />
                  </div>
                )}
              </div>

              {question.type === "mcq" ? (
                <div className="space-y-3 ml-11">
                  {question.options?.map((option, optIndex) => {
                    const isUserAnswer = answers[question.id] === optIndex
                    const isCorrectAnswer = question.correctAnswer === optIndex
                    const showCorrectness = reviewMode

                    let borderColor = "border-border"
                    let bgColor = ""

                    if (showCorrectness) {
                      if (isCorrectAnswer) {
                        borderColor = "border-green-500"
                        bgColor = "bg-green-500/10"
                      }
                      if (isUserAnswer && !isCorrectAnswer) {
                        borderColor = "border-red-500"
                        bgColor = "bg-red-500/10"
                      }
                    } else if (isUserAnswer) {
                      borderColor = "border-primary"
                      bgColor =
                        "bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 shadow-lg shadow-primary/20"
                    }

                    return (
                      (option || question.optionImages?.[optIndex]) && (
                        <motion.label
                          key={optIndex}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: optIndex * 0.05 }}
                          whileHover={!reviewMode ? { scale: 1.02, x: 4 } : {}}
                          whileTap={!reviewMode ? { scale: 0.98 } : {}}
                          className={`group relative flex items-start gap-4 p-5 rounded-2xl border-2 transition-all duration-300 overflow-hidden ${borderColor} ${bgColor} ${
                            reviewMode
                              ? "cursor-default"
                              : "cursor-pointer hover:border-primary/60 hover:bg-gradient-to-br hover:from-accent/10 hover:to-background hover:shadow-md"
                          }`}
                        >
                          {answers[question.id] === optIndex && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent"
                            />
                          )}
                          <div className="relative flex items-center justify-center z-10">
                            <input
                              type="radio"
                              name={`question-${question.id}`}
                              value={optIndex}
                              checked={answers[question.id] === optIndex}
                              onChange={() => !reviewMode && handleAnswerChange(question.id, optIndex)}
                              className="peer sr-only"
                              disabled={reviewMode}
                            />
                            <div
                              className={`relative w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                                showCorrectness && isCorrectAnswer
                                  ? "border-green-600 bg-green-600"
                                  : showCorrectness && isUserAnswer && !isCorrectAnswer
                                    ? "border-red-600 bg-red-600"
                                    : answers[question.id] === optIndex
                                      ? "border-primary bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/30"
                                      : "border-muted-foreground group-hover:border-primary/60 group-hover:bg-primary/5"
                              }`}
                            >
                              {(answers[question.id] === optIndex || (showCorrectness && isCorrectAnswer)) && (
                                <motion.div
                                  initial={{ scale: 0, rotate: -180 }}
                                  animate={{ scale: 1, rotate: 0 }}
                                  transition={{ type: "spring", stiffness: 200 }}
                                >
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                </motion.div>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 z-10">
                            {question.optionImages?.[optIndex] ? (
                              <div className="w-full">
                                <div className="flex items-center gap-3 mb-2">
                                  <span
                                    className={`font-bold text-sm px-3 py-1 rounded-lg shadow-lg transition-all duration-300 ${
                                      answers[question.id] === optIndex
                                        ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground shadow-sm"
                                        : "bg-gradient-to-br from-muted to-muted/80 text-muted-foreground group-hover:from-primary/20 group-hover:to-primary/10"
                                    }`}
                                  >
                                    {String.fromCharCode(65 + optIndex)}
                                  </span>
                                  {option && (
                                    <span
                                      className={`text-base font-medium transition-colors ${
                                        answers[question.id] === optIndex
                                          ? "text-foreground"
                                          : "text-muted-foreground group-hover:text-foreground"
                                      }`}
                                    >
                                      {option}
                                    </span>
                                  )}
                                </div>
                                <motion.img
                                  whileHover={{ scale: 1.02 }}
                                  src={question.optionImages[optIndex]}
                                  alt={`Option ${String.fromCharCode(65 + optIndex)}`}
                                  className={`w-full rounded-xl border-2 transition-all duration-300 ${
                                    answers[question.id] === optIndex
                                      ? "border-primary shadow-md"
                                      : "border-border group-hover:border-primary/40"
                                  }`}
                                />
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 mb-1">
                                <span
                                  className={`font-bold text-sm px-3 py-1 rounded-lg transition-all duration-300 ${
                                    answers[question.id] === optIndex
                                      ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground shadow-sm"
                                      : "bg-gradient-to-br from-muted to-muted/80 text-muted-foreground group-hover:from-primary/20 group-hover:to-primary/10"
                                  }`}
                                >
                                  {String.fromCharCode(65 + optIndex)}
                                </span>
                                {option && (
                                  <span
                                    className={`text-base font-medium transition-colors ${
                                      answers[question.id] === optIndex
                                        ? "text-foreground"
                                        : "text-muted-foreground group-hover:text-foreground"
                                    }`}
                                  >
                                    {option}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </motion.label>
                      )
                    )
                  })}
                </div>
              ) : (
                <div className="ml-11 space-y-4">
                  <textarea
                    value={answers[question.id] || ""}
                    onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                    className="w-full px-4 py-3 bg-input border-2 border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                    rows={5}
                    placeholder="লিখিত উত্তর লিখুন... / Write your answer here..."
                  />

                  <div className="border-2 border-dashed border-border rounded-xl p-4 bg-accent/5">
                    <div className="flex items-start gap-3 mb-3">
                      <Upload className="w-5 h-5 text-primary mt-1" />
                      <div className="flex-1">
                        <h4 className="font-medium mb-1">উত্তর পত্রের ছবি আপলোড করুন / Upload Answer Images</h4>
                        <p className="text-sm text-muted-foreground mb-3">
                          একাধিক ছবি নির্বাচন করতে পারবেন (প্রতিটি সর্বোচ্চ 32MB)
                        </p>
                        <label className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 cursor-pointer transition-colors">
                          <ImageIcon className="w-4 h-4" />
                          <span>ছবি নির্বাচন করুন / Choose Images</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(e) => handleImageUpload(question.id, e.target.files)}
                            className="hidden"
                            disabled={uploadingImages[question.id]}
                          />
                        </label>
                      </div>
                    </div>

                    {uploadingImages[question.id] && (
                      <div className="flex items-center gap-2 text-primary mb-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                        <span className="text-sm">আপলোড হচ্ছে... / Uploading...</span>
                      </div>
                    )}

                    {cqImages[question.id] && cqImages[question.id].length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                        {cqImages[question.id].map((imageUrl, idx) => (
                          <div key={idx} className="relative group">
                            <img
                              src={imageUrl || "/placeholder.svg"}
                              alt={`Answer ${idx + 1}`}
                              className="w-full h-32 object-cover rounded-lg border-2 border-border"
                            />
                            <button
                              onClick={() => removeImage(question.id, idx)}
                              className="absolute top-1 right-1 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                              type="button"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <div className="absolute bottom-1 left-1 px-2 py-0.5 bg-black/70 text-white text-xs rounded">
                              ছবি {idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {!reviewMode && (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border p-4 z-[100]">
            <div className="max-w-4xl mx-auto flex gap-3">
              <button
                onClick={() => {
                  setConfirmDialog({
                    isOpen: true,
                    title: "Exit Exam",
                    message: "Are you sure you want to exit? Your progress will be lost.",
                    variant: "danger",
                    confirmText: "Exit",
                    onConfirm: () => navigate(-1),
                  })
                }}
                className="px-6 py-3 bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium relative z-10"
                disabled={submitting}
              >
                Exit
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors font-medium disabled:opacity-50 relative z-10"
              >
                <Send className="w-5 h-5" />
                {submitting ? "Submitting..." : "Submit Exam"}
              </button>
            </div>
          </div>
        )}

        {reviewMode && (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border p-4 z-[100]">
            <div className="max-w-4xl mx-auto">
              <button
                onClick={() => navigate(-1)}
                className="w-full px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors font-medium relative z-10"
              >
                Back to Exams
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText || "Confirm"}
        cancelText={confirmDialog.cancelText || "Cancel"}
        variant={confirmDialog.variant || "default"}
      />
    </div>
  )
}
