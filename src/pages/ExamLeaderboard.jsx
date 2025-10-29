"use client"

import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { Trophy, Medal, ArrowLeft, User, Award } from "lucide-react"
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { toast } from "../hooks/use-toast"

export default function ExamLeaderboard() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const [leaderboard, setLeaderboard] = useState([])
  const [exam, setExam] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeaderboardData()
  }, [examId])

  const fetchLeaderboardData = async () => {
    try {
      setLoading(true)

      // Fetch exam details
      const examDoc = await getDoc(doc(db, "exams", examId))
      if (!examDoc.exists()) {
        toast({
          variant: "error",
          title: "Error",
          description: "Exam not found",
        })
        navigate(-1)
        return
      }
      setExam({ id: examDoc.id, ...examDoc.data() })

      // Fetch all exam results for this exam
      const resultsQuery = query(collection(db, "examResults"), where("examId", "==", examId))
      const resultsSnapshot = await getDocs(resultsQuery)
      const results = resultsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

      // Group results by userId and keep only the first attempt (oldest submission)
      const userFirstAttempts = new Map()
      results.forEach((result) => {
        const userId = result.userId
        const existingAttempt = userFirstAttempts.get(userId)
        
        if (!existingAttempt || (result.submittedAt && existingAttempt.submittedAt && result.submittedAt.seconds < existingAttempt.submittedAt.seconds)) {
          userFirstAttempts.set(userId, result)
        }
      })

      // Fetch user data for first attempts only
      const leaderboardData = await Promise.all(
        Array.from(userFirstAttempts.values()).map(async (result) => {
          const userDoc = await getDoc(doc(db, "users", result.userId))
          const userData = userDoc.exists() ? userDoc.data() : { name: "Unknown User" }

          // Use totalScore if available (after CQ grading), otherwise use MCQ score
          const finalScore = result.totalScore !== undefined ? result.totalScore : result.score || 0

          return {
            id: result.id,
            userId: result.userId,
            userName: userData.name || "Unknown User",
            userEmail: userData.email || "",
            score: finalScore,
            mcqScore: result.score || 0,
            cqScore: result.cqScore || 0,
            cqGraded: result.cqGraded || false,
            submittedAt: result.submittedAt,
            totalQuestions: result.totalQuestions || 0,
            correctAnswers: (result.totalQuestions || 0) - (result.wrongAnswers?.length || 0),
          }
        }),
      )

      // Sort by score (descending)
      leaderboardData.sort((a, b) => b.score - a.score)
      setLeaderboard(leaderboardData)
    } catch (error) {
      console.error("Error fetching leaderboard:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to load leaderboard",
      })
    } finally {
      setLoading(false)
    }
  }

  const getMedalIcon = (position) => {
    switch (position) {
      case 0:
        return <Trophy className="w-6 h-6 text-yellow-500" />
      case 1:
        return <Medal className="w-6 h-6 text-gray-400" />
      case 2:
        return <Medal className="w-6 h-6 text-orange-600" />
      default:
        return null
    }
  }

  const getMedalColor = (position) => {
    switch (position) {
      case 0:
        return "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30"
      case 1:
        return "from-gray-400/20 to-gray-500/10 border-gray-400/30"
      case 2:
        return "from-orange-500/20 to-orange-600/10 border-orange-500/30"
      default:
        return "from-primary/10 to-primary/5 border-primary/20"
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
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-primary hover:text-primary/80 mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Exam Leaderboard</h1>
          {exam && <p className="text-muted-foreground text-lg">{exam.title}</p>}
        </div>

        {leaderboard.length === 0 ? (
          <div className="text-center py-12 bg-card border border-border rounded-xl">
            <Award className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No submissions yet for this exam</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Top 3 Podium */}
            {leaderboard.slice(0, 3).length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {leaderboard.slice(0, 3).map((entry, index) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`bg-gradient-to-br ${getMedalColor(index)} border rounded-xl p-6 relative overflow-hidden`}
                  >
                    <div className="absolute top-2 right-2">{getMedalIcon(index)}</div>
                    <div className="text-center">
                      <div className="text-4xl font-bold mb-2">#{index + 1}</div>
                      <div className="w-12 h-12 rounded-full bg-primary/20 mx-auto mb-3 flex items-center justify-center">
                        <User className="w-6 h-6 text-primary" />
                      </div>
                      <h3 className="font-bold text-lg mb-1">{entry.userName}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{entry.userEmail}</p>
                      <div className="text-3xl font-bold text-primary mb-2">{entry.score.toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>MCQ: {entry.mcqScore.toFixed(1)}%</div>
                        {entry.cqGraded && <div>CQ: {entry.cqScore.toFixed(1)}%</div>}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Full Leaderboard */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-3 text-left text-sm font-semibold">Rank</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Student</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold">Score</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold">MCQ</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold">CQ</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold">Correct</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, index) => (
                      <motion.tr
                        key={entry.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`border-b border-border hover:bg-muted/50 transition-colors ${
                          index < 3 ? "bg-muted/30" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {index < 3 ? getMedalIcon(index) : <span className="text-lg font-bold">{index + 1}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{entry.userName}</p>
                            <p className="text-xs text-muted-foreground">{entry.userEmail}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="font-bold text-lg text-primary">{entry.score.toFixed(1)}%</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm">{entry.mcqScore.toFixed(1)}%</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {entry.cqGraded ? (
                            <span className="text-sm font-medium text-green-600">{entry.cqScore.toFixed(1)}%</span>
                          ) : (
                            <span className="text-xs text-yellow-600">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm">
                            {entry.correctAnswers}/{entry.totalQuestions}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
