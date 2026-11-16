import {useEffect, useState} from 'react'
import {jahajiRequest} from './JahajiDashboard'

export default function JahajiReleases({access}) {
  const [release, setRelease] = useState({version: '', url: '', sha256: '', size: '', notes: '', published: false})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {let active = true; jahajiRequest('admin-release').then(data => {if (active && data.release) setRelease(data.release)}).catch(e => {if (active) setMessage(e.message)}); return () => {active = false}}, [])
  const save = async event => {
    event.preventDefault(); setBusy(true); setMessage('')
    try {await jahajiRequest('admin-release', {...release, size: Number(release.size)}); setMessage(release.published ? 'Update published. Compatible Jahaji apps will detect it.' : 'Draft saved. No update notification will be shown.')}
    catch (e) {setMessage(e.message)} finally {setBusy(false)}
  }
  const input = 'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
  return <form onSubmit={save} className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Windows app update</h2>
    <p className="text-sm text-muted-foreground">Upload the Setup EXE to the official Easy Education GitHub release, then publish its version and checksum here. Use a higher version for each release. Existing app data is retained by the installer.</p>
    {[['version', 'Version', '3.0.8'], ['url', 'Direct HTTPS installer URL', 'https://…/Jahaji-Setup.exe'], ['sha256', 'SHA-256 checksum', '64 hexadecimal characters'], ['size', 'Installer size (bytes)', '']].map(([key,label,placeholder]) => <label key={key} className="block text-sm">{label}<input className={input} required disabled={!access.full} type={key === 'size' ? 'number' : key === 'url' ? 'url' : 'text'} min={key === 'size' ? 1 : undefined} value={release[key]} placeholder={placeholder} onChange={e => setRelease({...release, [key]: e.target.value})}/></label>)}
    <label className="block text-sm">Release notes<textarea className={input} disabled={!access.full} rows={4} maxLength={4000} value={release.notes} onChange={e => setRelease({...release, notes: e.target.value})}/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!access.full} checked={release.published} onChange={e => setRelease({...release, published: e.target.checked})}/>Publish update notification</label>
    {access.full && <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? 'Saving…' : 'Save release'}</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>
}
