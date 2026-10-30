import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const source = read('./dist/server/index.js');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
test('packaged dashboard assets match their reviewed sources', async () => {
  for (const file of ['index.html','style.css','app.js','settings.mjs','quote.mjs','navigation.mjs','retire-notifications.mjs','notification-worker.js','chart.mjs','market-data.mjs','calendar-ui.mjs']) {
    const response = await worker.fetch(new Request('https://fixture.example/' + file), {});
    assert.equal(response.status, 200, file);
    assert.equal(await response.text(), read('./dist/' + file), file);
  }
});
test('packaged retired routes never inspect bindings and obsolete modules are absent', async () => {
  const env = new Proxy({}, {get(){throw Error('Retirement must not access bindings');}});
  for (const endpoint of ['/mcp','/api/state','/api/config','/api/check','/api/ack','/api/background','/api/push/subscribe']) {
    assert.equal((await worker.fetch(new Request('https://fixture.example' + endpoint, {method:'POST'}), env)).status, 410);
  }
  for (const file of ['rules.mjs','cloud-push.mjs']) assert.equal((await worker.fetch(new Request('https://fixture.example/' + file), {})).status, 404);
  for (const symbol of ['async function runCheck','async function cloudMcp','async function sendPush','requestPermission(']) assert.ok(!source.includes(symbol), symbol);
  assert.deepEqual(JSON.parse(read('./dist/.openai/hosting.json')).capabilities, []);
});
