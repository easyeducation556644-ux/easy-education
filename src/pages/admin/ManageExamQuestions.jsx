import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, ArrowLeft, Image as ImageIcon, Type, CheckCircle, Upload, Download } from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { doc, getDoc } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { useExam } from "../../contexts/ExamContext"
import { toast } from "../../hooks/use-toast"
import { uploadImageToImgBB } from "../../lib/imgbb"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageExamQuestions() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [questionType, setQuestionType] = useState("mcq")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkQuestionType, setBulkQuestionType] = useState("mcq")
  const [questionTexts, setQuestionTexts] = useState("")
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  const [formData, setFormData] = useState({
    type: "mcq",
    questionText: "",
    questionImageUrl: "",
    options: ["", "", "", ""],
    optionImages: ["", "", "", ""],
    correctAnswer: 0,
    marks: 1,
    order: 0,
  })

  const { getExamById, getQuestionsByExam, addQuestion, updateQuestion, deleteQuestion } = useExam()

  useEffect(() => {
    fetchData()
  }, [examId])

  const fetchData = async () => {
    try {
      setLoading(true)
      const examData = await getExamById(examId)
      if (!examData) {
        toast({
          variant: "error",
          title: "Error",
          description: "Exam not found",
        })
        navigate("/admin/exams")
        return
      }

      if (examData.courseId) {
        const courseDoc = await getDoc(doc(db, "courses", examData.courseId))
        if (courseDoc.exists()) {
          examData.courseName = courseDoc.data().title
        }
      }

      setExam(examData)

      const questionsData = await getQuestionsByExam(examId)
      setQuestions(questionsData)
    } catch (error) {
      console.error("Error fetching data:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load exam data",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (file, field, index = null) => {
    if (!file) return

    setUploadingImage(true)
    try {
      const imageUrl = await uploadImageToImgBB(file)
      
      if (index !== null && field === "optionImages") {
        const newOptionImages = [...formData.optionImages]
        newOptionImages[index] = imageUrl
        setFormData({ ...formData, optionImages: newOptionImages })
      } else {
        setFormData({ ...formData, [field]: imageUrl })
      }

      toast({
        title: "Success",
        description: "Image uploaded successfully",
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to upload image",
      })
    } finally {
      setUploadingImage(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.questionText && !formData.questionImageUrl) {
      toast({
        variant: "error",
        title: "Missing Question",
        description: "Please provide a question text or image",
      })
      return
    }

    if (formData.type === "mcq") {
      const hasOptions = formData.options.some(opt => opt.trim()) || formData.optionImages.some(img => img.trim())
      if (!hasOptions) {
        toast({
          variant: "error",
          title: "Missing Options",
          description: "Please provide at least one option",
        })
        return
      }
    }

    try {
      const questionData = {
        examId,
        type: formData.type,
        questionText: formData.questionText,
        questionImageUrl: formData.questionImageUrl,
        marks: formData.marks,
        order: formData.order,
      }

      if (formData.type === "mcq") {
        questionData.options = formData.options
        questionData.optionImages = formData.optionImages
        questionData.correctAnswer = formData.correctAnswer
      }

      if (editingQuestion) {
        await updateQuestion(editingQuestion.id, questionData)
        toast({
          title: "Success",
          description: "Question updated successfully",
        })
      } else {
        await addQuestion(questionData)
        toast({
          title: "Success",
          description: "Question added successfully",
        })
      }

      setShowModal(false)
      setEditingQuestion(null)
      resetForm()
      fetchData()
    } catch (error) {
      console.error("Error saving question:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save question",
      })
    }
  }

  const resetForm = () => {
    const maxOrder = questions.length > 0 ? Math.max(...questions.map(q => q.order ?? 0)) : 0
    setFormData({
      type: "mcq",
      questionText: "",
      questionImageUrl: "",
      options: ["", "", "", ""],
      optionImages: ["", "", "", ""],
      correctAnswer: 0,
      marks: 1,
      order: maxOrder + 1,
    })
    setQuestionType("mcq")
  }

  const handleEdit = (question) => {
    setEditingQuestion(question)
    setQuestionType(question.type)
    setFormData({
      type: question.type,
      questionText: question.questionText || "",
      questionImageUrl: question.questionImageUrl || "",
      options: question.options || ["", "", "", ""],
      optionImages: question.optionImages || ["", "", "", ""],
      correctAnswer: question.correctAnswer || 0,
      marks: question.marks || 1,
      order: question.order ?? 0,
    })
    setShowModal(true)
  }

  const handleDelete = async (questionId) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Question",
      message: "Are you sure you want to delete this question? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteQuestion(questionId)
          toast({
            title: "Success",
            description: "Question deleted successfully",
          })
          fetchData()
        } catch (error) {
          console.error("Error deleting question:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete question",
          })
        }
      }
    })
  }

  const addOption = () => {
    setFormData({
      ...formData,
      options: [...formData.options, ""],
      optionImages: [...formData.optionImages, ""],
    })
  }

  const removeOption = (index) => {
    if (formData.options.length <= 2) {
      toast({
        variant: "error",
        title: "Cannot Remove",
        description: "Minimum 2 options required",
      })
      return
    }

    const newOptions = formData.options.filter((_, i) => i !== index)
    const newOptionImages = formData.optionImages.filter((_, i) => i !== index)
    setFormData({
      ...formData,
      options: newOptions,
      optionImages: newOptionImages,
      correctAnswer: formData.correctAnswer >= index ? Math.max(0, formData.correctAnswer - 1) : formData.correctAnswer,
    })
  }

  const handleBulkCreate = async () => {
    if (!questionTexts.trim()) {
      toast({
        variant: "error",
        title: "Question Texts Required",
        description: "Please enter at least one question",
      })
      return
    }

    setBulkProcessing(true)
    try {
      // Parse question texts - support both newline and numbered list
      const texts = questionTexts
        .split(/\n+/)
        .map(text => text.trim().replace(/^\d+[\.\)]\s*/, '')) // Remove numbering like "1. " or "1) "
        .filter(text => text.length > 0)

      if (texts.length === 0) {
        toast({
          variant: "error",
          title: "No Valid Questions",
          description: "Please enter valid question texts",
        })
        setBulkProcessing(false)
        return
      }

      let successCount = 0
      let errorCount = 0
      const errors = []

      for (const text of texts) {
        try {
          const questionData = {
            examId,
            type: bulkQuestionType,
            questionText: text,
            questionImageUrl: "",
            marks: 1,
          }

          if (bulkQuestionType === "mcq") {
            // Create default MCQ options with first option as correct
            questionData.options = ["Option A", "Option B", "Option C", "Option D"]
            questionData.optionImages = ["", "", "", ""]
            questionData.correctAnswer = 0
          }

          await addQuestion(questionData)
          successCount++
        } catch (err) {
          console.error(`Error adding question:`, err)
          errorCount++
          errors.push(text.substring(0, 30) + "...")
        }
      }

      toast({
        title: "Bulk Creation Complete",
        description: `Successfully added ${successCount} question(s). ${errorCount > 0 ? `Failed: ${errorCount}` : ""}`,
      })

      setShowBulkModal(false)
      setBulkQuestionType("mcq")
      setQuestionTexts("")
      fetchData()
    } catch (error) {
      console.error("Error in bulk creation:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to create questions",
      })
    } finally {
      setBulkProcessing(false)
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
    <div className="p-4 sm:p-6">
      <button
        onClick={() => navigate("/admin/exams")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Exams
      </button>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{exam?.title}</h1>
          <p className="text-muted-foreground mt-1">
            {exam?.courseName} • {questions.length} question{questions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Quick Add Multiple</span>
          </button>
          <button
            onClick={() => {
              setEditingQuestion(null)
              resetForm()
              setShowModal(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Add Question</span>
          </button>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Type className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No questions added yet</p>
          <button
            onClick={() => {
              resetForm()
              setShowModal(true)
            }}
            className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Add Your First Question
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((question, index) => (
            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-border rounded-lg p-6"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium bg-primary/10 text-primary px-2 py-1 rounded">
                      Q{index + 1}
                    </span>
                    <span className="text-sm font-medium bg-blue-500/10 text-blue-600 px-2 py-1 rounded">
                      {question.type === "mcq" ? "MCQ" : "CQ"}
                    </span>
                    <span className="text-sm text-muted-foreground">{question.marks} mark{question.marks !== 1 ? "s" : ""}</span>
                  </div>
                  
                  {question.questionText && (
                    <p className="text-base mb-2">{question.questionText}</p>
                  )}
                  
                  {question.questionImageUrl && (
                    <img
                      src={question.questionImageUrl}
                      alt="Question"
                      className="max-w-md rounded-lg mb-2"
                    />
                  )}

                  {question.type === "mcq" && (
                    <div className="mt-3 space-y-2">
                      {question.options?.map((option, optIndex) => (
                        (option || question.optionImages?.[optIndex]) && (
                          <div
                            key={optIndex}
                            className={`flex items-start gap-2 p-2 rounded ${
                              question.correctAnswer === optIndex
                                ? "bg-green-500/10 border border-green-500/30"
                                : "bg-muted/50"
                            }`}
                          >
                            {question.correctAnswer === optIndex && (
                              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                            )}
                            <div className="flex-1">
                              <span className="font-medium mr-2">
                                {String.fromCharCode(65 + optIndex)}.
                              </span>
                              {option && <span>{option}</span>}
                              {question.optionImages?.[optIndex] && (
                                <img
                                  src={question.optionImages[optIndex]}
                                  alt={`Option ${optIndex + 1}`}
                                  className="max-w-xs rounded mt-1"
                                />
                              )}
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(question)}
                    className="px-3 py-2 bg-blue-500/10 text-blue-600 rounded-lg hover:bg-blue-500/20 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(question.id)}
                    className="px-3 py-2 bg-red-500/10 text-red-600 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-4 sm:p-6 w-full max-w-2xl my-2 sm:my-8 max-h-[98vh] sm:max-h-auto overflow-y-auto"
          >
            <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">
              {editingQuestion ? "Edit Question" : "Add New Question"}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
              <div className="flex gap-2 sm:gap-4 mb-3 sm:mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setQuestionType("mcq")
                    setFormData({ ...formData, type: "mcq" })
                  }}
                  className={`flex-1 py-2 sm:py-3 rounded-lg border-2 transition-all ${
                    questionType === "mcq"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Type className="w-4 h-4 sm:w-5 sm:h-5 mx-auto mb-1" />
                  <span className="block font-medium text-sm sm:text-base">MCQ</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuestionType("cq")
                    setFormData({ ...formData, type: "cq" })
                  }}
                  className={`flex-1 py-2 sm:py-3 rounded-lg border-2 transition-all ${
                    questionType === "cq"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Type className="w-4 h-4 sm:w-5 sm:h-5 mx-auto mb-1" />
                  <span className="block font-medium text-sm sm:text-base">CQ</span>
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Question Text</label>
                <textarea
                  value={formData.questionText}
                  onChange={(e) => setFormData({ ...formData, questionText: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Enter your question here..."
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Or Upload Question Image
                </label>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e.target.files[0], "questionImageUrl")}
                    className="flex-1 px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={uploadingImage}
                  />
                  {formData.questionImageUrl && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, questionImageUrl: "" })}
                      className="px-3 py-2 bg-red-500/10 text-red-600 rounded-lg hover:bg-red-500/20"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {formData.questionImageUrl && (
                  <img
                    src={formData.questionImageUrl}
                    alt="Question preview"
                    className="mt-2 max-w-sm rounded-lg"
                  />
                )}
              </div>

              {questionType === "mcq" && (
                <>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium">Options</label>
                      <button
                        type="button"
                        onClick={addOption}
                        className="text-sm text-primary hover:underline"
                      >
                        + Add Option
                      </button>
                    </div>

                    <div className="space-y-3">
                      {formData.options.map((option, index) => (
                        <div key={index} className="border border-border rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="radio"
                              name="correctAnswer"
                              checked={formData.correctAnswer === index}
                              onChange={() => setFormData({ ...formData, correctAnswer: index })}
                              className="w-4 h-4"
                            />
                            <label className="text-sm font-medium">
                              Option {String.fromCharCode(65 + index)} (Correct?)
                            </label>
                            {index >= 2 && (
                              <button
                                type="button"
                                onClick={() => removeOption(index)}
                                className="ml-auto text-sm text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          <input
                            type="text"
                            value={option}
                            onChange={(e) => {
                              const newOptions = [...formData.options]
                              newOptions[index] = e.target.value
                              setFormData({ ...formData, options: newOptions })
                            }}
                            className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary mb-2"
                            placeholder="Option text..."
                          />

                          <div className="flex gap-2">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleImageUpload(e.target.files[0], "optionImages", index)}
                              className="flex-1 px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                              disabled={uploadingImage}
                            />
                            {formData.optionImages[index] && (
                              <button
                                type="button"
                                onClick={() => {
                                  const newOptionImages = [...formData.optionImages]
                                  newOptionImages[index] = ""
                                  setFormData({ ...formData, optionImages: newOptionImages })
                                }}
                                className="px-3 py-2 bg-red-500/10 text-red-600 rounded-lg hover:bg-red-500/20 text-sm"
                              >
                                Remove Image
                              </button>
                            )}
                          </div>

                          {formData.optionImages[index] && (
                            <img
                              src={formData.optionImages[index]}
                              alt={`Option ${index + 1}`}
                              className="mt-2 max-w-xs rounded-lg"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Marks</label>
                  <input
                    type="number"
                    value={formData.marks}
                    onChange={(e) => setFormData({ ...formData, marks: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Order</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Auto-calculated"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Display order (highest first)</p>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingQuestion(null)
                    resetForm()
                  }}
                  className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                  disabled={uploadingImage}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                  disabled={uploadingImage}
                >
                  {uploadingImage ? "Uploading..." : editingQuestion ? "Update" : "Add Question"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-2xl font-bold mb-4">Quick Add Multiple Questions</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Select question type and enter questions to add multiple at once.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Question Type *</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkQuestionType("mcq")}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 transition-all ${
                      bulkQuestionType === "mcq"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                    disabled={bulkProcessing}
                  >
                    <Type className="w-4 h-4 mx-auto mb-1" />
                    <span className="block font-medium text-sm">MCQ (Multiple Choice)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkQuestionType("cq")}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 transition-all ${
                      bulkQuestionType === "cq"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                    disabled={bulkProcessing}
                  >
                    <Type className="w-4 h-4 mx-auto mb-1" />
                    <span className="block font-medium text-sm">CQ (Creative)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Question Texts *</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Enter one question per line. Numbering is optional.
                </p>
                <textarea
                  value={questionTexts}
                  onChange={(e) => setQuestionTexts(e.target.value)}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={12}
                  placeholder={bulkQuestionType === "mcq" 
                    ? "What is 2+2?\nWhat is the capital of Bangladesh?\n1) Which planet is closest to the sun?\n2) What is photosynthesis?"
                    : "Explain the process of photosynthesis in detail.\nDescribe the causes of climate change.\n1. Write an essay on the importance of education."}
                  disabled={bulkProcessing}
                />
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>Note:</strong> {bulkQuestionType === "mcq" 
                    ? "MCQ questions will be created with default options (A, B, C, D) with option A as correct. You can edit each question later to set proper options and correct answers."
                    : "Creative questions will be created with 1 mark each. You can edit individual questions later to set specific marks."}
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  setShowBulkModal(false)
                  setBulkQuestionType("mcq")
                  setQuestionTexts("")
                }}
                className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                disabled={bulkProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkCreate}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                disabled={bulkProcessing}
              >
                {bulkProcessing ? "Creating..." : "Create Questions"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
      />
    </div>
  )
}
