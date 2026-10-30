export const DEFAULT_CHART_OPTIONS = Object.freeze({
  type: 'candles', ema: false, volume: true, profile: true,
  levels: true, flips: true, scale: 'linear', bars: 90,
  fit: 'levels', rsi: false, macd: false, news: false,
});

const DAY = 86400;
const DEFAULT_CHART_PALETTE = Object.freeze({
  up:'#bce58a', down:'#d88780', grid:'#384146', muted:'#9ba6aa', text:'#edf0ed',
  ema20:'#e6bc73', ema50:'#b6abec', rsi:'#92bee9', support:'#c2ef83', resistance:'#e78e87', profile:'#a1aba5',
  accent:'#c2ef83', 'on-accent':'#172014', 'accent-surface':'#252e22', crosshair:'#b2c0c5',
  'cursor-bg':'#edf0ed', 'cursor-text':'#101315', zero:'#697579',
});

export function readChartPalette(canvas) {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
  return Object.fromEntries(Object.entries(DEFAULT_CHART_PALETTE).map(([key, fallback]) => {
    const value = style?.getPropertyValue('--chart-' + key).trim();
    // Six-digit tokens keep alpha variants predictable and provide a CSS-unavailable fallback.
    return [key, /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback];
  }));
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatUSD = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatAxis = value => value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 2 : 0 });

export function normalizeChartCandles(rows, granularity = DAY, now = Date.now()) {
  if (!Array.isArray(rows) || !Number.isInteger(granularity) || granularity <= 0) return [];
  const byTime = new Map();
  for (const row of rows) {
    const candle = Array.isArray(row)
      ? { time: row[0], low: row[1], high: row[2], open: row[3], close: row[4], volume: row[5] }
      : row;
    if (!candle || !['time', 'low', 'high', 'open', 'close', 'volume'].every(key => Number.isFinite(candle[key]))) continue;
    if (!Number.isInteger(candle.time) || candle.time < 0 || candle.time % granularity !== 0 || candle.time > now / 1000) continue;
    if (candle.low <= 0 || candle.high < candle.low || candle.open < candle.low || candle.open > candle.high || candle.close < candle.low || candle.close > candle.high || candle.volume < 0) continue;
    byTime.set(candle.time, { time: candle.time, low: candle.low, high: candle.high, open: candle.open, close: candle.close, volume: candle.volume });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function normalizeChartEvents(rows, now = Date.now()) {
  if (!Array.isArray(rows) || !Number.isFinite(now)) return [];
  const events = new Map();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id.trim() || !Number.isFinite(row.time) || row.time < 0 || row.time > now / 1000) continue;
    if (typeof row.title !== 'string' || !row.title.trim() || typeof row.source !== 'string' || !row.source.trim()) continue;
    events.set(row.id, { id: row.id, time: row.time, title: row.title.trim(), source: row.source.trim(), category: typeof row.category === 'string' ? row.category.trim() : 'News' });
  }
  return [...events.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function findContainingCandle(candles, time, granularity = DAY) {
  if (!Array.isArray(candles) || !Number.isFinite(time) || !Number.isInteger(granularity) || granularity <= 0) return -1;
  let low = 0, high = candles.length - 1, index = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time <= time) { index = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return index >= 0 && time < candles[index].time + granularity ? index : -1;
}

export function groupChartEvents(events, candles, granularity = DAY) {
  if (!Array.isArray(events)) return [];
  const groups = new Map();
  for (const event of events) {
    const index = findContainingCandle(candles, event?.time, granularity);
    if (index < 0) continue;
    if (!groups.has(index)) groups.set(index, { index, time: candles[index].time, events: [] });
    groups.get(index).events.push({ ...event });
  }
  return [...groups.values()].sort((a, b) => a.index - b.index);
}

// Screen-space bins preserve every headline without squeezing touch targets together.
export function clusterChartEvents(groups, x, left, right, minimumWidth = 44) {
  if (!groups.length || right <= left) return [];
  const count = Math.max(1, Math.floor((right - left) / minimumWidth));
  const width = (right - left) / count, bins = new Map();
  for (const group of groups) {
    const anchor = x(group.index);
    const bin = clamp(Math.floor((anchor - left) / width), 0, count - 1);
    if (!bins.has(bin)) bins.set(bin, { index: group.index, endIndex: group.index, time: group.time,
      x: left + (bin + .5) * width, minX: anchor, maxX: anchor, candleCount: 0, events: [] });
    const cluster = bins.get(bin);
    cluster.endIndex = group.index;
    cluster.minX = Math.min(cluster.minX, anchor);
    cluster.maxX = Math.max(cluster.maxX, anchor);
    cluster.candleCount++;
    cluster.events.push(...group.events.map(event => ({ ...event })));
  }
  return [...bins.values()].map(cluster => ({ ...cluster,
    startTime: Math.min(...cluster.events.map(event => event.time)),
    endTime: Math.max(...cluster.events.map(event => event.time)) }));
}

export function viewportBounds(length, bars = 90, end = length) {
  const total = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (!total) return { start: 0, end: 0, bars: 0 };
  const requested = Number.isFinite(bars) ? Math.round(bars) : 90;
  const count = clamp(requested, Math.min(20, total), total);
  const finish = clamp(Number.isFinite(end) ? Math.round(end) : total, count, total);
  return { start: finish - count, end: finish, bars: count };
}

export function calculateEMA(values, period) {
  const result = Array(values.length).fill(null);
  if (!Number.isInteger(period) || period < 1 || values.length < period || !values.every(Number.isFinite)) return result;
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  result[period - 1] = value;
  const weight = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    value = values[index] * weight + value * (1 - weight);
    result[index] = value;
  }
  return result;
}

export function calculateRSI(values, period = 14) {
  const result = Array(values.length).fill(null);
  if (!Number.isInteger(period) || period < 1 || values.length <= period || !values.every(Number.isFinite)) return result;
  let gain = 0, loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    gain += Math.max(change, 0) / period;
    loss += Math.max(-change, 0) / period;
  }
  const strength = () => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  result[period] = strength();
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = strength();
  }
  return result;
}

