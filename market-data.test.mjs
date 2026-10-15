import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandleFeed, parseGraphCandles } from './dist/market-data.mjs';

const START = Date.UTC(2026, 9, 15, 12);
const row = (time, close = 2510) => [time, close - 10, close + 10, close, close, 100];
const rows = (granularity, time = START) => [row(Math.floor(time / 1000 / granularity) * granularity)];
const response = (data, status = 200, headers) => Response.json(data, { status, headers });

test('parser validates, sorts, deduplicates, and includes a valid in-progress candle', () => {
  const current = rows(900)[0];
  const older = row(current[0] - 900, 2500);
  const candles = parseGraphCandles([current, older, current], 900, START + 1000);
  assert.deepEqual(candles.map(candle => candle.time), [older[0], current[0]]);
  assert.equal(candles.at(-1).close, 2510);
  assert.ok(Object.isFrozen(candles));
  assert.ok(Object.isFrozen(candles[0]));
  assert.throws(() => parseGraphCandles([], 900, START));
  assert.throws(() => parseGraphCandles('invalid', 900, START));
  for (const bad of [
    [current[0], 2500, 2520, 2510, 2510],
    [current[0] + 1, 2500, 2520, 2510, 2510, 100],
    [current[0] + 900, 2500, 2520, 2510, 2510, 100],
    [current[0], 0, 2520, 2510, 2510, 100],
    [current[0], 2500, 2520, 2499, 2510, 100],
    [current[0], 2500, 2520, 2510, 2521, 100],
    [current[0], 2500, 2520, 2510, 2510, -1],
    [current[0], 2500, 2520, 2510, NaN, 100],
    [current[0], 2500, 2520, '2510', 2510, 100]
  ]) assert.throws(() => parseGraphCandles([bad], 900, START));
  assert.throws(() => parseGraphCandles([current, row(current[0], 2511)], 900, START), /conflicting/);
});

test('cache snapshots use caller age and keep daily/chart requests in the same interval cache', async () => {
  let time = START, calls = 0;
  const feed = createCandleFeed({ now: () => time, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400');
    assert.equal(options.cache, 'no-store');
    return response(rows(86400, time));
  } });
  assert.equal(feed.peek(86400).status, 'idle');
  const initial = await feed.load(86400, { maxAgeMs: 300000 });
  assert.equal(initial.fetchedAt, START);
  assert.equal(initial.status, 'ready');
  time += 60000;
  assert.equal(feed.peek(86400).stale, true);
  assert.equal(feed.peek(86400, { maxAgeMs: 300000 }).stale, false);
  await feed.load(86400, { maxAgeMs: 300000 });
  assert.equal(calls, 1);
  await feed.load(86400);
  assert.equal(calls, 2, 'selected daily chart can refresh its shared candles after 60 seconds');
  assert.equal(feed.peek(86400).fetchedAt, time);
});

test('overlapping loads share one request and the latest result without background timers', async () => {
  let calls = 0, finish;
  const feed = createCandleFeed({ now: () => START, fetcher: () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } });
  const first = feed.load(86400, { maxAgeMs: 300000 });
  const second = feed.load(86400, { maxAgeMs: 60000, force: true });
  assert.equal(feed.peek(86400).loading, true);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(response(rows(86400)));
  const [daily, chart] = await Promise.all([first, second]);
  assert.equal(daily.candles, chart.candles);
  assert.equal(daily.fetchedAt, chart.fetchedAt);
  assert.equal(feed.peek(86400).loading, false);
});

test('failure retains successful candles and timestamp, throttles forced refresh, and recovers', async () => {
  let time = START, calls = 0, fail = false;
  const feed = createCandleFeed({ now: () => time, fetcher: async () => {
    calls++;
    if (fail) throw new Error('Network offline');
    return response(rows(3600, time));
  } });
  const good = await feed.load(3600);
  time += 60000;
  fail = true;
  const failed = await feed.load(3600);
  assert.equal(failed.candles, good.candles);
  assert.equal(failed.fetchedAt, START);
  assert.equal(failed.error, 'Network offline');
  assert.equal(failed.stale, true);
  assert.equal(failed.status, 'stale');
  assert.equal(failed.retryAt, time + 15000);
  await feed.load(3600, { force: true });
  assert.equal(calls, 2);
  time = failed.retryAt;
  fail = false;
  const recovered = await feed.load(3600);
  assert.equal(calls, 3);
  assert.equal(recovered.fetchedAt, time);
  assert.equal(recovered.error, null);
  assert.equal(recovered.retryAt, null);
  assert.equal(recovered.failures, 0);
  assert.equal(recovered.status, 'ready');
});

test('HTTP Retry-After seconds and dates override exponential backoff', async () => {
  for (const header of ['120', new Date(START + 120000).toUTCString()]) {
    let calls = 0, time = START;
    const feed = createCandleFeed({ now: () => time, fetcher: async () => {
      calls++;
      return response({ message: 'rate limited' }, 429, { 'Retry-After': header });
    } });
    const failed = await feed.load(900);
    assert.equal(failed.responseStatus, 429);
    assert.equal(failed.retryAt, START + 120000);
    assert.equal(failed.status, 'error');
    time += 119999;
    await feed.load(900, { force: true });
    assert.equal(calls, 1);
    time++;
    await feed.load(900);
    assert.equal(calls, 2);
  }
});

test('exponential backoff caps at five minutes and does not truncate longer Retry-After', async () => {
  let time = START;
  const feed = createCandleFeed({ now: () => time, fetcher: async () => response({}, 503, { 'Retry-After': 'invalid' }) });
  for (const delay of [15000, 30000, 60000, 120000, 240000, 300000, 300000]) {
    const failed = await feed.load(900);
    assert.equal(failed.retryAt - time, delay);
    time = failed.retryAt;
  }
  const slow = createCandleFeed({ now: () => START, fetcher: async () => response({}, 503, { 'Retry-After': '600' }) });
  assert.equal((await slow.load(900)).retryAt, START + 600000);
});

test('invalid or unreadable successful payloads retain the previous cache', async () => {
  for (const badResponse of [
    () => response([]),
    () => response([[0, 5, 1, 2, 2, 100]]),
    () => new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    () => ({ ok: true })
  ]) {
    let broken = false;
    const feed = createCandleFeed({ now: () => START, fetcher: async () => broken ? badResponse() : response(rows(900)) });
    const original = await feed.load(900);
    broken = true;
    const result = await feed.load(900, { force: true });
    assert.equal(result.candles, original.candles);
    assert.equal(result.fetchedAt, original.fetchedAt);
    assert.ok(result.error);
    assert.equal(result.stale, true);
  }
});

test('only three supported intervals are cached and failures remain independent', async () => {
  let calls = 0;
  const feed = createCandleFeed({ now: () => START, fetcher: async url => {
    calls++;
    const granularity = Number(new URL(url).searchParams.get('granularity'));
    return granularity === 900 ? response({}, 429) : response(rows(granularity));
  } });
  assert.equal((await feed.load(900)).status, 'error');
  assert.equal((await feed.load(3600)).status, 'ready');
  assert.equal((await feed.load(86400)).status, 'ready');
  await feed.load(900);
  assert.equal(calls, 3);
  for (const granularity of [60, 300, '900', NaN]) {
    assert.throws(() => feed.load(granularity), /supported candle interval/);
    assert.throws(() => feed.peek(granularity), /supported candle interval/);
  }
  assert.throws(() => feed.load(900, { maxAgeMs: -1 }));
  assert.throws(() => feed.load(900, { force: 'true' }));
});
