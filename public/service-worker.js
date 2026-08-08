const CACHE_VERSION = 'v11';
const APP_VERSION = 'v11.0';
const CACHE_NAME = `easy-education-${CACHE_VERSION}`;
const OFFLINE_VIDEO_CACHE = 'easy-education-offline-v2';
const OFFLINE_VIDEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

  if (url.origin === self.location.origin && url.pathname === '/offline-assets/hls.min.js') {
    event.respondWith(
      caches.open(OFFLINE_VIDEO_CACHE)
        .then((cache) => cache.match(url.pathname))
        .then((response) => response || new Response('Offline HLS player not found', { status: 404 }))
    );
    return;
  }

  // Serve cached HLS playlists/segments or reassemble MP4 chunks.
  if (url.origin === self.location.origin && url.pathname.startsWith('/offline-media/')) {
    event.respondWith(serveOfflineVideo(event.request, url));
    return;
  }

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

async function serveOfflineVideo(request, url) {
  const cache = await caches.open(OFFLINE_VIDEO_CACHE);
  const basePath = url.pathname.match(/^\/offline-media\/[^/]+\/[^/]+/)?.[0];
  if (!basePath) return new Response('Invalid offline video path', { status: 400 });
  const manifestResponse = await cache.match(`${basePath}/manifest`);
  const manifest = await manifestResponse?.json().catch(() => null);
  if (!manifest || !manifest.savedAt || Date.now() - manifest.savedAt > OFFLINE_VIDEO_TTL_MS) {
    return new Response('Offline video not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
  if (manifest.kind === 'hls' && url.pathname !== basePath) {
    const cached = await cache.match(url.pathname);
    return cached || new Response('Offline HLS file not found', { status: 404 });
  }

  const total = Number(manifest.contentLength);
  const chunkSize = Number(manifest.chunkSize);
  if (!total || !chunkSize || !manifest.totalChunks) {
    return new Response('Offline video manifest is invalid', { status: 500 });
  }

  const rangeHeader = request.headers.get('range');
  let start = 0;
  let end = total - 1;
  let partial = false;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) return new Response('Invalid range', { status: 416 });
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : total - 1;
    } else if (match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, total - suffix);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || end < start) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` }
      });
    }
    end = Math.min(end, total - 1);
    partial = true;
  }

  const firstChunk = Math.floor(start / chunkSize);
  const lastChunk = Math.floor(end / chunkSize);
  const body = new ReadableStream({
    async start(controller) {
      try {
        for (let index = firstChunk; index <= lastChunk; index += 1) {
          const response = await cache.match(`${basePath}/chunks/${index}`);
          if (!response) throw new Error(`Missing offline chunk ${index}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const chunkStart = index * chunkSize;
          const from = index === firstChunk ? start - chunkStart : 0;
          const to = index === lastChunk ? end - chunkStart + 1 : bytes.byteLength;
          controller.enqueue(bytes.slice(from, to));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  const headers = new Headers({
    'Content-Type': manifest.contentType || 'video/mp4',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=604800',
    'X-Offline-Saved-At': String(manifest.savedAt)
  });
  if (partial) headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  return new Response(body, { status: partial ? 206 : 200, headers });
}

function backgroundConfigUrl(backgroundId) {
  return `/offline-background/${encodeURIComponent(backgroundId)}/config`;
}

function offlineVideoBase(userId, classId) {
  return `/offline-media/${encodeURIComponent(userId)}/${encodeURIComponent(classId)}`;
}

async function notifyDownloadClients(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage(message));
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_VIDEO_CACHE);
    const configResponse = await cache.match(backgroundConfigUrl(event.registration.id));
    const config = await configResponse?.json().catch(() => null);
    if (!config) throw new Error('Background download config was not found');

    const records = await event.registration.matchAll();
    const indexes = new Map(config.segmentUrls.map((url, index) => [url, index]));
    const basePath = offlineVideoBase(config.userId, config.classId);

    for (const record of records) {
      const response = await record.responseReady;
      if (!response.ok) throw new Error(`Background segment returned HTTP ${response.status}`);
      const index = indexes.get(record.request.url);
      if (!Number.isInteger(index)) continue;
      const bytes = await response.arrayBuffer();
      await cache.put(
        `${basePath}/segments/${index}.ts`,
        new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': response.headers.get('content-type') || 'video/mp2t',
            'Content-Length': String(bytes.byteLength)
          }
        })
      );
    }

    let segmentIndex = 0;
    const playlist = config.lines.map((line) => {
      if (!line || line.startsWith('#')) return line;
      const localUrl = `${basePath}/segments/${segmentIndex}.ts`;
      segmentIndex += 1;
      return localUrl;
    }).join('\n');

    const savedAt = Date.now();
    await Promise.all([
      cache.put(
        `${basePath}/playlist.m3u8`,
        new Response(playlist, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
        })
      ),
      cache.put(
        `${basePath}/manifest`,
        new Response(JSON.stringify({
          version: 5,
          kind: 'hls',
          status: 'completed',
          progress: 100,
          savedAt,
          userId: config.userId,
          classId: config.classId,
          height: config.height,
          contentLength: config.totalBytes,
          contentType: 'application/vnd.apple.mpegurl',
          totalChunks: config.segmentUrls.length,
          completedChunks: config.segmentUrls.length
        }), {
          headers: {
            'Content-Type': 'application/json',
            'X-Offline-Saved-At': String(savedAt)
          }
        })
      )
    ]);
    await cache.delete(backgroundConfigUrl(event.registration.id));
    await notifyDownloadClients({
      type: 'BACKGROUND_DOWNLOAD_COMPLETE',
      userId: config.userId,
      classId: config.classId,
      playbackUrl: `${basePath}/playlist.m3u8`
    });
  })());
});

self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil(notifyDownloadClients({
    type: 'BACKGROUND_DOWNLOAD_FAILED',
    backgroundId: event.registration.id,
    reason: event.registration.failureReason || 'unknown'
  }));
});

self.addEventListener('backgroundfetchabort', (event) => {
  event.waitUntil(notifyDownloadClients({
    type: 'BACKGROUND_DOWNLOAD_ABORTED',
    backgroundId: event.registration.id
  }));
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1 && cacheName !== OFFLINE_VIDEO_CACHE) {
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
        cacheNames
          .filter((cacheName) => cacheName !== OFFLINE_VIDEO_CACHE)
          .map((cacheName) => caches.delete(cacheName))
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