export function calculateMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const macd = Array(values.length).fill(null), signal = [...macd], histogram = [...macd];
  if (![fastPeriod, slowPeriod, signalPeriod].every(period => Number.isInteger(period) && period > 0) || fastPeriod >= slowPeriod || !values.every(Number.isFinite)) return { macd, signal, histogram };
  const fast = calculateEMA(values, fastPeriod), slow = calculateEMA(values, slowPeriod);
  const valid = [];
  for (let index = 0; index < values.length; index++) {
    if (fast[index] === null || slow[index] === null) continue;
    macd[index] = fast[index] - slow[index];
    valid.push(index);
  }
  const signalValues = calculateEMA(valid.map(index => macd[index]), signalPeriod);
  valid.forEach((index, position) => {
    signal[index] = signalValues[position];
    if (signal[index] !== null) histogram[index] = macd[index] - signal[index];
  });
  return { macd, signal, histogram };
}

export function calculateChartIndicators(candles, granularity = DAY, now = Date.now()) {
  const result = Object.fromEntries(['rsi', 'macd', 'signal', 'histogram'].map(key => [key, Array(candles.length).fill(null)]));
  if (!Number.isInteger(granularity) || granularity <= 0 || !Number.isFinite(now)) return result;
  let segment = [];
  const finish = () => {
    if (!segment.length) return;
    const closes = segment.map(index => candles[index].close);
    const values = { rsi: calculateRSI(closes), ...calculateMACD(closes) };
    for (const key of Object.keys(result)) segment.forEach((index, position) => { result[key][index] = values[key][position]; });
    segment = [];
  };
  candles.forEach((candle, index) => {
    if (!Number.isFinite(candle?.time) || !Number.isFinite(candle.close) || candle.close <= 0 || candle.time + granularity > now / 1000) { finish(); return; }
    if (segment.length && candle.time - candles[segment.at(-1)].time !== granularity) finish();
    segment.push(index);
  });
  finish();
  return result;
}

