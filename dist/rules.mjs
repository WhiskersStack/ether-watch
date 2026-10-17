const DAY = 86400;
const LEVEL_IDS = ['S3', 'S2', 'S1', 'R1', 'R2', 'R3'];
const MODES = ['immediate', 'close', 'retest'];
const PRIMARY_LEVELS = ['S1', 'R1'];

export const DEFAULT_CONFIG = Object.freeze({
  levels: Object.freeze({ S3: 2320, S2: 2373, S1: 2416, R1: 2554, R2: 2683, R3: 2813 }),
  mode: 'immediate', cooldownMinutes: 30, retestTolerance: 0.25, retestCandles: 5, armed: true,
  selectedLevels: Object.freeze(['S1', 'R1']),
  proximity: Object.freeze({ enabled: false, distancePercent: 0.5 }),
  volumeConfirmation: Object.freeze({ enabled: false, lookbackCandles: 20, minRelativeVolume: 1.5 })
});

function finiteNumber(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !value.trim())) throw new Error(`${label} must be a finite number.`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be a finite number.`);
  return result;
}

function timestamp(value, label = 'Time') {
  const result = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be a valid timestamp.`);
  return result;
}

function objectOption(value, defaults, label) {
  if (value === undefined) return defaults;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function booleanOption(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object.');
  if (!input.levels || typeof input.levels !== 'object') throw new Error('All six price levels are required.');
  const levels = {};
  for (const id of LEVEL_IDS) {
    const value = input.levels[id];
    if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
      throw new Error(`${id} must be a positive USD amount with at most two decimal places.`);
    }
    const amount = finiteNumber(value, id);
    if (amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
      throw new Error(`${id} must be a positive USD amount with at most two decimal places.`);
    }
    levels[id] = Math.round(amount * 100) / 100;
  }
  if (LEVEL_IDS.some((id, index) => index && levels[LEVEL_IDS[index - 1]] >= levels[id])) {
    throw new Error('Levels must increase in this order: S3 < S2 < S1 < R1 < R2 < R3.');
  }
  const requestedMode = input.mode ?? DEFAULT_CONFIG.mode;
  const mode = requestedMode === 'daily-close' ? 'close' : requestedMode;
  if (!MODES.includes(mode)) throw new Error('Choose immediate, close, or retest mode.');
  const cooldownMinutes = finiteNumber(input.cooldownMinutes ?? DEFAULT_CONFIG.cooldownMinutes, 'Cooldown');
  const retestTolerance = finiteNumber(input.retestTolerance ?? DEFAULT_CONFIG.retestTolerance, 'Retest tolerance');
  const retestCandles = finiteNumber(input.retestCandles ?? DEFAULT_CONFIG.retestCandles, 'Retest expiry');
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 1440) {
    throw new Error('Cooldown must be a whole number between 0 and 1440 minutes.');
  }
  if (retestTolerance <= 0 || retestTolerance > 10) throw new Error('Retest tolerance must be greater than 0 and at most 10 percent.');
  if (!Number.isInteger(retestCandles) || retestCandles < 1 || retestCandles > 30) throw new Error('Retest expiry must be a whole number from 1 to 30 candles.');
  const armed = booleanOption(input.armed, DEFAULT_CONFIG.armed, 'Armed status');
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Settings revision must be a positive integer.');

  const selected = input.selectedLevels === undefined ? PRIMARY_LEVELS : input.selectedLevels;
  if (!Array.isArray(selected) || !selected.length || selected.some(id => !LEVEL_IDS.includes(id)) || new Set(selected).size !== selected.length) {
    throw new Error('Select at least one of the six existing alert levels without duplicates.');
  }
  const selectedLevels = LEVEL_IDS.filter(id => selected.includes(id));
  const near = objectOption(input.proximity, DEFAULT_CONFIG.proximity, 'Proximity settings');
  const distancePercent = finiteNumber(near.distancePercent ?? DEFAULT_CONFIG.proximity.distancePercent, 'Proximity distance');
  if (distancePercent <= 0 || LEVEL_IDS.some(id => !Number.isFinite(levels[id] * (1 + distancePercent / 100)))) {
    throw new Error('Proximity distance must be a finite positive percentage.');
  }
  const proximity = { enabled: booleanOption(near.enabled, false, 'Proximity status'), distancePercent };
  const volume = objectOption(input.volumeConfirmation, DEFAULT_CONFIG.volumeConfirmation, 'Volume confirmation settings');
  const lookbackCandles = finiteNumber(volume.lookbackCandles ?? 20, 'Volume lookback');
  const minRelativeVolume = finiteNumber(volume.minRelativeVolume ?? 1.5, 'Relative volume threshold');
  if (lookbackCandles !== 20) throw new Error('Volume confirmation compares against the preceding 20 completed daily candles.');
  if (minRelativeVolume <= 0) throw new Error('Relative volume threshold must be positive.');
  const volumeConfirmation = { enabled: booleanOption(volume.enabled, false, 'Volume confirmation status'), lookbackCandles, minRelativeVolume };
  if (volumeConfirmation.enabled && mode === 'immediate') throw new Error('Completed daily volume confirmation requires daily-close or retest mode.');
  return { levels, mode, cooldownMinutes, retestTolerance, retestCandles, armed, revision, selectedLevels, proximity, volumeConfirmation };
}

