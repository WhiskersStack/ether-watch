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

function legacyConfig(config) {
  const next = { ...validateConfig(config) };
  delete next.selectedLevels;
  delete next.proximity;
  delete next.volumeConfirmation;
  return next;
}

function legacyState(state, config) {
  const old = legacyConfig(config);
  const key = JSON.stringify({ levels: old.levels, mode: old.mode, cooldownMinutes: old.cooldownMinutes,
    retestTolerance: old.retestTolerance, retestCandles: old.retestCandles, revision: old.revision });
  const migrated = json(state);
  migrated.version = 1;
  migrated.configKey = key;
  for (const field of ['proximityZones', 'proximityCursor', 'proximityLastAlertAt']) delete migrated[field];
  for (const field of ['zones', 'setups']) migrated[field] = { S1: migrated[field].S1, R1: migrated[field].R1 };
  return migrated;
}

function withVolume(row, volume) {
  return [...row.slice(0, 5), volume];
}

function volumeHistory(close = 2500, volume = 100) {
  return Array.from({ length: 20 }, (_, index) => withVolume(candle(D - (20 - index) * DAY, close), volume));
}

const volumeSettings = overrides => settings({ mode: 'close', volumeConfirmation: { enabled: true, lookbackCandles: 20, minRelativeVolume: 1.5 }, ...overrides });

test('advanced defaults normalize legacy settings and reject invalid simple controls', () => {
  const normalized = validateConfig(legacyConfig(settings()));
  assert.deepEqual(normalized.selectedLevels, ['S1', 'R1']);
  assert.deepEqual(normalized.proximity, { enabled: false, distancePercent: 0.5 });
  assert.deepEqual(normalized.volumeConfirmation, { enabled: false, lookbackCandles: 20, minRelativeVolume: 1.5 });
  assert.deepEqual(validateConfig(settings({ selectedLevels: ['R3', 'S2', 'R1'] })).selectedLevels, ['S2', 'R1', 'R3']);
  for (const selectedLevels of [[], ['S1', 'S1'], ['R4'], null, 'S1']) assert.throws(() => validateConfig(settings({ selectedLevels })));
  for (const proximity of [null, [], { enabled: 'true' }, { distancePercent: 0 }, { distancePercent: -0.5 }, { distancePercent: Infinity }]) {
    assert.throws(() => validateConfig(settings({ proximity })));
  }
  for (const volumeConfirmation of [null, [], { enabled: 'true' }, { minRelativeVolume: 0 }, { lookbackCandles: 19 }]) {
    assert.throws(() => validateConfig(settings({ volumeConfirmation })));
  }
  assert.throws(() => validateConfig(volumeSettings({ mode: 'immediate' })), /requires/);
});

test('selected secondary levels use strict boundaries and preserve default breach IDs', () => {
  const initial = evaluate(settings(), null, quote(2300), START);
  assert.deepEqual(initial.events.map(event => event.rule), ['S1']);
  assert.equal(initial.events[0].id, `eth:1:immediate:S1:below:${START}`);
  const all = settings({ selectedLevels: ['S3', 'S2', 'S1', 'R1', 'R2', 'R3'] });
  assert.deepEqual(evaluate(all, null, quote(2200), START).events.map(event => event.rule), ['S3', 'S2', 'S1']);
  assert.deepEqual(evaluate(all, null, quote(2900), START).events.map(event => event.rule), ['R1', 'R2', 'R3']);
  const secondary = settings({ selectedLevels: ['S2'] });
  let result = evaluate(secondary, null, quote(2373), START);
  assert.equal(result.events.length, 0);
  result = evaluate(secondary, result.state, quote(2372, START + 1000), START + 1000);
  assert.equal(result.events[0].rule, 'S2');
  assert.equal(result.events[0].levelPrice, 2373);
  assert.equal(result.events[0].kind, 'breach');
  assert.equal(result.events[0].revision, 1);
});

