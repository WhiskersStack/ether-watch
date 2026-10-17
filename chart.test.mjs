import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceChart, normalizeChartCandles, normalizeChartEvents, findContainingCandle, groupChartEvents, viewportBounds, calculateEMA, calculateRSI, calculateMACD, calculateChartIndicators, calculatePriceBounds, estimateVolumeProfile, findDailyFlips, layoutAxisLabels, normalizeChartOptions, DEFAULT_CHART_OPTIONS } from './dist/chart.mjs';

const DAY = 86400;
const START = Date.UTC(2026, 9, 14) / 1000;
const candle = (time, close = 2500, volume = 100) => ({ time, low: close - 10, high: close + 10, open: close - 2, close, volume });
const rows = (count = 120) => Array.from({ length: count }, (_, index) => candle(START - (count - index) * DAY, 2500 + index));
const headline = (id, time) => ({ id, time, title: 'Headline ' + id, source: 'Publisher', category: 'Ethereum' });

test('chart candles accept coherent exchange rows, deduplicate and sort without modifying inputs', () => {
  const valid = candle(START - DAY), earlier = candle(START - 2 * DAY);
  const input = [valid, [earlier.time, earlier.low, earlier.high, earlier.open, earlier.close, earlier.volume], valid];
  const result = normalizeChartCandles(input, DAY, START * 1000);
  assert.deepEqual(result, [earlier, valid]);
  result[1].close = 1;
  assert.equal(valid.close, 2500);
});

test('chart rejects non-finite, inconsistent, future, misaligned and non-positive prices', () => {
  const good = candle(START);
  const invalid = [null, { ...good, close: Infinity }, { ...good, low: 0 }, { ...good, high: good.low - 1 }, { ...good, close: good.high + 1 }, { ...good, open: good.low - 1 }, { ...good, volume: -1 }, { ...good, time: START + DAY }, { ...good, time: START + 1 }, { ...good, time: '1' }];
  assert.deepEqual(normalizeChartCandles([good, ...invalid], DAY, START * 1000), [good]);
  assert.deepEqual(normalizeChartCandles([good], 0), []);
  assert.deepEqual(normalizeChartCandles(undefined), []);
  assert.equal(normalizeChartCandles([candle(START + 900)], 900, (START + 901) * 1000).length, 1, 'current candle is retained');
});

test('chart events normalize UTC timestamps, deduplicate IDs and reject invalid or future publications', () => {
  const first = headline('a', START - 10), replacement = { ...first, title: 'Updated headline' };
  const input = [headline('b', START - 0.5), first, null, replacement, headline('future', START + 0.001), { ...first, id: '' }, { ...first, time: NaN }, { ...first, title: '' }, { ...first, source: null }];
  const result = normalizeChartEvents(input, START * 1000);
  assert.deepEqual(result.map(item => item.id), ['a', 'b']);
  assert.equal(result[0].title, 'Updated headline');
  result[0].title = 'Changed by caller';
  assert.equal(replacement.title, 'Updated headline');
  assert.deepEqual(normalizeChartEvents(undefined), []);
});

test('news grouping uses containing UTC candle intervals, excludes gaps and handles exact boundaries', () => {
  for (const granularity of [900, 3600, DAY]) {
    const data = [candle(START - 2 * granularity), candle(START)];
    const events = [headline('before', data[0].time - 1), headline('start', data[0].time), headline('inside', data[0].time + granularity - 0.001), headline('gap', START - granularity), headline('next', START), headline('after', START + granularity)];
    const groups = groupChartEvents(events, data, granularity);
    assert.deepEqual(groups.map(group => group.time), [data[0].time, START]);
    assert.deepEqual(groups[0].events.map(item => item.id), ['start', 'inside']);
    assert.deepEqual(groups[1].events.map(item => item.id), ['next']);
    assert.equal(findContainingCandle(data, START - granularity, granularity), -1);
    assert.equal(findContainingCandle(data, START, granularity), 1);
    assert.equal(findContainingCandle(data, START + granularity, granularity), -1);
  }
});

test('viewport clamps zoom and pan to valid bars including short and empty history', () => {
  assert.deepEqual(viewportBounds(0), { start: 0, end: 0, bars: 0 });
  assert.deepEqual(viewportBounds(10, 1), { start: 0, end: 10, bars: 10 });
  assert.deepEqual(viewportBounds(120, 5, 0), { start: 0, end: 20, bars: 20 });
  assert.deepEqual(viewportBounds(120, 40, 999), { start: 80, end: 120, bars: 40 });
  assert.deepEqual(viewportBounds(120, 40, 70), { start: 30, end: 70, bars: 40 });
  assert.deepEqual(viewportBounds(120, 1000), { start: 0, end: 120, bars: 120 });
});