export function acceptTicker(ticker, now = Date.now()) {
  const checkedAt = timestamp(now);
  if (!ticker || typeof ticker !== 'object') throw new Error('A fresh price quote is required.');
  const price = finiteNumber(ticker.price, 'Quote price');
  if (price <= 0) throw new Error('Quote price must be positive.');
  const time = timestamp(ticker.time, 'Quote source time');
  if (checkedAt - time > 120000) throw new Error('The price quote is stale (older than 120 seconds).');
  if (time - checkedAt > 30000) throw new Error('The price quote is more than 30 seconds in the future.');
  return { price, time };
}

function readCandle(row) {
  const source = Array.isArray(row) ?
    (row.length === 6 ? { time: row[0], low: row[1], high: row[2], open: row[3], close: row[4], volume: row[5] } : null) : row;
  if (!source || typeof source !== 'object') throw new Error('Each daily candle must contain six valid fields.');
  const candle = {};
  for (const key of ['time', 'low', 'high', 'open', 'close', 'volume']) candle[key] = finiteNumber(source[key], `Candle ${key}`);
  if (!Number.isSafeInteger(candle.time) || candle.time < 0 || candle.time % DAY !== 0) {
    throw new Error('Daily candle timestamps must be UTC day starts in epoch seconds.');
  }
  if (['low', 'high', 'open', 'close'].some(key => candle[key] <= 0) || candle.volume < 0 ||
      candle.low > candle.open || candle.low > candle.close || candle.open > candle.high || candle.close > candle.high) {
    throw new Error('Daily candles require positive coherent OHLC and nonnegative volume.');
  }
  return candle;
}

export function normalizeCandles(raw, now = Date.now()) {
  const checkedAt = timestamp(now);
  if (!Array.isArray(raw)) throw new Error('Daily candles must be an array.');
  const byTime = new Map();
  for (const row of raw) {
    const candle = readCandle(row);
    const existing = byTime.get(candle.time);
    if (existing && Object.keys(candle).some(key => existing[key] !== candle[key])) throw new Error('Conflicting duplicate daily candles cannot be evaluated.');
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].filter(candle => (candle.time + DAY) * 1000 <= checkedAt).sort((a, b) => a.time - b.time);
}

function rulesFor(config) {
  return config.selectedLevels.map(id => ({ id, direction: id.startsWith('S') ? 'below' : 'above' }));
}

function outside(rule, price, level) {
  return rule.direction === 'below' ? price < level : price > level;
}

function legacyConfigKey(config) {
  return JSON.stringify({ levels: config.levels, mode: config.mode, cooldownMinutes: config.cooldownMinutes,
    retestTolerance: config.retestTolerance, retestCandles: config.retestCandles, revision: config.revision });
}

