import { useEffect, useMemo, useState } from "react"
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
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
        courseId: "COURSE_ID",
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
  if (typeof operation.collection === "string" && operation.collection.trim() && operation.id !== undefined && operation.id !== null && String(operation.id).trim()) {
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
      if (action !== "delete" && (!operation.data || typeof operation.data !== "object" || Array.isArray(operation.data))) {
        throw new Error(`Operation ${index + 1}: ${action} requires a data object.`)
      }
    }

    return { ...operation, action }
  })
}

function JsonAdminConsole() {
  const { userProfile } = useAuth()
  const fullAdmin = isFullAdmin(userProfile)
  const [jsonText, setJsonText] = useState(JSON.stringify(JSON_EXAMPLE, null, 2))
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

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

  if (!fullAdmin) return <Navigate to="/admin" replace />

  const parseAndValidate = () => {
    const parsed = JSON.parse(jsonText)
    const operations = validateOperations(normalizeOperations(parsed))
    setPreview(operations)
    setError("")
    setResult(null)
    return operations
  }

  const handlePreview = () => {
    try {
      parseAndValidate()
    } catch (parseError) {
      setPreview(null)
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

  const handleExecute = async () => {
    let operations
    try {
      operations = parseAndValidate()
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="bg-card border border-border rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="font-semibold">Operations JSON</h2>
              <p className="text-xs text-muted-foreground mt-1">Supported: add, update, set, delete. Up to 450 operations at once.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setJsonText(JSON.stringify(JSON_EXAMPLE, null, 2)); setPreview(null); setError(""); setResult(null) }} className="px-3 py-2 text-xs rounded-lg bg-muted hover:bg-muted/80">Example</button>
              <button type="button" onClick={handleFormat} className="px-3 py-2 text-xs rounded-lg bg-muted hover:bg-muted/80">Format</button>
              <button type="button" onClick={handlePreview} className="px-3 py-2 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20">Preview</button>
            </div>
          </div>

          <textarea
            value={jsonText}
            onChange={(event) => { setJsonText(event.target.value); setPreview(null); setResult(null); setError("") }}
            spellCheck={false}
            className="w-full min-h-[520px] resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <p>Special values: {`{"__serverTimestamp":true}`}, {`{"__deleteField":true}`}, {`{"__increment":1}`}</p>
            <p>Arrays: {`{"__arrayUnion":[...]}`} and {`{"__arrayRemove":[...]}`}</p>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="bg-card border border-border rounded-xl p-4 sm:p-5">
            <h2 className="font-semibold mb-3">Preview</h2>
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
      const collection = event?.detail?.collection
      if (collection !== "userCourses" && collection !== "payments") return
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
