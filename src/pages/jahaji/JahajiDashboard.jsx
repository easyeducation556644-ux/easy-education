import JahajiReleases from './JahajiReleases'
import {useCallback, useEffect, useState} from 'react'
import {Link, Navigate, Route, Routes, useLocation} from 'react-router-dom'
import {LayoutDashboard, Users, Monitor, Layers3, ShieldCheck, RefreshCw, Plus, Trash2} from 'lucide-react'
import {auth} from '../../lib/firebase'

export async function jahajiRequest(action, body, after) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Sign in to Easy Education')
  const response = await fetch('/api/jahaji?action=' + action + (after ? '&after=' + encodeURIComponent(after) : ''), {
    method: body ? 'POST' : 'GET', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'Could not load Jahaji')
  return result
}

const FEATURES = {download: 'Video downloads', watermark: 'Watermark', telegram: 'Telegram uploads', youtube: 'YouTube uploads', scan: 'Course scans', import: 'Local videos', account: 'Course accounts'}
const SITES = ['acs', 'retina', 'youtube', 'vimeo', 'vidinfra', 'other']
const NAV = [['', 'Overview', LayoutDashboard], ['users', 'Users', Users], ['devices', 'Devices', Monitor], ['plans', 'Plans', Layers3], ['releases', 'App updates', RefreshCw], ['staff', 'User management', ShieldCheck]]
const button = 'inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const input = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const emptyPlan = () => ({name: '', limits: Object.fromEntries(Object.keys(FEATURES).map(key => [key, 5])), sites: [...SITES]})

function useRows(action) {
  const [data, setData] = useState({rows: [], next: null})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (after) => {
    setBusy(true); setError('')
    try {
      const result = await jahajiRequest('admin-' + action, null, after)
      setData(previous => ({...result, rows: after ? [...previous.rows, ...result.rows] : result.rows}))
    } catch (e) {setError(e.message)}
    finally {setBusy(false)}
  }, [action])
  useEffect(() => {void load()}, [load])
  return {data, error, busy, load, setError}
}

function PlanEditor({initial, close, save}) {
  const [plan, setPlan] = useState(() => ({...initial, deviceLimit: initial.deviceLimit ?? 1, price: initial.price ?? 0, durationDays: initial.durationDays ?? 30, published: initial.published ?? false}))
  const [limitedValues, setLimitedValues] = useState(() => Object.fromEntries(
    Object.keys(FEATURES).map(key => [key, initial.limits[key] >= 0 ? initial.limits[key] : 5])
  ))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="rounded-lg border border-border bg-card p-5 space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('')
    try {await save(plan); close()} catch (e) {setError(e.message)} finally {setBusy(false)}
  }}>
    <h2 className="font-semibold">{plan.id ? 'Edit plan' : 'Create plan'}</h2>
    <label className="block text-sm">Plan name<input className={input} required maxLength={80} value={plan.name} onChange={e => setPlan({...plan, name: e.target.value})}/></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">Price (BDT)<input className={input} type="number" min="0" max="1000000" step="0.01" required value={plan.price} onChange={e => setPlan({...plan, price: e.target.value === '' ? '' : Number(e.target.value)})}/></label>
      <label className="block text-sm">Duration (days)<input className={input} type="number" min="1" max="3650" step="1" required value={plan.durationDays} onChange={e => setPlan({...plan, durationDays: e.target.value === '' ? '' : Number(e.target.value)})}/></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plan.published} onChange={e => setPlan({...plan, published: e.target.checked})}/>Publish for customers to buy</label>
    <fieldset className="rounded-md border border-border p-3"><legend className="px-1 text-sm font-medium">Devices per Easy Education account</legend>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={plan.deviceLimit === -1} onChange={e => setPlan({...plan, deviceLimit: e.target.checked ? -1 : 1})}/>Unlimited devices</label>
      <input aria-label="Devices per account" className={input} type="number" min="1" max="1000" step="1" required disabled={plan.deviceLimit === -1} value={plan.deviceLimit === -1 ? '' : plan.deviceLimit} placeholder={plan.deviceLimit === -1 ? 'Unlimited' : ''} onChange={e => setPlan({...plan, deviceLimit: e.target.value === '' ? '' : Number(e.target.value)})}/>
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(FEATURES).map(([key, title]) => {
      const unlimited = plan.limits[key] === -1
      return <fieldset className="rounded-md border border-border p-3" key={key}>
        <legend className="px-1 text-sm font-medium">{title}</legend>
        <label className="mb-3 flex items-center justify-between gap-3 text-sm">
          Unlimited
          <input type="checkbox" role="switch" aria-label={title + ' unlimited'} checked={unlimited} onChange={e => {
            if (e.target.checked) {
              setLimitedValues(previous => ({...previous, [key]: Number.isInteger(plan.limits[key]) && plan.limits[key] >= 0 ? plan.limits[key] : 5}))
              setPlan(previous => ({...previous, limits: {...previous.limits, [key]: -1}}))
            } else {
              setPlan(previous => ({...previous, limits: {...previous.limits, [key]: limitedValues[key]}}))
            }
          }}/>
        </label>
        <label className="block text-xs text-muted-foreground">
          Monthly limit
          <input className={input + ' mt-1 disabled:bg-muted disabled:text-muted-foreground'} type="number"
            aria-label={title + ' monthly limit'} min={0} max={1000000} step="1" required disabled={unlimited}
            placeholder={unlimited ? 'Unlimited' : ''} value={unlimited ? '' : plan.limits[key]}
            onChange={e => setPlan(previous => ({...previous, limits: {...previous.limits, [key]: e.target.value === '' ? '' : Number(e.target.value)}}))}/>
        </label>
      </fieldset>
    })}</div>
    <p className="text-xs text-muted-foreground">Monthly limits per device. Enable Unlimited for unrestricted use. A limit of 0 disables the feature.</p>
    <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-sm font-medium">Download sites</legend>{SITES.map(site => <label key={site} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plan.sites.includes(site)} onChange={e => setPlan({...plan, sites: e.target.checked ? [...plan.sites, site] : plan.sites.filter(value => value !== site)})}/>{site === 'acs' ? 'ACS Admission / Academic / FRB' : site}</label>)}</fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-2"><button disabled={busy} className={button + ' bg-primary text-primary-foreground'}>Save plan</button><button type="button" className={button} onClick={close}>Cancel</button></div>
  </form>
}