test('EMA uses an SMA seed, preserves warmup and uses complete history', () => {
  assert.deepEqual(calculateEMA([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.deepEqual(calculateEMA([1, 2], 3), [null, null]);
  assert.deepEqual(calculateEMA([1, NaN, 3], 3), [null, null, null]);
  assert.deepEqual(calculateEMA([1, 2, 3], 1), [1, 2, 3]);
});

test('RSI uses Wilder smoothing with aligned warmup and handles flat, rising and falling prices', () => {
  assert.deepEqual(calculateRSI([100, 101, 100, 101, 100], 2), [null, null, 50, 75, 37.5]);
  const rising = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.deepEqual(calculateRSI(rising).slice(0, 14), Array(14).fill(null));
  assert.equal(calculateRSI(rising)[14], 100);
  assert.equal(calculateRSI([...rising].reverse())[14], 0);
  assert.equal(calculateRSI(Array(20).fill(2500))[14], 50);
  assert.deepEqual(calculateRSI([1, 2], 14), [null, null]);
  assert.deepEqual(calculateRSI([1, NaN, 3], 2), [null, null, null]);
});

test('MACD aligns both EMA and signal warmups without treating missing values as zero', () => {
  const values = Array.from({ length: 40 }, (_, index) => index + 1);
  const short = calculateMACD(values, 3, 5, 2);
  assert.deepEqual(short.macd.slice(0, 4), Array(4).fill(null));
  assert.equal(short.macd[4], 1);
  assert.equal(short.signal[4], null);
  assert.equal(short.signal[5], 1);
  assert.equal(short.histogram[5], 0);
  const standard = calculateMACD(values);
  assert.equal(standard.macd.findIndex(Number.isFinite), 25);
  assert.equal(standard.signal.findIndex(Number.isFinite), 33);
  assert.equal(standard.histogram.findIndex(Number.isFinite), 33);
  assert.ok(Math.abs(standard.macd[39] - 7) < 1e-10);
  assert.ok(Math.abs(standard.histogram[39]) < 1e-10);
  const flat = calculateMACD(Array(40).fill(2500));
  assert.equal(flat.macd[39], 0);
  assert.equal(flat.signal[39], 0);
  assert.equal(flat.histogram[39], 0);
  assert.deepEqual(calculateMACD([1, 2, 3], 5, 3, 2).macd, [null, null, null]);
});

test('selected-timeframe indicators exclude unfinished candles and restart warmup after missing intervals', () => {
  for (const granularity of [900, 3600, DAY]) {
    const first = Array.from({ length: 40 }, (_, index) => candle(START - (82 - index) * granularity, 2500 + index));
    const second = Array.from({ length: 40 }, (_, index) => candle(START - (40 - index) * granularity, 2700 - index));
    const data = [...first, ...second, candle(START, 10000)];
    const indicators = calculateChartIndicators(data, granularity, START * 1000 + 1000);
    for (const values of Object.values(indicators)) {
      assert.equal(values.length, data.length);
      assert.equal(values.at(-1), null, 'unfinished candle never enters the closed-candle series');
    }
    assert.equal(indicators.rsi[14], 100);
    assert.ok(Number.isFinite(indicators.histogram[33]));
    assert.deepEqual(indicators.rsi.slice(40, 54), Array(14).fill(null));
    assert.equal(indicators.rsi[54], 0);
    assert.deepEqual(indicators.macd.slice(40, 65), Array(25).fill(null));
    assert.deepEqual(indicators.signal.slice(40, 73), Array(33).fill(null));
    assert.ok(Number.isFinite(indicators.histogram[73]));
  }
});

test('price fitting includes selected EMAs but excludes watch levels and live prices in candle mode', () => {
  const data = [candle(START - DAY, 2500)];
  const options = { levels: [{ price: 1000 }, { price: 5000 }], price: 10000 };
  const inclusive = calculatePriceBounds(data, options);
  assert.ok(inclusive.min <= 1000 && inclusive.max >= 10000);
  const fitted = calculatePriceBounds(data, { ...options, fit: 'candles' });
  assert.ok(fitted.min > 2400 && fitted.max < 2600);
  const historical = calculatePriceBounds(data, { ...options, atLatest: false });
  assert.ok(historical.max >= 5000 && historical.max < 10000, 'historical range excludes today’s live price');
  const withEMA = calculatePriceBounds(data, { ...options, fit: 'candles', emaValues: [null, 3200, NaN] });
  assert.ok(withEMA.max >= 3200 && withEMA.max < 5000);
  for (const price of [0.01, 2500, Number.MIN_VALUE]) {
    const flat = { time: START, low: price, high: price, open: price, close: price, volume: 0 };
    const bounds = calculatePriceBounds([flat], { fit: 'candles' });
    assert.ok(bounds.min > 0 && bounds.max > bounds.min);
    assert.ok(Number.isFinite(Math.log(bounds.min)) && Number.isFinite(Math.log(bounds.max)));
  }
  assert.equal(calculatePriceBounds([]), null);
});

test('estimated profile conserves volume including flat candles and reports no POC for zero volume', () => {
  const data = [candle(START - DAY, 100, 100), { time: START, low: 100, high: 100, open: 100, close: 100, volume: 20 }];
  const profile = estimateVolumeProfile(data, 20);
  assert.ok(Math.abs(profile.volumes.reduce((sum, volume) => sum + volume, 0) - 120) < 1e-8);
  assert.ok(profile.poc >= profile.min && profile.poc <= profile.max);
  const flat = estimateVolumeProfile([data[1]], 20);
  assert.equal(flat.volumes.reduce((sum, volume) => sum + volume, 0), 20);
  assert.ok(Number.isFinite(flat.poc));
  assert.equal(estimateVolumeProfile([candle(START, 100, 0)]).poc, null);
  assert.equal(estimateVolumeProfile([]), null);
});

test('daily flip markers obey completed, consecutive daily closes and strict price boundaries', () => {
  const levels = [{ code: 'R1', price: 2554 }, { code: 'S1', price: 2416 }];
  const data = [candle(START - 3 * DAY, 2554), candle(START - 2 * DAY, 2555), candle(START - DAY, 2416), candle(START, 2415)];
  assert.deepEqual(findDailyFlips(data, levels, DAY, START * 1000).map(marker => marker.code), ['R1']);
  assert.deepEqual(findDailyFlips(data, levels, DAY, (START + DAY) * 1000).map(marker => marker.code), ['R1', 'S1']);
  assert.deepEqual(findDailyFlips(data, levels, 3600, (START + DAY) * 1000), []);
  assert.deepEqual(findDailyFlips([data[0], data[3]], levels, DAY, (START + DAY) * 1000), [], 'missing daily intervals do not show flips');
  assert.deepEqual(findDailyFlips([candle(START - DAY, 2550), candle(START, 2554)], levels, DAY, (START + DAY) * 1000), []);
});

test('axis labels remain ordered, separated and in bounds even at clustered prices', () => {
  const arranged = layoutAxisLabels([30, 31, 32, 89, 90, 91].map((y, index) => ({ y, index })), 20, 100, 13);
  assert.ok(arranged[0].y >= 20 && arranged.at(-1).y <= 100);
  for (let index = 1; index < arranged.length; index++) assert.ok(arranged[index].y - arranged[index - 1].y >= 13 - 1e-8);
  assert.deepEqual(arranged.map(label => label.index), [0, 1, 2, 3, 4, 5]);
});

test('display options restrict malformed stored values and copy defaults', () => {
  assert.deepEqual(normalizeChartOptions({ type: 'bad', scale: 'bad', volume: 'false', bars: Infinity }), DEFAULT_CHART_OPTIONS);
  const next = normalizeChartOptions({ type: 'line', scale: 'log', ema: true, bars: 999 });
  assert.equal(next.bars, 300);
  assert.equal(next.type, 'line');
  assert.equal(next.scale, 'log');
  assert.equal(next.ema, true);
  assert.equal(DEFAULT_CHART_OPTIONS.ema, false);
  assert.equal(DEFAULT_CHART_OPTIONS.fit, 'levels');
  assert.equal(DEFAULT_CHART_OPTIONS.rsi, false);
  assert.equal(DEFAULT_CHART_OPTIONS.macd, false);
  assert.equal(DEFAULT_CHART_OPTIONS.news, false);
  assert.equal(normalizeChartOptions({ news: 'true' }).news, false);
  assert.equal(normalizeChartOptions({ news: true }).news, true);
  assert.equal(normalizeChartOptions({ fit: 'unsupported', rsi: 'true', macd: 1 }).fit, 'levels');
  assert.equal(normalizeChartOptions({ fit: 'candles', rsi: true, macd: true }).fit, 'candles');
});

function fakeCanvas({ width = 700, height = 360 } = {}) {
  const listeners = new Map(), calls = [], captures = new Set();
  const context = new Proxy({ measureText: text => ({ width: String(text).length * 5 }) }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push({ key, args }), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = {
    style: { touchAction: '', cursor: '' }, tabIndex: -1, width: 0, height: 0,
    getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type), focus() {},
    setPointerCapture: pointerId => captures.add(pointerId), hasPointerCapture: pointerId => captures.has(pointerId), releasePointerCapture: pointerId => captures.delete(pointerId),
  };
  return { canvas, listeners, calls, captures };
}
const event = values => ({ prevented: false, preventDefault() { this.prevented = true; }, ...values });

test('numeric axis ticks stay aligned with their gridlines without annotations', () => {
  const { canvas, calls } = fakeCanvas(), chart = new PriceChart(canvas);
  chart.setData(rows());
  const geometry = chart.geometry;
  const ticks = calls.filter(call => call.key === 'fillText' && call.args[1] === geometry.right + 8 && /^[\d,.]+$/.test(call.args[0]));
  assert.equal(ticks.length, 5);
  for (let index = 0; index < ticks.length; index++) {
    const gridY = geometry.top + (geometry.bottom - geometry.top) * index / 4;
    assert.equal(ticks[index].args[2], gridY + 3, 'tick baseline stays on its own gridline');
    assert.equal(ticks[index].args[0], geometry.valueAtY(gridY).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  }
});

test('clustered annotations stay separated while crowded numeric ticks are omitted rather than moved', () => {
  const { canvas, calls } = fakeCanvas(), chart = new PriceChart(canvas);
  const levels = ['S3', 'S2', 'S1', 'R1', 'R2', 'R3'].map((code, index) => ({ code, price: 2546 + index }));
  chart.setData(rows(), { levels, price: 2550.5 });
  const geometry = chart.geometry;
  const axis = calls.filter(call => call.key === 'fillText' && call.args[1] === geometry.right + 8);
  const ticks = axis.filter(call => /^[\d,.]+$/.test(call.args[0]));
  const annotations = axis.filter(call => /^(?:[SR]\d |\$)/.test(call.args[0]));
  assert.equal(annotations.length, 7, 'all six watch levels and the current price remain labeled');
  assert.ok(ticks.length > 0 && ticks.length < 5, 'unobstructed ticks remain visible while crowded ticks are omitted');
  const annotationYs = annotations.map(call => call.args[2]).sort((a, b) => a - b);
  for (let index = 1; index < annotationYs.length; index++) assert.ok(annotationYs[index] - annotationYs[index - 1] >= 13 - 1e-8);
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const y = geometry.top + (geometry.bottom - geometry.top) * index / 4;
    return { y, text: geometry.valueAtY(y).toLocaleString('en-US', { maximumFractionDigits: 0 }) };
  });
  for (const tick of ticks) {
    const gridTick = gridTicks.find(candidate => candidate.text === tick.args[0]);
    assert.ok(gridTick, 'tick value belongs to an actual gridline');
    assert.equal(tick.args[2], gridTick.y + 3, 'collision handling never relocates a numeric tick');
    for (const annotationY of annotationYs) assert.ok(Math.abs(tick.args[2] - annotationY) >= 13 - 1e-8);
  }
});

test('fit and pane toggles preserve the viewport and expose offscreen levels and live price', () => {
  const { canvas, calls } = fakeCanvas({ height: 590 }), errors = [];
  const chart = new PriceChart(canvas, { onError: error => errors.push(error) });
  chart.setData(rows(), { levels: [{ code: 'S1', price: 1000 }, { code: 'R1', price: 5000 }], price: 6000 }).setOptions({ bars: 30 });
  chart.zoom(0.85);
  chart.keyDown(event({ key: 'ArrowLeft' }));
  const viewport = { ...chart.viewport };
  calls.length = 0;
  chart.setOptions({ fit: 'candles', rsi: true, macd: true, scale: 'log' });
  assert.deepEqual(chart.viewport, viewport);
  assert.ok(chart.geometry.min > 2400 && chart.geometry.max < 3000);
  const edgeLabels = calls.filter(call => call.key === 'fillText' && /^[↑↓]/.test(call.args[0]));
  assert.deepEqual(edgeLabels.map(call => call.args[0]).sort(), ['↑ Live $6,000', '↑ R1 $5,000', '↓ S1 $1,000'].sort());
  for (const label of edgeLabels) assert.ok(label.args[2] >= chart.geometry.top && label.args[2] <= chart.geometry.bottom + 3);
  assert.deepEqual(errors, []);
});

test('optional indicator panes use independent scales, full history and crosshair values', () => {
  const { canvas } = fakeCanvas({ height: 590 }), tooltip = { hidden: true, style: {} }, errors = [];
  const chart = new PriceChart(canvas, { tooltip, onError: error => errors.push(error) });
  const data = Array.from({ length: 80 }, (_, index) => candle(START - (80 - index) * 3600, 2500 + index));
  chart.setData(data, { granularity: 3600 }).setOptions({ bars: 30 });
  const priceBounds = { min: chart.geometry.min, max: chart.geometry.max };
  assert.equal(chart.extraPaneHeight, 0);
  assert.equal(chart.desiredChartHeight, 360);
  chart.setOptions({ rsi: true, macd: true });
  assert.equal(chart.extraPaneHeight, 230);
  assert.equal(chart.desiredChartHeight, 590);
  assert.deepEqual({ min: chart.geometry.min, max: chart.geometry.max }, priceBounds);
  assert.equal(chart.geometry.bottom, 284, 'expanded canvas retains the original price-panel height');
  const [rsi, macd] = chart.geometry.panes;
  assert.equal(rsi.key, 'rsi');
  assert.equal(rsi.min, 0);
  assert.equal(rsi.max, 100);
  assert.equal(macd.key, 'macd');
  assert.equal(macd.min, -macd.max);
  assert.equal(macd.y(0), (macd.top + macd.bottom) / 2);
  assert.ok(chart.geometry.volumeBottom < rsi.top && rsi.bottom < macd.top);
  assert.ok(Number.isFinite(chart.indicators.histogram[chart.viewport.start]), 'warmup uses full history before slicing the viewport');
  chart.pointerMove(event({ clientX: chart.geometry.x(29), clientY: rsi.y(50) }));
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /RSI 14 \(closed\) 100\.00/);
  assert.match(tooltip.textContent, /MACD 7\.00 · Signal 7\.00/);
  chart.setOptions({ rsi: false, macd: false });
  assert.deepEqual(chart.geometry.panes, []);
  assert.equal(chart.extraPaneHeight, 0);
  assert.deepEqual(errors, []);
});

test('indicator panes show warmup without invented values and handle flat zero-volume history', () => {
  const { canvas, calls } = fakeCanvas({ height: 590 }), chart = new PriceChart(canvas);
  chart.setData(rows(10)).setOptions({ rsi: true, macd: true });
  const labels = calls.filter(call => call.key === 'fillText').map(call => call.args[0]);
  assert.ok(labels.includes('Warming up · 15 closes'));
  assert.ok(labels.includes('Warming up · 34 closes'));
  chart.setData(rows(60).map(candle => ({ ...candle, low: 2500, high: 2500, open: 2500, close: 2500, volume: 0 })));
  assert.equal(chart.indicators.rsi.at(-1), 50);
  assert.equal(chart.indicators.histogram.at(-1), 0);
  for (const pane of chart.geometry.panes) assert.ok(Number.isFinite(pane.y(0)));
});

test('historical views are not stretched by a new live price in the default fit mode', () => {
  const { canvas, calls } = fakeCanvas(), chart = new PriceChart(canvas);
  chart.setData(rows(), { price: 2600 }).setOptions({ bars: 30 });
  chart.keyDown(event({ key: 'ArrowLeft' }));
  const viewport = { ...chart.viewport }, maximum = chart.geometry.max;
  calls.length = 0;
  chart.setData(rows(), { price: 6000 });
  assert.deepEqual(chart.viewport, viewport);
  assert.equal(chart.geometry.max, maximum);
  assert.ok(calls.some(call => call.key === 'fillText' && call.args[0] === '↑ Live $6,000'));
});

test('event updates and marker toggles preserve the viewport and focused timestamp', () => {
  const { canvas } = fakeCanvas(), chart = new PriceChart(canvas);
  const data = rows();
  chart.setData(data).setOptions({ bars: 30 });
  chart.zoom(0.85); chart.keyDown(event({ key: 'ArrowLeft' }));
  const viewport = { ...chart.viewport };
  chart.setEvents([headline('a', data[60].time + 60)]);
  assert.deepEqual(chart.viewport, viewport);
  assert.deepEqual(chart.newsHits, []);
  chart.setOptions({ news: true });
  assert.deepEqual(chart.viewport, viewport);
  assert.deepEqual(chart.focusTime(data[60].time + 60), { focused: true });
  const focusedViewport = { ...chart.viewport }, focusedTime = chart.focusedTime;
  chart.setEvents([headline('a', focusedTime), headline('b', focusedTime + 60)]);
  chart.setData([...data, candle(START)]);
  assert.deepEqual(chart.viewport, focusedViewport);
  assert.equal(chart.focusedTime, focusedTime);
  assert.equal(chart.newsHits.find(hit => hit.time === data[60].time).events.length, 2);
});

test('focusTime reports missing and unavailable history without changing timeframe or zoom', () => {
  const { canvas } = fakeCanvas(), chart = new PriceChart(canvas);
  const data = [candle(START - 3 * DAY), candle(START - DAY)];
  chart.setData(data);
  const viewport = { ...chart.viewport };
  assert.deepEqual(chart.focusTime('2026-10-14'), { focused: false, reason: 'invalid-time' });
  assert.deepEqual(chart.focusTime(Date.now() / 1000 + 60), { focused: false, reason: 'future-time' });
  assert.deepEqual(chart.focusTime(data[0].time - 1), { focused: false, reason: 'outside-history' });
  assert.deepEqual(chart.focusTime(START - 2 * DAY), { focused: false, reason: 'missing-candle' });
  assert.deepEqual(chart.focusTime(START), { focused: false, reason: 'outside-history' });
  assert.deepEqual(chart.viewport, viewport);
  assert.deepEqual(chart.focusTime(data[0].time + 30), { focused: true });
  assert.equal(chart.granularity, DAY);
  assert.equal(chart.viewport.bars, viewport.bars);
  assert.equal(chart.options.news, false, 'focusing does not silently change marker preferences');
});

test('focus near the newest candle stays anchored when later candles arrive', () => {
  const { canvas } = fakeCanvas(), chart = new PriceChart(canvas);
  const data = rows();
  chart.setData(data).setOptions({ bars: 30 });
  chart.focusTime(data.at(-1).time + 30);
  const viewport = { ...chart.viewport }, time = chart.focusedTime;
  chart.setData([...data, candle(START)]);
  assert.deepEqual(chart.viewport, viewport);
  assert.equal(chart.focusedTime, time);
  chart.resetView();
  assert.equal(chart.focusedTime, null);
  assert.equal(chart.viewport.end, data.length + 1);
});

test('count markers select cloned headline groups and leave the viewport unchanged', () => {
  const { canvas, calls } = fakeCanvas(), tooltip = { hidden: true, style: {} }, selected = [], errors = [];
  const chart = new PriceChart(canvas, { tooltip, onEventSelect: group => selected.push(group), onError: error => errors.push(error) });
  const data = rows();
  chart.setData(data).setOptions({ bars: 30, news: true });
  chart.setEvents([headline('a', data[110].time + 30), headline('b', data[110].time + 60)]);
  const marker = chart.newsHits[0], viewport = { ...chart.viewport };
  assert.equal(chart.newsHits.length, 1);
  assert.ok(calls.some(call => call.key === 'fillText' && call.args[0] === '2' && call.args[2] === 24));
  chart.pointerMove(event({ pointerType: 'mouse', pointerId: 1, clientX: marker.x, clientY: marker.y }));
  assert.match(tooltip.textContent, /2 headlines.*UTC/);
  chart.pointerDown(event({ pointerType: 'mouse', pointerId: 1, button: 0, clientX: marker.x, clientY: marker.y }));
  chart.pointerUp(event({ pointerType: 'mouse', pointerId: 1, clientX: marker.x, clientY: marker.y }));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].time, data[110].time);
  assert.deepEqual(selected[0].events.map(item => item.id), ['a', 'b']);
  assert.deepEqual(chart.viewport, viewport);
  selected[0].events[0].title = 'Changed outside the chart';
  assert.equal(chart.events[0].title, 'Headline a');
  assert.deepEqual(errors, []);
});

