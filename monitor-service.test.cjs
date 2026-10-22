const test = require('node:test');
const assert = require('node:assert/strict');
const { run, dpapi, ORIGIN } = require('./monitor-service.cjs');
const token = 'fixture_service_credential_32_characters';
const state = (enabled = false, armed = true) => ({ background: { enabled }, config: { armed, revision: 1 }, events: [], decisions: [] });

test('disabled monitoring and paused rules never decrypt or submit a check/ack', async () => {
  for (const operation of ['check', 'ack']) for (const s of [state(false), state(true, false)]) {
    let calls = 0;
    const result = await run(operation, ['reported-event'], { fetcher: async (url, options) => {
      calls++; assert.equal(url, ORIGIN + '/api/state'); assert.equal(options.method, undefined); return Response.json(s);
    }, credential: () => { throw new Error('Credential must not be read'); } });
    assert.equal(result.skipped, true); assert.equal(calls, 1);
  }
});

test('checks send a credential only to the fixed Site origin and reject redirects', async () => {
  const calls = [];
  await run('check', [], { credential: () => token, fetcher: async (url, options) => {
    calls.push({ url, options }); return Response.json(options.method ? { pending: [] } : state(true));
  } });
  assert.equal(calls.length, 2); assert.equal(calls[1].url, ORIGIN + '/api/check');
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[1].options.headers['X-Ether-Watch-Monitor-Token'], token);
  assert.equal(calls[1].options.redirect, 'error'); assert.deepEqual(JSON.parse(calls[1].options.body), { source: 'codex' });
});

test('permission probe uses nonobject bodies, verifies narrow grants and leaves data unchanged', async () => {
  const seen = [];
  const result = await run('probe', [], { credential: () => token, fetcher: async (url, options) => {
    if (!options.method) return Response.json(state());
    seen.push(url); assert.equal(options.body, '[]');
    return Response.json({ error: 'fixture' }, { status: /\/(check|ack)$/.test(url) ? 400 : 403 });
  } });
  assert.equal(seen.length, 4); assert.equal(result.passed, true); assert.equal(result.backgroundEnabled, false);
});

test('permission probe detects invalid credentials and concurrent monitor changes', async () => {
  let reads = 0;
  const result = await run('probe', [], { credential: () => token, fetcher: async (url, options) => {
    if (options.method) return Response.json({}, { status: 401 });
    const s = state(); s.config.revision += reads++; return Response.json(s);
  } });
  assert.equal(result.passed, false); assert.equal(result.monitorDataUnchanged, false);
});

test('unknown operations and invalid acknowledgements do not access network or credentials', async () => {
  const forbidden = () => { throw new Error('Must not be called'); };
  await assert.rejects(run('background', [], { fetcher: forbidden, credential: forbidden }), /Unsupported/);
  await assert.rejects(run('ack', [], { fetcher: forbidden, credential: forbidden }), /event IDs/);
});

test('incomplete state and failed requests suppress upstream response bodies and credential details', async () => {
  await assert.rejects(run('check', [], { fetcher: async () => Response.json({}), credential: () => token }), /incomplete/);
  await assert.rejects(run('check', [], { fetcher: async () => { throw Error(token); }, credential: () => token }), error => !error.message.includes(token));
  await assert.rejects(run('check', [], { credential: () => token, fetcher: async (url, options) =>
    options.method ? Response.json({ error: token }, { status: 401 }) : Response.json(state(true)) }), error => !error.message.includes(token));
});

test('Windows DPAPI protects and recovers fixture bytes under the current account', { skip: process.platform !== 'win32' }, () => {
  const input = Buffer.from(token), encrypted = dpapi('protect', input);
  assert.notDeepEqual(encrypted, input); assert.deepEqual(dpapi('unprotect', encrypted), input);
});
