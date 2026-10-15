const INTERVALS = [900, 3600, 86400];
const BASE_URL = 'https://api.exchange.coinbase.com/products/ETH-USD/';
const INITIAL_BACKOFF_MS = 15000;
const MAX_BACKOFF_MS = 300000;
const EMPTY_CANDLES = Object.freeze([]);

function validGranularity(granularity) {
  if (!INTERVALS.includes(granularity)) throw new RangeError('Choose a supported candle interval: 900, 3600, or 86400 seconds.');
}

function validTime(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('The candle feed clock must return a valid timestamp.');
  return value;
}

/** Coinbase rows use UTC epoch seconds; the injected clock and fetchedAt use milliseconds. */
export function parseGraphCandles(rows, granularity, now = Date.now()) {
  validGranularity(granularity);
  validTime(now);
  if (!Array.isArray(rows) || !rows.length) throw new Error('No valid candle data returned.');
  const byTime = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 6 || !row.every(Number.isFinite)) {
      throw new Error('Candle data contains a malformed row.');
    }
    const [time, low, high, open, close, volume] = row;
    if (!Number.isSafeInteger(time) || time < 0 || time % granularity !== 0 || time > now / 1000 ||
        low <= 0 || high < low || open < low || open > high || close < low || close > high || volume < 0) {
      throw new Error('Candle data contains an invalid timestamp, price range, or volume.');
    }
    const candle = Object.freeze({ time, low, high, open, close, volume });
    const previous = byTime.get(time);
    if (previous && Object.keys(candle).some(key => previous[key] !== candle[key])) {
      throw new Error('Candle data contains conflicting duplicate timestamps.');
    }
    byTime.set(time, candle);
  }
  // An in-progress candle is valid chart data. Completed-candle consumers filter it separately.
  return Object.freeze([...byTime.values()].sort((a, b) => a.time - b.time));
}

function retryAfterMilliseconds(value, now) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const milliseconds = Number(text) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

/**
 * A bounded, timer-free candle cache. fetcher follows fetch(url, options) and returns a Response.
 * load resolves a snapshot on feed failures; invalid caller options throw. force still respects backoff.
 * Applications own polling, visibility, and request cancellation/deadlines in their fetcher adapter.
 */
export function createCandleFeed({ fetcher = globalThis.fetch, now = () => Date.now() } = {}) {
  if (typeof fetcher !== 'function' || typeof now !== 'function') throw new TypeError('A fetcher and clock function are required.');
  const entries = new Map(INTERVALS.map(granularity => [granularity, {
    granularity, candles: EMPTY_CANDLES, fetchedAt: null, error: null,
    responseStatus: null, retryAt: null, failures: 0, inFlight: null
  }]));

  function entryFor(granularity) {
    validGranularity(granularity);
    return entries.get(granularity);
  }

  function maxAge(value) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Candle cache age must be a nonnegative number of milliseconds.');
    return value;
  }

  function snapshot(entry, maxAgeMs) {
    const checkedAt = validTime(now());
    const stale = entry.fetchedAt === null || Boolean(entry.error) || checkedAt - entry.fetchedAt >= maxAgeMs;
    const loading = Boolean(entry.inFlight);
    const status = loading ? 'loading' : entry.error ? (entry.candles.length ? 'stale' : 'error') :
      entry.fetchedAt === null ? 'idle' : stale ? 'stale' : 'ready';
    return Object.freeze({
      granularity: entry.granularity, candles: entry.candles, fetchedAt: entry.fetchedAt,
      stale, error: entry.error, retryAt: entry.retryAt, failures: entry.failures,
      loading, status, responseStatus: entry.responseStatus
    });
  }

  function peek(granularity, { maxAgeMs = 60000 } = {}) {
    return snapshot(entryFor(granularity), maxAge(maxAgeMs));
  }

  function load(granularity, { maxAgeMs = 60000, force = false } = {}) {
    const entry = entryFor(granularity);
    maxAge(maxAgeMs);
    if (typeof force !== 'boolean') throw new TypeError('Force refresh must be true or false.');
    const checkedAt = validTime(now());
    if (entry.inFlight) return entry.inFlight.then(() => snapshot(entry, maxAgeMs));
    if (entry.retryAt !== null && checkedAt < entry.retryAt) return Promise.resolve(snapshot(entry, maxAgeMs));
    if (!force && entry.fetchedAt !== null && !entry.error && checkedAt - entry.fetchedAt < maxAgeMs) {
      return Promise.resolve(snapshot(entry, maxAgeMs));
    }

    entry.inFlight = Promise.resolve().then(async () => {
      let retryAfter = null;
      entry.responseStatus = null;
      try {
        const response = await fetcher(BASE_URL + 'candles?granularity=' + granularity, { cache: 'no-store' });
        if (!response || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
          throw new Error('Candle feed returned an invalid response.');
        }
        entry.responseStatus = Number.isInteger(response.status) ? response.status : null;
        retryAfter = response.headers?.get?.('Retry-After') ?? null;
        if (!response.ok) throw new Error('Coinbase candle feed returned ' + response.status + '.');
        const rows = await response.json();
        const fetchedAt = validTime(now());
        const candles = parseGraphCandles(rows, granularity, fetchedAt);
        entry.candles = candles;
        entry.fetchedAt = fetchedAt;
        entry.error = null;
        entry.failures = 0;
        entry.retryAt = null;
      } catch (error) {
        const failedAt = validTime(now());
        entry.error = typeof error?.message === 'string' ? error.message : 'Candle feed unavailable.';
        entry.failures = Math.min(entry.failures + 1, 32);
        const backoff = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** (entry.failures - 1));
        entry.retryAt = failedAt + Math.max(backoff, retryAfterMilliseconds(retryAfter, failedAt));
      }
    }).finally(() => { entry.inFlight = null; });
    return entry.inFlight.then(() => snapshot(entry, maxAgeMs));
  }

  return Object.freeze({ load, peek });
}
