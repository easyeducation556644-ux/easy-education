import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { ThemeProvider } from "./contexts/ThemeContext" 
import { registerServiceWorker } from "./lib/pwa"
import "./index.css"

const rootElement = document.getElementById("root")

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>
  )
} else {
    console.error("Failed to find the root element with ID 'root'")
}

registerServiceWorker()

console.log(" React app mounted")
