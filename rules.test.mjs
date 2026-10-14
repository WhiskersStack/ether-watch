import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig, acceptTicker, normalizeCandles, evaluate } from './dist/rules.mjs';

const DAY = 86400;
const START = Date.UTC(2026, 9, 14);
const D = START / 1000;
const settings = overrides => ({ ...DEFAULT_CONFIG, levels: { ...DEFAULT_CONFIG.levels }, ...overrides });
const candle = (time, close, low = close - 10, high = close + 10) => [time, low, high, close, close, 100];
const quote = (price, time = START) => ({ price, time });
const json = value => JSON.parse(JSON.stringify(value));
const daily = (config, previous, rows, now) => evaluate(config, previous, { candles: rows }, now);

test('settings sanitize USD input and reject invalid levels or mode', () => {
  const config = settings();
  config.levels.S1 = '2416.25';
  assert.equal(validateConfig(config).levels.S1, 2416.25);
  assert.equal(validateConfig(config).revision, 1);
  assert.equal(validateConfig(settings({ mode: 'daily-close' })).mode, 'close');
  for (const value of ['', '2416.001', 0, -1, NaN, Infinity, true]) {
    assert.throws(() => validateConfig(settings({ levels: { ...DEFAULT_CONFIG.levels, S1: value } })));
  }
  assert.throws(() => validateConfig(settings({ levels: { ...DEFAULT_CONFIG.levels, S1: 2554 } })), /increase/);
  assert.throws(() => validateConfig(settings({ mode: 'unknown' })));
  assert.throws(() => validateConfig(settings({ revision: 0 })));
  assert.throws(() => validateConfig(settings({ armed: 'false' })));
  for (const cooldownMinutes of [0.5, 1441]) assert.throws(() => validateConfig(settings({ cooldownMinutes })), /Cooldown/);
});

test('ticker validation checks source timestamps and exact freshness bounds', () => {
  assert.deepEqual(acceptTicker({ price: '2510.25', time: new Date(START).toISOString() }, START), { price: 2510.25, time: START });
  assert.equal(acceptTicker(quote(2510, START - 120000), START).price, 2510);
  assert.equal(acceptTicker(quote(2510, START + 30000), START).price, 2510);
  assert.throws(() => acceptTicker(quote(2510, START - 120001), START), /stale/);
  assert.throws(() => acceptTicker(quote(2510, START + 30001), START), /future/);
  for (const price of ['', 0, -1, Infinity, NaN, null, true]) assert.throws(() => acceptTicker(quote(price), START));
  assert.throws(() => acceptTicker({ price: 2510, time: 'invalid' }, START));
});

test('candles sort, deduplicate, omit incomplete days, and validate data', () => {
  const first = candle(D - 2 * DAY, 2500);
  const last = candle(D - DAY, 2510);
  const rows = normalizeCandles([last, candle(D, 2520), first, last], START + 1000);
  assert.deepEqual(rows.map(row => row.time), [D - 2 * DAY, D - DAY]);
  assert.equal(rows[1].close, 2510);
  assert.throws(() => normalizeCandles([candle(D - DAY + 1, 2510)], START), /UTC day/);
  assert.throws(() => normalizeCandles([[D - DAY, 2520, 2530, 2510, 2510, 100]], START), /coherent/);
  assert.throws(() => normalizeCandles([[D - DAY, 2500, 2520, 2510, 2510, -1]], START));
  assert.throws(() => normalizeCandles([last, candle(D - DAY, 2511)], START), /duplicate/);
  assert.throws(() => normalizeCandles([[D - DAY, 2500, 2520, 2510, NaN, 100]], START));
});

