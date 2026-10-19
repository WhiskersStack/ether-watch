import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const source=readFileSync(new URL('./worker/volume.js',import.meta.url),'utf8');
const {parseCoinMarketCapVolume,fetchVolume,CMC_VOLUME_SOURCE}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const start=Date.parse('2026-10-19T06:00:00Z'),key='eth-usd-cmc-spot-v1';
const request=(origin='https://etherwatch.app',method='GET')=>new Request(origin+'/api/volume',{method});
const payload=(now=start,volume=8.35e9)=>({status:{error_code:'0'},data:[{id:1027,symbol:'ETH',quote:[{id:2781,symbol:'USD',volume_24h:volume,last_updated:new Date(now).toISOString()}]}]});
function database(migrate=true){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./drizzle/0000_monitor.sql',import.meta.url),'utf8'));
  if(migrate)sqlite.exec(readFileSync(new URL('./drizzle/0001_market_data_cache.sql',import.meta.url),'utf8'));
  const db={prepare(sql){assert.doesNotMatch(sql,/^\s*(CREATE|ALTER|DROP)/i);return {bind(...values){return {async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};},async first(){return sqlite.prepare(sql).get(...values);}};}};}};
  return {db,sqlite};
}
async function fixture(operation){
  const {db,sqlite}=database();let time=start,calls=0,fetcher=async()=>Response.json(payload(time));
  const env={DB:db,CMC_API_KEY:'fixture-only-cmc-key'},deps={now:()=>time,fetch:async(...args)=>{calls++;return fetcher(...args);}};
  try{await operation({env,deps,sqlite,setFetch(fn){fetcher=fn;},advance(ms){time+=ms;},get now(){return time;},get calls(){return calls;},read(){return sqlite.prepare('SELECT * FROM market_data_cache WHERE cache_key=?').get(key);},async get(origin){return fetchVolume(request(origin),env,deps);}});}finally{sqlite.close();}
}
test('CMC v3 reads ETH total USD spot volume directly with distinct source time',()=>{
  const result=parseCoinMarketCapVolume(payload(),start);assert.equal(result.volumeUsd,8.35e9);assert.equal(result.sourceUpdatedAt,new Date(start).toISOString());
  const numeric=payload();numeric.status.error_code=0;assert.equal(parseCoinMarketCapVolume(numeric,start).volumeUsd,8.35e9);
});
for(const volume of [null,0,-1,'8350000000',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test('rejects invalid volume '+volume,()=>assert.throws(()=>parseCoinMarketCapVolume(payload(start,volume),start)));
for(const [name,mutate] of [
  ['provider error',d=>d.status.error_code='1001'],['missing status',d=>delete d.status],['wrong asset',d=>d.data[0].id=1],['wrong symbol',d=>d.data[0].symbol='BTC'],['duplicate coins',d=>d.data.push(d.data[0])],['wrong quote',d=>d.data[0].quote[0].symbol='ETH'],['wrong USD id',d=>d.data[0].quote[0].id=1],['duplicate quotes',d=>d.data[0].quote.push(d.data[0].quote[0])],['missing quote time',d=>delete d.data[0].quote[0].last_updated],['invalid date',d=>d.data[0].quote[0].last_updated='2026-02-30T06:00:00Z'],['future time',d=>d.data[0].quote[0].last_updated=new Date(start+60001).toISOString()],['one-hour-old time',d=>d.data[0].quote[0].last_updated=new Date(start-3600000).toISOString()]
])test('rejects '+name,()=>{const data=payload();mutate(data);assert.throws(()=>parseCoinMarketCapVolume(data,start));});
test('public route identifies CMC and keeps provider time separate from retrieval',()=>fixture(async f=>{
  f.setFetch(async(url,options)=>{assert.equal(url,CMC_VOLUME_SOURCE.url);assert.equal(options.headers['X-CMC_PRO_API_KEY'],f.env.CMC_API_KEY);assert.equal(options.redirect,'manual');return Response.json(payload(f.now-60000));});
  const response=await f.get(),data=await response.json();assert.equal(response.status,200);assert.equal(data.volumeUsd,8.35e9);assert.equal(data.sourceId,'coinmarketcap');assert.equal(data.scope,'aggregate');assert.equal(data.currency,'USD');assert.equal(data.sourceUrl,CMC_VOLUME_SOURCE.page);assert.equal(data.fetchedAt,new Date(f.now).toISOString());assert.equal(data.sourceUpdatedAt,new Date(f.now-60000).toISOString());assert.equal(data.stale,false);assert.doesNotMatch(JSON.stringify(data),/fixture-only-cmc-key/);
}));
test('both origins and manual refreshes share one five-minute allowance',()=>fixture(async f=>{
  await f.get();for(let i=0;i<10;i++)await f.get('https://ether-watch-jen.aquarose3.chatgpt.site');f.advance(299999);await f.get();assert.equal(f.calls,1);f.advance(1);await f.get();assert.equal(f.calls,2);
}));
test('concurrent cold requests acquire one D1 lease globally',()=>fixture(async f=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve);f.setFetch(async()=>{entered();return new Promise(resolve=>release=()=>resolve(Response.json(payload(f.now))));});
  const first=f.get();await started;const others=await Promise.all(Array.from({length:12},(_,i)=>f.get(i%2?'https://etherwatch.app':'https://ether-watch-jen.aquarose3.chatgpt.site')));assert.equal(f.calls,1);assert.ok(others.every(r=>r.status===503));release();assert.equal((await first).status,200);assert.equal((await f.get()).status,200);assert.equal(f.calls,1);
}));
test('an interrupted request cannot be retried after lease expiry before its five-minute reservation',()=>fixture(async f=>{
  f.sqlite.prepare('INSERT INTO market_data_cache(cache_key,next_attempt_at,lease_until,lease_token) VALUES (?,?,?,?)').run(key,f.now+300000,f.now+30000,'old-lease');f.advance(31000);assert.equal((await f.get()).status,503);assert.equal(f.calls,0);f.advance(269000);assert.equal((await f.get()).status,200);assert.equal(f.calls,1);
}));
test('failures preserve timestamps and impose fifteen-minute cooldown before recovery',()=>fixture(async f=>{
  const first=await(await f.get()).json();f.advance(300000);f.setFetch(async()=>new Response('blocked',{status:403}));const failed=await(await f.get()).json();assert.equal(failed.stale,true);assert.equal(failed.fetchedAt,first.fetchedAt);assert.equal(failed.sourceUpdatedAt,first.sourceUpdatedAt);assert.equal(failed.volumeUsd,first.volumeUsd);assert.equal(failed.error,'HTTP 403');const calls=f.calls;
  f.advance(899999);await f.get('https://ether-watch-jen.aquarose3.chatgpt.site');assert.equal(f.calls,calls);f.advance(1);f.setFetch(async()=>Response.json(payload(f.now,9e9)));const recovered=await(await f.get()).json();assert.equal(recovered.volumeUsd,9e9);assert.equal(recovered.stale,false);assert.equal(recovered.error,null);
}));
for(const retry of ['3600',new Date(start+3900000).toUTCString()])test('respects longer Retry-After '+retry,()=>fixture(async f=>{
  f.setFetch(async()=>new Response('rate limited',{status:429,headers:{'Retry-After':retry}}));const response=await f.get();assert.equal(response.status,503);assert.ok(Number(response.headers.get('Retry-After'))>=3600);f.advance(900000);await f.get();assert.equal(f.calls,1);assert.ok(f.read().next_attempt_at>=start+3600000);
}));
test('source-age expiry cannot be renewed by retrieving the same old value',()=>fixture(async f=>{
  f.setFetch(async()=>Response.json(payload(start-300000)));const data=await(await f.get()).json();assert.equal(data.stale,true);f.advance(3300000);f.setFetch(async()=>{throw Error('offline');});const response=await f.get();assert.equal(response.status,503);assert.equal((await response.json()).volumeUsd,null);
}));
test('retained failure data expires after one hour even during a longer cooldown',()=>fixture(async f=>{
  await f.get();f.advance(300000);f.setFetch(async()=>new Response('blocked',{status:429,headers:{'Retry-After':'7200'}}));await f.get();f.advance(3300000);const response=await f.get();assert.equal(response.status,503);assert.equal((await response.json()).fetchedAt,null);assert.equal(f.calls,2);
}));
test('malformed, redirect and oversized bodies fail without another provider',async()=>{
  for(const make of [()=>Response.json({}),()=>new Response(null,{status:302,headers:{Location:'https://other.example'}}),()=>new Response('x'.repeat(65537))])await fixture(async f=>{f.setFetch(async()=>make());assert.equal((await f.get()).status,503);await f.get();assert.equal(f.calls,1);});
});
test('cache and volume failures never alter monitor rows',()=>fixture(async f=>{
  f.sqlite.prepare('INSERT INTO monitor(id,version,data) VALUES(1,7,?)').run('{"background":{"enabled":false}}');const before=f.sqlite.prepare('SELECT * FROM monitor').all();await f.get();f.advance(300000);f.setFetch(async()=>{throw Error('offline');});await f.get();assert.deepEqual(f.sqlite.prepare('SELECT * FROM monitor').all(),before);
}));
test('missing configuration makes no request; keyless mode requires an explicit runtime choice',()=>fixture(async f=>{
  delete f.env.CMC_API_KEY;assert.equal((await f.get()).status,503);assert.equal(f.calls,0);f.env.CMC_USE_PUBLIC_API='true';f.setFetch(async(url,options)=>{assert.equal(url,CMC_VOLUME_SOURCE.publicUrl);assert.equal(options.headers['X-CMC_PRO_API_KEY'],undefined);return Response.json(payload(f.now));});assert.equal((await f.get()).status,200);assert.equal(f.calls,1);
}));
test('missing DB or migration never starts an uncontrolled upstream request',async()=>{
  const {db,sqlite}=database(false);let calls=0;const deps={now:start,fetch:async()=>{calls++;throw Error('must not fetch');}};try{for(const DB of [undefined,db])assert.equal((await fetchVolume(request(),{DB,CMC_API_KEY:'fixture-key'},deps)).status,503);assert.equal(calls,0);}finally{sqlite.close();}
});
test('volume route is public with its cache and rejects writes before storage or network',async()=>{
  const chunks=['dist/rules.mjs','worker/news.js','worker/calendar.js','worker/volume.js'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8').replace(/^export\s+/gm,''));
  const worker=(await import('data:text/javascript;base64,'+Buffer.from('const ASSETS={};\n'+chunks.join('\n')+'\n'+readFileSync(new URL('./worker/index.js',import.meta.url),'utf8')).toString('base64'))).default;
  const {db,sqlite}=database(),original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(payload(Date.now()));};
  try{const env={DB:db,CMC_API_KEY:'fixture-key'};const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).source,'CoinMarketCap');const post=await worker.fetch(request('https://etherwatch.app','POST'),{});assert.equal(post.status,405);assert.equal(post.headers.get('Allow'),'GET');assert.equal(calls,1);}finally{sqlite.close();globalThis.fetch=original;}
});

test('cached snapshots cannot extend the permitted provider clock skew',()=>fixture(async f=>{
  const data={volumeUsd:8.35e9,fetchedAt:new Date(f.now+60000).toISOString(),sourceUpdatedAt:new Date(f.now+120000).toISOString()};
  f.sqlite.prepare('INSERT INTO market_data_cache(cache_key,data,next_attempt_at) VALUES(?,?,?)').run(key,JSON.stringify(data),f.now+300000);
  const response=await f.get();assert.equal(response.status,503);assert.equal((await response.json()).volumeUsd,null);assert.equal(f.calls,0);
}));
