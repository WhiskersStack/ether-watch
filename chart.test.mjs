import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceChart, normalizeChartCandles, viewportBounds, calculateEMA, estimateVolumeProfile, findDailyFlips, layoutAxisLabels, normalizeChartOptions, DEFAULT_CHART_OPTIONS } from './dist/chart.mjs';

const DAY = 86400;
const START = Date.UTC(2026, 9, 14) / 1000;
const candle = (time, close = 2500, volume = 100) => ({ time, low: close - 10, high: close + 10, open: close - 2, close, volume });
const rows = (count = 120) => Array.from({ length: count }, (_, index) => candle(START - (count - index) * DAY, 2500 + index));

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
});

function fakeCanvas() {
  const listeners = new Map(), calls = [];
  const context = new Proxy({ measureText: text => ({ width: String(text).length * 5 }) }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push({ key, args }), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = {
    style: { touchAction: '', cursor: '' }, tabIndex: -1, width: 0, height: 0,
    getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 360 }),
    addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type), focus() {},
    setPointerCapture() {}, hasPointerCapture: () => false,
  };
  return { canvas, listeners, calls };
}
const event = values => ({ preventDefault() {}, ...values });

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
