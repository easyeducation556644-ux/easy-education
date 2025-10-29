import admin from 'firebase-admin';

let db = null;

if (admin.apps.length === 0) {
  try {
    if (process.env.FIREBASE_PROJECT_ID && 
        process.env.FIREBASE_CLIENT_EMAIL && 
        process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      db = admin.firestore();
    } else {
      console.warn('Firebase Admin credentials not configured, using default manifest values');
    }
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    console.warn('Will use default manifest values');
  }
} else {
  db = admin.firestore();
}

export default async function handler(req, res) {
  try {
    let appName = 'Easy Education - Free Online Courses';
    let appShortName = 'Easy Education';
    let appIcon192 = '/icon-192x192.png';
    let appIcon512 = '/icon-512x512.png';
    let themeColor = '#3b82f6';
    let backgroundColor = '#fcfcfd';

    if (db) {
      try {
        const settingsSnapshot = await db.collection('settings').where('type', '==', 'pwa').get();
        
        if (!settingsSnapshot.empty) {
          const settings = settingsSnapshot.docs[0].data();
          if (settings.appName) appName = settings.appName;
          if (settings.appShortName) appShortName = settings.appShortName;
          if (settings.appIcon192) appIcon192 = settings.appIcon192;
          if (settings.appIcon512) appIcon512 = settings.appIcon512;
          if (settings.themeColor) themeColor = settings.themeColor;
          if (settings.backgroundColor) backgroundColor = settings.backgroundColor;
        }
      } catch (dbError) {
        console.error('Error fetching settings from Firestore:', dbError);
      }
    }

    const manifest = {
      name: appName,
      short_name: appShortName,
      description: "Learn from the best free online courses with expert teachers",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: backgroundColor,
      theme_color: themeColor,
      orientation: "portrait-primary",
      prefer_related_applications: false,
      gcm_sender_id: "103953800507",
      icons: [
        {
          src: appIcon192,
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable"
        },
        {
          src: appIcon512,
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ],
      categories: ["education", "learning"],
      shortcuts: [
        {
          name: "Browse Courses",
          short_name: "Courses",
          description: "Browse all available courses",
          url: "/courses",
          icons: [
            {
              src: appIcon192,
              sizes: "192x192"
            }
          ]
        },
        {
          name: "My Courses",
          short_name: "My Courses",
          description: "View your enrolled courses",
          url: "/my-courses",
          icons: [
            {
              src: appIcon192,
              sizes: "192x192"
            }
          ]
        }
      ]
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json(manifest);
  } catch (error) {
    console.error('Error generating manifest:', error);
    res.status(500).json({ error: 'Failed to generate manifest' });
  }
}
