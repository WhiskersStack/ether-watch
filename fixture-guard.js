// Loaded before application modules in the disposable fixture browser profile.
(() => {
  'use strict';
  const allowed = new Set([
    '/api/settings', '/api/volume', '/api/news', '/api/calendar',
    '/fixture/market/ticker', '/fixture/market/stats', '/fixture/market/candles'
  ]);
  const scenarios = new Set(['success', 'loading', 'stale', 'empty', 'failure']);
  const requested = new URL(location.href).searchParams.get('scenario');
  const scenario = scenarios.has(requested) ? requested : 'success';
  const originalFetch = fetch.bind(window);
  window.__ETHER_WATCH_FIXTURE__ = Object.freeze({ scenario });
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin || !allowed.has(url.pathname)) {
      return Promise.reject(new Error('Fixture preview denied network request: ' + url.origin + url.pathname));
    }
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Fixture-Scenario', scenario);
    if(new URL(location.href).searchParams.get('viewer')==='true')headers.set('X-Fixture-Viewer','true');
    return originalFetch(input, { ...options, headers, credentials: 'omit', redirect: 'error' });
  };
  // The preview runs one initial load. Only explicit UI actions can refresh fixtures.
  window.setInterval = () => 0;
  if (navigator.serviceWorker) {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () => Promise.reject(new Error('Service workers are disabled in fixture mode.'))
    });
  }
  if (window.Notification) {
    Object.defineProperty(Notification, 'requestPermission', {
      value: () => Promise.reject(new Error('Notification permission is disabled in fixture mode.'))
    });
  }
  const addDocumentListener = document.addEventListener.bind(document);
  document.addEventListener = (type, listener, options) =>
    type === 'visibilitychange' ? undefined : addDocumentListener(type, listener, options);
  addDocumentListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (link && new URL(link.href, location.href).origin !== location.origin) event.preventDefault();
  }, true);
  window.open = () => null;
})();
