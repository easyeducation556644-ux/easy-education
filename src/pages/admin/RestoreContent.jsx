"use client"

import { useMemo, useState } from "react"
import { useAuth } from "../../contexts/AuthContext"

const APPROVED_ROOT = "153b8d0e4ba66d04e85ad8e5026b7b2382f2804bca628bbca30cd4d9b0cdb12a"
const ALLOWED = ["categories", "courses", "chapters", "classes"]
const CONFIRM_TEXT = "RESTORE MISSING CONTENT"

function buildChunks(items) {
  const chunks = []
  const encoder = new TextEncoder()
  let group = []
  let bytes = 0
  for (const item of items) {
    const size = encoder.encode(JSON.stringify(item)).byteLength + 180
    if (size > 105000) throw Error("An individual document is too large for safe restore")
    if (group.length >= 15 || bytes + size > 105000) {
      chunks.push(group)
      group = []
      bytes = 0
    }
    group.push(item)
    bytes += size
  }
  if (group.length) chunks.push(group)
  return chunks
}

async function callRestore(token, action, items) {
  const response = await fetch("/api/restore-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
    },
    body: JSON.stringify({
      action,
      root: APPROVED_ROOT,
      records: items,
      ...(action === "restore" ? { confirmation: "CREATE_MISSING_ONLY" } : {}),
    }),
  })
  let result
  try { result = await response.json() } catch { throw Error("Server did not return JSON") }
  if (!response.ok || !result.success) throw Error(result.error || "Restore request failed")
  if (!Array.isArray(result.results) || result.results.length !== items.length) throw Error("Incomplete response from recovery API")
  return result.results
}

function fileSummary(items) {
  const totals = Object.fromEntries(ALLOWED.map(name => [name, 0]))
  const found = new Set()
  for (const item of items) {
    const row = item?.row
    const path = row?.path
    const kind = typeof path === "string" ? path.split("/")[0] : ""
    if (!ALLOWED.includes(kind) || found.has(path) || row?.hasCommittedMutations !== false || !Array.isArray(item.proof) || item.proof.length !== 12)
      throw Error("File contains invalid, duplicated or unapproved documents")
    found.add(path)
    totals[kind]++
  }
  return totals
}

