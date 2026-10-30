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

