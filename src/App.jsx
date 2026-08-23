import { useEffect, useMemo, useState } from "react"
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  increment,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore"
import { AuthProvider, useAuth } from "./contexts/AuthContext"
import { CartProvider } from "./contexts/CartContext"
import { ExamProvider } from "./contexts/ExamContext"
import { Toaster } from "./components/ui/toaster"
import Header from "./components/Header"
import Footer from "./components/Footer"
import CartDrawer from "./components/CartDrawer"
import FloatingCartButton from "./components/FloatingCartButton"
import ProtectedRoute from "./components/ProtectedRoute"
import PermanentCacheSyncAgent from "./components/PermanentCacheSyncAgent"
import PWAInstallPrompt from "./components/PWAInstallPrompt"
import UpdateNotification from "./components/UpdateNotification"
import SettingsLoader from "./components/SettingsLoader"
import DownloadResumeAgent from "./components/DownloadResumeAgent"
import NativeHlsBootstrap from "./components/NativeHlsBootstrap"
import NativePushRegistrationAgent from "./components/NativePushRegistrationAgent"
import LearningPushFeedbackAgent from "./components/LearningPushFeedbackAgent"
import { NativeAppTopBar, NativeBottomNav } from "./components/NativeAppChrome"
import { hasNativeDownloader } from "./lib/nativeAndroid"
import { db } from "./lib/firebase"
import { isFullAdmin } from "./lib/adminPermissions"

import Home from "./pages/Home"
import Login from "./pages/Login"
import Courses from "./pages/Courses"
import CourseDetail from "./pages/CourseDetail"
import CourseChapters from "./pages/CourseChapters"
import CourseSubjects from "./pages/CourseSubjects"
import CourseClasses from "./pages/CourseClasses"
import CourseWatch from "./pages/CourseWatch"
import Announcements from "./pages/Announcments"
import AnnouncementDetail from "./pages/AnnouncementDetail"
import Community from "./pages/Community"
import Profile from "./pages/Profile"
import Dashboard from "./pages/Dashboard"
import AdminDashboard from "./pages/admin/AdminDashboard"
import Checkout from "./pages/Checkout"
import CheckoutComplete from "./pages/CheckoutComplete"
import PaymentSuccess from "./pages/PaymentSuccess"
import PaymentCancel from "./pages/PaymentCancel"
import PaymentHistory from "./pages/PaymentHistory"
import MyCourses from "./pages/MyCourses"
import Downloads from "./pages/Downloads"
import ExamView from "./pages/ExamView"
import ExamList from "./pages/ExamList"
import ExamLeaderboard from "./pages/ExamLeaderboard"
import ExamResult from "./pages/ExamResult"
import ExamSolutions from "./pages/ExamSolutions"
import ExamAttempts from "./pages/ExamAttempts"
import Analytics from "./pages/Analytics"
import NotFound from "./pages/NotFound"

const JSON_EXAMPLE = {
  operations: [
    {
      action: "add",
      collection: "classes",
      data: {
        courseId: "{{COURSE_ID}}",
        title: "New class",
        subject: [],
        chapter: ["Chapter name"],
        order: 1,
        duration: "35:00",
        youtubeLink: "https://www.youtube.com/watch?v=VIDEO_ID",
        videoURL: "https://www.youtube.com/watch?v=VIDEO_ID",
        createdAt: { __serverTimestamp: true },
      },
    },
    {
      action: "update",
      path: "classes/DOCUMENT_ID",
      data: {
        title: "Updated class title",
        updatedAt: { __serverTimestamp: true },
      },
    },
  ],
}

const normalizeOperations = (payload) => {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.operations)) return payload.operations
  if (payload && typeof payload === "object") return [payload]
  throw new Error("JSON must be an operation object, an array, or { operations: [...] }.")
}