test('secondary levels retain daily close and retest semantics', () => {
  const closeConfig = settings({ mode: 'close', selectedLevels: ['R2'] });
  const original = [candle(D - DAY, 2683)];
  const baseline = daily(closeConfig, null, original, START);
  const closed = daily(closeConfig, baseline.state, [...original, candle(D, 2684)], START + DAY * 1000);
  assert.equal(closed.events[0].rule, 'R2');
  const retest = settings({ mode: 'retest', selectedLevels: ['S2'] });
  const rows = [candle(D - DAY, 2373), candle(D, 2360)];
  const start = daily(retest, null, rows.slice(0, 1), START);
  const setup = daily(retest, start.state, rows, START + DAY * 1000);
  assert.equal(setup.events.length, 0);
  assert.equal(setup.decisions[0].reason, 'retest-started');
  const confirmation = daily(retest, setup.state, [...rows, candle(D + DAY, 2360, 2350, 2373)], START + 2 * DAY * 1000);
  assert.equal(confirmation.events[0].rule, 'S2');
});

test('v1 immediate state migrates without replay, reset, lost cooldown, or changed ID semantics', () => {
  const config = settings();
  const initial = evaluate(config, null, quote(2400), START);
  const old = legacyState(initial.state, config);
  const migrated = evaluate(legacyConfig(config), old, quote(2390, START + 1000), START + 1000);
  assert.equal(migrated.events.length, 0);
  assert.equal(migrated.state.version, 2);
  assert.equal(migrated.state.activatedAt, START);
  assert.equal(migrated.state.lastAlertAt.S1, START);
  assert.equal(migrated.state.quoteCursor, START + 1000);
  assert.deepEqual(old, legacyState(initial.state, config), 'migration is pure');
  const reentered = evaluate(config, migrated.state, quote(2416, START + 2000), START + 2000);
  const suppressed = evaluate(config, reentered.state, quote(2415, START + 3000), START + 3000);
  assert.equal(suppressed.events.length, 0);
  assert.equal(suppressed.decisions[0].reason, 'cooldown');
});

test('v1 daily cursors and active retest setups survive the software migration', () => {
  const config = settings({ mode: 'close' });
  const rows = [candle(D - DAY, 2500)];
  const baseline = daily(config, null, rows, START);
  const migrated = daily(config, legacyState(baseline.state, config), rows, START + 1000);
  assert.equal(migrated.state.activatedAt, START);
  assert.equal(migrated.state.candleCursor, D - DAY);
  assert.equal(migrated.events.length, 0);
  const cross = daily(config, migrated.state, [...rows, candle(D, 2560)], START + DAY * 1000);
  assert.equal(cross.events[0].rule, 'R1');
  const setup = retestSetup();
  const confirm = daily(setup.config, legacyState(setup.state, setup.config),
    [...setup.rows, candle(D + DAY, 2565, 2554, 2580)], START + 2 * DAY * 1000);
  assert.equal(confirm.events.length, 1);
  assert.equal(confirm.state.activatedAt, setup.state.activatedAt);
});

test('proximity silently baselines, warns on entry, and cannot suppress an immediate breach', () => {
  const config = settings({ proximity: { enabled: true, distancePercent: 0.5 } });
  assert.equal(evaluate(config, null, quote(2420), START).events.length, 0, 'no synthetic warning on activation');
  let result = evaluate(config, null, quote(2500), START);
  result = evaluate(config, result.state, quote(2416 * 1.005, START + 1000), START + 1000);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'proximity');
  assert.match(result.events[0].id, /:proximity$/);
  assert.equal(result.events[0].rule, 'S1');
  result = evaluate(config, json(result.state), quote(2416, START + 2000), START + 2000);
  assert.equal(result.events.length, 0, 'continuous proximity and equality do not repeat');
  result = evaluate(config, result.state, quote(2415, START + 3000), START + 3000);
  assert.equal(result.events[0].kind, 'breach', 'proximity cooldown does not throttle the breach');
  result = evaluate(config, result.state, quote(2417, START + 4000), START + 4000);
  assert.equal(result.events.length, 0, 'recovering from outside is not approaching');
  result = evaluate(config, result.state, quote(2450, START + 5000), START + 5000);
  result = evaluate(config, result.state, quote(2420, START + 6000), START + 6000);
  assert.equal(result.events.length, 0);
  assert.equal(result.decisions[0].kind, 'proximity');
  assert.equal(result.decisions[0].reason, 'cooldown');
  result = evaluate(config, result.state, quote(2420, START + 31 * 60000), START + 31 * 60000);
  assert.equal(result.events.length, 0, 'suppressed proximity is not reported late');
  result = evaluate(config, result.state, quote(2450, START + 32 * 60000), START + 32 * 60000);
  result = evaluate(config, result.state, quote(2420, START + 33 * 60000), START + 33 * 60000);
  assert.equal(result.events[0].kind, 'proximity');
});

