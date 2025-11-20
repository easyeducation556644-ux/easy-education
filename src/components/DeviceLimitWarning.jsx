import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, LogOut } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'

export function DeviceLimitWarning({ warningInfo, onAutoLogout }) {
  const [timeRemaining, setTimeRemaining] = useState('')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [cleanupError, setCleanupError] = useState(null)
  
  useEffect(() => {
    if (!warningInfo || isLoggingOut || cleanupError) return
    
    let interval = null
    
    const performAutoLogout = async () => {
      if (isLoggingOut) return
      setIsLoggingOut(true)
      setTimeRemaining('Logging out...')
      
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      
      let retries = 3
      let cleanupSuccess = false
      let lastError = null
      
      while (retries > 0 && !cleanupSuccess) {
        try {
          if (onAutoLogout) {
            await onAutoLogout()
            cleanupSuccess = true
          } else {
            cleanupSuccess = true
          }
        } catch (error) {
          console.error(`Cleanup attempt failed (${4 - retries}/3):`, error)
          lastError = error
          retries--
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      }
      
      if (!cleanupSuccess) {
        console.error('Failed to cleanup device after 3 attempts')
        localStorage.removeItem('deviceWarning')
        setCleanupError({
          message: 'Failed to properly logout your device. Please log out manually and contact support.',
          error: lastError
        })
        return
      }
      
      try {
        await signOut(auth)
      } catch (error) {
        console.error('Sign out failed:', error)
      }
      
      window.location.reload()
    }
    
    const updateTimer = () => {
      const now = new Date()
      const expiresAt = new Date(warningInfo.expiresAt)
      const diff = expiresAt - now
      
      if (diff <= 0) {
        performAutoLogout()
        return
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)
      
      if (hours > 0) {
        setTimeRemaining(`${hours}ঘণ্টা ${minutes}মিনিট ${seconds}সেকেন্ড`)
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}মিনিট ${seconds}সেকেন্ড`)
      } else {
        setTimeRemaining(`${seconds}সেকেন্ড`)
      }
    }
    
    updateTimer()
    interval = setInterval(updateTimer, 1000)
    
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [warningInfo, onAutoLogout, isLoggingOut])
  
  if (!warningInfo || !warningInfo.showWarning) return null
  
  if (cleanupError) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-sm">
        <div className="max-w-2xl w-full mx-4 text-center space-y-8 animate-in fade-in duration-500">
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full" />
              <div className="relative bg-red-500/10 p-8 rounded-full border-2 border-red-500/50">
                <AlertTriangle className="w-24 h-24 text-red-500" strokeWidth={1.5} />
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-bold text-white">
              Logout Failed
            </h1>
            <p className="text-xl text-gray-300">
              লগআউট ব্যর্থ হয়েছে
            </p>
          </div>
          
          <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-6 backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-semibold text-red-400">Error / ত্রুটি</h3>
            </div>
            <p className="text-gray-200 text-base mb-4">{cleanupError.message}</p>
            <p className="text-sm text-gray-400">
              আপনার ডিভাইস সিস্টেম থেকে সঠিকভাবে সরানো যায়নি। অনুগ্রহ করে ম্যানুয়ালি লগআউট করুন এবং সাপোর্টের সাথে যোগাযোগ করুন।
            </p>
          </div>
          
          <button
            onClick={async () => {
              try {
                if (onAutoLogout) {
                  await onAutoLogout()
                }
                await signOut(auth)
                window.location.reload()
              } catch (error) {
                console.error('Manual logout failed:', error)
                alert('Manual logout also failed. Please contact support immediately. Error: ' + error.message)
              }
            }}
            className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 mx-auto"
          >
            <LogOut className="w-5 h-5" />
            Manual Logout / ম্যানুয়াল লগআউট
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-sm">
      <div className="max-w-2xl w-full mx-4 text-center space-y-8 animate-in fade-in duration-500">
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-orange-500/20 blur-3xl rounded-full animate-pulse" />
            <div className="relative bg-orange-500/10 p-8 rounded-full border-2 border-orange-500/50">
              <AlertTriangle className="w-24 h-24 text-orange-500" strokeWidth={1.5} />
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-white">
            ডিভাইস লিমিট সতর্কতা
          </h1>
          
          <p className="text-xl text-gray-300">
            Device Limit Warning
          </p>
        </div>
        
        <div className="bg-orange-950/50 border border-orange-500/30 rounded-lg p-6 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            <h3 className="text-lg font-semibold text-orange-400">সতর্কবার্তা / Warning</h3>
          </div>
          <div className="text-gray-200 text-lg space-y-2">
            <p className="font-semibold">আপনি ২য় ডিভাইস থেকে লগইন করেছেন!</p>
            <p className="text-base">You have logged in from a 2nd device!</p>
            <p className="text-sm text-gray-300 mt-3">
              আপনার সিস্টেমে সর্বোচ্চ ২টি ডিভাইস থেকে একসাথে লগইন করা যায়। 
              আপনি যদি তৃতীয় ডিভাইস থেকে লগইন করার চেষ্টা করেন বা এই কাউন্টডাউন শেষ হওয়ার আগে 
              লগআউট না করেন তাহলে আপনার অ্যাকাউন্ট ৩০ মিনিটের জন্য ব্যান হবে।
            </p>
          </div>
        </div>
        
        <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-6 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-red-400" />
            <h3 className="text-lg font-semibold text-red-400">অটো লগআউট / Auto Logout</h3>
          </div>
          <div className="text-4xl font-mono font-bold text-white tabular-nums mb-3">
            {timeRemaining}
          </div>
          <p className="text-sm text-gray-300">
            এই সময়ের মধ্যে স্বয়ংক্রিয়ভাবে লগআউট হবে
          </p>
        </div>
        
        <div className="pt-4 space-y-3 text-gray-400">
          <p className="text-sm">
            কাউন্টডাউন শেষ হলে আপনি স্বয়ংক্রিয়ভাবে লগআউট হয়ে যাবেন এবং ব্যান থেকে রক্ষা পাবেন।
          </p>
          <p className="text-sm">
            When the countdown ends, you will be automatically logged out and protected from ban.
          </p>
          
          <div className="flex items-center justify-center gap-2 mt-6">
            <LogOut className="w-4 h-4 text-gray-500" />
            <p className="text-xs text-gray-500">
              নিরাপদ থাকতে অপেক্ষা করুন বা ম্যানুয়ালি লগআউট করুন
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
