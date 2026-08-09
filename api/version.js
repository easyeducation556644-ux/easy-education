import firestoreReadUsageHandler from './_firestore-read-usage.js'

const APP_VERSION = 'v9.0';

export default async function versionHandler(req, res) {
  if (req.query?.resource === 'firestore-read-usage') {
    return firestoreReadUsageHandler(req, res)
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  res.json({
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
}