test('marker gestures do not select a story after dragging, cancelling or adding a second touch', () => {
  const { canvas } = fakeCanvas(), selected = [], chart = new PriceChart(canvas, { onEventSelect: group => selected.push(group) });
  const data = rows();
  chart.setData(data).setOptions({ news: true }).setEvents([headline('a', data[110].time + 30)]);
  const marker = chart.newsHits[0];
  const at = (pointerId, values = {}) => event({ pointerType: 'touch', pointerId, clientX: marker.x, clientY: marker.y, ...values });
  const down = at(1); chart.pointerDown(down);
  const move = at(1, { clientY: marker.y + 20 }); chart.pointerMove(move);
  chart.pointerUp(at(1));
  assert.equal(down.prevented, false);
  assert.equal(move.prevented, false);
  assert.equal(selected.length, 0);
  chart.pointerDown(at(2)); chart.pointerCancel(at(2)); chart.pointerUp(at(2));
  chart.pointerDown(at(3)); chart.pointerDown(at(4)); chart.pointerUp(at(3)); chart.pointerUp(at(4));
  assert.equal(selected.length, 0);
  assert.equal(chart.markerPress, null);
  assert.equal(chart.touchPointers.size, 0);
  chart.pointerDown(at(5)); chart.pointerUp(at(5));
  assert.equal(selected.length, 1, 'a later ordinary tap still selects its group');
});

