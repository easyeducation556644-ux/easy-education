"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Settings, Save, AlertCircle, Bell, BellOff, CheckCircle, Upload, Smartphone, Loader2 } from "lucide-react"
import { collection, getDocs, query, where, updateDoc, doc, setDoc, serverTimestamp } from "firebase/firestore"
import { db, auth } from "../../lib/firebase"
import { saveAdminFCMToken } from "../../lib/notifications"
import { requestNotificationPermission } from "../../lib/pwa"
import { uploadImageToImgBB } from "../../lib/imgbb"

export default function WebsiteSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [notificationStatus, setNotificationStatus] = useState('default')
  const [enablingNotifications, setEnablingNotifications] = useState(false)
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const [settings, setSettings] = useState({
    communityEnabled: true,
    paymentInstructions: "Please pay to 018XXXXXXXX via bKash",
    siteName: "Easy Education",
    siteDescription: "Learn from the best educators",
    appName: "Easy Education",
    appShortName: "EasyEdu",
    appIcon: "",
    appLogo: "",
    themeColor: "#0ea5e9",
    backgroundColor: "#ffffff",
  })

  useEffect(() => {
    fetchSettings()
    checkNotificationStatus()
  }, [])

  const checkNotificationStatus = () => {
    if ('Notification' in window) {
      setNotificationStatus(Notification.permission)
    }
  }

  const handleEnableNotifications = async () => {
    setEnablingNotifications(true)
    setErrorMessage("")
    
    try {
      const permission = await requestNotificationPermission()
      
      if (!permission) {
        setErrorMessage("Notification permission denied. Please enable notifications in your browser settings.")
        setNotificationStatus('denied')
        return
      }

      const userId = auth.currentUser?.uid
      if (!userId) {
        setErrorMessage("You must be logged in to enable notifications")
        return
      }

      const token = await saveAdminFCMToken(userId)
      
      if (token) {
        setSuccessMessage("Push notifications enabled successfully!")
        setNotificationStatus('granted')
        setTimeout(() => setSuccessMessage(""), 3000)
      } else {
        setErrorMessage("Failed to get notification token. Please try again.")
      }
    } catch (error) {
      console.error("Error enabling notifications:", error)
      setErrorMessage("Failed to enable notifications. Check console for details.")
    } finally {
      setEnablingNotifications(false)
    }
  }

  const fetchSettings = async () => {
    try {
      const settingsRef = collection(db, "settings")
      const snapshot = await getDocs(settingsRef)

      if (!snapshot.empty) {
        const settingsData = {}
        snapshot.docs.forEach((doc) => {
          const data = doc.data()
          if (data.type === "general") {
            settingsData.siteName = data.siteName || "Easy Education"
            settingsData.siteDescription = data.siteDescription || "Learn from the best educators"
            settingsData.communityEnabled = data.communityEnabled !== false
          } else if (data.type === "payment") {
            settingsData.paymentInstructions = data.instructions || "Please pay to 018XXXXXXXX via bKash"
          } else if (data.type === "pwa") {
            settingsData.appName = data.appName || "Easy Education"
            settingsData.appShortName = data.appShortName || "EasyEdu"
            settingsData.appIcon = data.appIcon || ""
            settingsData.appLogo = data.appLogo || ""
            settingsData.themeColor = data.themeColor || "#0ea5e9"
            settingsData.backgroundColor = data.backgroundColor || "#ffffff"
          }
        })
        setSettings((prev) => ({ ...prev, ...settingsData }))
      }
    } catch (error) {
      console.error("Error fetching settings:", error)
      setErrorMessage("Failed to load settings")
    } finally {
      setLoading(false)
    }
  }

  const handleIconUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingIcon(true)
    setErrorMessage("")
    
    try {
      const imageUrl = await uploadImageToImgBB(file)
      setSettings({ ...settings, appIcon: imageUrl })
      setSuccessMessage("App icon uploaded successfully!")
      setTimeout(() => setSuccessMessage(""), 3000)
    } catch (error) {
      console.error("Error uploading app icon:", error)
      setErrorMessage("Failed to upload app icon. Please try again.")
    } finally {
      setUploadingIcon(false)
    }
  }

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingLogo(true)
    setErrorMessage("")
    
    try {
      const imageUrl = await uploadImageToImgBB(file)
      setSettings({ ...settings, appLogo: imageUrl })
      setSuccessMessage("App logo uploaded successfully!")
      setTimeout(() => setSuccessMessage(""), 3000)
    } catch (error) {
      console.error("Error uploading app logo:", error)
      setErrorMessage("Failed to upload app logo. Please try again.")
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setErrorMessage("")
    setSuccessMessage("")

    try {
      const generalSettingsRef = query(collection(db, "settings"), where("type", "==", "general"))
      const generalSnapshot = await getDocs(generalSettingsRef)

      const generalData = {
        type: "general",
        siteName: settings.siteName,
        siteDescription: settings.siteDescription,
        communityEnabled: settings.communityEnabled,
        updatedAt: serverTimestamp(),
      }

      if (!generalSnapshot.empty) {
        await updateDoc(doc(db, "settings", generalSnapshot.docs[0].id), generalData)
      } else {
        await setDoc(doc(collection(db, "settings")), generalData)
      }

      const paymentSettingsRef = query(collection(db, "settings"), where("type", "==", "payment"))
      const paymentSnapshot = await getDocs(paymentSettingsRef)

      const paymentData = {
        type: "payment",
        instructions: settings.paymentInstructions,
        updatedAt: serverTimestamp(),
      }

      if (!paymentSnapshot.empty) {
        await updateDoc(doc(db, "settings", paymentSnapshot.docs[0].id), paymentData)
      } else {
        await setDoc(doc(collection(db, "settings")), paymentData)
      }

      const pwaSettingsRef = query(collection(db, "settings"), where("type", "==", "pwa"))
      const pwaSnapshot = await getDocs(pwaSettingsRef)

      const pwaData = {
        type: "pwa",
        appName: settings.appName,
        appShortName: settings.appShortName,
        appIcon: settings.appIcon,
        appLogo: settings.appLogo,
        themeColor: settings.themeColor,
        backgroundColor: settings.backgroundColor,
        updatedAt: serverTimestamp(),
      }

      if (!pwaSnapshot.empty) {
        await updateDoc(doc(db, "settings", pwaSnapshot.docs[0].id), pwaData)
      } else {
        await setDoc(doc(collection(db, "settings")), pwaData)
      }

      setSuccessMessage("Settings saved successfully! Please reload the page to see PWA changes take effect.")
      
      if (settings.appIcon || settings.appLogo || settings.appName || settings.themeColor) {
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      setErrorMessage("Failed to save settings. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Settings className="w-8 h-8 text-primary" />
          Website Settings
        </h1>
        <p className="text-muted-foreground">Configure your platform settings</p>
      </motion.div>

      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-600 dark:text-green-400 text-sm flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4" />
          {successMessage}
        </motion.div>
      )}

      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4" />
          {errorMessage}
        </motion.div>
      )}

      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        {/* General Settings */}
        <div>
          <h2 className="text-xl font-semibold mb-4">General Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Site Name</label>
              <input
                type="text"
                value={settings.siteName}
                onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Site Description</label>
              <textarea
                value={settings.siteDescription}
                onChange={(e) => setSettings({ ...settings, siteDescription: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition resize-none"
              />
            </div>
          </div>
        </div>

        {/* Feature Toggles */}
        <div className="border-t border-border pt-6">
          <h2 className="text-xl font-semibold mb-4">Features</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <h3 className="font-medium">Community Page</h3>
                <p className="text-sm text-muted-foreground">Enable or disable the community page for users</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.communityEnabled}
                  onChange={(e) => setSettings({ ...settings, communityEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Push Notifications */}
        <div className="border-t border-border pt-6">
          <h2 className="text-xl font-semibold mb-4">Push Notifications</h2>
          <div className="space-y-4">
            <div className="p-4 bg-muted/30 rounded-lg border border-border">
              <div className="flex items-start gap-3 mb-3">
                {notificationStatus === 'granted' ? (
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                ) : notificationStatus === 'denied' ? (
                  <BellOff className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <Bell className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <h3 className="font-medium mb-1">Admin Notifications</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Enable push notifications to receive alerts for new payments, user registrations, and important updates
                  </p>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium">Status:</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      notificationStatus === 'granted' 
                        ? 'bg-green-500/10 text-green-600 border border-green-500/20' 
                        : notificationStatus === 'denied'
                        ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                        : 'bg-orange-500/10 text-orange-600 border border-orange-500/20'
                    }`}>
                      {notificationStatus === 'granted' ? 'Enabled' : notificationStatus === 'denied' ? 'Blocked' : 'Not enabled'}
                    </span>
                  </div>
                  {notificationStatus !== 'granted' && (
                    <button
                      onClick={handleEnableNotifications}
                      disabled={enablingNotifications}
                      className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                    >
                      <Bell className="w-4 h-4" />
                      {enablingNotifications ? 'Enabling...' : 'Enable Notifications'}
                    </button>
                  )}
                  {notificationStatus === 'granted' && (
                    <p className="text-xs text-green-600 flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5" />
                      You'll receive push notifications for important updates
                    </p>
                  )}
                </div>
              </div>
              {notificationStatus === 'denied' && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-xs text-red-600">
                    <strong>Notifications blocked:</strong> To enable notifications, please allow them in your browser settings for this site.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* PWA Configuration */}
        <div className="border-t border-border pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Smartphone className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">App Configuration (PWA)</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            Configure how your platform appears when installed as an app on mobile devices
          </p>
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-xs text-blue-600 dark:text-blue-400">
              <strong>Note:</strong> After changing app icon, logo, or name, the page will automatically reload. Users may need to reinstall the app to see the new icon on their home screen.
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">App Name</label>
                <input
                  type="text"
                  value={settings.appName}
                  onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
                  placeholder="Easy Education"
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition"
                />
                <p className="text-xs text-muted-foreground mt-1">Full name displayed in the app</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">App Short Name</label>
                <input
                  type="text"
                  value={settings.appShortName}
                  onChange={(e) => setSettings({ ...settings, appShortName: e.target.value })}
                  placeholder="EasyEdu"
                  maxLength={12}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition"
                />
                <p className="text-xs text-muted-foreground mt-1">Short name for home screen (max 12 characters)</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Theme Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={settings.themeColor}
                    onChange={(e) => setSettings({ ...settings, themeColor: e.target.value })}
                    className="h-10 w-20 rounded-lg border border-border cursor-pointer"
                  />
                  <input
                    type="text"
                    value={settings.themeColor}
                    onChange={(e) => setSettings({ ...settings, themeColor: e.target.value })}
                    placeholder="#0ea5e9"
                    className="flex-1 px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Browser toolbar color on mobile</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Background Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={settings.backgroundColor}
                    onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                    className="h-10 w-20 rounded-lg border border-border cursor-pointer"
                  />
                  <input
                    type="text"
                    value={settings.backgroundColor}
                    onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                    placeholder="#ffffff"
                    className="flex-1 px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Splash screen background color</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">App Icon (512x512 recommended)</label>
                <div className="space-y-2">
                  {settings.appIcon && (
                    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border">
                      <img 
                        src={settings.appIcon} 
                        alt="App Icon" 
                        className="w-16 h-16 rounded-lg object-cover border border-border"
                      />
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">Current app icon</p>
                      </div>
                    </div>
                  )}
                  <label className="flex items-center justify-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer border border-border">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleIconUpload}
                      className="hidden"
                      disabled={uploadingIcon}
                    />
                    {uploadingIcon ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span className="text-sm">Upload Icon</span>
                      </>
                    )}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Used for app icon on home screen</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">App Logo (any size)</label>
                <div className="space-y-2">
                  {settings.appLogo && (
                    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border">
                      <img 
                        src={settings.appLogo} 
                        alt="App Logo" 
                        className="w-16 h-16 rounded-lg object-contain border border-border bg-white"
                      />
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">Current app logo</p>
                      </div>
                    </div>
                  )}
                  <label className="flex items-center justify-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer border border-border">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      disabled={uploadingLogo}
                    />
                    {uploadingLogo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span className="text-sm">Upload Logo</span>
                      </>
                    )}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Used for splash screen and branding</p>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Settings */}
        <div className="border-t border-border pt-6">
          <h2 className="text-xl font-semibold mb-4">Payment Settings</h2>
          <div>
            <label className="block text-sm font-medium mb-2">Payment Instructions</label>
            <textarea
              value={settings.paymentInstructions}
              onChange={(e) => setSettings({ ...settings, paymentInstructions: e.target.value })}
              rows={4}
              placeholder="Enter payment instructions for users..."
              className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary smooth-transition resize-none"
            />
            <p className="text-xs text-muted-foreground mt-2">
              These instructions will be displayed on the checkout page
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="border-t border-border pt-6 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 font-medium smooth-transition"
          >
            <Save className="w-5 h-5" />
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  )
}