const materializeFirestoreValues = (value) => {
  if (Array.isArray(value)) return value.map(materializeFirestoreValues)
  if (!value || typeof value !== "object") return value

  if (value.__serverTimestamp === true && Object.keys(value).length === 1) return serverTimestamp()
  if (value.__deleteField === true && Object.keys(value).length === 1) return deleteField()
  if (Object.prototype.hasOwnProperty.call(value, "__increment") && Object.keys(value).length === 1) {
    const amount = Number(value.__increment)
    if (!Number.isFinite(amount)) throw new Error("__increment must be a number.")
    return increment(amount)
  }
  if (Array.isArray(value.__arrayUnion) && Object.keys(value).length === 1) {
    return arrayUnion(...value.__arrayUnion.map(materializeFirestoreValues))
  }
  if (Array.isArray(value.__arrayRemove) && Object.keys(value).length === 1) {
    return arrayRemove(...value.__arrayRemove.map(materializeFirestoreValues))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, materializeFirestoreValues(nestedValue)]),
  )
}

const operationPath = (operation) => {
  if (typeof operation.path === "string" && operation.path.trim()) return operation.path.trim()
  if (
    typeof operation.collection === "string" &&
    operation.collection.trim() &&
    operation.id !== undefined &&
    operation.id !== null &&
    String(operation.id).trim()
  ) {
    return `${operation.collection.trim()}/${String(operation.id).trim()}`
  }
  return ""
}

const validateOperations = (operations) => {
  if (operations.length === 0) throw new Error("No operations found.")
  if (operations.length > 450) throw new Error("Maximum 450 operations per execution.")

  return operations.map((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new Error(`Operation ${index + 1} must be an object.`)
    }

    const action = String(operation.action || operation.operation || "").trim().toLowerCase()
    if (!["add", "update", "set", "delete"].includes(action)) {
      throw new Error(`Operation ${index + 1}: action must be add, update, set, or delete.`)
    }

    if (action === "add") {
      if (typeof operation.collection !== "string" || !operation.collection.trim()) {
        throw new Error(`Operation ${index + 1}: add requires collection.`)
      }
      if (!operation.data || typeof operation.data !== "object" || Array.isArray(operation.data)) {
        throw new Error(`Operation ${index + 1}: add requires a data object.`)
      }
    } else {
      const path = operationPath(operation)
      if (!path) throw new Error(`Operation ${index + 1}: ${action} requires path or collection + id.`)
      if (path.split("/").filter(Boolean).length % 2 !== 0) {
        throw new Error(`Operation ${index + 1}: document path must point to a document.`)
      }
      if (
        action !== "delete" &&
        (!operation.data || typeof operation.data !== "object" || Array.isArray(operation.data))
      ) {
        throw new Error(`Operation ${index + 1}: ${action} requires a data object.`)
      }
    }

    return { ...operation, action }
  })
}

const isTopicImportPayload = (payload) => (
  Array.isArray(payload) &&
  payload.length > 0 &&
  payload.every((topic) => (
    topic &&
    typeof topic === "object" &&
    !Array.isArray(topic) &&
    typeof topic.TopicTitle === "string" &&
    Array.isArray(topic.Videos)
  ))
)

const safeDocumentPart = (value) => encodeURIComponent(String(value || "").trim() || "item")

const formatDurationMinutes = (minutes) => {
  const numericMinutes = Number(minutes)
  if (!Number.isFinite(numericMinutes) || numericMinutes < 0) return ""
  const totalSeconds = Math.round(numericMinutes * 60)
  const hours = Math.floor(totalSeconds / 3600)
  const remaining = totalSeconds % 3600
  const mins = Math.floor(remaining / 60)
  const seconds = remaining % 60
  if (hours > 0) return `${hours}:${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  return `${mins}:${String(seconds).padStart(2, "0")}`
}

const normalizeVideoLink = (video) => {
  const rawLink = String(video?.VideoLink || "").trim()
  const type = String(video?.VideoType || "").trim().toLowerCase()
  if (!rawLink) return { type, url: "" }

  if (type === "youtube") {
    const isFullUrl = /^https?:\/\//i.test(rawLink)
    return { type, url: isFullUrl ? rawLink : `https://www.youtube.com/watch?v=${rawLink}` }
  }

  return { type, url: rawLink }
}

