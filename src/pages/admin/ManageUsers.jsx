"use client"

import { useState } from "react"
import { Clock3, Sparkles, Users } from "lucide-react"
import ManageUsersCore from "./ManageUsersCore"
import CourseAccessControl from "./CourseAccessControl"
import { useAuth } from "../../contexts/AuthContext"
import { isFullAdmin } from "../../lib/adminPermissions"

export default function ManageUsers() {
  const { userProfile } = useAuth()
  const [accessOpen, setAccessOpen] = useState(false)
  const fullAdmin = isFullAdmin(userProfile)

  return (
    <>
      {fullAdmin && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-amber-500/10 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-start gap-3">
              <span className="rounded-xl bg-violet-500/15 p-2.5 text-violet-500"><Sparkles className="h-5 w-5" /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">Course access & trials</h2><span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">CPS + Our courses</span></div>
                <p className="mt-1 text-sm text-muted-foreground">Grant CPS access to one, multiple or all users for any minutes, hours, days or months. CPS courses remain app-only.</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />Bulk users</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Flexible trial</span></div>
              </div>
            </div>
            <button onClick={() => setAccessOpen(true)} className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground shadow-sm transition hover:opacity-90">Open access studio</button>
          </div>
        </div>
      )}
      <ManageUsersCore />
      <CourseAccessControl open={accessOpen} onClose={() => setAccessOpen(false)} />
    </>
  )
}