test('resistance proximity, jumps, duplicate quotes, and changed settings use safe baselines', () => {
  const config = settings({ selectedLevels: ['R2'], proximity: { enabled: true, distancePercent: 0.5 } });
  let result = evaluate(config, null, quote(2600), START);
  result = evaluate(config, result.state, quote(2683 - 2683 * 0.005, START + 1000), START + 1000);
  assert.equal(result.events[0].kind, 'proximity');
  assert.equal(result.events[0].rule, 'R2');
  const duplicate = evaluate(config, result.state, quote(2682, START + 1000), START + 2000);
  assert.equal(duplicate.events.length, 0);
  assert.equal(duplicate.decisions.length, 0);
  const reset = evaluate({ ...config, revision: 2 }, result.state, quote(2682, START + 3000), START + 3000);
  assert.equal(reset.events.length, 0);
  const start = evaluate(config, null, quote(2600), START);
  const jumped = evaluate(config, start.state, quote(2690, START + 1000), START + 1000);
  assert.equal(jumped.events.length, 1);
  assert.equal(jumped.events[0].kind, 'breach', 'no manufactured warning for a skipped band');
});

test('daily modes can issue fresh proximity warnings without a new daily close or volume gate', () => {
  const config = volumeSettings({ proximity: { enabled: true, distancePercent: 0.5 } });
  const candles = [candle(D - DAY, 2500)];
  const start = evaluate(config, null, { ...quote(2500), candles }, START);
  const warning = evaluate(config, start.state, { ...quote(2420, START + 1000), candles }, START + 1000);
  assert.equal(warning.events[0].kind, 'proximity');
  assert.equal(warning.events[0].evidence.relativeVolume, undefined);
  assert.equal(warning.state.candleCursor, D - DAY);
  assert.throws(() => evaluate(config, warning.state, { ...quote(2420, START - 180000), candles }, START + 2000), /stale/);
});

test('volume confirmation uses exactly the preceding 20 completed candles and accepts threshold equality', () => {
  const config = volumeSettings();
  const history = volumeHistory();
  const baseline = daily(config, null, history, START);
  const rows = [...history, withVolume(candle(D, 2560), 150), withVolume(candle(D + DAY, 2570), 1000000)];
  const result = daily(config, baseline.state, rows, START + DAY * 1000);
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.evidence.averageVolume, 100);
  assert.equal(event.evidence.candleVolume, 150);
  assert.equal(event.evidence.relativeVolume, 1.5);
  assert.equal(event.evidence.lookbackCandles, 20);
  assert.equal(event.candleTime, D);
  assert.equal(event.levelPrice, 2554);
  assert.equal(event.time, START + DAY * 1000);
  config.levels.R1 = 2550;
  assert.equal(event.levelPrice, 2554, 'history preserves its original level snapshot');
});

