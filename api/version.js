import firestoreReadUsageHandler from '../server/api-resources/firestore-read-usage.js'
import syncEventHandler from './_sync-event.js'
import learningPushHandler from '../server/api-resources/learning-push.js'
import rumbleEmbedHandler from '../server/api-resources/rumble-embed.js'
import cpsHandler from '../server/cps-readonly-v2.js'
import cpsAcademicHandler from '../server/api-resources/cps-academic-v3.js'
import cpsRoutineHandler from '../server/api-resources/cps-routine.js'
import cpsMathSvgHandler from '../server/api-resources/cps-math-svg.js'
import trialsHandler from '../server/api-resources/trials.js'
import examResultsHandler from '../server/api-resources/exam-results.js'
import createPaymentHandler from '../server/api-resources/create-payment.js'
import verifyPaymentHandler from '../server/api-resources/verify-payment.js'
import uploadImageHandler from '../server/api-resources/upload-image.js'
import unpiratorPlaybackHandler from '../server/api-resources/unpirator-playback.js'
import channelRouterHandler, {
  channelRouterTelegram,
  channelRouterToken,
  channelRouterWebhookSecret,
} from '../server/bot/channel-router.js'

const APP_VERSION = 'v9.7'

function routerWebhookUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  if (!host) throw new Error('Unable to determine public deployment host')
  return `${proto}://${host}/api/channel-router-bot`
}

async function channelRouterSetupHandler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  try {
    channelRouterToken()
    const expectedKey = channelRouterWebhookSecret()
    const suppliedKey = String(req.query?.key || req.headers['x-router-setup-key'] || '')
    if (!suppliedKey || suppliedKey !== expectedKey) {
      return res.status(401).json({ ok: false, error: 'Invalid setup key' })
    }

    const url = routerWebhookUrl(req)
    await channelRouterTelegram('setWebhook', {
      url,
      secret_token: channelRouterWebhookSecret(),
      allowed_updates: ['message', 'callback_query', 'my_chat_member', 'channel_post'],
      drop_pending_updates: false,
    })
    await channelRouterTelegram('setMyCommands', {
      commands: [
        { command: 'start', description: 'Open channel router' },
        { command: 'menu', description: 'Open main menu' },
        { command: 'cancel', description: 'Cancel current setup' },
      ],
    })
    const me = await channelRouterTelegram('getMe', {})
    const webhookInfo = await channelRouterTelegram('getWebhookInfo', {})
    return res.status(200).json({
      ok: true,
      bot: { id: me.id, username: me.username, firstName: me.first_name },
      webhook: {
        url: webhookInfo.url,
        pendingUpdateCount: webhookInfo.pending_update_count,
        lastErrorMessage: webhookInfo.last_error_message || null,
      },
      openTelegram: me.username ? `https://t.me/${me.username}` : null,
    })
  } catch (error) {
    console.error('Channel router setup failed:', error)
    return res.status(500).json({ ok: false, error: error.message || 'Setup failed' })
  }
}

export default async function versionHandler(req, res) {
  const resource = String(req.query?.resource || '').trim()

  if (resource === 'channel-router-bot') return channelRouterHandler(req, res)
  if (resource === 'channel-router-setup') return channelRouterSetupHandler(req, res)
  if (resource === 'firestore-read-usage') return firestoreReadUsageHandler(req, res)
  if (resource === 'sync-event') return syncEventHandler(req, res)
  if (resource === 'learning-push') return learningPushHandler(req, res)
  if (resource === 'rumble-embed') return rumbleEmbedHandler(req, res)
  if (resource === 'cps') {
    const action = String(req.query?.action || '').trim()
    if (action === 'academic') return cpsAcademicHandler(req, res)
    if (action === 'routine') return cpsRoutineHandler(req, res)
    if (action === 'math-svg') return cpsMathSvgHandler(req, res)
    return cpsHandler(req, res)
  }
  if (resource === 'trials') return trialsHandler(req, res)
  if (resource === 'exam-results') return examResultsHandler(req, res)
  if (resource === 'create-payment') return createPaymentHandler(req, res)
  if (resource === 'verify-payment') return verifyPaymentHandler(req, res)
  if (resource === 'upload-image') return uploadImageHandler(req, res)
  if (resource === 'unpirator-playback') return unpiratorPlaybackHandler(req, res)

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  return res.json({ version: APP_VERSION, timestamp: new Date().toISOString() })
}