const buildTopicImportOperations = (topics, courseId) => {
  const normalizedCourseId = String(courseId || "").trim()
  if (!normalizedCourseId) throw new Error("Select a course before importing Topic JSON.")

  const chapterMap = new Map()
  const classOperations = []
  const nextOrderByChapter = new Map()

  topics.forEach((topic, topicIndex) => {
    const chapterTitle = String(topic.TopicTitle || "").trim()
    if (!chapterTitle) throw new Error(`Topic ${topicIndex + 1} has an empty TopicTitle.`)

    if (!chapterMap.has(chapterTitle)) {
      chapterMap.set(chapterTitle, {
        action: "set",
        path: `chapters/json_${safeDocumentPart(normalizedCourseId)}_${safeDocumentPart(chapterTitle)}`,
        merge: true,
        data: {
          title: chapterTitle,
          imageUrl: "",
          courseId: normalizedCourseId,
          subjectId: "",
          order: chapterMap.size + 1,
          updatedAt: { __serverTimestamp: true },
        },
      })
      nextOrderByChapter.set(chapterTitle, 1)
    }

    topic.Videos.forEach((video, videoIndex) => {
      const title = String(video?.VideoTitle || "").trim()
      if (!title) throw new Error(`Topic ${topicIndex + 1}, video ${videoIndex + 1} has an empty VideoTitle.`)

      const order = nextOrderByChapter.get(chapterTitle) || 1
      nextOrderByChapter.set(chapterTitle, order + 1)

      const normalizedVideo = normalizeVideoLink(video)
      const sourceVideoId = String(video?.VideoId || "").trim()
      const fallbackId = `${chapterTitle}_${order}_${title}`
      const documentId = `json_${safeDocumentPart(normalizedCourseId)}_${safeDocumentPart(sourceVideoId || fallbackId)}`

      const youtubeLink = normalizedVideo.type === "youtube" ? normalizedVideo.url : ""
      const hlsLink = normalizedVideo.type === "hls" ? normalizedVideo.url : ""
      const driveLink = normalizedVideo.type === "drive" ? normalizedVideo.url : ""
      const dailymotionLink = normalizedVideo.type === "dailymotion" ? normalizedVideo.url : ""
      const rumbleLink = normalizedVideo.type === "rumble" ? normalizedVideo.url : ""

      classOperations.push({
        action: "set",
        path: `classes/${documentId}`,
        merge: true,
        data: {
          courseId: normalizedCourseId,
          title,
          topic: "",
          chapter: [chapterTitle],
          subject: [],
          order,
          duration: formatDurationMinutes(video?.DurationInMinute),
          youtubeLink,
          hlsLink,
          driveLink,
          dailymotionLink,
          rumbleLink,
          videoURL: normalizedVideo.url,
          imageURL: "",
          teacherName: [],
          teacherImageURL: "",
          resourceLinks: [],
          updatedAt: { __serverTimestamp: true },
        },
      })
    })
  })

  return {
    operations: [...chapterMap.values(), ...classOperations],
    stats: {
      chapters: chapterMap.size,
      classes: classOperations.length,
    },
  }
}