test('low-volume close is consumed, decision IDs are deterministic, and continuous breaches do not qualify later', () => {
  const config = volumeSettings();
  const history = volumeHistory(), baseline = daily(config, null, history, START);
  const rows = [...history, withVolume(candle(D, 2560), 149)];
  const low = daily(config, baseline.state, rows, START + DAY * 1000);
  assert.equal(low.events.length, 0);
  assert.equal(low.decisions[0].reason, 'volume-low');
  assert.equal(low.decisions[0].evidence.relativeVolume, 1.49);
  assert.equal(daily(config, baseline.state, rows, START + DAY * 1000 + 1000).decisions[0].id, low.decisions[0].id);
  assert.equal(daily(config, low.state, rows, START + DAY * 1000 + 1000).decisions.length, 0);
  const later = daily(config, low.state, [...rows, withVolume(candle(D + DAY, 2570), 1000)], START + 2 * DAY * 1000);
  assert.equal(later.events.length, 0);
  assert.equal(later.decisions.length, 0);
});

test('missing, insufficient, or zero-average volume history cannot qualify a close', () => {
  const config = volumeSettings();
  const full = volumeHistory();
  for (const history of [full.slice(1), full.filter((_, index) => index !== 5), volumeHistory(2500, 0), volumeHistory(2500, 1e308)]) {
    const baseline = daily(config, null, history, START);
    const result = daily(config, baseline.state, [...history, withVolume(candle(D, 2560), 200)], START + DAY * 1000);
    assert.equal(result.events.length, 0);
    assert.equal(result.decisions[0].reason, 'volume-unavailable');
  }
});

test('a low-volume retest may qualify on a later touched candle within its original window', () => {
  const config = volumeSettings({ mode: 'retest' });
  const history = volumeHistory(2554), baseline = daily(config, null, history, START);
  const rows = [...history, withVolume(candle(D, 2570), 100)];
  const setup = daily(config, baseline.state, rows, START + DAY * 1000);
  assert.equal(setup.events.length, 0, 'breakout volume is not the retest confirmation volume');
  assert.equal(setup.decisions[0].reason, 'retest-started');
  rows.push(withVolume(candle(D + DAY, 2560, 2554, 2580), 100));
  const low = daily(config, setup.state, rows, START + 2 * DAY * 1000);
  assert.equal(low.events.length, 0);
  assert.equal(low.decisions[0].reason, 'volume-low');
  assert.equal(low.state.setups.R1.waited, 1);
  rows.push(withVolume(candle(D + 2 * DAY, 2560, 2554, 2580), 200));
  const confirmed = daily(config, low.state, rows, START + 3 * DAY * 1000);
  assert.equal(confirmed.events.length, 1);
  assert.equal(confirmed.events[0].evidence.relativeVolume, 2);
  assert.equal(confirmed.events[0].candleTime, D + 2 * DAY);
  assert.equal(confirmed.state.setups.R1, null);
});

test('volume-filtered support retests confirm and low-volume windows still expire on candle five', () => {
  const down = volumeSettings({ mode: 'retest', selectedLevels: ['S1'] });
  const history = volumeHistory(2416), baseline = daily(down, null, history, START);
  const rows = [...history, withVolume(candle(D, 2400), 100)];
  const setup = daily(down, baseline.state, rows, START + DAY * 1000);
  const success = daily(down, setup.state, [...rows, withVolume(candle(D + DAY, 2400, 2380, 2416), 150)], START + 2 * DAY * 1000);
  assert.equal(success.events[0].rule, 'S1');
  const config = volumeSettings({ mode: 'retest' });
  const upRows = [...volumeHistory(2554), withVolume(candle(D, 2570), 100)];
  let state = daily(config, daily(config, null, upRows.slice(0, -1), START).state, upRows, START + DAY * 1000).state;
  for (let index = 1; index <= 5; index++) {
    upRows.push(withVolume(candle(D + index * DAY, 2560, 2554, 2580), 100));
    const result = daily(config, state, upRows, START + (index + 1) * DAY * 1000);
    assert.equal(result.events.length, 0);
    assert.ok(result.decisions.some(item => item.reason === 'volume-low'));
    assert.equal(result.decisions.some(item => item.reason === 'retest-expired'), index === 5);
    state = result.state;
  }
  assert.equal(state.setups.R1, null);
  upRows.push(withVolume(candle(D + 6 * DAY, 2560, 2554, 2580), 1000));
  assert.equal(daily(config, state, upRows, START + 7 * DAY * 1000).events.length, 0);
});

