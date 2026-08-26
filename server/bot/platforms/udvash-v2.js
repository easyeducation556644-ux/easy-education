import { loginUdvashWeb } from "./udvash-web-login.js"
import {
  getUdvashClassMediaBulkHtml,
  getUdvashCourseSnapshotHtml,
  listUdvashCoursesHtmlV2,
  normalizeContentTypeTitle,
} from "./udvash-html-v2.js"
import { resolveUdvashRoutineNoteResources } from "./udvash-notes.js"

export async function loginUdvashV2({ roll, password }) {
  return loginUdvashWeb({ roll, password })
}

export async function listUdvashCoursesV2(auth) {
  return listUdvashCoursesHtmlV2(auth)
}

export async function getUdvashCourseSnapshot(auth, courseId) {
  return getUdvashCourseSnapshotHtml(auth, courseId)
}

export async function getUdvashClassMediaBulk(auth, classes, concurrency = 3) {
  const results = await getUdvashClassMediaBulkHtml(auth, classes, concurrency)
  return resolveUdvashRoutineNoteResources(auth, results, concurrency)
}

export { normalizeContentTypeTitle }
