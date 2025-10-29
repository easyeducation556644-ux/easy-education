import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Download, Smartphone } from "lucide-react"

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      
      const dismissed = localStorage.getItem('pwaInstallDismissed')
      if (!dismissed) {
        setTimeout(() => setShowPrompt(true), 3000)
      }
    }

    const checkIfInstalled = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      const isIOSStandalone = window.navigator.standalone === true
      return isStandalone || isIOSStandalone
    }

    const checkIsIOS = () => {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    }

    setIsIOS(checkIsIOS())

    if (checkIfInstalled()) {
      return
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    if (checkIsIOS() && !checkIfInstalled()) {
      const dismissed = localStorage.getItem('pwaInstallDismissed')
      if (!dismissed) {
        setTimeout(() => setShowPrompt(true), 3000)
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt && !isIOS) {
      return
    }

    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      console.log(`User response to install prompt: ${outcome}`)
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt')
      }
      
      setDeferredPrompt(null)
      setShowPrompt(false)
    }
  }

  const handleDismiss = () => {
    const dismissedAt = Date.now()
    localStorage.setItem('pwaInstallDismissed', dismissedAt.toString())
    setShowPrompt(false)
  }

  useEffect(() => {
    const checkDismissal = () => {
      const lastDismissed = localStorage.getItem('pwaInstallDismissed')
      if (lastDismissed) {
        const daysSince = (Date.now() - parseInt(lastDismissed)) / (1000 * 60 * 60 * 24)
        if (daysSince >= 7) {
          localStorage.removeItem('pwaInstallDismissed')
        }
      }
    }
    checkDismissal()
  }, [])

  if (!showPrompt) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:p-4 sm:items-center"
        onClick={handleDismiss}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-card border-t sm:border border-border sm:rounded-2xl rounded-t-3xl shadow-2xl max-w-md w-full overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative p-4 sm:p-6">
            <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-4 sm:hidden" />
            
            <button
              onClick={handleDismiss}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-muted transition-colors sm:top-4 sm:right-4"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col sm:items-center sm:text-center">
              <div className="flex items-center gap-3 mb-3 sm:flex-col sm:gap-2">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg sm:text-xl font-bold mb-0.5">Install Easy Education</h2>
                  <p className="text-sm text-muted-foreground">
                    Quick access & offline learning
                  </p>
                </div>
              </div>

              <div className="w-full space-y-2 mb-4 sm:mb-5">
                <div className="flex items-center gap-2.5 text-xs sm:text-sm text-left p-2.5 bg-muted/50 rounded-lg">
                  <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-xs">✓</span>
                  </div>
                  <span>Launch from home screen</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs sm:text-sm text-left p-2.5 bg-muted/50 rounded-lg">
                  <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-xs">✓</span>
                  </div>
                  <span>Works without internet</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs sm:text-sm text-left p-2.5 bg-muted/50 rounded-lg">
                  <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-xs">✓</span>
                  </div>
                  <span>No app store needed</span>
                </div>
              </div>

              {isIOS ? (
                <div className="w-full space-y-3">
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-left">
                    <p className="text-xs font-semibold mb-2">How to install on iOS:</p>
                    <ol className="text-xs space-y-1 text-muted-foreground">
                      <li>1. Tap the <strong>Share</strong> button (square with arrow)</li>
                      <li>2. Scroll and tap <strong>"Add to Home Screen"</strong></li>
                      <li>3. Tap <strong>Add</strong></li>
                    </ol>
                  </div>
                  <button
                    onClick={handleDismiss}
                    className="w-full py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium text-sm"
                  >
                    Got it
                  </button>
                </div>
              ) : deferredPrompt ? (
                <div className="w-full space-y-2">
                  <button
                    onClick={handleInstallClick}
                    className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-all font-medium flex items-center justify-center gap-2 text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Install App
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="w-full py-2.5 px-4 bg-muted/50 hover:bg-muted text-foreground rounded-lg transition-colors font-medium text-sm"
                  >
                    Not now
                  </button>
                </div>
              ) : (
                <div className="w-full space-y-2">
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-left">
                    <p className="text-xs font-semibold mb-2">How to install on Android/Desktop:</p>
                    <ol className="text-xs space-y-1 text-muted-foreground">
                      <li>1. Click the <strong>three dots menu</strong> (⋮) in your browser</li>
                      <li>2. Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></li>
                      <li>3. Click <strong>Install</strong></li>
                    </ol>
                  </div>
                  <button
                    onClick={handleDismiss}
                    className="w-full py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium text-sm"
                  >
                    Got it
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