function configKey(config) {
  return JSON.stringify({ legacy: legacyConfigKey(config), selectedLevels: config.selectedLevels,
    proximity: config.proximity, volumeConfirmation: config.volumeConfirmation });
}

function emptyRules() {
  return Object.fromEntries(LEVEL_IDS.map(id => [id, null]));
}

function savedTimes(value) {
  return Object.fromEntries(LEVEL_IDS.filter(id => Number.isFinite(value?.[id]) && value[id] >= 0).map(id => [id, value[id]]));
}

function baseline(config, previous, now) {
  return {
    version: 2, revision: config.revision, configKey: configKey(config), activatedAt: now, updatedAt: now,
    armed: config.armed, quoteCursor: null, candleCursor: null, lastEvaluatedCandle: null,
    zones: emptyRules(), lastAlertAt: savedTimes(previous?.lastAlertAt), lastCrossingAt: {}, setups: emptyRules(),
    proximityZones: emptyRules(), proximityCursor: null, proximityLastAlertAt: savedTimes(previous?.proximityLastAlertAt)
  };
}

function restore(config, previous, now) {
  const defaultsOnly = config.selectedLevels.join(',') === PRIMARY_LEVELS.join(',') && !config.proximity.enabled && !config.volumeConfirmation.enabled;
  const legacyMatch = previous?.version === 1 && previous.configKey === legacyConfigKey(config) && defaultsOnly;
  const currentMatch = previous?.version === 2 && previous.configKey === configKey(config);
  if ((legacyMatch || currentMatch) && previous.armed === config.armed) {
    const state = { ...baseline(config, previous, now), ...JSON.parse(JSON.stringify(previous)), version: 2, configKey: configKey(config) };
    state.zones = { ...emptyRules(), ...state.zones };
    state.setups = { ...emptyRules(), ...state.setups };
    state.proximityZones = { ...emptyRules(), ...state.proximityZones };
    return { state, reset: false };
  }
  return { state: baseline(config, previous, now), reset: true };
}

function metadata(config, rule, price, time, now, { kind = 'breach', candleTime, evidence } = {}) {
  return { rule: rule.id, direction: rule.direction, kind, mode: config.mode, revision: config.revision,
    levelPrice: config.levels[rule.id], time, price, evaluatedAt: now,
    ...(candleTime === undefined ? {} : { candleTime }), ...(evidence ? { evidence } : {}) };
}

function decision(config, decisions, rule, reason, price, time, sourceId, now, options = {}) {
  const kind = options.kind ?? 'breach';
  const descriptions = {
    cooldown: 'Crossing suppressed during cooldown', 'volume-low': 'Relative volume below the confirmation threshold',
    'volume-unavailable': 'Contiguous completed daily volume history unavailable',
    'retest-started': 'Daily breakout started a retest window', 'retest-cancelled': 'Retest cancelled by an original-side or equal close',
    'retest-expired': 'Retest window expired', 'retest-gap': 'Retest cancelled by a missing daily interval'
  };
  decisions.push({ id: `eth-decision:${config.revision}:${config.mode}:${rule.id}:${kind}:${reason}:${sourceId}`,
    ...metadata(config, rule, price, time, now, options), reason,
    message: `${descriptions[reason] ?? reason}: ${rule.id} ($${config.levels[rule.id].toFixed(2)}).` });
}

