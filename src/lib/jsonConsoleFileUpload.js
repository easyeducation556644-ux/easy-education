const UPLOAD_BUTTON_ID = "ee-json-console-upload-button"
const UPLOAD_INPUT_ID = "ee-json-console-upload-input"

function findJsonConsoleElements() {
  const pageHeading = [...document.querySelectorAll("h1")]
    .find((element) => element.textContent?.trim() === "JSON Firestore Console")
  if (!pageHeading) return null

  const jsonHeading = [...document.querySelectorAll("h2")]
    .find((element) => element.textContent?.trim() === "JSON")
  const section = jsonHeading?.closest("section")
  const textarea = section?.querySelector("textarea")
  if (!jsonHeading || !section || !textarea) return null

  const headerRow = jsonHeading.parentElement?.parentElement
  const toolbar = headerRow
    ? [...headerRow.children].find((element) => element.querySelector?.("button"))
    : null

  if (!toolbar) return null
  return { textarea, toolbar }
}

function updateReactTextarea(textarea, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set

  if (valueSetter) valueSetter.call(textarea, value)
  else textarea.value = value

  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

function attachUploadButton() {
  if (document.getElementById(UPLOAD_BUTTON_ID)) return

  const elements = findJsonConsoleElements()
  if (!elements) return

  const { textarea, toolbar } = elements
  const input = document.createElement("input")
  input.id = UPLOAD_INPUT_ID
  input.type = "file"
  input.accept = ".json,application/json"
  input.hidden = true

  const button = document.createElement("button")
  button.id = UPLOAD_BUTTON_ID
  button.type = "button"
  button.textContent = "Upload JSON"
  button.className = "px-3 py-2 text-xs rounded-lg bg-muted hover:bg-muted/80"

  button.addEventListener("click", () => {
    input.value = ""
    input.click()
  })

  input.addEventListener("change", async () => {
    const file = input.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      updateReactTextarea(textarea, text)
      textarea.focus()
      button.title = file.name
    } catch (error) {
      console.error("Failed to read JSON file", error)
      window.alert("JSON file read করা যায়নি। আবার চেষ্টা করুন।")
    }
  })

  toolbar.prepend(button)
  toolbar.append(input)
}

export function installJsonConsoleFileUpload() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {}

  attachUploadButton()
  const observer = new MutationObserver(() => attachUploadButton())
  observer.observe(document.body, { childList: true, subtree: true })

  return () => observer.disconnect()
}