test('hidden, removed and empty-data markers never retain active hit areas', () => {
  const { canvas } = fakeCanvas(), selected = [], chart = new PriceChart(canvas, { onEventSelect: group => selected.push(group) });
  const data = rows();
  chart.setData(data).setOptions({ news: true }).setEvents([headline('a', data[110].time + 30)]);
  const marker = chart.newsHits[0];
  chart.setOptions({ news: false });
  assert.deepEqual(chart.newsHits, []);
  assert.equal(chart.hitNews({ x: marker.x, y: marker.y }), null);
  chart.setOptions({ news: true });
  chart.setEvents([]);
  assert.deepEqual(chart.newsHits, []);
  chart.setEvents([headline('a', data[110].time + 30)]);
  chart.setData([]);
  assert.deepEqual(chart.newsHits, []);
  assert.equal(chart.geometry, null);
  assert.equal(selected.length, 0);
});

test('renderer updates data, emits visible profile and clears stale geometry/tooltip on empty input', () => {
  const { canvas } = fakeCanvas(), tooltip = { hidden: true, style: {} }, profiles = [], errors = [];
  const chart = new PriceChart(canvas, { tooltip, onProfile: poc => profiles.push(poc), onError: error => errors.push(error) });
  chart.setData(rows(), { price: 2600, levels: [{ code: 'S1', price: 2416 }] });
  assert.equal(chart.viewport.bars, 90);
  assert.ok(chart.geometry);
  assert.ok(Number.isFinite(profiles.at(-1)));
  chart.pointerMove(event({ clientX: 100, clientY: 100 }));
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /UTC/);
  assert.match(tooltip.textContent, /Volume .* ETH/);
  chart.setData([]);
  assert.equal(chart.geometry, null);
  assert.equal(chart.hover, null);
  assert.equal(tooltip.hidden, true);
  assert.equal(profiles.at(-1), null);
  assert.deepEqual(errors, []);
});

