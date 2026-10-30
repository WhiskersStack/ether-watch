import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createFixtureServer } from './fixture-preview.mjs';

async function withServer(run) {
  const server = createFixtureServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run(origin); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('serves a protected fixture page and rewritten local market modules', async () => withServer(async origin => {
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /worker-src 'none'/);
  assert.match(await page.text(), /fixture-guard\.js/);
  for (const file of ['/app.js', '/market-data.mjs']) {
    const source = await (await fetch(origin + file)).text();
    assert.match(source, /\/fixture\/market\//);
    assert.doesNotMatch(source, /https:\/\/api\.exchange\.coinbase\.com/);
  }
  assert.doesNotMatch(await (await fetch(origin + '/style.css')).text(), /fonts\.googleapis\.com/);
  assert.equal((await fetch(origin + '/cloud-push.mjs')).status,404);
}));

test('market, news, calendar, volume, and monitor data are synthetic', async () => withServer(async origin => {
  const get = async route => (await (await fetch(origin + route)).json());
  const ticker = await get('/fixture/market/ticker');
  assert.equal(ticker.price, '2510.12');
  assert.equal((await get('/fixture/market/candles?granularity=86400')).length, 110);
  assert.equal((await get('/api/news')).items[0].id, 'fixture-headline-1');
  assert.equal((await get('/api/calendar')).events[0].id, 'fixture-event-1');
  assert.equal((await get('/api/volume')).volumeUsd, 12750000000);
  const state = await get('/api/settings');
  assert.equal(state.levels.S1,2416);
  assert.equal(state.access.canManage,true);
}));

test('supports loading, stale, empty, and failure scenarios', async () => withServer(async origin => {
  const scenario = value => ({ headers: { 'X-Fixture-Scenario': value } });
  const start = Date.now();
  const loading = await fetch(origin + '/fixture/market/ticker', scenario('loading'));
  assert.equal(loading.status, 200);
  assert.ok(Date.now() - start >= 800);
  assert.equal((await (await fetch(origin + '/api/news', scenario('stale'))).json()).stale, true);
  assert.deepEqual(await (await fetch(origin + '/fixture/market/candles?granularity=86400', scenario('empty'))).json(), []);
  assert.equal((await (await fetch(origin + '/api/calendar', scenario('empty'))).json()).events.length, 0);
  assert.equal((await fetch(origin + '/api/settings', scenario('failure'))).status, 503);
  assert.equal((await fetch(origin + '/fixture/market/ticker', scenario('failure'))).status, 503);
}));

test('configuration stays in memory and resets with a new server', async () => {
  await withServer(async origin => {
    const before = await (await fetch(origin + '/api/settings')).json();
    const response = await fetch(origin + '/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ levels:{...before.levels,S1:2400}, expectedRevision: before.revision })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).levels.S1, 2400);
    assert.equal((await (await fetch(origin + '/api/settings')).json()).revision, 2);
  });
  await withServer(async origin => {
    const fresh = await (await fetch(origin + '/api/settings')).json();
    assert.equal(fresh.revision, 1);
  });
});

test('denies production routes, notification worker, and non-loopback hosts', async () => withServer(async origin => {
  for (const route of ['/api/check', '/api/push/test', '/mcp', '/notification-worker.js', '/unknown']) {
    assert.equal((await fetch(origin + route)).status, 404, route);
  }
  assert.equal((await fetch(origin + '/api/settings', { headers: { Origin: 'https://etherwatch.app' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(origin + '/api/settings', { headers: { Host: 'etherwatch.app' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
}));

test('server outbound clients fail before making a connection', () => {
  const program = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import https from 'node:https';
    import net from 'node:net';
    import dgram from 'node:dgram';
    import { denyOutboundNetwork } from './fixture-preview.mjs';
    denyOutboundNetwork();
    for (const call of [
      () => fetch('https://etherwatch.app/'),
      () => http.request('https://etherwatch.app/'),
      () => https.request('https://etherwatch.app/'),
      () => net.connect(443, 'etherwatch.app'),
      () => dgram.createSocket('udp4')
    ]) assert.throws(call, /outbound network access is disabled/);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: new URL('.', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
