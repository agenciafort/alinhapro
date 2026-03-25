/**
 * AlinhaPro — Service Worker para Push Notifications
 * Registrado pelo admin/leads para receber alertas de novos leads e mensagens.
 */

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'AlinhaPro', body: event.data ? event.data.text() : 'Nova notificação' };
  }

  var title = data.title || 'AlinhaPro';
  var options = {
    body: data.body || 'Você tem uma nova mensagem',
    icon: data.icon || '/img/alinhapro-logo.svg',
    badge: '/img/alinhapro-logo.svg',
    tag: data.tag || 'alinhapro-' + Date.now(),
    data: {
      url: data.url || '/leads.html'
    },
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Dispensar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  var url = (event.notification.data && event.notification.data.url) || '/leads.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url.indexOf('admin.html') !== -1 || client.url.indexOf('leads.html') !== -1) {
          client.focus();
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