test('wheel and keyboard controls clamp zoom, pan history and reset to the saved preset', () => {
  const { canvas } = fakeCanvas(), chart = new PriceChart(canvas);
  chart.setData(rows()).setOptions({ bars: 30, scale: 'log', type: 'line', ema: true });
  assert.equal(chart.viewport.start, 90);
  const anchor = chart.viewport.start + chart.viewport.bars / 2;
  chart.zoom(0.75, 0.5);
  assert.ok(Math.abs(chart.viewport.start + chart.viewport.bars / 2 - anchor) <= 0.5);
  chart.keyDown(event({ key: 'ArrowLeft' }));
  assert.ok(chart.viewport.end < 120);
  const panned = { ...chart.viewport };
  chart.setOptions({ ...chart.options, profile: false });
  assert.deepEqual(chart.viewport, panned, 'overlay preferences preserve pan and zoom');
  for (let index = 0; index < 30; index++) chart.wheel(event({ deltaY: -1, clientX: 200, clientY: 100 }));
  assert.equal(chart.viewport.bars, 20);
  chart.keyDown(event({ key: 'Home' }));
  assert.deepEqual(chart.viewport, { start: 90, end: 120, bars: 30 });
});

test('pan remains anchored when fresh candles arrive and timeframe changes reset the view', () => {
  const { canvas } = fakeCanvas(), chart = new PriceChart(canvas);
  const initial = rows();
  chart.setData(initial).setOptions({ bars: 30 });
  chart.keyDown(event({ key: 'ArrowLeft' }));
  const endTime = chart.candles[chart.viewport.end - 1].time;
  chart.setData([...initial, candle(START)]);
  assert.equal(chart.candles[chart.viewport.end - 1].time, endTime);
  chart.setData(initial, { granularity: 3600 });
  assert.equal(chart.viewport.end, initial.length);
  chart.resetView();
  chart.setData([...initial, candle(START)]);
  assert.equal(chart.viewport.end, initial.length + 1, 'latest view follows the feed');
});

