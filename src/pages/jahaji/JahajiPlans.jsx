import {useCallback, useEffect, useRef, useState} from 'react'
import {Link, useSearchParams} from 'react-router-dom'
import {useAuth} from '../../contexts/AuthContext'
import {jahajiRequest} from './JahajiDashboard'

export const FEATURE_LABELS = {download: 'Video downloads', watermark: 'Watermark', telegram: 'Telegram uploads', youtube: 'YouTube uploads', scan: 'Course scans', import: 'Local videos', account: 'Course accounts'}
export const planButton = 'inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50'
export const planInput = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm'
export const dateLabel = value => value ? new Date(value).toLocaleString('en-GB') : 'No expiry'

export async function fetchCatalog() {
  const response = await fetch('/api/jahaji?action=catalog')
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Could not load Jahaji plans')
  return data.plans
}

export function JahajiActivation({purchase, onUpdated}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const activate = async timing => {
    const question = timing === 'now'
      ? 'Activate this plan now? Your current plan will end immediately. Existing scheduled purchases will follow the new plan.'
      : 'Schedule this plan after your current and already scheduled plans finish?'
    if (!window.confirm(question)) return
    setBusy(true); setError('')
    try {
      const result = await jahajiRequest('activate', {orderId: purchase.orderId, timing})
      onUpdated(result.entitlement)
    } catch (e) {setError(e.message)} finally {setBusy(false)}
  }
  return <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
    <p className="text-sm font-medium">Choose when to activate {purchase.name}</p>
    <div className="flex flex-wrap gap-2"><button className={planButton} disabled={busy} onClick={() => void activate('now')}>Activate now</button><button className={planButton + ' bg-secondary text-secondary-foreground'} disabled={busy} onClick={() => void activate('after')}>After current plan ends</button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}

