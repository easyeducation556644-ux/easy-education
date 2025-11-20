import { useEffect, useState } from 'react'
import { Ban, Clock, AlertTriangle } from 'lucide-react'

export function BanOverlay({ banInfo, onUnban }) {
  const [timeRemaining, setTimeRemaining] = useState('')
  
  useEffect(() => {
    if (!banInfo) return
    
    const updateTimer = () => {
      if (banInfo.type === 'permanent') {
        setTimeRemaining('Permanent')
        return
      }
      
      const now = new Date()
      const bannedUntil = banInfo.bannedUntil?.toDate ? banInfo.bannedUntil.toDate() : new Date(banInfo.bannedUntil)
      const diff = bannedUntil - now
      
      if (diff <= 0) {
        setTimeRemaining('Ban expired')
        if (onUnban) {
          setTimeout(() => onUnban(), 2000)
        }
        return
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)
      
      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`)
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s`)
      } else {
        setTimeRemaining(`${seconds}s`)
      }
    }
    
    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    
    return () => clearInterval(interval)
  }, [banInfo, onUnban])
  
  if (!banInfo || !banInfo.isBanned) return null
  
  const isPermanent = banInfo.type === 'permanent'
  
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-sm">
      <div className="max-w-2xl w-full mx-4 text-center space-y-8 animate-in fade-in duration-500">
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full animate-pulse" />
            <div className="relative bg-red-500/10 p-8 rounded-full border-2 border-red-500/50">
              <Ban className="w-24 h-24 text-red-500" strokeWidth={1.5} />
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-white">
            {isPermanent ? 'Account Permanently Banned' : 'Account Temporarily Banned'}
          </h1>
          
          <p className="text-xl text-gray-300">
            আপনার অ্যাকাউন্ট {isPermanent ? 'স্থায়ীভাবে' : 'সাময়িকভাবে'} নিষিদ্ধ করা হয়েছে
          </p>
        </div>
        
        {banInfo.reason && (
          <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-6 backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-semibold text-red-400">Ban Reason / নিষিদ্ধের কারণ</h3>
            </div>
            <p className="text-gray-200 text-lg">{banInfo.reason}</p>
          </div>
        )}
        
        {!isPermanent && (
          <div className="bg-orange-950/50 border border-orange-500/30 rounded-lg p-6 backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Clock className="w-5 h-5 text-orange-400" />
              <h3 className="text-lg font-semibold text-orange-400">Time Remaining / অবশিষ্ট সময়</h3>
            </div>
            <div className="text-4xl font-mono font-bold text-white tabular-nums">
              {timeRemaining}
            </div>
          </div>
        )}
        
        <div className="pt-4 space-y-3 text-gray-400">
          <p className="text-sm">
            {isPermanent 
              ? 'Your account has been permanently suspended. Please contact support for assistance.'
              : 'Please wait for the ban period to expire. The page will automatically reload when your ban is lifted.'}
          </p>
          <p className="text-sm">
            {isPermanent
              ? 'আপনার অ্যাকাউন্ট স্থায়ীভাবে স্থগিত করা হয়েছে। সহায়তার জন্য সাপোর্টের সাথে যোগাযোগ করুন।'
              : 'নিষেধাজ্ঞার সময়কাল শেষ হওয়ার জন্য অপেক্ষা করুন। আপনার নিষেধাজ্ঞা তুলে নেওয়া হলে পৃষ্ঠাটি স্বয়ংক্রিয়ভাবে পুনরায় লোড হবে।'}
          </p>
        </div>
        
        {banInfo.banCount && (
          <div className="pt-6 border-t border-gray-700">
            <p className="text-sm text-gray-500">
              Ban Count: {banInfo.banCount} | Device Limit Violations
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
