importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCeSmrbWCldLLI0D3UUhdY1Qinw3-puIPQ",
  authDomain: "easy-educat.firebaseapp.com",
  projectId: "easy-educat",
  storageBucket: "easy-educat.firebasestorage.app",
  messagingSenderId: "1047552618209",
  appId: "1:1047552618209:web:09b31cb8d8fc2ff0dfd1a0",
  measurementId: "G-7YJX7M1SX3",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: payload.notification?.icon || '/placeholder-logo.png',
    badge: '/placeholder-logo.png',
    data: { url: payload.fcmOptions?.link || payload.data?.url || '/' },
    tag: payload.data?.tag || 'default',
    requireInteraction: true,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification clicked:', event);
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