function JsonAdminConsole() {
  const { userProfile } = useAuth()
  const fullAdmin = isFullAdmin(userProfile)
  const [jsonText, setJsonText] = useState(JSON.stringify(JSON_EXAMPLE, null, 2))
  const [preview, setPreview] = useState(null)
  const [previewInfo, setPreviewInfo] = useState(null)
  const [error, setError] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [courses, setCourses] = useState([])
  const [coursesLoading, setCoursesLoading] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState("")

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  )

  const previewRows = useMemo(() => {
    if (!preview) return []
    return preview.map((operation, index) => ({
      index: index + 1,
      action: operation.action,
      target: operation.action === "add"
        ? `${operation.collection}${operation.id ? `/${operation.id}` : "/<auto-id>"}`
        : operationPath(operation),
    }))
  }, [preview])

  useEffect(() => {
    if (!fullAdmin) return undefined

    let cancelled = false
    setCoursesLoading(true)
    getDocs(collection(db, "courses"))
      .then((snapshot) => {
        if (cancelled) return
        const data = snapshot.docs
          .map((courseDoc) => ({ id: courseDoc.id, ...courseDoc.data() }))
          .sort((a, b) => String(a.title || a.name || "").localeCompare(String(b.title || b.name || "")))
        setCourses(data)
      })
      .catch((courseError) => {
        if (!cancelled) setError(courseError.message || "Failed to load courses.")
      })
      .finally(() => {
        if (!cancelled) setCoursesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fullAdmin])

  if (!fullAdmin) return <Navigate to="/admin" replace />

  const prepareJson = () => {
    const parsed = JSON.parse(jsonText)

    if (isTopicImportPayload(parsed)) {
      if (!selectedCourse) throw new Error("Select a course before previewing Topic JSON.")
      const courseType = String(selectedCourse.type || "subject").trim().toLowerCase()
      if (courseType !== "subject") {
        throw new Error(`Selected course is type "${selectedCourse.type || "unknown"}". Topic JSON import is configured for subject-type courses.`)
      }

      const generated = buildTopicImportOperations(parsed, selectedCourse.id)
      const operations = validateOperations(generated.operations)
      setPreview(operations)
      setPreviewInfo({ mode: "topic", ...generated.stats })
      setError("")
      setResult(null)
      return operations
    }

    const operations = validateOperations(normalizeOperations(parsed))
    setPreview(operations)
    setPreviewInfo({ mode: "operations" })
    setError("")
    setResult(null)
    return operations
  }

  const handlePreview = () => {
    try {
      prepareJson()
    } catch (parseError) {
      setPreview(null)
      setPreviewInfo(null)
      setResult(null)
      setError(parseError.message || "Invalid JSON.")
    }
  }

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText)
      setJsonText(JSON.stringify(parsed, null, 2))
      setError("")
    } catch (parseError) {
      setError(parseError.message || "Invalid JSON.")
    }
  }

  const handleApplyCourseId = () => {
    if (!selectedCourseId) {
      setError("Select a course first.")
      return
    }
    setJsonText((current) => current
      .replaceAll("{{COURSE_ID}}", selectedCourseId)
      .replaceAll("COURSE_ID", selectedCourseId))
    setPreview(null)
    setPreviewInfo(null)
    setResult(null)
    setError("")
  }

  const handleCopyCourseId = async () => {
    if (!selectedCourseId) return
    try {
      await navigator.clipboard.writeText(selectedCourseId)
      setError("")
    } catch {
      setError("Could not copy the course ID. You can select and copy it manually.")
    }
  }

  const handleExecute = async () => {
    let operations
    try {
      operations = prepareJson()
    } catch (parseError) {
      setError(parseError.message || "Invalid JSON.")
      return
    }

    setRunning(true)
    setError("")
    setResult(null)

    try {
      const batch = writeBatch(db)
      const executed = []

      operations.forEach((operation) => {
        if (operation.action === "add") {
          const collectionRef = collection(db, operation.collection.trim())
          const documentRef = operation.id !== undefined && operation.id !== null && String(operation.id).trim()
            ? doc(collectionRef, String(operation.id).trim())
            : doc(collectionRef)
          batch.set(documentRef, materializeFirestoreValues(operation.data))
          executed.push({ action: "add", path: documentRef.path })
          return
        }

        const documentRef = doc(db, operationPath(operation))
        if (operation.action === "update") {
          batch.update(documentRef, materializeFirestoreValues(operation.data))
        } else if (operation.action === "set") {
          batch.set(documentRef, materializeFirestoreValues(operation.data), { merge: operation.merge === true })
        } else if (operation.action === "delete") {
          batch.delete(documentRef)
        }
        executed.push({ action: operation.action, path: documentRef.path })
      })

      await batch.commit()
      setResult({ count: executed.length, executed })
    } catch (executionError) {
      setError(executionError.message || "Firestore operation failed.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">JSON Firestore Console</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Direct full-admin tool. It is intentionally not linked from admin navigation.
        </p>
      </div>

      <section className="mb-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-2 block text-sm font-semibold" htmlFor="json-course-select">Target course</label>
            <select
              id="json-course-select"
              value={selectedCourseId}
              disabled={coursesLoading}
              onChange={(event) => {
                setSelectedCourseId(event.target.value)
                setPreview(null)
                setPreviewInfo(null)
                setResult(null)
                setError("")
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">{coursesLoading ? "Loading courses..." : "Select a course"}</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title || course.name || "Untitled course"} · {course.type || "subject"}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-[1.2]">
            <div className="mb-2 text-sm font-semibold">Course ID</div>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs break-all">
                {selectedCourseId || "Select a course to see its Firestore ID"}
              </div>
              <button
                type="button"
                disabled={!selectedCourseId}
                onClick={handleCopyCourseId}
                className="rounded-lg bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/80 disabled:opacity-50"
              >
                Copy
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={!selectedCourseId}
            onClick={handleApplyCourseId}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Apply ID to JSON
          </button>
        </div>

        {selectedCourse && (
          <div className="mt-3 text-xs text-muted-foreground">
            Selected: <span className="font-medium text-foreground">{selectedCourse.title || selectedCourse.name || "Untitled course"}</span>
            {` · type: ${selectedCourse.type || "subject"}`}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="bg-card border border-border rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="font-semibold">JSON</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Paste TopicTitle + Videos JSON directly, or use add/update/set/delete operations. TopicTitle becomes chapter and subject stays empty.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setJsonText(JSON.stringify(JSON_EXAMPLE, null, 2))
                  setPreview(null)
                  setPreviewInfo(null)
                  setError("")
                  setResult(null)
                }}
                className="px-3 py-2 text-xs rounded-lg bg-muted hover:bg-muted/80"
              >
                Example
              </button>
              <button type="button" onClick={handleFormat} className="px-3 py-2 text-xs rounded-lg bg-muted hover:bg-muted/80">Format</button>
              <button type="button" onClick={handlePreview} className="px-3 py-2 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20">Preview</button>
            </div>
          </div>

          <textarea
            value={jsonText}
            onChange={(event) => {
              setJsonText(event.target.value)
              setPreview(null)
              setPreviewInfo(null)
              setResult(null)
              setError("")
            }}
            spellCheck={false}
            className="w-full min-h-[520px] resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <p>Topic import: TopicTitle → chapter, Videos[] → classes, subject → []. Select a subject-type course first.</p>
            <p>Special values: {`{"__serverTimestamp":true}`}, {`{"__deleteField":true}`}, {`{"__increment":1}`}</p>
            <p>Arrays: {`{"__arrayUnion":[...]}`} and {`{"__arrayRemove":[...]}`}</p>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="bg-card border border-border rounded-xl p-4 sm:p-5">
            <h2 className="font-semibold mb-3">Preview</h2>
            {previewInfo?.mode === "topic" && (
              <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                Topic JSON detected: <strong>{previewInfo.chapters}</strong> chapter{previewInfo.chapters === 1 ? "" : "s"} + <strong>{previewInfo.classes}</strong> class{previewInfo.classes === 1 ? "" : "es"}.
              </div>
            )}

            {!previewRows.length ? (
              <p className="text-sm text-muted-foreground">Preview the JSON before executing it.</p>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {previewRows.map((row) => (
                  <div key={row.index} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase">{row.action}</span>
                      <span className="text-[11px] text-muted-foreground">#{row.index}</span>
                    </div>
                    <div className="mt-1 text-xs font-mono break-all">{row.target}</div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={!previewRows.length || running}
              onClick={handleExecute}
              className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {running ? "Executing..." : `Execute ${previewRows.length || ""} operation${previewRows.length === 1 ? "" : "s"}`}
            </button>
          </section>

          {error && (
            <section className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">
              <div className="font-semibold mb-1">Failed</div>
              <div className="break-words">{error}</div>
            </section>
          )}

          {result && (
            <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
              <div className="font-semibold mb-2">Committed {result.count} operation{result.count === 1 ? "" : "s"}</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.executed.map((item, index) => (
                  <div key={`${item.path}-${index}`} className="font-mono text-xs break-all">{item.action}: {item.path}</div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function App() {
  const nativeApp = hasNativeDownloader()
  const [accessVersion, setAccessVersion] = useState(0)

  useEffect(() => {
    const handleCacheUpdate = (event) => {
      const collectionName = event?.detail?.collection
      if (collectionName !== "userCourses" && collectionName !== "payments") return
      if (!window.location.pathname.startsWith("/course/")) return
      setAccessVersion((version) => version + 1)
    }

    window.addEventListener("easy-education-cache-updated", handleCacheUpdate)
    return () => window.removeEventListener("easy-education-cache-updated", handleCacheUpdate)
  }, [])

  return (
    <Router>
      <AuthProvider>
        <CartProvider>
          <ExamProvider>
            <SettingsLoader />
            <PermanentCacheSyncAgent />
            <NativePushRegistrationAgent />
            <LearningPushFeedbackAgent />
            <DownloadResumeAgent />
            <NativeHlsBootstrap />
            {!nativeApp && <style>{'a[href="/downloads"]{display:none!important}'}</style>}
            <div className="flex min-h-screen flex-col bg-background text-foreground">
              {nativeApp ? <NativeAppTopBar /> : <Header />}
              <main className={`flex-1 ${nativeApp ? "pb-20" : ""}`}>
                <Routes key={accessVersion}>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/courses" element={<Courses />} />
                  <Route path="/course/:courseId" element={<CourseDetail />} />
                  <Route path="/course/:courseId/chapters" element={<ProtectedRoute><CourseChapters /></ProtectedRoute>} />
                  <Route path="/course/:courseId/subjects" element={<ProtectedRoute><CourseSubjects /></ProtectedRoute>} />
                  <Route path="/course/:courseId/subjects/:subject/chapters" element={<ProtectedRoute><CourseChapters /></ProtectedRoute>} />
                  <Route path="/course/:courseId/archive/:subject/chapters" element={<ProtectedRoute><CourseChapters /></ProtectedRoute>} />
                  <Route path="/course/:courseId/archive/:subject/:chapter/classes" element={<ProtectedRoute><CourseClasses /></ProtectedRoute>} />
                  <Route path="/course/:courseId/archive/:chapter/classes" element={<ProtectedRoute><CourseClasses /></ProtectedRoute>} />
                  <Route path="/course/:courseId/classes/:chapter" element={<ProtectedRoute><CourseClasses /></ProtectedRoute>} />
                  <Route path="/course/:courseId/classes/:subject/:chapter" element={<ProtectedRoute><CourseClasses /></ProtectedRoute>} />
                  <Route path="/course/:courseId/watch/:classId" element={<ProtectedRoute><CourseWatch /></ProtectedRoute>} />
                  <Route path="/course/:courseId/watch" element={<ProtectedRoute><CourseWatch /></ProtectedRoute>} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/checkout-complete" element={<CheckoutComplete />} />
                  <Route path="/payment-success" element={<ProtectedRoute><PaymentSuccess /></ProtectedRoute>} />
                  <Route path="/payment-cancel" element={<PaymentCancel />} />
                  <Route path="/payment-history" element={<ProtectedRoute><PaymentHistory /></ProtectedRoute>} />
                  <Route path="/announcements" element={<Announcements />} />
                  <Route path="/announcements/:id" element={<AnnouncementDetail />} />
                  <Route path="/community" element={<Community />} />
                  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                  <Route path="/downloads" element={nativeApp ? <ProtectedRoute><Downloads /></ProtectedRoute> : <Navigate to="/courses" replace />} />
                  <Route path="/my-courses" element={<ProtectedRoute><MyCourses /></ProtectedRoute>} />
                  <Route path="/course/:courseId/exams" element={<ProtectedRoute><ExamList /></ProtectedRoute>} />
                  <Route path="/exam/:examId" element={<ProtectedRoute><ExamView /></ProtectedRoute>} />
                  <Route path="/exam/:examId/leaderboard" element={<ProtectedRoute><ExamLeaderboard /></ProtectedRoute>} />
                  <Route path="/exam/:examId/result" element={<ProtectedRoute><ExamResult /></ProtectedRoute>} />
                  <Route path="/exam/:examId/solutions" element={<ProtectedRoute><ExamSolutions /></ProtectedRoute>} />
                  <Route path="/exam/:examId/attempts" element={<ProtectedRoute><ExamAttempts /></ProtectedRoute>} />
                  <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
                  <Route path="/admin/json" element={<ProtectedRoute adminOnly><JsonAdminConsole /></ProtectedRoute>} />
                  <Route path="/admin/*" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>

              <CartDrawer />
              {!nativeApp && <FloatingCartButton />}
              {!nativeApp && <PWAInstallPrompt />}
              <UpdateNotification />
              <Toaster />
              {nativeApp ? <NativeBottomNav /> : <Footer />}
            </div>
          </ExamProvider>
        </CartProvider>
      </AuthProvider>
    </Router>
  )
}

export default App