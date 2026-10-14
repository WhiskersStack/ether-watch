const DAY = 86400;
const LEVEL_IDS = ['S3', 'S2', 'S1', 'R1', 'R2', 'R3'];
const MODES = ['immediate', 'close', 'retest'];
const RULES = [{ id: 'S1', direction: 'below' }, { id: 'R1', direction: 'above' }];

export const DEFAULT_CONFIG = Object.freeze({
  levels: Object.freeze({ S3: 2320, S2: 2373, S1: 2416, R1: 2554, R2: 2683, R3: 2813 }),
  mode: 'immediate',
  cooldownMinutes: 30,
  retestTolerance: 0.25,
  retestCandles: 5,
  armed: true
});

function finiteNumber(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !value.trim())) throw new Error(`${label} must be a finite number.`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be a finite number.`);
  return result;
}

function timestamp(value, label = 'Time') {
  const result = value instanceof Date ? value.getTime() :
    typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be a valid timestamp.`);
  return result;
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
  const armed = input.armed ?? DEFAULT_CONFIG.armed;
  if (typeof armed !== 'boolean') throw new Error('Armed status must be true or false.');
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Settings revision must be a positive integer.');
  return { levels, mode, cooldownMinutes, retestTolerance, retestCandles, armed, revision };
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
  for (const key of ['time', 'low', 'high', 'open', 'close', 'volume']) {
    candle[key] = finiteNumber(source[key], `Candle ${key}`);
  }
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
    if (existing && Object.keys(candle).some(key => existing[key] !== candle[key])) {
      throw new Error('Conflicting duplicate daily candles cannot be evaluated.');
    }
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].filter(candle => (candle.time + DAY) * 1000 <= checkedAt)
    .sort((a, b) => a.time - b.time);
}

function outside(rule, price, level) {
  return rule.direction === 'below' ? price < level : price > level;
}

function configKey(config) {
  return JSON.stringify({ levels: config.levels, mode: config.mode, cooldownMinutes: config.cooldownMinutes,
    retestTolerance: config.retestTolerance, retestCandles: config.retestCandles, revision: config.revision });
}

function baseline(config, previous, now) {
  const lastAlertAt = {};
  for (const rule of RULES) {
    const value = previous?.lastAlertAt?.[rule.id];
    if (Number.isFinite(value) && value >= 0) lastAlertAt[rule.id] = value;
  }
  return {
    version: 1, revision: config.revision, configKey: configKey(config), activatedAt: now, updatedAt: now,
    armed: config.armed, quoteCursor: null, candleCursor: null, lastEvaluatedCandle: null,
    zones: { S1: null, R1: null }, lastAlertAt, lastCrossingAt: {}, setups: { S1: null, R1: null }
  };
}

function eventFor(config, rule, price, sourceTime, sourceId, initial) {
  const level = config.levels[rule.id].toFixed(2);
  const kind = initial ? 'Initial state on activation' :
    config.mode === 'close' ? 'Completed daily close' : config.mode === 'retest' ? 'Completed daily retest' : 'Price breach';
  return {
    id: `eth:${config.revision}:${config.mode}:${rule.id}:${rule.direction}:${sourceId}`,
    rule: rule.id, direction: rule.direction, mode: config.mode, time: sourceTime, price,
    message: `${kind}: ETH $${price.toFixed(2)} ${rule.direction} ${rule.id} ($${level}).`
  };
}

function emit(config, state, events, rule, price, sourceTime, sourceId, now, initial = false) {
  state.lastCrossingAt[rule.id] = sourceTime;
  const lastAlert = state.lastAlertAt[rule.id];
  if (Number.isFinite(lastAlert) && now - lastAlert < config.cooldownMinutes * 60000) return;
  events.push(eventFor(config, rule, price, sourceTime, sourceId, initial));
  state.lastAlertAt[rule.id] = now;
}

/** Times in ticker/state/events are epoch milliseconds; candle times are UTC epoch seconds. */
export function evaluate(input, previous, sample = {}, now = Date.now()) {
  const config = validateConfig(input);
  const checkedAt = timestamp(now);
  const reset = !previous || previous.version !== 1 || previous.configKey !== configKey(config) ||
    previous.armed !== config.armed;
  const state = reset ? baseline(config, previous, checkedAt) : JSON.parse(JSON.stringify(previous));
  const events = [];
  state.updatedAt = checkedAt;
  if (!config.armed) {
    state.armed = false;
    state.setups = { S1: null, R1: null };
    return { state, events };
  }
  if (config.mode === 'immediate') {
    const quote = acceptTicker(sample, checkedAt);
    if (state.quoteCursor !== null && quote.time <= state.quoteCursor) return { state, events };
    for (const rule of RULES) {
      const breached = outside(rule, quote.price, config.levels[rule.id]);
      const initial = state.zones[rule.id] === null;
      if (breached && (initial || state.zones[rule.id] === 'inside')) {
        emit(config, state, events, rule, quote.price, quote.time, quote.time, checkedAt, initial);
      }
      state.zones[rule.id] = breached ? 'outside' : 'inside';
    }
    state.quoteCursor = quote.time;
    return { state, events };
  }

  const candles = normalizeCandles(sample.candles, checkedAt);
  const latest = candles.at(-1);
  const expected = (Math.floor(checkedAt / (DAY * 1000)) - 1) * DAY;
  if (!latest || latest.time !== expected) throw new Error('The latest completed UTC daily candle is missing or stale.');
  if (reset || state.candleCursor === null) {
    state.candleCursor = latest.time;
    state.lastEvaluatedCandle = latest.time;
    for (const rule of RULES) state.zones[rule.id] = outside(rule, latest.close, config.levels[rule.id]) ? 'outside' : 'inside';
    return { state, events };
  }

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    if (candle.time <= state.candleCursor) continue;
    const prior = candles[index - 1];
    const contiguous = prior && candle.time - prior.time === DAY;
    const stateContiguous = candle.time - state.candleCursor === DAY;
    if (!contiguous || !stateContiguous) state.setups = { S1: null, R1: null };
    for (const rule of RULES) {
      const level = config.levels[rule.id];
      const breached = outside(rule, candle.close, level);
      const setup = state.setups[rule.id];
      if (config.mode === 'retest' && setup) {
        setup.waited += 1;
        if (!breached) state.setups[rule.id] = null;
        else {
          const tolerance = level * config.retestTolerance / 100;
          const touch = candle.low <= level + tolerance && candle.high >= level - tolerance;
          if (touch && setup.waited <= config.retestCandles) {
            emit(config, state, events, rule, candle.close, (candle.time + DAY) * 1000, candle.time, checkedAt);
            state.setups[rule.id] = null;
          } else if (setup.waited >= config.retestCandles) state.setups[rule.id] = null;
        }
      }
      if (contiguous && breached && !outside(rule, prior.close, level)) {
        if (config.mode === 'close') {
          emit(config, state, events, rule, candle.close, (candle.time + DAY) * 1000, candle.time, checkedAt);
        } else {
          state.setups[rule.id] = { breakoutTime: candle.time, waited: 0 };
        }
      }
      state.zones[rule.id] = breached ? 'outside' : 'inside';
    }
    state.candleCursor = candle.time;
    state.lastEvaluatedCandle = candle.time;
  }
  return { state, events };
}