function Records({kind, access}) {
  const {data, error, busy, load, setError} = useRows(kind)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [plans, setPlans] = useState([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    async function allPlans() {
      if (!['users', 'devices'].includes(kind)) return
      try {
        const rows = []; let after
        do {const page = await jahajiRequest('admin-plans', null, after); rows.push(...page.rows); after = page.next} while (after)
        if (active) setPlans(rows.filter(plan => !plan.deleted))
      } catch (e) {if (active) setError(e.message)}
    }
    void allPlans(); return () => {active = false}
  }, [kind, setError])
  const mutate = async (action, body) => {
    setSaving(true); setError('')
    try {await jahajiRequest('admin-' + action, body); await load()}
    catch (e) {setError(e.message); throw e}
    finally {setSaving(false)}
  }
  const editable = ['owner', 'manager'].includes(access.role)
  const canBan = access.role !== 'viewer'
  const rows = data.rows.filter(row => !row.deleted && [row.name, row.userName, row.email].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())))
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><input aria-label="Search loaded records" className={input + ' max-w-sm'} placeholder="Search loaded names or emails" value={search} onChange={e => setSearch(e.target.value)}/><button className={button} disabled={busy || saving} onClick={() => void load()}><RefreshCw size={15}/>Refresh</button>{kind === 'plans' && editable && <button className={button + ' bg-primary text-primary-foreground'} onClick={() => setEditing(emptyPlan())}><Plus size={15}/>Create plan</button>}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {kind === 'plans' && editing && <PlanEditor key={editing.id || 'new'} initial={editing} close={() => setEditing(null)} save={plan => mutate('plan', plan)}/>}
    <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40"><tr><th className="p-3">{kind === 'devices' ? 'Device / user' : 'Name'}</th><th className="p-3">{kind === 'plans' ? 'Monthly allowance' : 'Access'}</th><th className="p-3">Actions</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id} className="border-b border-border last:border-0"><td className="p-3"><b>{kind === 'devices' ? row.userName || 'Guest' : row.name || 'Unnamed user'}</b><p className="text-xs text-muted-foreground">{row.email || (kind === 'devices' ? 'Not signed in' : '')}</p>{kind === 'plans' && <p className="text-xs text-muted-foreground">৳{row.price || 0} · {row.durationDays || 30} days · {row.published ? 'For sale' : 'Private'}</p>}{kind === 'devices' && <p className="text-xs text-muted-foreground">{row.name}</p>}{kind === 'devices' && <p className="text-xs text-muted-foreground">{Object.entries(row.usage || {}).map(([feature, count]) => `${FEATURES[feature]} ${count.used}`).join(' · ')}</p>}</td><td className="p-3">
        {kind === 'plans' ? Object.entries(row.limits).map(([feature, count]) => <p className="text-xs" key={feature}>{FEATURES[feature]} · {count === -1 ? 'Unlimited' : count}</p>) : kind === 'staff' ? row.role : <><span className={row.banned ? 'text-destructive' : 'text-green-600'}>{row.banned ? 'Banned' : 'Active'}</span><p className="text-xs text-muted-foreground">{plans.find(plan => plan.id === row.planId)?.name || 'Free / inherited'}</p></>}
      </td><td className="p-3"><div className="flex flex-wrap gap-2">
        {['users', 'devices'].includes(kind) && <>{editable && <select aria-label={'Plan for ' + (row.name || row.userName)} className={input + ' max-w-48'} value={row.planId || ''} disabled={saving} onChange={e => void mutate(kind === 'users' ? 'user' : 'device', {id: row.id, planId: e.target.value || null}).catch(() => {})}><option value="">Free / inherited</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>}{canBan && <button disabled={saving} className={button} onClick={() => void mutate(kind === 'users' ? 'user' : 'device', {id: row.id, banned: !row.banned}).catch(() => {})}>{row.banned ? 'Unban' : 'Ban'}</button>}</>}
        {kind === 'plans' && editable && <><button className={button} onClick={() => setEditing(row)}>Edit</button><button className={button} disabled={saving} onClick={() => {if(window.confirm(`Delete ${row.name}? Assigned users will use the Free plan. Usage is retained.`)) void mutate('plan', {id: row.id, remove: true}).catch(() => {})}}><Trash2 size={14}/>Delete</button></>}
        {kind === 'staff' && access.full && <button className={button} disabled={saving} onClick={() => void mutate('staff', {email: row.email, remove: true}).catch(() => {})}>Remove access</button>}
      </div></td></tr>)}
      {!rows.length && <tr><td colSpan={3} className="p-8 text-center text-muted-foreground">{busy ? 'Loading…' : 'No records found'}</td></tr>}
    </tbody></table></div>
    {data.next && <button className={button} disabled={busy} onClick={() => void load(data.next)}>Load more</button>}
    {kind === 'staff' && access.full && <StaffForm save={body => mutate('staff', body)}/>}
  </div>
}