test('immediate equality, initial state, persistence, reentry, and cooldown suppression', () => {
  const config = settings();
  let result = evaluate(config, null, quote(2416), START);
  assert.equal(result.events.length, 0);
  result = evaluate(config, result.state, quote(2415, START + 1000), START + 1000);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].rule, 'S1');
  const firstId = result.events[0].id;
  result = evaluate(config, json(result.state), quote(2400, START + 31 * 60000), START + 31 * 60000);
  assert.equal(result.events.length, 0, 'continuous breach never repeats after cooldown');
  result = evaluate(config, result.state, quote(2416, START + 32 * 60000), START + 32 * 60000);
  result = evaluate(config, result.state, quote(2415, START + 33 * 60000), START + 33 * 60000);
  assert.equal(result.events.length, 1);
  assert.notEqual(result.events[0].id, firstId);
  result = evaluate(config, result.state, quote(2416, START + 34 * 60000), START + 34 * 60000);
  result = evaluate(config, result.state, quote(2415, START + 35 * 60000), START + 35 * 60000);
  assert.equal(result.events.length, 0, 'crossing during cooldown is consumed');
  result = evaluate(config, result.state, quote(2415, START + 65 * 60000), START + 65 * 60000);
  assert.equal(result.events.length, 0, 'suppressed crossing is not delivered late');
  const initial = evaluate(config, null, quote(2555), START);
  assert.match(initial.events[0].message, /Initial state/);
  assert.equal(evaluate(config, json(initial.state), quote(2555, START + 1000), START + 1000).events.length, 0);
  assert.equal(evaluate(config, null, quote(2554), START).events.length, 0);
});

test('independent rules, paused state, resumed activation, deterministic IDs, and quote ordering', () => {
  const config = settings({ cooldownMinutes: 0 });
  const first = evaluate(config, null, quote(2400), START);
  assert.equal(evaluate(config, null, quote(2400), START).events[0].id, first.events[0].id);
  const older = evaluate(config, first.state, quote(2500, START - 1000), START);
  assert.equal(older.state.zones.S1, 'outside');
  const paused = evaluate(settings({ armed: false }), first.state, {}, START + 1000);
  assert.equal(paused.events.length, 0);
  const resumed = evaluate(config, paused.state, quote(2555, START + 2000), START + 2000);
  assert.equal(resumed.events[0].rule, 'R1');
  assert.match(resumed.events[0].message, /Initial state/);
  const revised = evaluate(settings({ revision: 2, cooldownMinutes: 0 }), resumed.state, quote(2555, START + 3000), START + 3000);
  assert.match(revised.events[0].id, /^eth:2:/);
  assert.equal(first.state.quoteCursor, START, 'evaluation never mutates previous state');
  assert.throws(() => evaluate(config, first.state, quote(0), START + 1000));
});

test('daily baselines skip history and completed crossings obey strict boundaries in both directions', () => {
  const config = settings({ mode: 'daily-close' });
  const historical = [candle(D - 2 * DAY, 2500), candle(D - DAY, 2560)];
  let result = daily(config, null, historical, START);
  assert.equal(result.events.length, 0, 'historical breakout is not replayed at activation');
  result = daily(config, result.state, [...historical, candle(D, 2554)], START + DAY * 1000);
  assert.equal(result.events.length, 0, 'equal close is a touch');
  result = daily(config, result.state, [...historical, candle(D, 2554), candle(D + DAY, 2560)], START + 2 * DAY * 1000);
  assert.equal(result.events[0].rule, 'R1');
  assert.equal(result.events[0].mode, 'close');
  assert.equal(result.events[0].time, START + 2 * DAY * 1000);
  assert.equal(daily(config, json(result.state), [...historical, candle(D, 2554), candle(D + DAY, 2560)], START + 2 * DAY * 1000).events.length, 0);
  const initial = daily(config, null, [candle(D - DAY, 2416)], START);
  const below = daily(config, initial.state, [candle(D - DAY, 2416), candle(D, 2415)], START + DAY * 1000);
  assert.equal(below.events[0].rule, 'S1');
});

