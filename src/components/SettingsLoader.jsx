import { useEffect } from "react"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"

export default function SettingsLoader() {
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settingsRef = collection(db, "settings")
        const snapshot = await getDocs(settingsRef)

        let appName = "Easy Education"
        let appIcon = null
        let themeColor = "#3b82f6"
        
        snapshot.docs.forEach((doc) => {
          const data = doc.data()
          if (data.type === "pwa") {
            if (data.appName) appName = data.appName
            if (data.appIcon) appIcon = data.appIcon
            if (data.themeColor) themeColor = data.themeColor
          }
        })

        document.title = appName

        const themeMetaTag = document.querySelector('meta[name="theme-color"]')
        if (themeMetaTag) {
          themeMetaTag.setAttribute("content", themeColor)
        }

        const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
        if (appleTitle) {
          appleTitle.setAttribute("content", appName)
        }

        if (appIcon) {
          let faviconLink = document.querySelector('link[rel="icon"]')
          if (!faviconLink) {
            faviconLink = document.createElement("link")
            faviconLink.rel = "icon"
            document.head.appendChild(faviconLink)
          }
          faviconLink.href = appIcon

          let appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]')
          if (!appleTouchIcon) {
            appleTouchIcon = document.createElement("link")
            appleTouchIcon.rel = "apple-touch-icon"
            document.head.appendChild(appleTouchIcon)
          }
          appleTouchIcon.href = appIcon
        }

        let manifestLink = document.querySelector('link[rel="manifest"]')
        if (manifestLink) {
          const manifestUrl = manifestLink.href
          const timestamp = new Date().getTime()
          manifestLink.href = manifestUrl.split('?')[0] + '?v=' + timestamp
        }

        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'UPDATE_MANIFEST',
            appName,
            appIcon,
            themeColor
          })
        }

        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((registrations) => {
            registrations.forEach((registration) => {
              registration.update()
            })
          })
        }
      } catch (error) {
        console.error("Error loading settings:", error)
      }
    }

    loadSettings()
  }, [])

  return null
}