test('dragging pans within history bounds and destroy removes interaction listeners', () => {
  const { canvas, listeners } = fakeCanvas(), tooltip = { hidden: true, style: {} };
  const chart = new PriceChart(canvas, { tooltip });
  chart.setData(rows()).setOptions({ bars: 30 });
  chart.pointerDown(event({ pointerId: 1, button: 0, clientX: 250, clientY: 100 }));
  chart.pointerMove(event({ pointerId: 1, clientX: 400, clientY: 100 }));
  assert.ok(chart.viewport.end < 120);
  chart.pointerMove(event({ pointerId: 1, clientX: 10000, clientY: 100 }));
  assert.equal(chart.viewport.start, 0);
  chart.pointerUp(event({ pointerId: 1, clientX: 400, clientY: 100 }));
  assert.equal(chart.drag, null);
  chart.destroy();
  assert.equal(listeners.size, 0);
  assert.equal(tooltip.hidden, true);
  assert.equal(canvas.style.touchAction, '');
});

test('touch gestures leave vertical scrolling native and capture only clear horizontal intent', () => {
  const { canvas, captures } = fakeCanvas(), chart = new PriceChart(canvas);
  chart.setData(rows()).setOptions({ bars: 30 });
  assert.equal(canvas.style.touchAction, 'pan-y pinch-zoom');
  const viewport = { ...chart.viewport };
  const down = event({ pointerType: 'touch', pointerId: 1, clientX: 250, clientY: 100 });
  chart.pointerDown(down);
  assert.equal(down.prevented, false);
  assert.equal(captures.size, 0);
  const vertical = event({ pointerType: 'touch', pointerId: 1, clientX: 254, clientY: 130 });
  chart.pointerMove(vertical);
  assert.equal(vertical.prevented, false);
  assert.equal(chart.pendingTouch, null);
  assert.equal(chart.drag, null);
  assert.deepEqual(chart.viewport, viewport);
  chart.pointerCancel(event({ pointerType: 'touch', pointerId: 1 }));
  chart.pointerDown(event({ pointerType: 'touch', pointerId: 2, clientX: 250, clientY: 100 }));
  const small = event({ pointerType: 'touch', pointerId: 2, clientX: 258, clientY: 100 });
  chart.pointerMove(small);
  assert.equal(captures.size, 0);
  const horizontal = event({ pointerType: 'touch', pointerId: 2, clientX: 270, clientY: 101 });
  chart.pointerMove(horizontal);
  assert.equal(horizontal.prevented, true);
  assert.equal(captures.has(2), true);
  assert.ok(chart.viewport.end < viewport.end);
  chart.pointerUp(event({ pointerType: 'touch', pointerId: 2, clientX: 270, clientY: 101 }));
  assert.equal(chart.drag, null);
  assert.equal(chart.pendingTouch, null);
  assert.equal(captures.size, 0);
  assert.equal(chart.touchPointers.size, 0);
});

