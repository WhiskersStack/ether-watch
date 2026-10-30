// Only retire this application's legacy receiver; never create a subscription.
export async function retireNotifications(browser = globalThis) {
  for (const key of ['etherwatch-alerts', 'etherwatch-armed', 'etherwatch-migrated']) {
    try { browser.localStorage.removeItem(key); } catch {}
  }
  try {
    const request = browser.indexedDB?.deleteDatabase('ether-watch-push-receipts');
    if (request) request.onerror = () => {};
  } catch {}
  try {
    const serviceWorker = browser.navigator?.serviceWorker;
    if (!serviceWorker?.getRegistrations) return;
    for (const registration of await serviceWorker.getRegistrations()) {
      const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
      if (!workers.length || !workers.every(worker => {
        const url = new URL(worker.scriptURL);
        return url.origin === browser.location.origin && url.pathname === '/notification-worker.js';
      })) continue;
      try { await registration.update(); } catch {}
      try { await (await registration.pushManager?.getSubscription())?.unsubscribe(); } catch {}
      await registration.unregister();
    }
  } catch { /* Retry on a later visit without blocking market data. */ }
}
