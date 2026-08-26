import { loginUdvashWeb } from "./udvash-web-login.js"
import {
  getUdvashClassMediaBulkHtml,
  getUdvashCourseSnapshotHtml,
  listUdvashCoursesHtmlV2,
  normalizeContentTypeTitle,
} from "./udvash-html-v2.js"
import { resolveUdvashRoutineNoteResources } from "./udvash-notes.js"

const UDVASH_ORIGIN = "https://online.udvash-unmesh.com"

function isSolveSheetNavigationLink(resource) {
  try {
    const url = new URL(String(resource?.url || ""), UDVASH_ORIGIN)
    return url.origin === UDVASH_ORIGIN
      && url.pathname.toLowerCase() === "/routine/questionandsolvesheet"
      && !url.search
  } catch {
    return false
  }
}

function removeNavigationResourceFalsePositives(results) {
  return (Array.isArray(results) ? results : []).map((result) => {
    if (!result?.media || !Array.isArray(result.media.resourceLinks)) return result
    return {
      ...result,
      media: {
        ...result.media,
        resourceLinks: result.media.resourceLinks.filter((resource) => !isSolveSheetNavigationLink(resource)),
      },
    }
  })
}

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
  const cleaned = removeNavigationResourceFalsePositives(results)
  return resolveUdvashRoutineNoteResources(auth, cleaned, concurrency)
}

export { normalizeContentTypeTitle }