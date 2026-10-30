// Local-only fixture server. It never imports the production Worker or opens D1.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, validateSettings } from './dist/settings.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const daySeconds = 86400;
const scenarios = new Set(['success', 'loading', 'stale', 'empty', 'failure']);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ...['settings.mjs','quote.mjs','navigation.mjs','retire-notifications.mjs'].map(file=>['/'+file,[file,'text/javascript; charset=utf-8']]),
  ['/chart.mjs', ['chart.mjs', 'text/javascript; charset=utf-8']],
  ['/market-data.mjs', ['market-data.mjs', 'text/javascript; charset=utf-8']],
  ['/calendar-ui.mjs', ['calendar-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/favicon.ico', ['favicon.ico', 'image/x-icon']],
  ['/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']]
]);
const csp = [
  "default-src 'none'", "base-uri 'none'", "object-src 'none'",
  "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
  "worker-src 'none'", "child-src 'none'", "form-action 'self'",
  "navigate-to 'self'"
].join('; ');
const marketPrefix = 'https://api.exchange.coinbase.com/products/ETH-USD/';
const fixturePrefix = '/fixture/market/';

function deny() { throw new Error('Fixture server outbound network access is disabled.'); }
export function denyOutboundNetwork() {
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = dgram.createSocket = deny;
}
function header(res, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
function json(res, status, body) {
  header(res, 'application/json; charset=utf-8');
  res.writeHead(status);
  res.end(JSON.stringify(body));
}
function syntheticCandles(granularity, count = 110, stale = false) {
  if (![900, 3600, daySeconds].includes(granularity)) return null;
  const now = Math.floor(Date.now() / 1000);
  const last = Math.floor(now / granularity) * granularity - (stale ? granularity * 4 : 0);
  return Array.from({ length: count }, (_, index) => {
    const time = last - (count - index - 1) * granularity;
    // Deterministic mixed up/down candles exercise the real renderer and EMAs.
    const close = +(2510.12 + (index - count + 1) * 1.4 + 90 * (Math.sin(index / 7) - Math.sin((count - 1) / 7))).toFixed(2);
    const open = +(close + Math.cos(index * 1.7) * 14).toFixed(2);
    const low = +(Math.min(open, close) - 9 - index % 4).toFixed(2);
    const high = +(Math.max(open, close) + 8 + index % 5 * 2).toFixed(2);
    return [time, low, high, open, close, 1600 + index * 431 % 2200 + Math.round(Math.abs(close - open) * 30)];
  });
}
function fixtureMarket(name, search, scenario) {
  if (scenario === 'failure') return [503, { error: 'Synthetic market feed failure' }];
  if (name === 'ticker') return [200, { price: scenario === 'empty' ? '' : '2510.12', time: new Date(Date.now() - (scenario === 'stale' ? 120000 : 0)).toISOString() }];
  if (name === 'stats') return [200, { open: '2490.00', volume: '123456.00' }];
  if (name === 'candles') {
    const granularity = Number(search.get('granularity'));
    const rows = syntheticCandles(granularity, 110, scenario === 'stale');
    return rows ? [200, scenario === 'empty' ? [] : rows] : [400, { error: 'Unsupported synthetic candle interval' }];
  }
  return [404, { error: 'Fixture route not found' }];
}
function fixtureVolume(scenario) {
  const now = Date.now() - (scenario === 'stale' ? 600000 : 0);
  return { asset: 'ETH', currency: 'USD', scope: 'aggregate', sourceId: 'coinmarketcap', source: 'CoinMarketCap', sourceUrl: 'https://coinmarketcap.com/currencies/ethereum/', volumeUsd: 12750000000, fetchedAt: new Date(now).toISOString(), sourceUpdatedAt: new Date(now).toISOString(), stale: scenario === 'stale', error: scenario === 'stale' ? 'Synthetic stale source' : null };
}
function fixtureNews(scenario) {
  const fetchedAt = new Date(Date.now() - (scenario === 'stale' ? 600000 : 0)).toISOString();
  const source = { id: 'ethereum', name: 'Synthetic Ethereum feed', status: scenario === 'stale' ? 'stale' : 'ok', fetchedAt, itemCount: scenario === 'empty' ? 0 : 12 };
  return { items: scenario === 'empty' ? [] : Array.from({length:12},(_,index)=>({ id: 'fixture-headline-'+(index+1), sourceId: 'ethereum', source: 'Synthetic Ethereum feed', title: 'Fixture headline '+(index+1)+': network activity and Ethereum market context', category: 'Ethereum', topics: ['ethereum'], context: 'Synthetic preview content; no publisher was contacted.', publishedAt: fetchedAt, url: 'https://fixture.invalid/story/'+(index+1) })), sources: [source], fetchedAt, stale: scenario === 'stale', partial: false, error: null };
}
function fixtureCalendar(scenario) {
  const fetchedAt = new Date(Date.now() - (scenario === 'stale' ? 600000 : 0)).toISOString();
  const start = new Date(Date.now() + 7 * 86400000);
  const source = { id: 'ethereum', name: 'Synthetic schedule', status: scenario === 'stale' ? 'stale' : 'ok', fetchedAt };
  return { sources: [source], events: scenario === 'empty' ? [] : [{ id: 'fixture-event-1', sourceId: 'ethereum', source: 'Synthetic schedule', title: 'Fixture network event', kind: 'network', status: 'confirmed', date: start.toISOString().slice(0, 10), startAt: start.toISOString(), context: 'Synthetic preview event; no official schedule was contacted.', url: 'https://ethereum.org/en/roadmap/' }], roadmap: scenario==='empty'?[]:[{id:'fixture-roadmap',sourceId:'ethereum',source:'Synthetic schedule',title:'Fixture roadmap milestone',kind:'ethereum-upgrade',status:'unconfirmed',context:'Synthetic planning target; no activation date confirmed.',url:'https://ethereum.org/roadmap/'}], fetchedAt, error: null };
}
function stateBody(state, viewer=false) {
  return {...state.config,access:{canManage:!viewer}};
}
async function requestBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 16000) throw new Error('Request is too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function serveAsset(res, pathname) {
  if (pathname === '/fixture-guard.js') {
    header(res, 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, 'fixture-guard.js')));
    return true;
  }
  const asset = assets.get(pathname);
  if (!asset) return false;
  let body = fs.readFileSync(path.join(root, 'dist', asset[0]));
  if (pathname === '/') {
    body = body.toString('utf8')
      .replace('<head>', '<head><script src="/fixture-guard.js"></script>')
      .replace('<title>', '<title>[FIXTURE] ')
      .replace('<body>', '<body><div role="status" style="padding:8px 16px;background:#512b00;color:#fff;font:600 13px sans-serif;text-align:center">LOCAL FIXTURE PREVIEW · Synthetic data only · No live alerts or notifications</div>');
  } else if (pathname === '/app.js' || pathname === '/market-data.mjs') {
    const source = body.toString('utf8');
    if (!source.includes(marketPrefix)) throw new Error('Market request rewrite no longer matches source');
    body = source.replaceAll(marketPrefix, fixturePrefix);
  } else if (pathname === '/style.css') {
    body = body.toString('utf8').replace(/^@import\s+url\([^\n]+\);\s*/u, '');
  }
  header(res, asset[1]);
  res.end(body);
  return true;
}
export function createFixtureServer() {
  const state = { config: validateSettings({ ...DEFAULT_SETTINGS, revision: 1 }) };
  return http.createServer(async (req, res) => {
    try {
      const host = `127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== host || !req.url?.startsWith('/') || req.url.startsWith('//')) return json(res, 403, { error: 'Loopback host required' });
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Same-origin request required' });
      if (req.method === 'GET' && serveAsset(res, url.pathname)) return;
      const selected = req.headers['x-fixture-scenario'];
      const viewer=req.headers['x-fixture-viewer']==='true';
      const scenario = scenarios.has(selected) ? selected : 'success';
      if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 900));
      if (req.method === 'GET' && url.pathname.startsWith(fixturePrefix)) {
        const [status, body] = fixtureMarket(url.pathname.slice(fixturePrefix.length), url.searchParams, scenario);
        return json(res, status, body);
      }
      if (req.method === 'GET' && url.pathname === '/api/settings') return json(res, scenario === 'failure' ? 503 : 200, scenario === 'failure' ? { error: 'Synthetic settings failure' } : stateBody(state, viewer));
      if (req.method === 'GET' && url.pathname === '/api/volume') return json(res, scenario === 'failure' ? 503 : 200, scenario === 'failure' ? { error: 'Synthetic volume failure' } : fixtureVolume(scenario));
      if (req.method === 'GET' && url.pathname === '/api/news') return json(res, scenario === 'failure' ? 503 : 200, scenario === 'failure' ? { error: 'Synthetic news failure' } : fixtureNews(scenario));
      if (req.method === 'GET' && url.pathname === '/api/calendar') return json(res, scenario === 'failure' ? 503 : 200, scenario === 'failure' ? { error: 'Synthetic calendar failure' } : fixtureCalendar(scenario));
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        if(viewer)return json(res,401,{error:'Owner sign-in required'});
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { error: 'JSON required' });
        const input = await requestBody(req);
        if (input.expectedRevision !== state.config.revision) return json(res, 409, { error: 'Fixture revision changed' });
        state.config = validateSettings({ ...input, revision: state.config.revision + 1 });
        return json(res, 200, stateBody(state, viewer));
      }
      return json(res, 404, { error: 'Fixture route denied' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  denyOutboundNetwork();
  const port = Number(process.argv[2] || 4175);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid local port');
  createFixtureServer().listen(port, '127.0.0.1', () => console.log(`Fixture preview: http://127.0.0.1:${port}/`));
}