test('daily incomplete candles, stale intervals, gaps, and revisions do not produce false signals', () => {
  const config = settings({ mode: 'daily-close' });
  const start = daily(config, null, [candle(D - DAY, 2500)], START);
  const incomplete = daily(config, start.state, [candle(D - DAY, 2500), candle(D, 2560)], START + 1000);
  assert.equal(incomplete.events.length, 0);
  assert.throws(() => daily(config, start.state, [candle(D - DAY, 2500)], START + DAY * 1000), /missing or stale/);
  const gap = daily(config, start.state, [candle(D - DAY, 2500), candle(D + DAY, 2560)], START + 2 * DAY * 1000);
  assert.equal(gap.events.length, 0, 'crossing across a missing interval is blocked');
  const revision = daily(settings({ mode: 'daily-close', revision: 2 }), start.state,
    [candle(D - DAY, 2500), candle(D, 2560)], START + DAY * 1000);
  assert.equal(revision.events.length, 0);
  const paused = daily(settings({ mode: 'daily-close', armed: false }), start.state, [], START + DAY * 1000);
  const resumed = daily(config, paused.state, [candle(D - DAY, 2500), candle(D, 2560)], START + DAY * 1000);
  assert.equal(resumed.events.length, 0);
});

function retestSetup(direction = 'above') {
  const config = settings({ mode: 'retest' });
  const original = direction === 'above' ? 2554 : 2416;
  const breached = direction === 'above' ? 2570 : 2400;
  const rows = [candle(D - DAY, original), candle(D, breached, Math.min(original, breached) - 10, Math.max(original, breached) + 10)];
  const baseline = daily(config, null, rows.slice(0, 1), START);
  const setup = daily(config, baseline.state, rows, START + DAY * 1000);
  assert.equal(setup.events.length, 0, 'breakout candle cannot confirm its own retest');
  return { config, rows, state: setup.state };
}

test('retest wick-band touch confirms strictly on breakout side in either direction', () => {
  for (const direction of ['above', 'below']) {
    const { config, rows, state } = retestSetup(direction);
    const close = direction === 'above' ? 2565 : 2405;
    const next = direction === 'above' ? candle(D + DAY, close, 2559, 2580) : candle(D + DAY, close, 2390, 2410);
    const result = daily(config, state, [...rows, next], START + 2 * DAY * 1000);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].rule, direction === 'above' ? 'R1' : 'S1');
    assert.equal(result.state.setups[result.events[0].rule], null);
    assert.equal(daily(config, json(result.state), [...rows, next], START + 2 * DAY * 1000).events.length, 0);
  }
});

test('retests cancel on original/equal closes and gaps, while incomplete candles are ignored', () => {
  for (const close of [2554, 2550]) {
    const { config, rows, state } = retestSetup();
    const result = daily(config, state, [...rows, candle(D + DAY, close)], START + 2 * DAY * 1000);
    assert.equal(result.events.length, 0);
    assert.equal(result.state.setups.R1, null);
  }
  const { config, rows, state } = retestSetup();
  const touch = candle(D + DAY, 2565, 2554, 2580);
  const incomplete = daily(config, state, [...rows, touch], START + DAY * 1000 + 1000);
  assert.equal(incomplete.events.length, 0);
  assert.equal(incomplete.state.setups.R1.waited, 0);
  const gap = daily(config, state, [...rows, candle(D + 2 * DAY, 2565, 2554, 2580)], START + 3 * DAY * 1000);
  assert.equal(gap.events.length, 0);
  assert.equal(gap.state.setups.R1, null);
});

test('a retest can confirm on candle five, expires after candle five, and cannot confirm on six', () => {
  for (const touchFifth of [true, false]) {
    const setup = retestSetup();
    let state = setup.state;
    const rows = [...setup.rows];
    for (let index = 1; index <= 5; index++) {
      rows.push(candle(D + index * DAY, 2570, index === 5 && touchFifth ? 2554 : 2565, 2580));
      const result = daily(setup.config, state, rows, START + (index + 1) * DAY * 1000);
      assert.equal(result.events.length, index === 5 && touchFifth ? 1 : 0);
      state = result.state;
    }
    assert.equal(state.setups.R1, null);
    rows.push(candle(D + 6 * DAY, 2570, 2554, 2580));
    assert.equal(daily(setup.config, state, rows, START + 7 * DAY * 1000).events.length, 0);
  }
});