function emit(config, state, events, decisions, rule, price, sourceTime, sourceId, now, options = {}) {
  const kind = options.kind ?? 'breach';
  const times = kind === 'proximity' ? state.proximityLastAlertAt : state.lastAlertAt;
  if (kind === 'breach') state.lastCrossingAt[rule.id] = sourceTime;
  const lastAlert = times[rule.id];
  if (Number.isFinite(lastAlert) && now - lastAlert < config.cooldownMinutes * 60000) {
    decision(config, decisions, rule, 'cooldown', price, sourceTime, sourceId, now, options);
    return;
  }
  const description = kind === 'proximity' ? 'Approaching level' : options.initial ? 'Initial state on activation' :
    config.mode === 'close' ? 'Completed daily close' : config.mode === 'retest' ? 'Completed daily retest' : 'Price breach';
  events.push({
    id: `eth:${config.revision}:${config.mode}:${rule.id}:${rule.direction}:${sourceId}${kind === 'proximity' ? ':proximity' : ''}`,
    ...metadata(config, rule, price, sourceTime, now, options), initial: Boolean(options.initial),
    message: kind === 'proximity' ?
      `${description}: ETH $${price.toFixed(2)} is within ${config.proximity.distancePercent}% of ${rule.id} ($${config.levels[rule.id].toFixed(2)}).` :
      `${description}: ETH $${price.toFixed(2)} ${rule.direction} ${rule.id} ($${config.levels[rule.id].toFixed(2)}).`
  });
  times[rule.id] = now;
}

function evaluateProximity(config, state, events, decisions, rules, quote, now) {
  if (!config.proximity.enabled || state.proximityCursor !== null && quote.time <= state.proximityCursor) return;
  for (const rule of rules) {
    const level = config.levels[rule.id], distance = level * (config.proximity.distancePercent / 100);
    const breached = outside(rule, quote.price, level);
    const near = rule.direction === 'below' ? quote.price <= level + distance : quote.price >= level - distance;
    const zone = breached ? 'outside' : near ? 'near' : 'far';
    if (zone === 'near' && state.proximityZones[rule.id] === 'far') {
      emit(config, state, events, decisions, rule, quote.price, quote.time, quote.time, now, {
        kind: 'proximity', evidence: { distancePercent: Math.abs(quote.price - level) / level * 100, thresholdPercent: config.proximity.distancePercent }
      });
    }
    state.proximityZones[rule.id] = zone;
  }
  state.proximityCursor = quote.time;
}

function volumeResult(config, candles, index) {
  if (!config.volumeConfirmation.enabled) return { qualified: true };
  const { lookbackCandles, minRelativeVolume } = config.volumeConfirmation;
  const window = candles.slice(Math.max(0, index - lookbackCandles), index + 1);
  const evidence = { lookbackCandles, minRelativeVolume, volumeSource: 'Coinbase ETH-USD' };
  if (window.length !== lookbackCandles + 1 || window.some((row, i) => i && row.time - window[i - 1].time !== DAY)) {
    return { qualified: false, reason: 'volume-unavailable', evidence };
  }
  const averageVolume = window.slice(0, -1).reduce((sum, row) => sum + row.volume, 0) / lookbackCandles;
  const candleVolume = window.at(-1).volume, relativeVolume = candleVolume / averageVolume;
  if (!(averageVolume > 0) || !Number.isFinite(averageVolume) || !Number.isFinite(relativeVolume)) return { qualified: false, reason: 'volume-unavailable', evidence };
  return { qualified: relativeVolume >= minRelativeVolume, reason: 'volume-low',
    evidence: { ...evidence, candleVolume, averageVolume, relativeVolume } };
}