export default function RestoreContent() {
  const { currentUser } = useAuth()
  const [items, setItems] = useState([])
  const [filename, setFilename] = useState("")
  const [totals, setTotals] = useState({})
  const [plan, setPlan] = useState(null)
  const [results, setResults] = useState([])
  const [stage, setStage] = useState("idle")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const isBusy = stage === "checking" || stage === "restoring"

  const chunks = useMemo(() => {
    try { return buildChunks(items) } catch { return [] }
  }, [items])

  const stats = useMemo(() => ({
    existing: plan?.filter(r => r.status === "existing").length || 0,
    missing: plan?.filter(r => r.status === "missing").length || 0,
    created: results.filter(r => r.status === "created").length,
    errors: results.filter(r => r.status === "error").length,
  }), [plan, results])

  async function onFileChange(event) {
    const file = event.target.files?.[0]
    setItems([])
    setPlan(null)
    setResults([])
    setFilename("")
    setError("")
    setStage("idle")
    setConfirmation("")
    setBackupConfirmed(false)
    if (!file) return
    try {
      if (file.size > 20 * 1024 * 1024) throw Error("Recovery file exceeds 20MB")
      const data = JSON.parse(await file.text())
      if (data.format !== "EasyEducationSignedContentRestoreV1" ||
          data.project !== "easy-education-real" ||
          data.root !== APPROVED_ROOT ||
          data.count !== 2581 ||
          !Array.isArray(data.items) || data.items.length !== data.count)
        throw Error("Select the approved Easy Education signed content recovery JSON")
      const count = fileSummary(data.items)
      if (count.categories !== 7 || count.courses !== 170 || count.chapters !== 283 || count.classes !== 2121)
        throw Error("Recovery file contents do not match the verified content counts")
      setItems(data.items)
      setTotals(count)
      setFilename(file.name)
      setStage("loaded")
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  async function checkContent() {
    if (isBusy || !items.length) return
    setStage("checking")
    setError("")
    setPlan(null)
    setResults([])
    setProgress({ done: 0, total: items.length })
    try {
      const token = await currentUser?.getIdToken(true)
      if (!token) throw Error("Sign in again as Full Admin")
      const all = []
      for (const group of chunks) {
        const partial = await callRestore(token, "preflight", group)
        all.push(...partial)
        setProgress({ done: all.length, total: items.length })
      }
      if (all.length !== items.length) throw Error("Preflight did not cover all documents")
      setPlan(all)
      setStage("checked")
    } catch (err) {
      setStage("error")
      setError(err.message || String(err))
    }
  }

  async function restoreContent() {
    if (!plan || isBusy || confirmation.trim() !== CONFIRM_TEXT || !backupConfirmed) return
    if (plan.length !== items.length) return
    setStage("restoring")
    setError("")
    setResults([])
    setProgress({ done: 0, total: items.length })
    const all = []
    try {
      const token = await currentUser?.getIdToken(true)
      if (!token) throw Error("Sign in again as the trusted administrator")
      for (const group of chunks) {
        const partial = await callRestore(token, "restore", group)
        all.push(...partial)
        setResults([...all])
        setProgress({ done: all.length, total: items.length })
      }
      setStage(all.some(row => row.status === "error") ? "partial" : "complete")
    } catch (err) {
      setStage("partial")
      setError("Restore stopped after " + all.length + " results. Previously created documents remain. Recheck before retrying. " + (err.message || String(err)))
    }
  }

  function downloadReport() {
    const payload = { file: filename, project: "easy-education-real", date: new Date().toISOString(), stage, counts: totals, preflight: plan, results }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "easyeducation-content-restore-report.json"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Emergency Database Restore</h1>
        <p className="text-sm text-muted-foreground mt-1">Restore only verified missing courses, chapters, categories and classes. No Firestore rule change required.</p>
      </div>
      <div className="border border-amber-300 dark:border-amber-700 rounded-lg p-4 bg-amber-50/60 dark:bg-amber-950/20 text-sm space-y-2">
        <p className="font-semibold">Recovery is limited to the verified content backup.</p>
        <p>Any existing logged-in Full Admin can use this restore page. No separate UID list or new environment settings are required. Keep Firestore rules locked down.</p>
        <p><strong>Never use</strong> <code>allow read, write: if true</code>. No payments, users, enrollments, settings or announcements are accepted. Existing records are never overwritten.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-semibold">1. Select approved recovery file</h2>
        <input type="file" accept=".json,application/json" onChange={onFileChange} disabled={isBusy} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:px-3 file:py-2" />
        <p className="text-xs text-muted-foreground">Select <code>EasyEducation-SIGNED-CONTENT-RESTORE.json</code>, not the original unfiltered browser cache or payments backup. The backend validates a proof for every document against the fixed approved recovery snapshot.</p>
        {filename && <p className="text-sm font-medium break-all">{filename}</p>}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ALLOWED.map(name => (
              <div key={name} className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground capitalize">{name}</p>
                <p className="font-semibold text-lg">{totals[name]?.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="font-semibold">2. Verify existing vs missing documents</h2>
          <button type="button" disabled={isBusy} onClick={checkContent} className="px-4 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50">
            {stage === "checking" ? "Checking Firestore…" : "Check Missing Documents"}
          </button>
          {(isBusy || progress.total > 0) && <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{progress.done.toLocaleString()} / {progress.total.toLocaleString()} processed</p>
            <progress className="w-full h-3" max={progress.total || 1} value={progress.done} />
          </div>}
          {plan && <div className="flex flex-wrap gap-4 text-sm">
            <span>Already exists: <b>{stats.existing.toLocaleString()}</b></span>
            <span>Missing: <b>{stats.missing.toLocaleString()}</b></span>
          </div>}
        </div>
      )}

      {plan && stage !== "restoring" && stage !== "complete" && stage !== "partial" && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="font-semibold">3. Confirm restoration</h2>
          <label className="flex gap-2 items-start text-sm">
            <input type="checkbox" checked={backupConfirmed} onChange={event => setBackupConfirmed(event.target.checked)} className="mt-1" />
            <span>I verified the preflight results and saved a separate backup of the current live database.</span>
          </label>
          <label className="block text-sm font-medium">Type <code>{CONFIRM_TEXT}</code> to continue:</label>
          <input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={CONFIRM_TEXT} autoComplete="off" className="w-full border border-input rounded-md bg-background p-2 text-sm" />
          <button type="button" disabled={!backupConfirmed || confirmation.trim() !== CONFIRM_TEXT} onClick={restoreContent} className="px-4 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-40">
            Restore Missing Content
          </button>
        </div>
      )}

      {(stage === "complete" || stage === "partial" || stage === "restoring") && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Restore results</h2>
          <p className="text-sm">Created: <b>{stats.created}</b> · Already existed: <b>{results.filter(r => r.status === "existing").length}</b> · Errors: <b>{stats.errors}</b></p>
          <p className="text-sm">{stage === "complete" ? "Finished. Check course pages and Firestore counts." : "Review the report, then run a fresh preflight before any retry."}</p>
          <button type="button" onClick={downloadReport} className="px-3 py-2 text-sm border rounded-md">Download restore report</button>
        </div>
      )}

      {error && <div role="alert" className="border border-destructive/40 rounded-md p-3 text-sm text-destructive break-words">{error}</div>}
    </div>
  )
}
