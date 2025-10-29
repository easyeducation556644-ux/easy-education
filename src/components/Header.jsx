"use client"

import { useState, useEffect, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  Menu,
  X,
  User,
  LogOut,
  LayoutDashboard,
  Sun,
  Moon,
  Search,
  Home,
  BookOpen,
  Newspaper,
  Users,
  Download,
  CreditCard,
  BarChart3,
} from "lucide-react"
import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"
import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "../lib/firebase"

// CRITICAL: Define deferredPrompt at module level to capture event early
let deferredPrompt = null
let isInstallListenerSet = false

export default function Header() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const { currentUser, userProfile, signOut, isAdmin } = useAuth()
  const { theme, toggleTheme, isDark } = useTheme()
  const navigate = useNavigate()
  const searchRef = useRef(null)
  const [communityEnabled, setCommunityEnabled] = useState(true)
  const [showInstallButton, setShowInstallButton] = useState(false)
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [canInstall, setCanInstall] = useState(false)

  // Set up beforeinstallprompt listener IMMEDIATELY (before any other effects)
  useEffect(() => {
    if (isInstallListenerSet) return

    const handleBeforeInstallPrompt = (e) => {
      console.log('✅ beforeinstallprompt fired!')
      e.preventDefault()
      deferredPrompt = e
      setCanInstall(true)
      
      // Check if already dismissed
      const dismissed = localStorage.getItem('pwaInstallDismissed')
      const dismissTime = dismissed ? parseInt(dismissed) : 0
      const daysSinceDismiss = (Date.now() - dismissTime) / (1000 * 60 * 60 * 24)
      
      if (!dismissed || daysSinceDismiss >= 7) {
        setShowInstallButton(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    isInstallListenerSet = true

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (!db) {
          console.warn(" Firebase not available, skipping settings fetch")
          return
        }
        const settingsQuery = query(collection(db, "settings"), where("type", "==", "general"))
        const snapshot = await getDocs(settingsQuery)
        if (!snapshot.empty) {
          const settings = snapshot.docs[0].data()
          setCommunityEnabled(settings.communityEnabled !== false)
        }
      } catch (error) {
        console.error(" Error fetching settings:", error)
      }
    }
    fetchSettings()
  }, [])

  useEffect(() => {
    const checkIfInstalled = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      const isIOSStandalone = window.navigator.standalone === true
      return isStandalone || isIOSStandalone
    }

    const checkIsIOS = () => {
      const isIOSUserAgent = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
      const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints >= 1
      return isIOSUserAgent || isIPadOS
    }

    const checkInIframe = () => {
      return window.self !== window.top
    }

    const iosDevice = checkIsIOS()
    setIsIOS(iosDevice)
    
    const isInstalled = checkIfInstalled()

    console.log('🔍 PWA Install Debug:', {
      isIOS: iosDevice,
      isInstalled: isInstalled,
      inIframe: checkInIframe(),
      hasLocalStorageDismiss: !!localStorage.getItem('pwaInstallDismissed'),
      deferredPromptExists: !!deferredPrompt
    })

    // If already installed, hide button and clear dismiss flag for future use
    if (isInstalled) {
      console.log('✅ App is already installed - hiding install button')
      setShowInstallButton(false)
      localStorage.removeItem('pwaInstallDismissed')
      return
    }

    // Check dismiss status - only hide for 1 hour instead of 7 days
    const dismissed = localStorage.getItem('pwaInstallDismissed')
    const dismissTime = dismissed ? parseInt(dismissed) : 0
    const hoursSinceDismiss = (Date.now() - dismissTime) / (1000 * 60 * 60)
    
    // For iOS, show button if not installed
    if (iosDevice) {
      if (!dismissed || hoursSinceDismiss >= 1) {
        console.log('📱 Showing iOS install button')
        setTimeout(() => {
          setShowInstallButton(true)
        }, 1000)
      } else {
        console.log('⏰ Install button dismissed recently, will show again in 1 hour')
      }
    }

    // For non-iOS devices: show button after delay if not dismissed
    // This ensures the button appears even in iframes or if beforeinstallprompt doesn't fire
    if (!iosDevice) {
      if (!dismissed || hoursSinceDismiss >= 1) {
        console.log('📱 Showing install button (non-iOS)')
        // Wait brief moment to give beforeinstallprompt a chance to fire first
        setTimeout(() => {
          if (!deferredPrompt) {
            console.log('🔔 No beforeinstallprompt received - showing button anyway')
          }
          console.log('🎯 Setting showInstallButton to TRUE')
          setShowInstallButton(true)
        }, 1000)
      } else {
        console.log('⏰ Install button dismissed recently, will show again in 1 hour')
      }
    }
    
    // Add window function for manual reset (accessible via browser console)
    window.resetPWAInstall = handleResetInstallPrompt

    // Listen for successful installation
    const handleAppInstalled = () => {
      console.log('✅ PWA was installed')
      setShowInstallButton(false)
      setShowInstallModal(false)
      localStorage.removeItem('pwaInstallDismissed')
      deferredPrompt = null
    }
    
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
      setSidebarOpen(false)
      navigate("/")
    } catch (error) {
      console.error("Sign out error:", error)
    }
  }

  const handleInstallClick = () => {
    console.log('📱 Install button clicked, deferredPrompt:', !!deferredPrompt)
    setShowInstallModal(true)
  }

  const handleInstallConfirm = async () => {
    if (!deferredPrompt) {
      console.log('❌ No deferred prompt available - showing manual instructions')
      // Keep modal open to show manual instructions
      return
    }

    try {
      console.log('📱 Showing install prompt...')
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      console.log(`User response to install prompt: ${outcome}`)
      
      if (outcome === 'accepted') {
        console.log('✅ User accepted the install prompt')
        setShowInstallButton(false)
        setShowInstallModal(false)
      } else {
        console.log('❌ User dismissed the install prompt')
        setShowInstallModal(false)
      }
    } catch (error) {
      console.error('Error showing install prompt:', error)
      setShowInstallModal(false)
    } finally {
      deferredPrompt = null
    }
  }

  const handleOpenInNewTab = () => {
    const currentUrl = window.location.origin
    window.open(currentUrl, '_blank')
  }

  const handleInstallDismiss = () => {
    // Don't save dismiss permanently - just close the modal
    // This allows users to reinstall anytime they want
    setShowInstallModal(false)
    setShowInstallButton(false)
    
    // Set a short-term dismiss (only for current session or 1 hour)
    const dismissedAt = Date.now()
    localStorage.setItem('pwaInstallDismissed', dismissedAt.toString())
  }
  
  const handleResetInstallPrompt = () => {
    // Manual reset function for debugging
    localStorage.removeItem('pwaInstallDismissed')
    setShowInstallButton(true)
    console.log('✅ Install prompt reset - button will show again')
  }

  const handleSearch = (e) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/courses?search=${encodeURIComponent(searchQuery)}`)
      setSearchOpen(false)
      setSearchQuery("")
    }
  }

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchOpen(false)
      }
    }

    if (searchOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [searchOpen])

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }

    return () => {
      document.body.style.overflow = "unset"
    }
  }, [sidebarOpen])

  const navLinks = [
    { name: "Home", path: "/", icon: Home },
    { name: "Courses", path: "/courses", icon: BookOpen },
    { name: "Announcements", path: "/announcements", icon: Newspaper },
    ...(communityEnabled ? [{ name: "Community", path: "/community", icon: Users }] : []),
  ]

  return (
    <>
      <header className="sticky top-0 z-50 dark:bg-black/95 backdrop-blur-xl border-b border-border/50">
        <nav className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:flex-1">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 hover:bg-primary/10 rounded-lg smooth-transition hover:scale-105 active:scale-95"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5 sm:w-6 sm:h-6 text-foreground" />
              </button>

              <Link to="/" className="flex items-center">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="text-xl sm:text-2xl font-bold dark:text-white"
                >
                  Easy Education
                </motion.div>
              </Link>
            </div>

            <nav className="hidden lg:flex items-center gap-1 justify-center lg:flex-1">
              {navLinks.map((link) => {
                const Icon = link.icon
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-primary/10 transition-colors font-medium text-sm"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{link.name}</span>
                  </Link>
                )
              })}
            </nav>

            <div className="flex items-center gap-2 lg:flex-1 justify-end">
              {showInstallButton && (
                <button
                  onClick={handleInstallClick}
                  className="p-2 hover:bg-primary/10 rounded-lg smooth-transition hover:scale-105 active:scale-95"
                  aria-label="Install App"
                  title="Install App"
                >
                  <Download className="w-5 h-5 text-primary animate-bounce" />
                </button>
              )}
              
              
              <div className="relative" ref={searchRef}>
                <button
                  onClick={() => setSearchOpen(!searchOpen)}
                  className="p-2 hover:bg-primary/10 rounded-lg smooth-transition hover:scale-105 active:scale-95"
                  aria-label="Search"
                >
                  <Search className="w-5 h-5 text-foreground" />
                </button>

                <AnimatePresence>
                  {searchOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-20 sm:top-full sm:mt-2 w-auto sm:w-96 bg-card border border-primary/30 rounded-xl shadow-2xl glow-pink p-4 z-50"
                    >
                      <form onSubmit={handleSearch} className="w-full">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search courses..."
                            className="w-full pl-10 pr-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-foreground placeholder:text-muted-foreground text-sm smooth-transition"
                            autoFocus
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full mt-3 px-4 py-2 bg-gradient-pink-purple text-white rounded-lg hover:opacity-90 smooth-transition font-medium"
                        >
                          Search
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {currentUser ? (
                <>
                  <Link
                    to={isAdmin ? "/admin" : "/dashboard"}
                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white dark:text-black rounded-lg smooth-transition text-sm font-medium hover:scale-105 active:scale-95"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Dashboard
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg smooth-transition text-sm font-medium hover:scale-105 active:scale-95"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="hidden sm:block px-4 py-2 bg-primary hover:bg-primary/90 text-white dark:text-black rounded-lg smooth-transition text-sm font-medium hover:scale-105 active:scale-95"
                >
                  Login
                </Link>
              )}

              <button
                onClick={toggleTheme}
                className="p-2 hover:bg-primary/10 rounded-lg smooth-transition hover:scale-105 active:scale-95"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun className="w-5 h-5 text-foreground" /> : <Moon className="w-5 h-5 text-foreground" />}
              </button>
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile Sidebar - Keep existing code */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/80 z-50 backdrop-blur-sm"
            />

            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 w-full sm:w-80 bg-card border-r border-border z-50 overflow-y-auto"
            >
              {/* Keep all existing sidebar content */}
              <div className="flex items-center justify-between p-4 border-b border-border/50 bg-primary/5">
                <Link to="/" onClick={() => setSidebarOpen(false)}>
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="text-2xl font-bold text-white"
                  >
                    Easy Education
                  </motion.div>
                </Link>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 hover:bg-muted rounded-lg smooth-transition hover:scale-105 active:scale-95"
                  aria-label="Close menu"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {currentUser && (
                <div className="p-4 border-b border-border/50 bg-primary/5">
                  <div className="flex items-center gap-3">
                    {userProfile?.photoURL ? (
                      <img
                        src={userProfile.photoURL || "/placeholder.svg"}
                        alt={userProfile.name}
                        className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/50"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-blue-purple flex items-center justify-center ring-2 ring-primary/50">
                        <User className="w-6 h-6 text-white" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{userProfile?.name || "User"}</p>
                      <p className="text-sm text-muted-foreground truncate">{userProfile?.email}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-4 space-y-1">
                {navLinks.map((link) => {
                  const Icon = link.icon
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-primary/10 smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                    >
                      <Icon className="w-5 h-5 text-muted-foreground group-hover:text-primary smooth-transition" />
                      <span className="font-medium group-hover:text-primary smooth-transition">{link.name}</span>
                    </Link>
                  )
                })}
              </div>

              {currentUser && (
                <div className="p-4 border-t border-border/50 space-y-1">
                  <Link
                    to={isAdmin ? "/admin" : "/dashboard"}
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-primary/10 smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <LayoutDashboard className="w-5 h-5 text-muted-foreground group-hover:text-primary smooth-transition" />
                    <span className="font-medium group-hover:text-primary smooth-transition">Dashboard</span>
                  </Link>
                  <Link
                    to="/my-courses"
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-primary/10 smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <BookOpen className="w-5 h-5 text-muted-foreground group-hover:text-primary smooth-transition" />
                    <span className="font-medium group-hover:text-primary smooth-transition">My Courses</span>
                  </Link>
                  {!isAdmin && (
                    <>
                      <Link
                        to="/payment-history"
                        onClick={() => setSidebarOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-primary/10 smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <CreditCard className="w-5 h-5 text-muted-foreground group-hover:text-primary smooth-transition" />
                        <span className="font-medium group-hover:text-primary smooth-transition">Payment History</span>
                      </Link>
                      <Link
                        to="/analytics"
                        onClick={() => setSidebarOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-primary/10 smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <BarChart3 className="w-5 h-5 text-muted-foreground group-hover:text-primary smooth-transition" />
                        <span className="font-medium group-hover:text-primary smooth-transition">Analytics</span>
                      </Link>
                    </>
                  )}
                  <Link
                    to="/profile"
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-primary/10 smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <User className="w-5 h-5 text-muted-foreground group-hover:text-primary smooth-transition" />
                    <span className="font-medium group-hover:text-primary smooth-transition">Profile</span>
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-destructive/10 hover:text-destructive smooth-transition group hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <LogOut className="w-5 h-5" />
                    <span className="font-medium">Sign Out</span>
                  </button>
                </div>
              )}

              {!currentUser && (
                <div className="p-4 border-t border-border/50 space-y-2">
                  <Link
                    to="/login"
                    onClick={() => setSidebarOpen(false)}
                    className="block w-full px-4 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg smooth-transition text-center font-medium hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Login
                  </Link>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Install Modal */}
      <AnimatePresence>
        {showInstallModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:p-4 sm:items-center"
            onClick={handleInstallDismiss}
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
                  onClick={handleInstallDismiss}
                  className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-muted transition-colors sm:top-4 sm:right-4"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col sm:items-center sm:text-center">
                  <div className="flex items-center gap-3 mb-3 sm:flex-col sm:gap-2">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-primary to-blue-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                      <Download className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
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
                      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg text-left space-y-3">
                        <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          📱 iPhone/iPad এ App Install করার নিয়ম:
                        </p>
                        <ol className="text-sm space-y-2.5 text-foreground">
                          <li className="flex items-start gap-3">
                            <span className="font-bold text-blue-600 dark:text-blue-400 text-base flex-shrink-0">১.</span>
                            <span>সবার নিচে <strong className="text-blue-600 dark:text-blue-400">Share বাটন</strong> খুঁজুন (□↑ এই আইকন)</span>
                          </li>
                          <li className="flex items-start gap-3">
                            <span className="font-bold text-blue-600 dark:text-blue-400 text-base flex-shrink-0">২.</span>
                            <span>নিচের দিকে scroll করে <strong className="text-blue-600 dark:text-blue-400">"Add to Home Screen"</strong> অপশন খুঁজুন</span>
                          </li>
                          <li className="flex items-start gap-3">
                            <span className="font-bold text-blue-600 dark:text-blue-400 text-base flex-shrink-0">৩.</span>
                            <span>উপরে ডানপাশে <strong className="text-blue-600 dark:text-blue-400">"Add"</strong> বাটনে ট্যাপ করুন</span>
                          </li>
                        </ol>
                        <div className="pt-2 border-t border-blue-500/20">
                          <p className="text-xs text-blue-600 dark:text-blue-400">
                            ✅ এরপর আপনার Home Screen এ App icon দেখতে পাবেন
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleInstallDismiss}
                        className="w-full py-3 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium text-sm"
                      >
                        বুঝেছি
                      </button>
                    </div>
                  ) : (
                    <div className="w-full space-y-2">
                      {deferredPrompt ? (
                        <button
                          onClick={handleInstallConfirm}
                          className="w-full py-3 px-4 bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 text-white rounded-lg transition-all font-medium flex items-center justify-center gap-2 text-sm shadow-lg hover:shadow-xl"
                        >
                          <Download className="w-4 h-4" />
                          এখনই Install করুন
                        </button>
                      ) : (
                        <>
                          {window.self !== window.top && (
                            <button
                              onClick={handleOpenInNewTab}
                              className="w-full py-3 px-4 bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 text-white rounded-lg transition-all font-medium flex items-center justify-center gap-2 text-sm shadow-lg hover:shadow-xl"
                            >
                              <Download className="w-4 h-4" />
                              নতুন Tab এ খুলুন
                            </button>
                          )}
                          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-3">
                            <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                              📱 Android Phone এ App Install করার নিয়ম:
                            </p>
                            <ol className="text-sm space-y-2.5 text-foreground">
                              <li className="flex items-start gap-3">
                                <span className="font-bold text-blue-600 dark:text-blue-400 text-base flex-shrink-0">১.</span>
                                <span>Browser এর উপরে ডান কোণায় <strong className="text-blue-600 dark:text-blue-400">তিন বিন্দু (⋮)</strong> বা <strong className="text-blue-600 dark:text-blue-400">তিন লাইন (≡)</strong> মেনুতে ক্লিক করুন</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <span className="font-bold text-blue-600 dark:text-blue-400 text-base flex-shrink-0">২.</span>
                                <div className="flex-1">
                                  <p><strong className="text-blue-600 dark:text-blue-400">"Add to Home Screen"</strong> অপশন খুঁজুন</p>
                                  <p className="text-xs mt-1 text-muted-foreground">(Chrome: "Install App" / "Add to Home Screen")</p>
                                  <p className="text-xs text-muted-foreground">(Firefox: "Install" / "Add to Home Screen")</p>
                                </div>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="font-bold text-blue-600 dark:text-blue-400 text-base flex-shrink-0">৩.</span>
                                <span>পপআপে <strong className="text-blue-600 dark:text-blue-400">"Install"</strong> বা <strong className="text-blue-600 dark:text-blue-400">"Add"</strong> বাটনে ক্লিক করুন</span>
                              </li>
                            </ol>
                            <div className="pt-2 border-t border-blue-500/20 space-y-1">
                              <p className="text-xs text-blue-600 dark:text-blue-400">
                                ✅ সফলভাবে install হলে আপনার Home Screen এ App icon দেখতে পাবেন
                              </p>
                              <p className="text-xs text-blue-600 dark:text-blue-400">
                                💡 <strong>Best Browser:</strong> Chrome, Edge, বা Samsung Internet
                              </p>
                            </div>
                          </div>
                        </>
                      )}
                      <button
                        onClick={handleInstallDismiss}
                        className="w-full py-2.5 px-4 bg-muted/50 hover:bg-muted text-foreground rounded-lg transition-colors font-medium text-sm"
                      >
                        পরে করব
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}