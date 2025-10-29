"use client"

import { createContext, useContext, useState } from "react"
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore"
import { db } from "../lib/firebase"

const ExamContext = createContext({})

export const useExam = () => {
  const context = useContext(ExamContext)
  if (!context) {
    throw new Error("useExam must be used within ExamProvider")
  }
  return context
}

export function ExamProvider({ children }) {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(false)

  const createExam = async (examData) => {
    try {
      const docRef = await addDoc(collection(db, "exams"), {
        ...examData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      return docRef.id
    } catch (error) {
      console.error("Error creating exam:", error)
      throw error
    }
  }

  const getExamsByClass = async (classId) => {
    try {
      const q = query(collection(db, "exams"), where("classId", "==", classId))
      const snapshot = await getDocs(q)
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    } catch (error) {
      console.error("Error fetching exams:", error)
      return []
    }
  }

  const getExamsByCourse = async (courseId, includeArchived = true) => {
    try {
      const q = query(collection(db, "exams"), where("courseId", "==", courseId))
      const snapshot = await getDocs(q)
      const allExams = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

      if (!includeArchived) {
        return allExams.filter((exam) => !exam.isArchived)
      }

      return allExams
    } catch (error) {
      console.error("Error fetching exams:", error)
      return []
    }
  }

  const getActiveExamsByCourse = async (courseId) => {
    try {
      const q = query(collection(db, "exams"), where("courseId", "==", courseId))
      const snapshot = await getDocs(q)
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((exam) => !exam.isArchived)
    } catch (error) {
      console.error("Error fetching active exams:", error)
      return []
    }
  }

  const getArchivedExamsByCourse = async (courseId) => {
    try {
      const q = query(collection(db, "exams"), where("courseId", "==", courseId))
      const snapshot = await getDocs(q)
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((exam) => exam.isArchived === true)
    } catch (error) {
      console.error("Error fetching archived exams:", error)
      return []
    }
  }

  const getExamById = async (examId) => {
    try {
      const docRef = doc(db, "exams", examId)
      const docSnap = await getDoc(docRef)
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() }
      }
      return null
    } catch (error) {
      console.error("Error fetching exam:", error)
      return null
    }
  }

  const updateExam = async (examId, examData) => {
    try {
      const docRef = doc(db, "exams", examId)
      await updateDoc(docRef, {
        ...examData,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error("Error updating exam:", error)
      throw error
    }
  }

  const deleteExam = async (examId) => {
    try {
      await deleteDoc(doc(db, "exams", examId))
      const questionsQ = query(collection(db, "examQuestions"), where("examId", "==", examId))
      const questionsSnapshot = await getDocs(questionsQ)
      const deletePromises = questionsSnapshot.docs.map((doc) => deleteDoc(doc.ref))
      await Promise.all(deletePromises)
    } catch (error) {
      console.error("Error deleting exam:", error)
      throw error
    }
  }

  const addQuestion = async (questionData) => {
    try {
      const docRef = await addDoc(collection(db, "examQuestions"), {
        ...questionData,
        createdAt: serverTimestamp(),
      })
      return docRef.id
    } catch (error) {
      console.error("Error adding question:", error)
      throw error
    }
  }

  const getQuestionsByExam = async (examId) => {
    try {
      console.log(" Fetching questions for exam:", examId)
      const q = query(collection(db, "examQuestions"), where("examId", "==", examId))
      const snapshot = await getDocs(q)
      const questions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      // Sort by order (descending), fallback to createdAt if order doesn't exist or is 0
      questions.sort((a, b) => {
        const orderA = a.order || null
        const orderB = b.order || null
        // If both have order, sort by order
        if (orderA !== null && orderB !== null) {
          return orderB - orderA
        }
        // If only one has order, it comes first
        if (orderA !== null) return -1
        if (orderB !== null) return 1
        // If neither has order, sort by createdAt descending
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      })
      console.log(" Found", questions.length, "questions for exam", examId)
      return questions
    } catch (error) {
      console.error(" Error fetching questions:", error)
      return []
    }
  }

  const updateQuestion = async (questionId, questionData) => {
    try {
      const docRef = doc(db, "examQuestions", questionId)
      await updateDoc(docRef, questionData)
    } catch (error) {
      console.error("Error updating question:", error)
      throw error
    }
  }

  const deleteQuestion = async (questionId) => {
    try {
      await deleteDoc(doc(db, "examQuestions", questionId))
    } catch (error) {
      console.error("Error deleting question:", error)
      throw error
    }
  }

  const submitExamResult = async (userId, examId, answers, score, questions, cqImages = {}) => {
    try {
      if (!userId || !examId) {
        throw new Error("User ID and Exam ID are required")
      }

      const previousAttempts = await getUserExamAttempts(userId, examId)
      const attemptNumber = previousAttempts.length + 1

      const wrongAnswers = questions
        .filter((q) => {
          // Only check MCQ questions for wrong answers
          if (q.type !== "mcq") return false
          const userAnswer = answers[q.id]
          return userAnswer !== q.correctAnswer
        })
        .map((q) => ({
          questionId: q.id,
          questionText: q.questionText,
          correctAnswer: q.correctAnswer,
          userAnswer: answers[q.id] !== undefined ? answers[q.id] : null,
          options: q.options,
        }))

      const cqAnswers = questions
        .filter((q) => q.type === "cq" || q.type === "creative")
        .map((q) => ({
          questionId: q.id,
          questionText: q.questionText,
          textAnswer: answers[q.id] || "",
          images: cqImages[q.id] || [],
          marks: q.marks || 0,
        }))

      console.log(" Submitting exam result:", {
        userId,
        examId,
        score,
        attemptNumber,
        totalQuestions: questions.length,
        cqAnswersCount: cqAnswers.length,
        wrongAnswersCount: wrongAnswers.length,
      })

      const result = await addDoc(collection(db, "examResults"), {
        userId,
        examId,
        answers,
        score,
        wrongAnswers,
        cqAnswers,
        totalQuestions: questions.length,
        submittedAt: serverTimestamp(),
        cqGraded: false,
        cqScore: 0,
        totalScore: score,
        attemptNumber,
      })

      console.log(" Exam result submitted successfully:", result.id)
      return result.id
    } catch (error) {
      console.error(" Error submitting exam result:", error)
      throw new Error(`Failed to submit exam: ${error.message}`)
    }
  }

  const getExamResult = async (userId, examId) => {
    try {
      const q = query(collection(db, "examResults"), where("userId", "==", userId), where("examId", "==", examId))
      const snapshot = await getDocs(q)
      if (!snapshot.empty) {
        const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        results.sort((a, b) => {
          const attemptA = a.attemptNumber || 1
          const attemptB = b.attemptNumber || 1
          if (attemptA !== attemptB) {
            return attemptA - attemptB
          }
          if (a.submittedAt && b.submittedAt) {
            return a.submittedAt.seconds - b.submittedAt.seconds
          }
          return 0
        })
        return results[0]
      }
      return null
    } catch (error) {
      console.error("Error fetching exam result:", error)
      return null
    }
  }

  const getUserExamAttempts = async (userId, examId) => {
    try {
      const q = query(collection(db, "examResults"), where("userId", "==", userId), where("examId", "==", examId))
      const snapshot = await getDocs(q)
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      results.sort((a, b) => (a.attemptNumber || 1) - (b.attemptNumber || 1))
      return results
    } catch (error) {
      console.error("Error fetching user exam attempts:", error)
      return []
    }
  }

  const getExamLeaderboard = async (examId, limit = 10) => {
    try {
      const q = query(collection(db, "examResults"), where("examId", "==", examId))
      const snapshot = await getDocs(q)
      
      const userAttempt1Scores = {}
      snapshot.docs.forEach(doc => {
        const data = doc.data()
        const userId = data.userId
        const attemptNumber = data.attemptNumber || 1
        
        if (attemptNumber === 1) {
          const score = data.totalScore || data.score || 0
          userAttempt1Scores[userId] = {
            id: doc.id,
            ...data,
            score
          }
        }
      })

      const leaderboard = Object.values(userAttempt1Scores)
      leaderboard.sort((a, b) => b.score - a.score)
      
      return leaderboard.slice(0, limit)
    } catch (error) {
      console.error("Error fetching leaderboard:", error)
      return []
    }
  }

  const getAllExamResults = async (examId) => {
    try {
      const q = query(collection(db, "examResults"), where("examId", "==", examId))
      const snapshot = await getDocs(q)
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    } catch (error) {
      console.error("Error fetching all exam results:", error)
      return []
    }
  }

  const getUserExamResults = async (userId) => {
    try {
      const q = query(collection(db, "examResults"), where("userId", "==", userId))
      const snapshot = await getDocs(q)
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    } catch (error) {
      console.error("Error fetching user exam results:", error)
      return []
    }
  }

  const copyExamQuestions = async (sourceExamId, targetExamId) => {
    try {
      console.log(" Copying questions from exam", sourceExamId, "to", targetExamId)
      const sourceQuestions = await getQuestionsByExam(sourceExamId)

      if (sourceQuestions.length === 0) {
        console.log(" No questions to copy")
        return 0
      }

      let copiedCount = 0
      for (const question of sourceQuestions) {
        const newQuestion = {
          ...question,
          examId: targetExamId,
          createdAt: serverTimestamp(),
        }
        delete newQuestion.id
        await addDoc(collection(db, "examQuestions"), newQuestion)
        copiedCount++
      }

      console.log(" Successfully copied", copiedCount, "questions")
      return copiedCount
    } catch (error) {
      console.error(" Error copying exam questions:", error)
      throw error
    }
  }

  const value = {
    exams,
    loading,
    createExam,
    getExamsByClass,
    getExamsByCourse,
    getActiveExamsByCourse,
    getArchivedExamsByCourse,
    getExamById,
    updateExam,
    deleteExam,
    addQuestion,
    getQuestionsByExam,
    updateQuestion,
    deleteQuestion,
    submitExamResult,
    getExamResult,
    getUserExamResults,
    getUserExamAttempts,
    getExamLeaderboard,
    getAllExamResults,
    copyExamQuestions,
  }

  return <ExamContext.Provider value={value}>{children}</ExamContext.Provider>
}
