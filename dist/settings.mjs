export const LEVEL_IDS = Object.freeze(['S3', 'S2', 'S1', 'R1', 'R2', 'R3']);
export const DEFAULT_SETTINGS = Object.freeze({
  levels: Object.freeze({ S3: 2320, S2: 2373, S1: 2416, R1: 2554, R2: 2683, R3: 2813 }),
  revision: 1
});
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.levels || Array.isArray(input.levels)) throw new Error('All six price levels are required.');
  const levels = {};
  for (const id of LEVEL_IDS) {
    const value = input.levels[id];
    if (!['string', 'number'].includes(typeof value) || typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error(id + ' must be a positive USD amount with at most two decimal places.');
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 100 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) throw new Error(id + ' must be a positive USD amount with at most two decimal places.');
    levels[id] = Math.round(amount * 100) / 100;
  }
  if (LEVEL_IDS.some((id, index) => index && levels[LEVEL_IDS[index - 1]] >= levels[id])) throw new Error('Levels must increase in this order: S3 < S2 < S1 < R1 < R2 < R3.');
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Settings revision must be a positive integer.');
  return { levels, revision };
}