export function calculatePriceBounds(candles, { levels = [], price = null, emaValues = [], fit = 'levels', atLatest = true } = {}) {
  const values = candles.flatMap(candle => [candle.low, candle.high]).filter(value => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  values.push(...emaValues.filter(value => Number.isFinite(value) && value > 0));
  if (fit === 'levels') {
    values.push(...levels.map(level => level.price).filter(value => Number.isFinite(value) && value > 0));
    if (atLatest && Number.isFinite(price) && price > 0) values.push(price);
  }
  const low = Math.min(...values), high = Math.max(...values), span = high - low || high * 0.02;
  const min = Math.max(Number.MIN_VALUE, low * 0.95, low - span * 0.035);
  const paddedMax = high + span * 0.035;
  let max = Number.isFinite(paddedMax) ? paddedMax : high;
  if (max <= min) max = Math.max(high * 1.01, Number.MIN_VALUE * 2);
  return { min, max };
}

export function estimateVolumeProfile(candles, bins = 30) {
  if (!candles.length || !Number.isInteger(bins) || bins < 1 || bins > 200) return null;
  const lowest = Math.min(...candles.map(candle => candle.low));
  const highest = Math.max(...candles.map(candle => candle.high));
  if (!(lowest > 0) || !Number.isFinite(highest) || highest < lowest) return null;
  // A flat candle contributes to one bin; other candles distribute volume by price overlap.
  const flatPadding = Math.max(0.01, lowest * 0.001);
  const min = highest === lowest ? Math.max(Number.MIN_VALUE, lowest - flatPadding / 2) : lowest;
  const max = highest === lowest ? lowest + flatPadding / 2 : highest;
  const step = (max - min) / bins;
  const volumes = Array(bins).fill(0);
  for (const candle of candles) {
    if (!Number.isFinite(candle.volume) || candle.volume < 0 || !(candle.low > 0) || candle.high < candle.low) return null;
    if (candle.high === candle.low) {
      volumes[clamp(Math.floor((candle.close - min) / step), 0, bins - 1)] += candle.volume;
      continue;
    }
    for (let index = 0; index < bins; index++) {
      const overlap = Math.max(0, Math.min(candle.high, min + (index + 1) * step) - Math.max(candle.low, min + index * step));
      volumes[index] += candle.volume * overlap / (candle.high - candle.low);
    }
  }
  const peak = Math.max(...volumes);
  const peakIndex = volumes.indexOf(peak);
  return { min, max, step, volumes, peak, peakIndex, poc: peak > 0 ? min + (peakIndex + 0.5) * step : null };
}

export function findDailyFlips(candles, levels, granularity = DAY, now = Date.now()) {
  if (granularity !== DAY) return [];
  const markers = [];
  for (let index = 1; index < candles.length; index++) {
    const current = candles[index], previous = candles[index - 1];
    if (current.time - previous.time !== DAY || current.time + DAY > now / 1000) continue;
    for (const level of levels) {
      const above = previous.close <= level.price && current.close > level.price;
      const below = previous.close >= level.price && current.close < level.price;
      if ((level.code?.startsWith('R') && above) || (level.code?.startsWith('S') && below)) {
        markers.push({ index, time: current.time, code: level.code, price: level.price, direction: above ? 'above' : 'below' });
      }
    }
  }
  return markers;
}

export function layoutAxisLabels(labels, top, bottom, requestedGap = 14) {
  if (!labels.length || bottom < top) return [];
  const arranged = labels.map(label => ({ ...label, y: clamp(label.y, top, bottom) })).sort((a, b) => a.y - b.y);
  const gap = Math.min(requestedGap, (bottom - top) / Math.max(1, arranged.length - 1));
  for (let index = 1; index < arranged.length; index++) arranged[index].y = Math.max(arranged[index].y, arranged[index - 1].y + gap);
  arranged.at(-1).y = Math.min(arranged.at(-1).y, bottom);
  for (let index = arranged.length - 2; index >= 0; index--) arranged[index].y = Math.min(arranged[index].y, arranged[index + 1].y - gap);
  return arranged;
}

export function normalizeChartOptions(input = {}, previous = DEFAULT_CHART_OPTIONS) {
  if (!input || typeof input !== 'object') input = {};
  const options = { ...previous };
  for (const key of ['ema', 'volume', 'profile', 'levels', 'flips', 'rsi', 'macd', 'news']) if (typeof input[key] === 'boolean') options[key] = input[key];
  if (['candles', 'line'].includes(input.type)) options.type = input.type;
  if (['linear', 'log'].includes(input.scale)) options.scale = input.scale;
  if (['levels', 'candles'].includes(input.fit)) options.fit = input.fit;
  if (Number.isFinite(input.bars)) options.bars = clamp(Math.round(input.bars), 20, 300);
  return options;
}

export class PriceChart {
  constructor(canvas, { tooltip = null, onProfile = () => {}, onSummary = () => {}, onError = () => {}, onEventSelect = () => {}, onGroupsChange = () => {} } = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A chart canvas is required.');
    this.canvas = canvas;
    this.palette = readChartPalette(canvas);
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('Canvas rendering is unavailable.');
    this.tooltip = tooltip;
    this.onProfile = onProfile;
    this.onSummary = onSummary;
    this.onError = onError;
    this.onEventSelect = onEventSelect;
    this.onGroupsChange = onGroupsChange;
    this.newsGroupSignature = '';
    this.selectedNewsTime = null;
    this.options = { ...DEFAULT_CHART_OPTIONS };
    this.candles = [];
    this.levels = [];
    this.events = [];
    this.newsHits = [];
    this.hoveredNews = null;
    this.markerPress = null;
    this.focusedTime = null;
    this.price = null;
    this.granularity = DAY;
    this.viewport = viewportBounds(0);
    this.viewBars = this.options.bars;
    this.viewEnd = 0;
    this.geometry = null;
    this.hover = null;
    this.drag = null;
    this.pendingTouch = null;
    this.touchPointers = new Set();
    this.destroyed = false;
    this.listeners = [];
    this.originalTouchAction = canvas.style.touchAction;
    this.originalCursor = canvas.style.cursor;
    canvas.style.touchAction = 'pan-y pinch-zoom';
    canvas.style.cursor = 'crosshair';
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    if (tooltip) { tooltip.hidden = true; tooltip.style.whiteSpace = 'pre-line'; }
    this.listen('pointermove', event => this.pointerMove(event));
    this.listen('pointerleave', event => {
      if (this.drag) return;
      this.touchPointers.delete(event.pointerId);
      this.pendingTouch = null;
      this.markerPress = null;
      this.clearHover();
    });
    this.listen('pointerdown', event => this.pointerDown(event));
    this.listen('pointerup', event => this.pointerUp(event));
    this.listen('pointercancel', event => this.pointerCancel(event));
    this.listen('lostpointercapture', () => {
      if (this.drag) this.touchPointers.delete(this.drag.pointerId);
      this.drag = null; this.pendingTouch = null; this.markerPress = null; canvas.style.cursor = 'crosshair';
    });
    this.listen('wheel', event => this.wheel(event), { passive: false });
    this.listen('keydown', event => this.keyDown(event));
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(canvas);
    } else if (typeof window !== 'undefined') {
      this.resizeHandler = () => this.render();
      window.addEventListener('resize', this.resizeHandler);
    }
    this.render();
  }

  listen(type, handler, options) {
    this.canvas.addEventListener(type, handler, options);
    this.listeners.push({ type, handler, options });
  }

  get extraPaneHeight() { return (this.options.rsi ? 110 : 0) + (this.options.macd ? 120 : 0); }

  get desiredChartHeight() { return 360 + this.extraPaneHeight; }

  setData(candles, { price = null, levels = [], granularity = this.granularity } = {}) {
    const previousLength = this.candles.length;
    const wasLatest = this.viewEnd >= previousLength && this.focusedTime === null;
    const endTime = this.candles[this.viewport.end - 1]?.time;
    const changedTimeframe = granularity !== this.granularity;
    if (changedTimeframe || !candles?.length) { this.cancelGesture(); this.touchPointers.clear(); }
    this.granularity = Number.isInteger(granularity) && granularity > 0 ? granularity : DAY;
    this.candles = normalizeChartCandles(candles, this.granularity);
    this.price = Number.isFinite(price) && price > 0 ? price : null;
    this.levels = Array.isArray(levels) ? levels.filter(level => typeof level?.code === 'string' && Number.isFinite(level.price) && level.price > 0).map(level => ({ code: level.code, price: level.price })) : [];
    this.ema20 = calculateEMA(this.candles.map(candle => candle.close), 20);
    this.ema50 = calculateEMA(this.candles.map(candle => candle.close), 50);
    this.indicators = calculateChartIndicators(this.candles, this.granularity);
    if (changedTimeframe || wasLatest || !previousLength) {
      this.viewEnd = this.candles.length;
      if (changedTimeframe) this.viewBars = this.options.bars;
    } else {
      const index = this.candles.findIndex(candle => candle.time >= endTime);
      this.viewEnd = index < 0 ? this.candles.length : index + 1;
    }
    if (!previousLength && this.focusedTime !== null) {
      const index = findContainingCandle(this.candles, this.focusedTime, this.granularity);
      if (index >= 0) this.viewEnd = index + 0.5 + this.viewBars / 2;
    }
    this.hover = null;
    this.render();
    return this;
  }

  setEvents(events) {
    this.events = normalizeChartEvents(events);
    this.render();
    return this;
  }

  focusTime(time) {
    if (!Number.isFinite(time) || time < 0) return { focused: false, reason: 'invalid-time' };
    if (time > Date.now() / 1000) return { focused: false, reason: 'future-time' };
    if (!this.candles.length || time < this.candles[0].time || time >= this.candles.at(-1).time + this.granularity) return { focused: false, reason: 'outside-history' };
    const index = findContainingCandle(this.candles, time, this.granularity);
    if (index < 0) return { focused: false, reason: 'missing-candle' };
    this.focusedTime = time;
    this.viewBars = this.viewport.bars || this.options.bars;
    this.viewEnd = index + 0.5 + this.viewBars / 2;
    this.hover = null;
    this.hoveredNews = null;
    this.render();
    return { focused: true };
  }

  setOptions(input) {
    const next = normalizeChartOptions(input, this.options);
    if (next.bars !== this.options.bars) { this.viewBars = next.bars; this.viewEnd = this.candles.length; }
    this.options = next;
    this.hover = null;
    this.render();
    return this;
  }

  refreshTheme() {
    this.palette = readChartPalette(this.canvas);
    this.render();
    return this;
  }

  resetView() {
    this.viewBars = this.options.bars;
    this.viewEnd = this.candles.length;
    this.hover = null;
    this.focusedTime = null;
    this.selectedNewsTime = null;
    this.render();
    return this;
  }

  clearHover() {
    this.hover = null;
    this.hoveredNews = null;
    if (!this.drag) this.canvas.style.cursor = 'crosshair';
    if (this.tooltip) this.tooltip.hidden = true;
    this.render();
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  pointerDown(event) {
    if (event.pointerType === 'touch') {
      this.touchPointers.add(event.pointerId);
      if (this.touchPointers.size > 1) { this.cancelGesture(); this.clearHover(); return; }
    }
    if (!this.geometry || (event.button !== undefined && event.button !== 0)) { this.touchPointers.delete(event.pointerId); return; }
    const point = this.point(event), g = this.geometry;
    const marker = this.hitNews(point);
    if (marker) {
      this.markerPress = { pointerId: event.pointerId, x: point.x, y: point.y, time: marker.time, moved: false };
      return;
    }
    if (point.x < g.left || point.x > g.right || point.y < g.top || point.y > g.contentBottom) { this.touchPointers.delete(event.pointerId); return; }
    if (event.pointerType === 'touch') {
      this.pendingTouch = { pointerId: event.pointerId, x: point.x, y: point.y, end: this.viewport.end, step: g.step };
      return;
    }
    event.preventDefault();
    this.canvas.focus?.({ preventScroll: true });
    this.drag = { pointerId: event.pointerId, x: point.x, end: this.viewport.end, step: g.step };
    this.canvas.setPointerCapture?.(event.pointerId);
    this.canvas.style.cursor = 'grabbing';
  }

  pointerMove(event) {
    if (!this.geometry) return;
    const point = this.point(event);
    if (this.markerPress && this.markerPress.pointerId === event.pointerId) {
      if (Math.hypot(point.x - this.markerPress.x, point.y - this.markerPress.y) > 8) this.markerPress.moved = true;
      return;
    }
    if (event.pointerType === 'touch') {
      if (this.touchPointers.size > 1) return;
      if (this.pendingTouch?.pointerId === event.pointerId) {
        const dx = Math.abs(point.x - this.pendingTouch.x), dy = Math.abs(point.y - this.pendingTouch.y);
        if (dy > 8 && dy >= dx / 1.25) { this.pendingTouch = null; return; }
        if (dx <= 8 || dx <= dy * 1.25) return;
        this.drag = this.pendingTouch;
        this.pendingTouch = null;
        this.canvas.setPointerCapture?.(event.pointerId);
        this.canvas.style.cursor = 'grabbing';
        this.canvas.focus?.({ preventScroll: true });
      }
      if (!this.drag) return;
    }
    if (this.drag && event.pointerId === this.drag.pointerId) {
      event.preventDefault();
      this.viewEnd = this.drag.end - (point.x - this.drag.x) / this.drag.step;
      this.hover = null;
      this.render();
      return;
    }
    const g = this.geometry;
    const marker = this.hitNews(point);
    if (marker) {
      this.hover = null;
      this.hoveredNews = marker.time;
      this.canvas.style.cursor = 'pointer';
      this.render();
      return;
    }
    this.hoveredNews = null;
    this.canvas.style.cursor = 'crosshair';
    if (point.x < g.left || point.x > g.right || point.y < g.top || point.y > g.contentBottom) { this.clearHover(); return; }
    this.hover = { index: clamp(Math.floor((point.x - g.left) / g.step), 0, this.viewport.bars - 1), y: point.y };
    this.render();
  }

  pointerUp(event) {
    const touch = event.pointerType === 'touch' || this.touchPointers.has(event.pointerId);
    this.touchPointers.delete(event.pointerId);
    if (this.markerPress && this.markerPress.pointerId === event.pointerId) {
      const press = this.markerPress, marker = this.hitNews(this.point(event));
      this.markerPress = null;
      if (!press.moved && marker?.time === press.time) {
        this.selectNewsCluster(marker.time);
      }
      return;
    }
    if (event.pointerId !== this.drag?.pointerId && event.pointerId !== this.pendingTouch?.pointerId) return;
    this.cancelGesture();
    if (touch) this.clearHover(); else this.pointerMove(event);
  }

  pointerCancel(event) {
    this.touchPointers.delete(event.pointerId);
    if (event.pointerId === this.drag?.pointerId || event.pointerId === this.pendingTouch?.pointerId || event.pointerId === this.markerPress?.pointerId) this.cancelGesture();
    this.clearHover();
  }

  cancelGesture() {
    const pointerId = this.drag?.pointerId;
    this.drag = null;
    this.pendingTouch = null;
    this.markerPress = null;
    if (pointerId !== undefined && this.canvas.hasPointerCapture?.(pointerId)) this.canvas.releasePointerCapture?.(pointerId);
    this.canvas.style.cursor = 'crosshair';
  }

  zoom(factor, anchor = 0.5) {
    if (!this.viewport.bars) return;
    const position = clamp(anchor, 0, 1);
    const next = viewportBounds(this.candles.length, this.viewport.bars * factor);
    const candlePosition = this.viewport.start + this.viewport.bars * position;
    this.viewBars = next.bars;
    this.viewEnd = candlePosition + next.bars * (1 - position);
    this.hover = null;
    this.render();
  }

  wheel(event) {
    if (!this.geometry || !event.deltaY) return;
    event.preventDefault();
    const g = this.geometry;
    this.zoom(event.deltaY > 0 ? 1.18 : 1 / 1.18, (this.point(event).x - g.left) / (g.right - g.left));
  }

  keyDown(event) {
    if (!this.geometry || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '+' || event.key === '=') this.zoom(1 / 1.18);
    else if (event.key === '-' || event.key === '_') this.zoom(1.18);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.viewEnd = this.viewport.end + (event.key === 'ArrowLeft' ? -1 : 1) * Math.max(1, Math.round(this.viewport.bars / 10));
      this.hover = null;
      this.render();
    } else if (event.key === 'Home' || event.key === 'End') this.resetView();
    else if (event.key === 'Escape') this.clearHover();
    else return;
    event.preventDefault();
  }

  render() {
    if (this.destroyed) return;
    try { this.draw(); }
    catch (error) { this.geometry = null; this.newsHits = []; this.hover = null; if (this.tooltip) this.tooltip.hidden = true; this.onError(error); }
    const groups = this.newsHits.map(({ time, startTime, endTime, candleCount, events }) =>
      ({ time, startTime, endTime, candleCount, events: events.map(event => ({ ...event })) }));
    const signature = JSON.stringify(groups);
    if (signature !== this.newsGroupSignature) {
      this.newsGroupSignature = signature;
      this.onGroupsChange(groups);
    }
  }

  draw() {
    const palette = this.palette;
    const rect = this.canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    const dpr = clamp(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1, 3);
    const ctx = this.context;
    const pixelWidth = Math.max(1, Math.round(w * dpr)), pixelHeight = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.geometry = null;
    this.newsHits = [];
    this.viewport = viewportBounds(this.candles.length, this.viewBars, this.viewEnd);
    this.viewEnd = this.viewport.end;
    const data = this.candles.slice(this.viewport.start, this.viewport.end);
    if (!data.length || w < 140 || h < 120) { if (this.tooltip) this.tooltip.hidden = true; this.hover = null; this.onProfile(null); this.onSummary(null); return; }
    ctx.font = '12px DM Sans, sans-serif';
    const liveLabel = Number.isFinite(this.price) ? 'Live ' + formatUSD(this.price) : '';
    const axisWidth = Math.max(w < 420 ? 108 : 120, ctx.measureText(liveLabel).width + 22);
    const left = 10, right = w - axisWidth, top = this.options.news ? 60 : 18;
    const bottom = h - (this.options.volume ? 76 : 32) - this.extraPaneHeight, volumeBottom = h - 26 - this.extraPaneHeight;
    if (bottom < top + 40) { this.hover = null; if (this.tooltip) this.tooltip.hidden = true; return; }
    const step = (right - left) / data.length, x = index => left + (index + 0.5) * step;
    const visibleLevels = this.options.levels ? this.levels : [];
    const emaValues = this.options.ema ? [this.ema20, this.ema50].flatMap(series => series.slice(this.viewport.start, this.viewport.end)) : [];
    const { min, max } = calculatePriceBounds(data, { levels: visibleLevels, price: this.price, emaValues, fit: this.options.fit, atLatest: this.viewport.end === this.candles.length });
    const transform = this.options.scale === 'log' ? Math.log : value => value;
    const inverse = this.options.scale === 'log' ? Math.exp : value => value;
    const minScale = transform(min), maxScale = transform(max);
    const y = price => top + (maxScale - transform(price)) / (maxScale - minScale) * (bottom - top);
    const valueAtY = py => inverse(maxScale - (py - top) / (bottom - top) * (maxScale - minScale));
    const baseline = data[0].close, last = data.at(-1), lastIndex = this.viewport.end - 1;
    this.onSummary({ baseline, close: last.close, time: last.time, price: this.price,
      atLatest: this.viewport.end === this.candles.length, inProgress: last.time + this.granularity > Date.now() / 1000,
      ema20: this.options.ema ? this.ema20[lastIndex] : null, ema50: this.options.ema ? this.ema50[lastIndex] : null });
    this.geometry = { left, right, top, bottom, volumeBottom, contentBottom: volumeBottom, step, x, y, valueAtY, min, max, panes: [] };
    ctx.font = '12px DM Sans, sans-serif';
    ctx.textAlign = 'left';
    const labels = [];
    for (let index = 0; index < 5; index++) {
      const py = top + (bottom - top) * index / 4, price = valueAtY(py);
      ctx.strokeStyle = palette.grid;
      ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      labels.push({ desiredY: py, y: py, text: formatAxis(price), color: palette.muted, kind: 'tick' });
    }
    const profile = estimateVolumeProfile(data);
    this.onProfile(profile?.poc ?? null);
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    if (this.options.profile && profile?.peak > 0) {
      profile.volumes.forEach((volume, index) => {
        const width = volume / profile.peak * (right - left) * 0.18;
        ctx.fillStyle = index === profile.peakIndex ? palette.accent + '30' : palette.profile + '14';
        const py = y(profile.min + (index + 1) * profile.step);
        ctx.fillRect(right - width, py, width, Math.max(1, y(profile.min + index * profile.step) - py - 1));
      });
    }
    const referencePrice = this.viewport.end === this.candles.length && this.price ? this.price : last.close;
    const nearestBelow = visibleLevels.filter(level => level.price <= referencePrice).sort((a, b) => b.price - a.price)[0];
    const nearestAbove = visibleLevels.filter(level => level.price > referencePrice).sort((a, b) => a.price - b.price)[0];
    for (const level of visibleLevels) {
      const support = level.code.startsWith('S'), py = y(level.price);
      const nearby = level === nearestBelow || level === nearestAbove;
      const edge = py < top ? '↑ ' : py > bottom ? '↓ ' : '';
      if (!edge) {
        ctx.strokeStyle = (support ? palette.support : palette.resistance) + (nearby ? 'a6' : '4d');
        ctx.setLineDash(nearby ? [5, 5] : [2, 6]);
        ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      }
      const anchor = clamp(py, top, bottom);
      labels.push({ desiredY: anchor, y: anchor, text: edge + level.code + ' $' + formatAxis(level.price), color: nearby ? (support ? palette.support : palette.resistance) : palette.muted, kind: 'level' });
    }
    ctx.setLineDash([]);
    if (this.options.type === 'line') {
      const baselineY = y(baseline);
      ctx.strokeStyle = palette.grid; ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(left, baselineY); ctx.lineTo(right, baselineY); ctx.stroke(); ctx.setLineDash([]);
      // Clip the same unsmoothed path at the labeled baseline: every close keeps its original coordinates.
      for (const [color, clipTop, clipBottom] of [[palette.up, top, baselineY], [palette.down, baselineY, bottom]]) {
        ctx.save(); ctx.beginPath(); ctx.rect(left, clipTop, right - left, Math.max(0, clipBottom - clipTop)); ctx.clip();
        ctx.beginPath(); ctx.moveTo(x(0), baselineY);
        data.forEach((candle, index) => ctx.lineTo(x(index), y(candle.close)));
        ctx.lineTo(x(data.length - 1), baselineY); ctx.closePath(); ctx.fillStyle = color + '0d'; ctx.fill();
        ctx.beginPath();
        data.forEach((candle, index) => index ? ctx.lineTo(x(index), y(candle.close)) : ctx.moveTo(x(index), y(candle.close)));
        ctx.strokeStyle = color; ctx.lineWidth = 2.3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = last.close >= baseline ? palette.up : palette.down;
      ctx.beginPath(); ctx.arc(x(data.length - 1), y(last.close), 3, 0, Math.PI * 2); ctx.fill();
    } else {
      data.forEach((candle, index) => {
        ctx.strokeStyle = ctx.fillStyle = candle.close >= candle.open ? palette.up : palette.down;
        ctx.beginPath(); ctx.moveTo(x(index), y(candle.high)); ctx.lineTo(x(index), y(candle.low)); ctx.stroke();
        const width = Math.max(1, Math.min(16, step * 0.57));
        ctx.fillRect(x(index) - width / 2, y(Math.max(candle.open, candle.close)), width, Math.max(1, Math.abs(y(candle.open) - y(candle.close))));
      });
    }
    if (this.options.ema) {
      for (const [series, color] of [[this.ema20, palette.ema20], [this.ema50, palette.ema50]]) {
        let started = false;
        ctx.strokeStyle = color + 'b3'; ctx.lineWidth = 1.1; ctx.beginPath();
        series.slice(this.viewport.start, this.viewport.end).forEach((value, index) => {
          if (!Number.isFinite(value)) { started = false; return; }
          if (started) ctx.lineTo(x(index), y(value)); else { ctx.moveTo(x(index), y(value)); started = true; }
        });
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    if (this.options.flips && this.options.levels) {
      for (const marker of findDailyFlips(this.candles, this.levels, this.granularity)) {
        if (marker.index < this.viewport.start || marker.index >= this.viewport.end) continue;
        ctx.fillStyle = palette.ema50;
        ctx.beginPath(); ctx.arc(x(marker.index - this.viewport.start), y(marker.price), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (this.price) {
      const py = y(this.price);
      const edge = py < top ? '↑ ' : py > bottom ? '↓ ' : '';
      if (!edge) {
        ctx.setLineDash([2, 4]); ctx.strokeStyle = palette.accent + '99';
        ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke(); ctx.setLineDash([]);
      }
      const anchor = clamp(py, top, bottom);
      labels.push({ desiredY: anchor, y: anchor, text: edge + liveLabel, color: palette.accent, kind: 'price' });
    }
    ctx.restore();
    if (this.options.volume) {
      const maxVolume = Math.max(...data.map(candle => candle.volume)) || 1;
      data.forEach((candle, index) => {
        ctx.fillStyle = candle.close >= candle.open ? palette.up + 'bb' : palette.down + 'bb';
        const height = candle.volume / maxVolume * 35;
        ctx.fillRect(x(index) - Math.min(16, step * 0.6) / 2, volumeBottom - height, Math.max(1, Math.min(16, step * 0.6)), height);
      });
    }
    // Numeric ticks must stay on their gridlines; only annotations may move.
    const labelGap = 22;
    const annotations = layoutAxisLabels(labels.filter(label => label.kind !== 'tick'), top + 12, bottom - 10, labelGap);
    const visibleTicks = labels.filter(label => label.kind === 'tick' && annotations.every(annotation => Math.abs(label.y - annotation.y) >= labelGap));
    for (const label of [...visibleTicks, ...annotations]) {
      ctx.font = '12px DM Sans, sans-serif';
      ctx.fillStyle = label.color;
      if (label.kind !== 'tick') {
        ctx.strokeStyle = label.color + '88'; ctx.beginPath(); ctx.moveTo(right + 1, label.desiredY); ctx.lineTo(right + 5, label.y); ctx.stroke();
      }
      if (label.kind === 'price') {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(right + 5, label.y - 10, Math.min(w - right - 7, ctx.measureText(label.text).width + 9), 22);
        ctx.fillStyle = palette['on-accent'];
      }
      ctx.fillText(label.text, right + 8, label.y + 3);
    }
    this.drawIndicators(data, h - this.extraPaneHeight - 18);
    ctx.font = '12px DM Sans, sans-serif'; ctx.fillStyle = palette.muted;
    const timeLabels = Math.max(2, Math.min(6, Math.floor((right - left) / 110)));
    const timeStep = Math.max(1, Math.ceil(data.length / timeLabels));
    for (let index = 0; index < data.length; index += timeStep) {
      const date = new Date(data[index].time * 1000);
      const text = this.granularity < DAY && data.at(-1).time - data[0].time < 2 * DAY
        ? date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const labelWidth = ctx.measureText(text).width;
      ctx.fillText(text, clamp(x(index) - labelWidth / 2, left, right - labelWidth), h - 7);
    }
    this.drawNewsRail();
    this.drawFocusedTime();
    this.drawHover(data);
  }

  hitNews(point) {
    if (!this.options.news || !this.geometry) return null;
    return this.newsHits.filter(hit => Math.abs(hit.x - point.x) <= 22 && Math.abs(hit.y - point.y) <= 22)
      .sort((a, b) => Math.abs(a.x - point.x) - Math.abs(b.x - point.x))[0] || null;
  }

  selectNewsCluster(time) {
    const marker = this.newsHits.find(hit => hit.time === time);
    if (!marker) return;
    this.selectedNewsTime = marker.time;
    // A multi-candle cluster must not imply that every story belongs to one candle.
    this.focusedTime = marker.candleCount === 1 ? marker.time : null;
    this.render();
    this.onEventSelect({ time: marker.time, startTime: marker.startTime, endTime: marker.endTime,
      candleCount: marker.candleCount, events: marker.events.map(item => ({ ...item })) });
  }

  drawNewsRail() {
    const palette = this.palette;
    if (!this.options.news) return;
    const g = this.geometry, ctx = this.context;
    const groups = groupChartEvents(this.events, this.candles, this.granularity).filter(group => group.index >= this.viewport.start && group.index < this.viewport.end);
    const clusters = clusterChartEvents(groups, index => g.x(index - this.viewport.start), g.left, g.right);
    ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.strokeStyle = palette.grid;
    ctx.beginPath(); ctx.moveTo(g.left, g.top - 10); ctx.lineTo(g.right, g.top - 10); ctx.stroke();
    const focusedIndex = findContainingCandle(this.candles, this.focusedTime, this.granularity);
    for (const cluster of clusters) {
      const selected = cluster.time === this.selectedNewsTime || focusedIndex >= cluster.index && focusedIndex <= cluster.endIndex;
      ctx.strokeStyle = selected ? palette.accent : palette.muted;
      ctx.beginPath(); ctx.moveTo(cluster.minX, 45); ctx.lineTo(cluster.maxX, 45);
      ctx.moveTo(cluster.minX, 42); ctx.lineTo(cluster.minX, 48);
      ctx.moveTo(cluster.maxX, 42); ctx.lineTo(cluster.maxX, 48); ctx.stroke();
      ctx.fillStyle = selected ? palette.accent : palette.grid;
      ctx.beginPath(); ctx.arc(cluster.x, 20, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = selected ? palette['on-accent'] : palette.text; ctx.font = '12px DM Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(cluster.events.length > 99 ? '99+' : String(cluster.events.length), cluster.x, 24);
      this.newsHits.push({ ...cluster, y: 20 });
    }
    ctx.textAlign = 'left'; ctx.fillStyle = palette.muted; ctx.font = '12px DM Sans, sans-serif';
    ctx.fillText('News', g.right + 8, 24);
    ctx.restore();
  }

  drawFocusedTime() {
    const palette = this.palette;
    const index = findContainingCandle(this.candles, this.focusedTime, this.granularity);
    if (index < this.viewport.start || index >= this.viewport.end) return;
    const g = this.geometry, ctx = this.context, x = g.x(index - this.viewport.start);
    ctx.save();
    ctx.fillStyle = palette.accent + '12'; ctx.fillRect(x - g.step * 0.45, g.top, Math.max(1, g.step * 0.9), g.contentBottom - g.top);
    ctx.strokeStyle = palette.accent + 'bb'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.contentBottom); ctx.stroke();
    ctx.restore();
  }

  drawIndicators(data, start) {
    const palette = this.palette;
    const g = this.geometry, ctx = this.context;
    const timeframe = this.granularity === DAY ? '1D' : this.granularity % 3600 === 0 ? this.granularity / 3600 + 'h' : this.granularity / 60 + 'm';
    for (const key of ['rsi', 'macd']) {
      if (!this.options[key]) continue;
      const height = key === 'rsi' ? 110 : 120;
      const series = key === 'rsi' ? [['rsi', palette.rsi]] : [['macd', palette.ema20], ['signal', palette.ema50]];
      const values = (key === 'rsi' ? ['rsi'] : ['macd', 'signal', 'histogram']).flatMap(name => this.indicators[name].slice(this.viewport.start, this.viewport.end)).filter(Number.isFinite);
      const limit = Math.max(0.01, ...values.map(Math.abs)) * 1.15;
      const min = key === 'rsi' ? 0 : -limit, max = key === 'rsi' ? 100 : limit;
      const top = start + 20, bottom = start + height - 12;
      const y = value => top + (max - value) / (max - min) * (bottom - top);
      const valueAtY = py => max - (py - top) / (bottom - top) * (max - min);
      g.panes.push({ key, top, bottom, min, max, y, valueAtY });
      g.contentBottom = bottom;
      ctx.font = '12px DM Sans, sans-serif'; ctx.fillStyle = palette.muted;
      ctx.strokeStyle = palette.grid; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(g.left, start - 4); ctx.lineTo(g.right + 70, start - 4); ctx.stroke();
      ctx.fillText((key === 'rsi' ? 'RSI 14' : 'MACD 12/26/9') + ' · ' + timeframe + ' · closed', g.left, start + 8);
      const ticks = key === 'rsi' ? [0, 30, 70, 100] : [min, 0, max];
      for (const value of ticks) {
        const py = y(value);
        ctx.strokeStyle = value === 0 && key === 'macd' ? palette.zero : palette.grid;
        ctx.setLineDash(key === 'rsi' && (value === 30 || value === 70) ? [3, 4] : []);
        ctx.beginPath(); ctx.moveTo(g.left, py); ctx.lineTo(g.right, py); ctx.stroke();
        ctx.fillStyle = palette.muted;
        ctx.fillText(key === 'rsi' ? String(value) : value.toFixed(2), g.right + 8, py + 3);
      }
      ctx.setLineDash([]);
      ctx.save(); ctx.beginPath(); ctx.rect(g.left, top, g.right - g.left, bottom - top); ctx.clip();
      if (key === 'macd') {
        this.indicators.histogram.slice(this.viewport.start, this.viewport.end).forEach((value, index) => {
          if (!Number.isFinite(value)) return;
          ctx.fillStyle = value >= 0 ? palette.up + 'bb' : palette.down + 'bb';
          const width = Math.max(1, Math.min(16, g.step * 0.6));
          ctx.fillRect(g.x(index) - width / 2, Math.min(y(0), y(value)), width, Math.abs(y(value) - y(0)));
        });
      }
      for (const [name, color] of series) {
        let started = false;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
        this.indicators[name].slice(this.viewport.start, this.viewport.end).forEach((value, index) => {
          if (!Number.isFinite(value)) { started = false; return; }
          if (started) ctx.lineTo(g.x(index), y(value)); else { ctx.moveTo(g.x(index), y(value)); started = true; }
        });
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      if (!values.length) {
        ctx.fillStyle = palette.muted;
        ctx.fillText('Warming up · ' + (key === 'rsi' ? '15' : '34') + ' closes', g.left + 8, top + (bottom - top) / 2);
      }
      ctx.restore();
      start += height;
    }
  }

  drawHover(data) {
    const palette = this.palette;
    if (this.hoveredNews !== null) {
      const marker = this.newsHits.find(hit => hit.time === this.hoveredNews);
      if (marker && this.tooltip) {
        this.tooltip.textContent = marker.events.length + (marker.events.length === 1 ? ' headline' : ' headlines') + ' · ' + new Date(marker.startTime * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' + (marker.candleCount > 1 ? '\nAcross ' + marker.candleCount + ' candles' : '') + '\nSelect to view headlines';
        this.tooltip.hidden = false;
        return;
      }
    }
    if (!this.hover || !this.geometry || !data[this.hover.index]) { if (this.tooltip) this.tooltip.hidden = true; return; }
    const { index, y: py } = this.hover, g = this.geometry, ctx = this.context, candle = data[index];
    ctx.setLineDash([3, 3]); ctx.strokeStyle = palette.crosshair + 'bb';
    ctx.beginPath(); ctx.moveTo(g.x(index), g.top); ctx.lineTo(g.x(index), g.contentBottom); ctx.stroke();
    if (py >= g.top && py <= g.bottom) {
      ctx.beginPath(); ctx.moveTo(g.left, py); ctx.lineTo(g.right, py); ctx.stroke();
      ctx.fillStyle = palette['cursor-bg']; ctx.fillRect(g.right + 2, py - 10, this.canvas.getBoundingClientRect().width - g.right - 4, 19);
      ctx.fillStyle = palette['cursor-text']; ctx.font = '12px DM Sans, sans-serif'; ctx.fillText(formatUSD(g.valueAtY(py)), g.right + 7, py + 3);
    }
    const pane = g.panes.find(candidate => py >= candidate.top && py <= candidate.bottom);
    if (pane) {
      ctx.beginPath(); ctx.moveTo(g.left, py); ctx.lineTo(g.right, py); ctx.stroke();
      ctx.fillStyle = palette['cursor-bg']; ctx.fillRect(g.right + 2, py - 10, this.canvas.getBoundingClientRect().width - g.right - 4, 19);
      ctx.fillStyle = palette['cursor-text']; ctx.font = '12px DM Sans, sans-serif'; ctx.fillText(pane.valueAtY(py).toFixed(2), g.right + 7, py + 3);
    }
    ctx.setLineDash([]);
    if (this.tooltip) {
      const stamp = new Date(candle.time * 1000).toISOString();
      const time = this.granularity === DAY ? stamp.slice(0, 10) : stamp.slice(0, 16).replace('T', ' ');
      const progress = candle.time + this.granularity > Date.now() / 1000 ? ' · In progress' : '';
      this.tooltip.textContent = `${time} UTC${progress}\nO ${formatUSD(candle.open)} · H ${formatUSD(candle.high)}\nL ${formatUSD(candle.low)} · C ${formatUSD(candle.close)}\nVolume ${candle.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })} ETH`;
      const position = this.viewport.start + index;
      const indicatorValue = name => Number.isFinite(this.indicators[name][position]) ? this.indicators[name][position].toFixed(2) : '—';
      if (this.options.rsi) this.tooltip.textContent += '\nRSI 14 (closed) ' + indicatorValue('rsi');
      if (this.options.macd) this.tooltip.textContent += '\nMACD ' + indicatorValue('macd') + ' · Signal ' + indicatorValue('signal') + ' · Hist ' + indicatorValue('histogram');
      this.tooltip.hidden = false;
    }
  }

  destroy() {
    this.destroyed = true;
    this.cancelGesture();
    this.touchPointers.clear();
    for (const { type, handler, options } of this.listeners) this.canvas.removeEventListener(type, handler, options);
    this.resizeObserver?.disconnect();
    if (this.resizeHandler && typeof window !== 'undefined') window.removeEventListener('resize', this.resizeHandler);
    this.canvas.style.touchAction = this.originalTouchAction;
    this.canvas.style.cursor = this.originalCursor;
    this.geometry = null;
    this.newsHits = [];
    this.markerPress = null;
    this.hoveredNews = null;
    this.hover = null;
    this.drag = null;
    if (this.tooltip) this.tooltip.hidden = true;
  }
}