export default function JahajiPlans() {
  const {currentUser, signInWithGoogle} = useAuth()
  const [params] = useSearchParams()
  const [plans, setPlans] = useState([])
  const [mine, setMine] = useState({devices: [], purchases: []})
  const [deviceId, setDeviceId] = useState(params.get('device') || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  const reload = useCallback(async () => {
    const generation = ++request.current
    setLoading(true); setError('')
    setMine({devices: [], purchases: []})
    try {
      const [catalog, data] = await Promise.all([fetchCatalog(), currentUser ? jahajiRequest('mine') : null])
      if (generation !== request.current) return
      setPlans(catalog)
      if (currentUser) {
        setMine(data)
        setDeviceId(previous => data.devices.some(row => row.device.id === previous) ? previous : data.devices.find(row => !row.blocked)?.device.id || '')
      }
    } catch (e) {if (generation === request.current) setError(e.message)} finally {if (generation === request.current) setLoading(false)}
  }, [currentUser])
  useEffect(() => {void reload(); return () => {request.current++}}, [reload])
  const selected = mine.devices.find(row => row.device.id === deviceId)
  const toggleDevice = async (id, enabled) => {
    if (!window.confirm(enabled ? 'Enable this device?' : 'Disable this device? Its monthly usage and purchase history will be kept.')) return
    try {await jahajiRequest('device-access', {id, enabled}); await reload()} catch (e) {setError(e.message)}
  }
  return <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">
    <div><h1 className="text-3xl font-bold">Jahaji plans</h1><p className="mt-2 text-sm text-muted-foreground">Choose a plan for your computer. Feature allowances reset each month; buying a plan keeps the usage already recorded for that device.</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!currentUser ? <button className={planButton} onClick={() => void signInWithGoogle().catch(e => setError(e.message))}>Sign in with Easy Education</button> : <section className="rounded-xl border border-border bg-card p-5">
      <label className="block text-sm font-medium">Your computer<select className={planInput} value={deviceId} onChange={e => setDeviceId(e.target.value)}><option value="">Choose a connected device</option>{mine.devices.map(row => <option key={row.device.id} value={row.device.id} disabled={row.blocked || row.device.banned}>{row.device.name} · {row.plan.name}{row.blocked ? ' · Blocked' : ''}</option>)}</select></label>
      {!loading && !mine.devices.length && <p className="mt-3 text-sm text-muted-foreground">Open Jahaji on your computer and use Sign in to connect that device to this account.</p>}
      {selected && <p className="mt-3 text-sm">Current plan · <b>{selected.plan.name}</b>{selected.plan.id !== 'free' && ` · ${dateLabel(selected.device.planExpiresAt)}`}</p>}
      {selected?.scheduled?.map(row => <p key={row.startsAt} className="mt-2 text-xs text-muted-foreground">Scheduled · {row.name} · {dateLabel(row.startsAt)} → {dateLabel(row.expiresAt)}</p>)}
    </section>}
    {currentUser && mine.devices.length > 0 && <section className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Your devices · {mine.devices[0].slots?.used ?? mine.devices.length}/{mine.devices[0].slots?.limit === -1 ? 'Unlimited' : mine.devices[0].slots?.limit ?? 1}</h2>{mine.devices.map(row => <div key={row.device.id} className="flex items-center justify-between gap-3 text-sm"><div><b>{row.device.name}</b><p className="text-xs text-muted-foreground">{row.device.accountDisabled ? 'Disabled' : row.device.allowed === false ? 'Over device limit' : 'Enabled'}</p></div><button className={planButton} disabled={row.blocked} onClick={() => void toggleDevice(row.device.id, !!row.device.accountDisabled)}>{row.device.accountDisabled ? 'Enable' : 'Disable'}</button></div>)}</section>}
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{plans.map(plan => <section key={plan.id} className="flex flex-col rounded-xl border border-border bg-card p-6">
      <h2 className="text-xl font-semibold">{plan.name}</h2><p className="my-4"><b className="text-3xl">৳{plan.price}</b><span className="text-sm text-muted-foreground"> / {plan.durationDays} days</span></p>
      <p className="mb-4 text-sm">{plan.deviceLimit === -1 ? 'Unlimited devices' : `${plan.deviceLimit ?? 1} device(s) per account`}</p>
      <ul className="mb-5 flex-1 space-y-2 text-sm">{Object.entries(FEATURE_LABELS).map(([key, label]) => <li key={key} className="flex justify-between gap-3"><span>{label}</span><b>{plan.limits[key] === -1 ? 'Unlimited' : plan.limits[key] === 0 ? 'Not included' : `${plan.limits[key]} / month`}</b></li>)}</ul>
      <p className="mb-4 text-xs text-muted-foreground">Download sites · {plan.sites.join(', ')}</p>
      {currentUser && selected && !selected.blocked ? <Link className={planButton} to={`/jahaji-checkout?plan=${encodeURIComponent(plan.id)}&device=${encodeURIComponent(deviceId)}`}>Buy plan</Link> : <span className="text-sm text-muted-foreground">{currentUser ? 'Connect and select your device to buy' : 'Sign in to buy'}</span>}
    </section>)}</div>
    {!loading && !plans.length && <p className="text-muted-foreground">No plans are currently on sale.</p>}
    {mine.purchases.length > 0 && <section className="space-y-3"><h2 className="text-xl font-semibold">Your purchases</h2>{mine.purchases.map(purchase => <div key={purchase.id} className="space-y-3 rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><b>{purchase.name}</b><span className="text-sm">৳{purchase.amount} · {purchase.status === 'fulfilled' ? 'Paid' : purchase.status}</span></div><p className="text-sm text-muted-foreground">{purchase.deviceName}</p>
      {purchase.entitlement?.state === 'choice_required' ? <JahajiActivation purchase={{...purchase.entitlement, orderId: purchase.id}} onUpdated={() => void reload()}/> : purchase.entitlement ? <p className="text-sm">{purchase.entitlement.state === 'scheduled' ? 'Scheduled' : 'Activated'} · {dateLabel(purchase.entitlement.startsAt)} → {dateLabel(purchase.entitlement.expiresAt)}</p> : <Link className="text-sm text-primary" to={'/checkout-complete?order_id=' + purchase.id}>Check payment</Link>}
    </div>)}</section>}
  </div>
}
