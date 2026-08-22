import firestoreReadUsageHandler from '../server/api-resources/firestore-read-usage.js'
import syncEventHandler from './_sync-event.js'
import learningPushHandler from '../server/api-resources/learning-push.js'
import rumbleEmbedHandler from '../server/api-resources/rumble-embed.js'
import cpsHandler from '../server/cps-readonly-v2.js'
import cpsAcademicHandler from '../server/api-resources/cps-academic-v3.js'
import trialsHandler from '../server/api-resources/trials.js'
import examResultsHandler from '../server/api-resources/exam-results.js'
import createPaymentHandler from '../server/api-resources/create-payment.js'
import verifyPaymentHandler from '../server/api-resources/verify-payment.js'
import uploadImageHandler from '../server/api-resources/upload-image.js'

const APP_VERSION = 'v9.5'

export default async function versionHandler(req, res) {
  const resource = String(req.query?.resource || '').trim()

  if (resource === 'firestore-read-usage') return firestoreReadUsageHandler(req, res)
  if (resource === 'sync-event') return syncEventHandler(req, res)
  if (resource === 'learning-push') return learningPushHandler(req, res)
  if (resource === 'rumble-embed') return rumbleEmbedHandler(req, res)
  if (resource === 'cps') {
    if (String(req.query?.action || '').trim() === 'academic') return cpsAcademicHandler(req, res)
    return cpsHandler(req, res)
  }
  if (resource === 'trials') return trialsHandler(req, res)
  if (resource === 'exam-results') return examResultsHandler(req, res)
  if (resource === 'create-payment') return createPaymentHandler(req, res)
  if (resource === 'verify-payment') return verifyPaymentHandler(req, res)
  if (resource === 'upload-image') return uploadImageHandler(req, res)

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  return res.json({ version: APP_VERSION, timestamp: new Date().toISOString() })
}
