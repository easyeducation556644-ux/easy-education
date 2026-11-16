import {useEffect, useState} from 'react'
import {Link, useSearchParams} from 'react-router-dom'
import {useAuth} from '../../contexts/AuthContext'
import {jahajiRequest} from './JahajiDashboard'
import {fetchCatalog, planButton, planInput} from './JahajiPlans'

export default function JahajiCheckout() {
  const {currentUser, userProfile, signInWithGoogle} = useAuth()
  const [params] = useSearchParams()
  const planId = params.get('plan'), deviceId = params.get('device')
  const [plan, setPlan] = useState(null)
  const [device, setDevice] = useState(null)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setPlan(null); setDevice(null); setError('')
    if (!currentUser) return
    Promise.all([fetchCatalog(), jahajiRequest('mine')]).then(([plans, mine]) => {
      if (!active) return
      const selected = plans.find(row => row.id === planId)
      const computer = mine.devices.find(row => row.device.id === deviceId)
      if (!selected || !computer || computer.blocked) {setError('Select an available plan and a connected device.'); return}
      setPlan(selected); setDevice(computer); setName(userProfile?.name || currentUser.displayName || '')
      setPhone(userProfile?.phone || '')
    }).catch(e => {if (active) setError(e.message)})
    return () => {active = false}
  }, [currentUser, userProfile?.name, userProfile?.phone, planId, deviceId])
  const pay = async event => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const body = {fullname: name, email: currentUser.email, amount: plan.price,
        metadata: {product: 'jahaji', planId, deviceId, mobileNumber: phone}}
      const fingerprint = JSON.stringify({uid: currentUser.uid, ...body})
      let attempt
      try {attempt = JSON.parse(sessionStorage.getItem('jahaji-payment-attempt') || 'null')} catch {}
      if (!attempt || attempt.fingerprint !== fingerprint) attempt = {fingerprint, key: crypto.randomUUID()}
      sessionStorage.setItem('jahaji-payment-attempt', JSON.stringify(attempt))
      const response = await fetch('/api/create-payment', {method: 'POST', headers: {
        Authorization: 'Bearer ' + await currentUser.getIdToken(), 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key,
      }, body: JSON.stringify(body)})
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not start checkout')
      sessionStorage.setItem('jahaji-pending-order', result.order_id)
      window.location.assign(result.payment_url)
    } catch (e) {setError(e.message); setBusy(false)}
  }
  return <div className="mx-auto my-12 max-w-xl space-y-5 px-4"><h1 className="text-2xl font-bold">Jahaji checkout</h1>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!currentUser ? <button className={planButton} onClick={() => void signInWithGoogle().catch(e => setError(e.message))}>Sign in with Easy Education</button> : !plan || !device ? <p>Select a plan from <Link className="text-primary" to="/jahaji-plans">Jahaji plans</Link>.</p> : <form className="space-y-4 rounded-xl border border-border bg-card p-6" onSubmit={pay}>
      <h2 className="text-xl font-semibold">{plan.name}</h2><p className="text-sm text-muted-foreground">{device.device.name} · {plan.durationDays} days</p>
      <p className="text-2xl font-bold">৳{plan.price}</p>
      <label className="block text-sm">Full name<input className={planInput} value={name} maxLength={120} required onChange={e => setName(e.target.value)}/></label>
      <label className="block text-sm">Mobile number<input className={planInput} type="tel" pattern="(88)?01[3-9][0-9]{8}" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="01XXXXXXXXX"/></label>
      <p className="text-xs text-muted-foreground">{device.plan.id === 'free' ? 'Your plan starts after payment is verified.' : 'After payment, choose Activate now or After current plan ends.'} Monthly device usage is kept. This payment covers the selected term.</p>
      <button className={planButton + ' w-full'} disabled={busy}>{busy ? 'Opening payment…' : `Continue to payment · ৳${plan.price}`}</button>
    </form>}
  </div>
}
