// Public market reads; chart-level writes require the configured signed-in owner.
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const retiredPaths = new Set(['/api/state', '/api/config', '/api/check', '/api/ack', '/api/background', '/api/push', '/mcp']);
function settingsAccess(request, env) {
  const userId = request.headers.get('oai-authenticated-user-id') || null;
  const canManage = typeof env.MONITOR_OWNER_ID === 'string' && Boolean(env.MONITOR_OWNER_ID.trim()) && userId === env.MONITOR_OWNER_ID;
  return { userId, canManage };
}
async function readSettingsRow(db) {
  const row = await db.prepare('SELECT revision, s3, s2, s1, r1, r2, r3 FROM dashboard_settings WHERE id = 1').first();
  if (!row) throw new Error('Chart settings have not been migrated.');
  return validateSettings({ revision: row.revision, levels: Object.fromEntries(LEVEL_IDS.map(id => [id, row[id.toLowerCase()]])) });
}
async function settingsRoute(request, env) {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  const access = settingsAccess(request, env);
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Same-origin request required' }, 403);
    if (!access.canManage) return json({ error: 'Owner sign-in required' }, access.userId ? 403 : 401);
  }
  if (!env.DB) return json({ error: 'Chart settings storage is unavailable' }, 503);
  if (request.method === 'GET') return json({ ...await readSettingsRow(env.DB), access: { canManage: access.canManage } });
  let input, next;
  try {
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Error('JSON request required');
    const text = await request.text();
    if (text.length > 16000) throw new Error('Request is too large');
    input = JSON.parse(text);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['levels', 'expectedRevision'].includes(key))) throw new Error('Only chart levels and expectedRevision are accepted.');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('A valid expectedRevision is required.');
    next = validateSettings({ levels: input.levels, revision: input.expectedRevision + 1 });
  } catch (error) { return json({ error: error.message }, 400); }
  const result = await env.DB.prepare('UPDATE dashboard_settings SET s3 = ?, s2 = ?, s1 = ?, r1 = ?, r2 = ?, r3 = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
    .bind(...LEVEL_IDS.map(id => next.levels[id]), input.expectedRevision).run();
  if (result.meta?.changes !== 1) return json({ error: 'Settings were updated elsewhere. Refresh and try again.' }, 409);
  return json({ ...next, access: { canManage: true } });
}
async function route(request, env) {
  const path = new URL(request.url).pathname;
  // Check retirement before authentication, parsing, storage, or network access.
  if (retiredPaths.has(path) || path.startsWith('/api/push/') || path.startsWith('/mcp/')) return json({ error: 'Alerts have been permanently retired.' }, 410);
  if (path === '/api/settings') return settingsRoute(request, env);
  if (path === '/api/volume') return fetchVolume(request, env);
  if (path === '/api/news') return fetchNews(request);
  if (path === '/api/calendar') return fetchCalendar(request);
  if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  const asset = ASSETS[path];
  if (!asset) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : asset.encoding === 'base64' ? Uint8Array.from(atob(asset.body), c => c.charCodeAt(0)) : asset.body,
    { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
}
export default { async fetch(request, env) {
  try { return await route(request, env); }
  catch { return json({ error: 'Chart settings service is unavailable. Try again shortly.' }, 503); }
} };
