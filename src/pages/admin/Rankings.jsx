import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Trophy, TrendingUp, User, Award, Star, Crown, BookOpen, Medal } from "lucide-react"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../lib/firebase"

export default function Rankings() {
  const [rankings, setRankings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRankings()
  }, [])

  const fetchRankings = async () => {
    try {
      console.log(" Fetching rankings data...")

      const classesSnapshot = await getDocs(collection(db, "classes"))
      const classesData = classesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      console.log(" Classes fetched:", classesData.length)

      const teacherVotes = {}

      classesData.forEach((cls) => {
        const teacherName = cls.teacherName

        if (!teacherName || teacherName.trim() === "") {
          return
        }

        if (!teacherVotes[teacherName]) {
          teacherVotes[teacherName] = {
            name: teacherName,
            totalLikes: 0,
            totalDislikes: 0,
            netScore: 0,
            classesCount: 0,
            teacherImageURL: cls.teacherImageURL || null,
          }
        }

        const likes = cls.likesCount || 0
        const dislikes = cls.dislikesCount || 0

        teacherVotes[teacherName].totalLikes += likes
        teacherVotes[teacherName].totalDislikes += dislikes
        teacherVotes[teacherName].netScore += likes - dislikes
        teacherVotes[teacherName].classesCount += 1

        if (!teacherVotes[teacherName].teacherImageURL && cls.teacherImageURL) {
          teacherVotes[teacherName].teacherImageURL = cls.teacherImageURL
        }
      })

      console.log(" Teachers aggregated:", Object.keys(teacherVotes).length)

      const rankingsArray = Object.values(teacherVotes).sort((a, b) => b.netScore - a.netScore)

      console.log(" Rankings sorted:", rankingsArray)
      setRankings(rankingsArray)
    } catch (error) {
      console.error(" Error fetching rankings:", error)
    } finally {
      setLoading(false)
    }
  }

  const getPodiumPosition = (index) => {
    if (index === 0) return "md:order-2"
    if (index === 1) return "md:order-1"
    if (index === 2) return "md:order-3"
    return ""
  }

  const getPodiumHeight = (index) => {
    if (index === 0) return "md:pb-0"
    if (index === 1) return "md:pb-12"
    if (index === 2) return "md:pb-20"
    return ""
  }

  const getRankBadge = (index) => {
    const badges = [
      {
        gradient: "from-yellow-400 via-yellow-500 to-yellow-600",
        icon: Crown,
        color: "text-yellow-600 dark:text-yellow-400",
        ring: "ring-yellow-500/30",
      },
      {
        gradient: "from-gray-300 via-gray-400 to-gray-500",
        icon: Award,
        color: "text-gray-600 dark:text-gray-400",
        ring: "ring-gray-400/30",
      },
      {
        gradient: "from-orange-400 via-orange-500 to-orange-600",
        icon: Medal,
        color: "text-orange-600 dark:text-orange-400",
        ring: "ring-orange-500/30",
      },
    ]

    if (index < 3) {
      const badge = badges[index]
      const Icon = badge.icon
      return (
        <div className="relative inline-flex">
          <div
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${badge.gradient} flex items-center justify-center shadow-lg ring-4 ${badge.ring}`}
          >
            <Icon className="w-6 h-6 sm:w-8 sm:h-8 text-white drop-shadow-md" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-background rounded-full flex items-center justify-center border-2 border-background shadow-md">
            <span className={`text-sm font-bold ${badge.color}`}>{index + 1}</span>
          </div>
        </div>
      )
    } else {
      return (
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center shadow-md ring-2 ring-border">
          <span className="text-lg sm:text-xl font-bold text-muted-foreground">#{index + 1}</span>
        </div>
      )
    }
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center sm:text-left">
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 justify-center sm:justify-start mb-2">
          <Trophy className="w-7 h-7 sm:w-8 sm:h-8 text-primary" />
          <h1 className="text-2xl sm:text-3xl font-bold">Teacher Rankings</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">
          Top teachers ranked by student reactions (likes - dislikes)
        </p>
      </motion.div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-56 sm:h-64 bg-card border border-border rounded-2xl animate-pulse"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 bg-card border border-border rounded-2xl animate-pulse"></div>
            ))}
          </div>
        </div>
      ) : rankings.length > 0 ? (
        <div className="space-y-8 sm:space-y-12">
          {rankings.length >= 3 && (
            <div className="space-y-4">
              <div className="text-center mb-6 sm:mb-8">
                <h2 className="text-xl sm:text-2xl font-bold mb-1 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                  🏆 Hall of Fame 🏆
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">Top 3 Outstanding Teachers</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                {rankings.slice(0, 3).map((teacher, index) => (
                  <motion.div
                    key={teacher.name}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.15, type: "spring" }}
                    className={`${getPodiumPosition(index)} ${getPodiumHeight(index)}`}
                  >
                    <div
                      className={`relative overflow-hidden rounded-2xl p-4 sm:p-6 border-2 backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-2xl ${
                        index === 0
                          ? "bg-gradient-to-br from-yellow-500/10 via-yellow-400/5 to-transparent border-yellow-500/40 shadow-yellow-500/20"
                          : index === 1
                            ? "bg-gradient-to-br from-gray-400/10 via-gray-300/5 to-transparent border-gray-400/40 shadow-gray-400/20"
                            : "bg-gradient-to-br from-orange-500/10 via-orange-400/5 to-transparent border-orange-500/40 shadow-orange-400/20"
                      } shadow-xl`}
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
                        {index === 0 && <Crown className="w-full h-full text-yellow-500" />}
                        {index === 1 && <Award className="w-full h-full text-gray-400" />}
                        {index === 2 && <Star className="w-full h-full text-orange-500" />}
                      </div>

                      <div className="flex flex-col items-center text-center relative z-10">
                        <div className="mb-3 sm:mb-4">{getRankBadge(index)}</div>

                        <div className="relative mb-3 sm:mb-4">
                          {teacher.teacherImageURL ? (
                            <img
                              src={teacher.teacherImageURL}
                              alt={teacher.name}
                              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-4 border-background shadow-xl ring-2 ring-primary/20"
                            />
                          ) : (
                            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center border-4 border-background shadow-xl ring-2 ring-primary/20">
                              <User className="w-10 h-10 sm:w-12 sm:h-12 text-primary" />
                            </div>
                          )}
                        </div>

                        <h3 className="text-base sm:text-lg font-bold mb-2 line-clamp-2 px-2">{teacher.name}</h3>

                        <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                          <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
                          <span>{teacher.classesCount} classes</span>
                        </div>

                        <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                              <span className="text-sm sm:text-base font-bold">{teacher.totalLikes}</span>
                            </div>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">Likes</span>
                          </div>
                          <div className="h-8 w-px bg-border"></div>
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 rotate-180" />
                              <span className="text-sm sm:text-base font-bold">{teacher.totalDislikes}</span>
                            </div>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">Dislikes</span>
                          </div>
                        </div>

                        <div className="w-full px-3 sm:px-4 py-2 sm:py-2.5 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 rounded-xl border border-primary/30 shadow-inner">
                          <div className="flex items-center justify-center gap-2">
                            <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                            <span className="text-base sm:text-lg font-bold text-primary">{teacher.netScore}</span>
                            <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">
                              Score
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {rankings.length > 3 && (
            <div className="space-y-4 sm:space-y-6">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent"></div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  <h2 className="text-lg sm:text-xl font-bold">Other Top Teachers</h2>
                </div>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent"></div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                {rankings.slice(3).map((teacher, index) => (
                  <motion.div
                    key={teacher.name}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (index + 3) * 0.05 }}
                    className="group bg-card border border-border rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:shadow-xl hover:border-primary/40 transition-all duration-300 hover:-translate-y-1"
                  >
                    <div className="flex flex-col items-center text-center">
                      <div className="mb-3">{getRankBadge(index + 3)}</div>

                      <div className="relative mb-3">
                        {teacher.teacherImageURL ? (
                          <img
                            src={teacher.teacherImageURL}
                            alt={teacher.name}
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-3 border-background shadow-lg ring-2 ring-border group-hover:ring-primary/30 transition-all"
                          />
                        ) : (
                          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center border-3 border-background shadow-lg ring-2 ring-border group-hover:ring-primary/30 transition-all">
                            <User className="w-8 h-8 sm:w-10 sm:h-10 text-primary" />
                          </div>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-base font-bold mb-2 line-clamp-2 min-h-[2.5rem] sm:min-h-[3rem] flex items-center">
                        {teacher.name}
                      </h3>

                      <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground mb-3">
                        <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span>{teacher.classesCount} classes</span>
                      </div>

                      <div className="w-full bg-muted/30 rounded-lg p-2 sm:p-2.5 mb-3">
                        <div className="flex items-center justify-center gap-3 sm:gap-4">
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            <span className="text-xs sm:text-sm font-semibold text-green-600 dark:text-green-400">
                              {teacher.totalLikes}
                            </span>
                          </div>
                          <div className="w-px h-3 sm:h-4 bg-border"></div>
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-red-500"></div>
                            <span className="text-xs sm:text-sm font-semibold text-red-600 dark:text-red-400">
                              {teacher.totalDislikes}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="w-full bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 rounded-lg px-3 py-2 border border-primary/20">
                        <div className="flex items-center justify-center gap-1.5">
                          <Trophy className="w-3 h-3 sm:w-4 sm:h-4 text-primary" />
                          <span className="text-sm sm:text-base font-bold text-primary">{teacher.netScore}</span>
                          <span className="text-[10px] sm:text-xs text-muted-foreground">pts</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-border rounded-2xl p-8 sm:p-12 text-center"
        >
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 sm:mb-6 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
              <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">No rankings yet</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Rankings will appear once classes receive reactions from students
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