/** Ticker/state/event times use epoch milliseconds; candleTime/candle cursors use UTC epoch seconds. */
export function evaluate(input, previous, sample = {}, now = Date.now()) {
  const config = validateConfig(input), checkedAt = timestamp(now), rules = rulesFor(config);
  const { state, reset } = restore(config, previous, checkedAt);
  const events = [], decisions = [];
  state.updatedAt = checkedAt;
  if (!config.armed) {
    state.armed = false;
    state.setups = emptyRules();
    return { state, events, decisions };
  }
  if (config.mode === 'immediate') {
    const quote = acceptTicker(sample, checkedAt);
    if (state.quoteCursor !== null && quote.time <= state.quoteCursor) return { state, events, decisions };
    for (const rule of rules) {
      const breached = outside(rule, quote.price, config.levels[rule.id]);
      const initial = state.zones[rule.id] === null;
      if (breached && (initial || state.zones[rule.id] === 'inside')) emit(config, state, events, decisions, rule, quote.price, quote.time, quote.time, checkedAt, { initial });
      state.zones[rule.id] = breached ? 'outside' : 'inside';
    }
    evaluateProximity(config, state, events, decisions, rules, quote, checkedAt);
    state.quoteCursor = quote.time;
    return { state, events, decisions };
  }

  if (config.proximity.enabled) evaluateProximity(config, state, events, decisions, rules, acceptTicker(sample, checkedAt), checkedAt);
  let candles, latest;
  try {
    if (sample.candleError) throw new Error(sample.candleError);
    candles = normalizeCandles(sample.candles, checkedAt);
    latest = candles.at(-1);
    const expected = (Math.floor(checkedAt / (DAY * 1000)) - 1) * DAY;
    if (!latest || latest.time !== expected) throw new Error('The latest completed UTC daily candle is missing or stale.');
  } catch (error) {
    if (!config.proximity.enabled) throw error;
    return { state, events, decisions, evaluationError: error.message };
  }
  if (reset || state.candleCursor === null) {
    state.candleCursor = latest.time;
    state.lastEvaluatedCandle = latest.time;
    for (const rule of rules) state.zones[rule.id] = outside(rule, latest.close, config.levels[rule.id]) ? 'outside' : 'inside';
    return { state, events, decisions };
  }

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    if (candle.time <= state.candleCursor) continue;
    const prior = candles[index - 1], sourceTime = (candle.time + DAY) * 1000;
    const contiguous = prior && candle.time - prior.time === DAY;
    const stateContiguous = candle.time - state.candleCursor === DAY;
    if (!contiguous || !stateContiguous) {
      for (const rule of rules) if (state.setups[rule.id]) {
        decision(config, decisions, rule, 'retest-gap', candle.close, sourceTime, candle.time, checkedAt, { candleTime: candle.time });
      }
      state.setups = emptyRules();
    }
    for (const rule of rules) {
      const level = config.levels[rule.id], breached = outside(rule, candle.close, level), setup = state.setups[rule.id];
      if (config.mode === 'retest' && setup) {
        setup.waited += 1;
        if (!breached) {
          decision(config, decisions, rule, 'retest-cancelled', candle.close, sourceTime, candle.time, checkedAt, { candleTime: candle.time });
          state.setups[rule.id] = null;
        } else {
          const tolerance = level * config.retestTolerance / 100;
          const touch = candle.low <= level + tolerance && candle.high >= level - tolerance;
          if (touch && setup.waited <= config.retestCandles) {
            const volume = volumeResult(config, candles, index);
            const options = { candleTime: candle.time, evidence: volume.evidence };
            if (volume.qualified) {
              emit(config, state, events, decisions, rule, candle.close, sourceTime, candle.time, checkedAt, options);
              state.setups[rule.id] = null;
            } else decision(config, decisions, rule, volume.reason, candle.close, sourceTime, candle.time, checkedAt, options);
          }
          if (state.setups[rule.id] && setup.waited >= config.retestCandles) {
            decision(config, decisions, rule, 'retest-expired', candle.close, sourceTime, candle.time, checkedAt, { candleTime: candle.time });
            state.setups[rule.id] = null;
          }
        }
      }
      if (contiguous && breached && !outside(rule, prior.close, level)) {
        state.lastCrossingAt[rule.id] = sourceTime;
        if (config.mode === 'close') {
          const volume = volumeResult(config, candles, index), options = { candleTime: candle.time, evidence: volume.evidence };
          if (volume.qualified) emit(config, state, events, decisions, rule, candle.close, sourceTime, candle.time, checkedAt, options);
          else decision(config, decisions, rule, volume.reason, candle.close, sourceTime, candle.time, checkedAt, options);
        } else {
          state.setups[rule.id] = { breakoutTime: candle.time, waited: 0 };
          decision(config, decisions, rule, 'retest-started', candle.close, sourceTime, candle.time, checkedAt, { candleTime: candle.time });
        }
      }
      state.zones[rule.id] = breached ? 'outside' : 'inside';
    }
    state.candleCursor = candle.time;
    state.lastEvaluatedCandle = candle.time;
  }
  return { state, events, decisions };
}
