"use client"
import { toast } from "../../hooks/use-toast"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Send, Search, Download, Mail, Phone } from "lucide-react"
import { collection, getDocs, query, orderBy } from "firebase/firestore"
import { db } from "../../lib/firebase"

export default function ManageTelegramSubmissions() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCourse, setSelectedCourse] = useState("all")

  useEffect(() => {
    fetchSubmissions()
  }, [])

  const fetchSubmissions = async () => {
    try {
      const q = query(collection(db, "telegramSubmissions"), orderBy("submittedAt", "desc"))
      const snapshot = await getDocs(q)
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setSubmissions(data)
    } catch (error) {
      console.error("Error fetching telegram submissions:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch telegram submissions",
      })
    } finally {
      setLoading(false)
    }
  }

  const uniqueCourses = [...new Set(submissions.map(s => s.courseName))].filter(Boolean)

  const filteredSubmissions = submissions.filter((submission) => {
    const matchesSearch = 
      submission.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.userEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.telegramId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.telegramMobile?.includes(searchQuery) ||
      submission.courseName?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesCourse = selectedCourse === "all" || submission.courseName === selectedCourse

    return matchesSearch && matchesCourse
  })

  const exportToCSV = () => {
    const headers = ["Name", "Email", "Telegram ID", "Mobile Number", "Course", "Submitted At"]
    const rows = filteredSubmissions.map(s => [
      s.userName || "",
      s.userEmail || "",
      s.telegramId || "",
      s.telegramMobile || "",
      s.courseName || "",
      s.submittedAt?.toDate?.()?.toLocaleString() || ""
    ])

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(","))
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `telegram-submissions-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
    
    toast({
      title: "Success",
      description: "CSV exported successfully!",
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Telegram Submissions</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            View and manage student telegram information
          </p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={filteredSubmissions.length === 0}
          className="w-full sm:w-auto px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 sm:p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, telegram ID, mobile..."
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Course:</label>
          <select
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
            className="px-3 py-1.5 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          >
            <option value="all">All Courses</option>
            {uniqueCourses.map((course) => (
              <option key={course} value={course}>
                {course}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent"></div>
        </div>
      ) : filteredSubmissions.length > 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Student Info
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Telegram Info
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Course
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Submitted
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredSubmissions.map((submission, index) => (
                  <motion.tr
                    key={submission.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{submission.userName || "N/A"}</p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="w-3 h-3" />
                          <span>{submission.userEmail || "N/A"}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-sm">
                          <Send className="w-3.5 h-3.5 text-blue-600" />
                          <span className="font-medium">{submission.telegramId || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="w-3 h-3" />
                          <span>{submission.telegramMobile || "N/A"}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
                        {submission.courseName || "Unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        {submission.submittedAt?.toDate?.()?.toLocaleDateString() || "N/A"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {submission.submittedAt?.toDate?.()?.toLocaleTimeString() || ""}
                      </p>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Send className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-1">No submissions found</h3>
          <p className="text-sm text-muted-foreground">
            {searchQuery || selectedCourse !== "all"
              ? "Try adjusting your filters"
              : "No telegram submissions yet"}
          </p>
        </div>
      )}

      <div className="bg-muted/30 border border-border rounded-lg p-3 sm:p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total Submissions:</span>
          <span className="font-semibold">{filteredSubmissions.length}</span>
        </div>
      </div>
    </div>
  )
}
