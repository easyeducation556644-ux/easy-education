import { loginUdvashWeb } from "./udvash-web-login.js"
import {
  getUdvashClassMediaHtml,
  getUdvashCourseContentHtml,
  listUdvashCoursesHtml,
} from "./udvash-html.js"

export async function loginUdvash({ roll, password }) {
  return loginUdvashWeb({ roll, password })
}

export async function listUdvashCourses(auth) {
  return listUdvashCoursesHtml(auth)
}

export async function getUdvashCourseContent(auth, courseId) {
  return getUdvashCourseContentHtml(auth, courseId)
}

export async function getUdvashClassMedia(auth, detailsUrl) {
  return getUdvashClassMediaHtml(auth, detailsUrl)
}

export function udvashConfigured() {
  // Udvash routes are intentionally hardcoded from the captured official web flow.
  // No UDVASH_* endpoint environment variables are required.
  return true
}