function StaffForm({save}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  return <form className="rounded-lg border border-border bg-card p-4 space-y-3" onSubmit={async e => {e.preventDefault(); setBusy(true); try {await save({email, role}); setEmail('')} catch {} finally {setBusy(false)}}}>
    <h2 className="font-semibold">Grant Jahaji panel access</h2>
    <label className="block text-sm">Easy Education email<input className={input} type="email" required value={email} onChange={e => setEmail(e.target.value)}/></label>
    <label className="block text-sm">Role<select className={input} value={role} onChange={e => setRole(e.target.value)}><option value="viewer">Viewer — read only</option><option value="support">Support — view and ban</option><option value="manager">Manager — plans, access and bans</option></select></label>
    <button disabled={busy} className={button + ' bg-primary text-primary-foreground'}>Grant access</button>
  </form>
}

function Overview() {
  const [value, setValue] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {jahajiRequest('admin-overview').then(setValue).catch(e => setError(e.message))}, [])
  return <div className="space-y-4">{error && <p role="alert">{error}</p>}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Devices', 'devices'], ['Signed-in users', 'users'], ['Plans', 'plans'], ['Banned devices', 'banned']].map(([label, key]) => <div key={key} className="rounded-lg border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><b className="mt-2 block text-3xl">{value?.[key] ?? '—'}</b></div>)}</div><div className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Free plan</h2><p className="mt-2 text-sm text-muted-foreground">5 successful uses of each feature per device, every month. Signing in keeps the existing device allowance. The month follows Bangladesh time.</p></div></div>
}

export default function JahajiDashboard() {
  const location = useLocation()
  const [access, setAccess] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {jahajiRequest('admin-access').then(setAccess).catch(e => setError(e.message))}, [])
  if (error) return <div className="p-8" role="alert">{error}</div>
  if (!access) return <div className="p-8">Checking access…</div>
  const nav = NAV.filter(([path]) => path !== 'staff' || access.full)
  const current = nav.find(([path]) => location.pathname === '/jahaji' + (path ? '/' + path : ''))?.[1] || 'Jahaji'
  return <div className="flex h-[calc(100vh-64px)] min-h-96 flex-col bg-background"><header className="border-b border-border bg-card p-4"><h1 className="text-lg font-bold">Jahaji</h1><p className="text-xs text-muted-foreground">{current}</p></header><div className="flex flex-1 flex-col overflow-hidden lg:flex-row"><aside className="shrink-0 overflow-x-auto border-b border-border bg-card p-3 lg:w-56 lg:overflow-y-auto lg:border-b-0 lg:border-r"><nav className="flex gap-1 lg:block lg:space-y-1">{nav.map(([path, label, Icon]) => <Link key={path} to={'/jahaji' + (path ? '/' + path : '')} className={'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-xs ' + (current === label ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted')}><Icon size={16}/>{label}</Link>)}<Link className="block px-2.5 py-3 text-xs text-muted-foreground" to="/admin">Easy Education</Link></nav></aside><main className="min-w-0 flex-1 overflow-y-auto p-4"><Routes><Route index element={<Overview/>}/>{['users', 'devices', 'plans'].map(kind => <Route key={kind} path={kind} element={<Records key={kind} kind={kind} access={access}/>}/>)}<Route path="releases" element={<JahajiReleases access={access}/>}/><Route path="staff" element={access.full ? <Records kind="staff" access={access}/> : <Navigate to="/jahaji" replace/>}/><Route path="*" element={<Navigate to="/jahaji" replace/>}/></Routes></main></div></div>
}
