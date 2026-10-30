// Permanent retirement endpoint for previously installed receivers.
// No push or notificationclick handler: this script cannot display notifications.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  try { await (await self.registration.pushManager.getSubscription())?.unsubscribe(); } catch {}
  try {
    await new Promise(resolve => {
      const request = self.indexedDB.deleteDatabase('ether-watch-push-receipts');
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
  } catch {}
  await self.registration.unregister();
})()));
