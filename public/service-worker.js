const CACHE_VERSION = 'v9';
const APP_VERSION = 'v9.0';
const CACHE_NAME = `easy-education-${CACHE_VERSION}`;
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/placeholder-logo.png',
  '/placeholder-logo.svg'
];

const NETWORK_FIRST_URLS = [
  '/',
  '/index.html',
  '/api/version',
  '/api/manifest'
];

// Cache patterns for better offline support
const CACHE_PATTERNS = {
  images: /\.(png|jpg|jpeg|svg|gif|webp|ico)$/i,
  fonts: /\.(woff|woff2|ttf|eot)$/i,
  styles: /\.(css)$/i,
  scripts: /\.(js|mjs)$/i
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(STATIC_CACHE);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const shouldUseNetworkFirst = NETWORK_FIRST_URLS.some(pattern => url.pathname.includes(pattern));
  
  // Skip caching for Firebase and external API calls
  if (url.hostname.includes('firebase') || 
      url.hostname.includes('googleapis') ||
      url.hostname.includes('ipify') ||
      url.hostname.includes('imgbb') ||
      event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  if (shouldUseNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            if (event.request.url.includes('/api/manifest')) {
              const defaultManifest = {
                name: 'Easy Education - Free Online Courses',
                short_name: 'Easy Education',
                description: 'Learn from the best free online courses with expert teachers',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                background_color: '#fcfcfd',
                theme_color: '#3b82f6',
                orientation: 'portrait-primary',
                prefer_related_applications: false,
                icons: [
                  {
                    src: '/placeholder-logo.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any maskable'
                  },
                  {
                    src: '/placeholder-logo.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any maskable'
                  }
                ]
              };
              return new Response(JSON.stringify(defaultManifest), {
                headers: { 
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-store'
                }
              });
            }
            // Return offline fallback page
            return new Response('<!DOCTYPE html><html><head><title>Offline</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff;text-align:center;padding:20px}h1{font-size:2rem;margin-bottom:1rem}</style></head><body><div><h1>আপনি অফলাইন আছেন</h1><p>ইন্টারনেট সংযোগ চেক করুন এবং আবার চেষ্টা করুন।</p></div></body></html>', {
              status: 503,
              headers: { 'Content-Type': 'text/html' }
            });
          });
        })
    );
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Cache static assets
          const shouldCache = Object.values(CACHE_PATTERNS).some(pattern => 
            pattern.test(url.pathname)
          );
          
          if (shouldCache) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
          }
          
          return response;
        }).catch(() => {
          // Return cached response if network fails
          return caches.match(event.request);
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'UPDATE_MANIFEST') {
    caches.open(CACHE_NAME).then((cache) => {
      cache.keys().then((keys) => {
        keys.forEach((request) => {
          if (request.url.includes('/api/manifest') || 
              request.url.includes('placeholder-logo')) {
            cache.delete(request);
          }
        });
      });
    });

    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'MANIFEST_UPDATED',
          data: {
            appName: event.data.appName,
            appIcon: event.data.appIcon,
            themeColor: event.data.themeColor
          }
        });
      });
    });
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION, appVersion: APP_VERSION });
  }
  
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    fetch('/api/version')
      .then(res => res.json())
      .then(data => {
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'VERSION_CHECK_RESULT',
              currentVersion: APP_VERSION,
              serverVersion: data.version,
              needsUpdate: data.version !== APP_VERSION
            });
          });
        });
      })
      .catch(() => {});
  }

  if (event.data && event.data.type === 'FORCE_UPDATE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      self.skipWaiting();
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'RELOAD_PAGE' });
        });
      });
    });
  }
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  const iconUrl = data.icon || '/placeholder-logo.png';
  const title = data.title || 'Easy Education';
  
  const options = {
    body: data.body || 'New notification from Easy Education',
    icon: iconUrl,
    badge: iconUrl,
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: data.id || 1,
      url: data.url || '/'
    },
    actions: [
      {
        action: 'view',
        title: 'View',
        icon: iconUrl
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
