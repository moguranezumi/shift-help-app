// シフトヘルプ Service Worker
const CACHE_VERSION = 'v2';

// アイコン用のData URL（青背景に👋絵文字）
const ICON_DATA_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxOTIgMTkyIj48cmVjdCB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgcng9IjI4IiBmaWxsPSIjMjU2M2ViIi8+PHRleHQgeD0iOTYiIHk9IjEzMCIgZm9udC1zaXplPSI5NiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIj7wn5GLPC90ZXh0Pjwvc3ZnPg==';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'シフトヘルプ', body: '新しいお知らせがあります' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  const options = {
    body: data.body || '',
    icon: ICON_DATA_URL,
    badge: ICON_DATA_URL,
    tag: data.tag || 'shift-help',
    data: { url: data.url || '/' },
    requireInteraction: false,
    renotify: false,
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'シフトヘルプ', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