test('multitouch, cancellation and lost capture cannot leave a chart drag stuck', () => {
  const { canvas, listeners, captures } = fakeCanvas(), chart = new PriceChart(canvas);
  chart.setData(rows()).setOptions({ bars: 30 });
  const touch = (pointerId, clientX = 250) => event({ pointerType: 'touch', pointerId, clientX, clientY: 100 });
  chart.pointerDown(touch(1)); chart.pointerMove(touch(1, 275));
  assert.equal(captures.has(1), true);
  chart.pointerDown(touch(2));
  assert.equal(chart.drag, null);
  assert.equal(captures.size, 0);
  const viewport = { ...chart.viewport };
  chart.pointerMove(touch(1, 400)); chart.pointerMove(touch(2, 400));
  assert.deepEqual(chart.viewport, viewport);
  chart.pointerUp(touch(1)); chart.pointerUp(touch(2));
  assert.equal(chart.touchPointers.size, 0);
  chart.pointerDown(touch(3)); chart.pointerMove(touch(3, 275));
  chart.pointerCancel(touch(3));
  assert.equal(chart.drag, null);
  assert.equal(captures.size, 0);
  assert.equal(chart.touchPointers.size, 0);
  chart.pointerDown(touch(4)); chart.pointerMove(touch(4, 275));
  captures.delete(4); listeners.get('lostpointercapture')(touch(4));
  assert.equal(chart.drag, null);
  assert.equal(chart.pendingTouch, null);
  assert.equal(chart.touchPointers.size, 0);
});

