const CACHE_VERSION = 'v8';
const APP_VERSION = 'v8.0';
const CACHE_NAME = `easy-education-${CACHE_VERSION}`;
const STATIC_CACHE = [
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
            return new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

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
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
          return response;
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