test('retest cancellation and gaps produce one durable transition decision without repeat polling records', () => {
  const setup = retestSetup();
  const cancelledRows = [...setup.rows, candle(D + DAY, 2554)];
  const cancelled = daily(setup.config, setup.state, cancelledRows, START + 2 * DAY * 1000);
  assert.deepEqual(cancelled.decisions.map(item => item.reason), ['retest-cancelled']);
  assert.equal(daily(setup.config, cancelled.state, cancelledRows, START + 2 * DAY * 1000 + 1000).decisions.length, 0);
  const gap = daily(setup.config, setup.state, [...setup.rows, candle(D + 2 * DAY, 2560)], START + 3 * DAY * 1000);
  assert.deepEqual(gap.decisions.map(item => item.reason), ['retest-gap']);
});

test('fresh proximity persists through a daily feed failure without deleting a daily retest setup', () => {
  const config = settings({ mode: 'retest', proximity: { enabled: true, distancePercent: 0.5 } });
  const rows = [candle(D - DAY, 2500), candle(D, 2560)];
  const baseline = evaluate(config, null, { ...quote(2500), candles: rows.slice(0, 1) }, START);
  const setup = evaluate(config, baseline.state, { ...quote(2500, START + DAY * 1000), candles: rows }, START + DAY * 1000);
  const failedAt = START + DAY * 1000 + 1000;
  const failed = evaluate(config, setup.state, { ...quote(2545, failedAt), candleError: 'Daily feed unavailable' }, failedAt);
  assert.equal(failed.events.length, 1);
  assert.equal(failed.events[0].kind, 'proximity');
  assert.equal(failed.events[0].rule, 'R1');
  assert.equal(failed.evaluationError, 'Daily feed unavailable');
  assert.equal(failed.state.candleCursor, setup.state.candleCursor);
  assert.deepEqual(failed.state.setups.R1, setup.state.setups.R1);
  const repeated = evaluate(config, failed.state, { ...quote(2545, failedAt + 1000), candles: [] }, failedAt + 1000);
  assert.equal(repeated.events.length, 0);
  assert.ok(repeated.evaluationError);
  assert.deepEqual(repeated.state.setups.R1, setup.state.setups.R1);
  const recovered = evaluate(config, repeated.state, { ...quote(2545, failedAt + 2000), candles: rows }, failedAt + 2000);
  assert.equal(recovered.events.length, 0);
  assert.equal(recovered.decisions.length, 0);
  assert.equal(recovered.evaluationError, undefined);
  assert.deepEqual(recovered.state.setups.R1, setup.state.setups.R1);
  const closedAt = START + 2 * DAY * 1000;
  const confirmed = evaluate(config, recovered.state, { ...quote(2545, closedAt), candles: [...rows, candle(D + DAY, 2565, 2554, 2580)] }, closedAt);
  assert.equal(confirmed.events.length, 1);
  assert.equal(confirmed.events[0].kind, 'breach');
});

test('daily recovery after activation without candles establishes a baseline without replay', () => {
  const config = settings({ mode: 'close', proximity: { enabled: true, distancePercent: 0.5 } });
  const failed = evaluate(config, null, { ...quote(2500), candles: [] }, START);
  assert.equal(failed.state.candleCursor, null);
  assert.equal(failed.events.length, 0);
  assert.ok(failed.evaluationError);
  const rows = [candle(D - 2 * DAY, 2500), candle(D - DAY, 2560)];
  const recovered = evaluate(config, failed.state, { ...quote(2500, START + 1000), candles: rows }, START + 1000);
  assert.equal(recovered.events.length, 0, 'historical close must not replay on recovery');
  assert.equal(recovered.state.candleCursor, D - DAY);
  assert.equal(recovered.evaluationError, undefined);
  assert.throws(() => evaluate(settings({ mode: 'close' }), null, { candles: [] }, START), /missing or stale/);
});
