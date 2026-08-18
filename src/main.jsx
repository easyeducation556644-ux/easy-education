import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { ThemeProvider } from "./contexts/ThemeContext"
import { registerServiceWorker } from "./lib/pwa"
import SecurityMonitor from "./components/SecurityMonitor"
import "./index.css"

const rootElement = document.getElementById("root")

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
        <SecurityMonitor />
      </ThemeProvider>
    </React.StrictMode>
  )
} else {
  console.error("Failed to find the root element with ID 'root'")
}

function isNativeAndroidApp() {
  return typeof window !== "undefined" && Boolean(window.EasyEducationNative?.postMessage)
}

function isLegacyAppWorker(worker) {
  if (!worker?.scriptURL) return false
  try {
    return new URL(worker.scriptURL).pathname === "/service-worker.js"
  } catch (_) {
    return worker.scriptURL.endsWith("/service-worker.js")
  }
}

async function stabilizeWebServiceWorker() {
  if (!("serviceWorker" in navigator)) return

  window.addEventListener("load", async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const legacyRegistrations = registrations.filter((registration) =>
        [registration.active, registration.waiting, registration.installing].some(isLegacyAppWorker),
      )
      const controlledByLegacyWorker = isLegacyAppWorker(navigator.serviceWorker.controller)

      await Promise.all(legacyRegistrations.map((registration) => registration.unregister()))

      // Remove the app-shell caches created by the retired worker. Keep the
      // separate offline-video cache intact because native/offline downloads use it.
      if ("caches" in window) {
        const names = await caches.keys()
        await Promise.all(names
          .filter((name) => name.startsWith("easy-education-") && name !== "easy-education-offline-v2")
          .map((name) => caches.delete(name)))
      }

      // Firebase push notifications still need a worker, but it does not intercept
      // navigation or Firestore requests with the old app-cache strategy.
      const firebaseRegistration = registrations.find((registration) =>
        [registration.active, registration.waiting, registration.installing]
          .some((worker) => worker?.scriptURL?.includes("/firebase-messaging-sw.js")),
      )
      if (!firebaseRegistration) {
        await navigator.serviceWorker.register("/firebase-messaging-sw.js")
      }

      // Unregistering a worker does not replace the controller of an already-open
      // page. Reload once so users currently trapped behind the old worker escape it.
      const reloadKey = "ee_legacy_service_worker_reloaded_v1"
      if (controlledByLegacyWorker && sessionStorage.getItem(reloadKey) !== "1") {
        sessionStorage.setItem(reloadKey, "1")
        window.location.reload()
      }
    } catch (error) {
      console.warn("Unable to retire legacy web service worker cleanly", error)
    }
  }, { once: true })
}

if (isNativeAndroidApp()) {
  registerServiceWorker()
} else {
  stabilizeWebServiceWorker()
}

console.log(" React app mounted")
