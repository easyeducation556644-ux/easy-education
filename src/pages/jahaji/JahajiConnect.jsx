import {useState} from 'react'
import {Link, useSearchParams} from 'react-router-dom'
import {useAuth} from '../../contexts/AuthContext'
import {jahajiRequest} from './JahajiDashboard'

export default function JahajiConnect() {
  const {currentUser, signInWithGoogle} = useAuth()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const code = params.get('code') || ''
  const connect = async () => {
    setBusy(true); setMessage('')
    try {
      if (!currentUser) await signInWithGoogle()
      await jahajiRequest('link', {code})
      setDone(true); setMessage('Jahaji is connected. You can return to the desktop app.')
    } catch (e) {setMessage(e.message)} finally {setBusy(false)}
  }
  return <div className="mx-auto my-16 max-w-md rounded-xl border border-border bg-card p-6"><h1 className="text-xl font-bold">Connect Jahaji</h1><p className="my-4 text-sm text-muted-foreground">Connect this device to your Easy Education account. Your existing monthly usage will be kept.</p>{currentUser && <p className="mb-4 text-sm">{currentUser.displayName || currentUser.email}</p>}{message && <p role="status" className="my-3 text-sm">{message}</p>}{!done && <button className="w-full rounded-lg bg-primary px-4 py-2.5 text-primary-foreground disabled:opacity-50" disabled={busy || !/^[a-f0-9]{64}$/.test(code)} onClick={() => void connect()}>{busy ? 'Connecting…' : currentUser ? 'Connect this account' : 'Sign in with Google'}</button>}<Link to="/" className="mt-4 block text-center text-sm">Easy Education</Link></div>
}
