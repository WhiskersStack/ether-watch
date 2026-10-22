// Local Windows credential access. Never package this file or its credential store for the browser.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ORIGIN = 'https://ether-watch-jen.aquarose3.chatgpt.site';
const PROJECT_ID = 'appgprj_6acfc8555d7c81918cdf33a9acf1fa6f';
const CREDENTIAL_FILE = path.join(__dirname, '.monitor-credentials', 'service-token.dpapi.json');
const ENTROPY = Buffer.from('ether-watch-monitor-service:' + PROJECT_ID).toString('base64');
const DPAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$data = [Convert]::FromBase64String($p.data)
$entropy = [Convert]::FromBase64String($p.entropy)
try {
  if ($p.operation -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  } elseif ($p.operation -eq 'unprotect') {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else { throw 'Invalid operation' }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} finally {
  [Array]::Clear($data, 0, $data.Length)
  if ($result) { [Array]::Clear($result, 0, $result.Length) }
}
`;

function dpapi(operation, data) {
  if (process.platform !== 'win32') throw new Error('This credential requires Windows and the provisioning account.');
  try {
    const output = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT], {
        input: JSON.stringify({ operation, data: Buffer.from(data).toString('base64'), entropy: ENTROPY }),
        encoding: 'utf8', timeout: 10000, maxBuffer: 32768, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    return Buffer.from(output.trim(), 'base64');
  } catch {
    // A child-process error can contain its input/output; never forward it.
    throw new Error('Windows credential protection failed. Use the same Windows account on this PC.');
  }
}

function validToken(token) { return typeof token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(token); }

function storeCredential(token) {
  if (!validToken(token)) throw new Error('Invalid monitor credential.');
  const directory = path.dirname(CREDENTIAL_FILE);
  if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()))
    throw new Error('Unsafe credential directory.');
  if (fs.existsSync(CREDENTIAL_FILE)) throw new Error('A local credential already exists; replacement requires a separate rotation.');
  const plain = Buffer.from(token);
  const encrypted = dpapi('protect', plain);
  const recovered = dpapi('unprotect', encrypted);
  const verified = recovered.length === plain.length && crypto.timingSafeEqual(recovered, plain);
  plain.fill(0); recovered.fill(0);
  if (!verified) throw new Error('Credential verification failed.');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(CREDENTIAL_FILE, JSON.stringify({ version: 1, projectId: PROJECT_ID, origin: ORIGIN,
    protection: 'windows-dpapi-current-user', encryptedToken: encrypted.toString('base64') }), { flag: 'wx', mode: 0o600 });
  return { stored: true, roundTripVerified: true };
}

function loadCredential() {
  const stat = fs.lstatSync(CREDENTIAL_FILE);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid local credential store.');
  const stored = JSON.parse(fs.readFileSync(CREDENTIAL_FILE, 'utf8'));
  if (stored.version !== 1 || stored.projectId !== PROJECT_ID || stored.origin !== ORIGIN ||
      stored.protection !== 'windows-dpapi-current-user' || typeof stored.encryptedToken !== 'string')
    throw new Error('Credential does not belong to this Site.');
  const plain = dpapi('unprotect', Buffer.from(stored.encryptedToken, 'base64'));
  const token = plain.toString('utf8'); plain.fill(0);
  if (!validToken(token)) throw new Error('Invalid decrypted credential.');
  return token;
}

function fingerprint(state) {
  return JSON.stringify({ config: state.config, events: state.events, decisions: state.decisions, background: state.background });
}

async function run(operation = 'state', ids = [], { fetcher = fetch, credential = loadCredential } = {}) {
  if (!['state', 'check', 'ack', 'probe'].includes(operation)) throw new Error('Unsupported monitor operation.');
  if (operation === 'ack' && (!ids.length || ids.length > 200 || !ids.every(id => typeof id === 'string' && id.length < 250)))
    throw new Error('Provide the event IDs actually reported.');
  const request = async (route, options = {}) => {
    try { return await fetcher(ORIGIN + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Monitor request failed; no credential details are logged.'); }
  };
  const stateOf = async () => {
    const response = await request('/api/state');
    if (!response.ok) throw new Error('Monitor state read failed (HTTP ' + response.status + ').');
    let state;
    try { state = await response.json(); } catch { throw new Error('Invalid monitor state response.'); }
    if (typeof state.background?.enabled !== 'boolean' || typeof state.config?.armed !== 'boolean')
      throw new Error('Monitor state is incomplete; no operation was attempted.');
    return state;
  };
  const state = await stateOf();
  if (operation === 'state') return state;
  if (operation !== 'probe' && (!state.background.enabled || !state.config.armed))
    return { skipped: true, reason: !state.background.enabled ? 'scheduled-monitoring-disabled' : 'alerts-paused' };
  const token = credential();
  if (!validToken(token)) throw new Error('Invalid monitor credential.');
  const post = route => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json',
    'X-Ether-Watch-Monitor-Token': token }, body: operation === 'probe' ? '[]' : JSON.stringify(operation === 'ack' ? { ids } : { source: 'codex' }) });
  if (operation === 'probe') {
    // An array is rejected before monitor storage or market-data calls, even if access regresses.
    const results = [];
    for (const [route, expected] of [['/api/check', 400], ['/api/ack', 400], ['/api/config', 403], ['/api/background', 403]]) {
      const response = await post(route);
      results.push({ route, status: response.status, expected, passed: response.status === expected });
      await response.body?.cancel();
    }
    const after = await stateOf();
    return { results, monitorDataUnchanged: fingerprint(state) === fingerprint(after), backgroundEnabled: after.background.enabled,
      passed: results.every(result => result.passed) && fingerprint(state) === fingerprint(after) };
  }
  const response = await post(operation === 'ack' ? '/api/ack' : '/api/check');
  if (!response.ok) throw new Error('Monitor operation failed (HTTP ' + response.status + ').');
  try { return await response.json(); } catch { throw new Error('Invalid monitor response.'); }
}

async function main() {
  const operation = process.argv[2] || 'state';
  if (operation === 'provision') {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    console.log('Ready for credential JSON on stdin (input is hidden).');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 4096) throw new Error('Credential input is too large.');
      if (/[\r\n]/.test(input)) break;
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    let payload;
    try { payload = JSON.parse(input.trim()); } catch { throw new Error('Invalid credential input.'); }
    input = '';
    const result = storeCredential(payload.serviceToken); payload.serviceToken = '';
    console.log(JSON.stringify(result));
    return;
  }
  const result = await run(operation, process.argv.slice(3));
  console.log(JSON.stringify(result));
  if (operation === 'probe' && !result.passed) process.exitCode = 1;
}

module.exports = { ORIGIN, CREDENTIAL_FILE, dpapi, storeCredential, loadCredential, run };
if (require.main === module) main().catch(() => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  console.error('Monitor helper failed. Check configuration, Windows account and Site availability; credential details are suppressed.');
  process.exitCode = 1;
});
