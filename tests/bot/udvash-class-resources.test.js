import test from "node:test"
import assert from "node:assert/strict"
import { parseUdvashClassDetailsHtml } from "../../server/bot/platforms/udvash-html-v2.js"

// Regression coverage is exercised through the public bulk parser in integration
// tests; this fixture documents the exact current Udvash HTML shapes that caused
// the production false positive.
test("ClassDetails extracts signed PDF and ignores Solve Sheet navigation", () => {
  const html = `
    <a href="/Routine/QuestionAndSolveSheet" title="Solve Sheet">Solve Sheet</a>
    <a onclick="forceDownload('https://storage-r1.udvash-unmesh.com/files/note.pdf?X-Amz-Expires=3600&amp;X-Amz-Signature=abc', 'Class Note - Chemistry')">Download</a>
    <embed src="https://storage-r1.udvash-unmesh.com/files/note.pdf?X-Amz-Expires=3600&amp;X-Amz-Signature=abc#toolbar=0">
  `
  const details = parseUdvashClassDetailsHtml(html, "https://online.udvash-unmesh.com/Routine/ClassDetails?id=42")
  assert.deepEqual(details.resourceLinks, [{
    label: "Class Note - Chemistry",
    url: "https://storage-r1.udvash-unmesh.com/files/note.pdf?X-Amz-Expires=3600&X-Amz-Signature=abc",
  }])
})