test('leaving the canvas and changing intervals clear pending touch gestures', () => {
  const { canvas, listeners, captures } = fakeCanvas(), chart = new PriceChart(canvas);
  chart.setData(rows()).setOptions({ bars: 30 });
  chart.pointerDown(event({ pointerType: 'touch', pointerId: 1, clientX: 699, clientY: 100 }));
  assert.equal(chart.touchPointers.size, 0, 'axis touches do not create a pending chart gesture');
  chart.pointerDown(event({ pointerType: 'touch', pointerId: 2, clientX: 250, clientY: 100 }));
  listeners.get('pointerleave')(event({ pointerType: 'touch', pointerId: 2 }));
  assert.equal(chart.pendingTouch, null);
  assert.equal(chart.touchPointers.size, 0);
  chart.pointerDown(event({ pointerType: 'touch', pointerId: 3, clientX: 250, clientY: 100 }));
  chart.pointerMove(event({ pointerType: 'touch', pointerId: 3, clientX: 275, clientY: 101 }));
  assert.equal(captures.size, 1);
  chart.setData([], { granularity: 3600 });
  assert.equal(captures.size, 0);
  assert.equal(chart.drag, null);
  assert.equal(chart.pendingTouch, null);
  assert.equal(chart.touchPointers.size, 0);
  chart.destroy();
  assert.equal(canvas.style.touchAction, '');
});
