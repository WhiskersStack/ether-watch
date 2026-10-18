import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./worker/volume.js',import.meta.url),'utf8');
const {parseAggregateVolume,fetchVolume,AGGREGATE_VOLUME_SOURCES:sources}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const now=Date.parse('2026-10-18T06:00:00Z'),request=()=>new Request('https://example.com/api/volume');
const payload=(id,value=15.52e9)=>id==='tradingview'?{totalCount:1,data:[{s:'CRYPTO:ETHUSD',d:[value]}]}:id==='coingecko'?{ethereum:{usd_24h_vol:value,last_updated_at:now/1000}}:{id:'eth-ethereum',symbol:'ETH',last_updated:new Date(now).toISOString(),quotes:{USD:{volume_24h:value}}};
for(const source of sources){
  test(source.name+' reads aggregate dollars directly without a price conversion',()=>assert.equal(parseAggregateVolume(payload(source.id),source,now).volumeUsd,15.52e9));
  for(const value of [null,0,-1,'15520000000',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test(source.name+' rejects invalid volume '+value,()=>assert.throws(()=>parseAggregateVolume(payload(source.id,value),source,now)));
}
test('rejects wrong assets, ambiguous symbols and stale provider timestamps',()=>{
  const wrong=payload('tradingview');wrong.data[0].s='BITSTAMP:ETHUSD';assert.throws(()=>parseAggregateVolume(wrong,sources[0],now));
  const duplicate=payload('tradingview');duplicate.totalCount=2;duplicate.data.push(duplicate.data[0]);assert.throws(()=>parseAggregateVolume(duplicate,sources[0],now));
  const old=payload('coingecko');old.ethereum.last_updated_at-=3600;assert.throws(()=>parseAggregateVolume(old,sources[1],now));
  const wrongCoin=payload('coinpaprika');wrongCoin.id='btc-bitcoin';assert.throws(()=>parseAggregateVolume(wrongCoin,sources[2],now));
});
async function fixture(operation,stored=null){
  const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;let calls=0,writes=0;
  globalThis.caches={default:{async match(){return stored?Response.json(stored):undefined;},async put(key,response){writes++;stored=await response.json();}}};
  globalThis.fetch=async()=>{calls++;return Response.json(payload('tradingview'));};
  try{await operation({setFetch:fn=>globalThis.fetch=async(...args)=>{calls++;return fn(...args);},get stored(){return stored;},get calls(){return calls;},get writes(){return writes;}});}finally{globalThis.fetch=oldFetch;if(oldCaches===undefined)delete globalThis.caches;else globalThis.caches=oldCaches;}
}
test('GET publishes source metadata, validates scanner query and caches for five minutes',()=>fixture(async f=>{
  f.setFetch(async(url,options)=>{assert.equal(url,sources[0].url);assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.deepEqual(JSON.parse(options.body).columns,['24h_vol_cmc']);assert.deepEqual(JSON.parse(options.body).symbols.tickers,['CRYPTO:ETHUSD']);return Response.json(payload('tradingview'));});
  const result=await fetchVolume(request(),now),data=await result.json();assert.equal(result.status,200);assert.equal(data.volumeUsd,15.52e9);assert.equal(data.source,'TradingView');assert.equal(data.currency,'USD');assert.equal(data.scope,'aggregate');assert.equal(data.sourceUpdatedAt,null);assert.equal(data.fetchedAt,new Date(now).toISOString());assert.equal(data.stale,false);assert.equal(f.writes,1);
  await fetchVolume(request(),now+299999);assert.equal(f.calls,1);
}));
test('blocked TradingView falls back to aggregate CoinGecko with its real source and time',()=>fixture(async f=>{
  f.setFetch(async url=>url===sources[0].url?new Response('blocked',{status:403}):Response.json(payload('coingecko',6.7e9)));
  const data=await(await fetchVolume(request(),now)).json();assert.equal(data.volumeUsd,6.7e9);assert.equal(data.source,'CoinGecko');assert.equal(data.sourceUrl,sources[1].page);assert.equal(data.sourceUpdatedAt,new Date(now).toISOString());assert.equal(f.calls,2);
}));
test('CoinPaprika fallback stays aggregate USD and names the provider',()=>fixture(async f=>{
  f.setFetch(async url=>url===sources[2].url?Response.json(payload('coinpaprika',4.6e9)):new Response('blocked',{status:429}));
  const data=await(await fetchVolume(request(),now)).json();assert.equal(data.volumeUsd,4.6e9);assert.equal(data.source,'CoinPaprika');assert.equal(f.calls,3);
}));
test('failure preserves original source/time, marks stale, and expires after one hour',()=>fixture(async f=>{
  const fetchedAt=f.stored.fetchedAt;f.setFetch(async()=>new Response('blocked',{status:403}));
  const stale=await(await fetchVolume(request(),now)).json();assert.equal(stale.volumeUsd,15.52e9);assert.equal(stale.source,'TradingView');assert.equal(stale.fetchedAt,fetchedAt);assert.equal(stale.stale,true);assert.equal(f.writes,0);
  const expired=await fetchVolume(request(),Date.parse(fetchedAt)+3600000);assert.equal(expired.status,503);assert.equal((await expired.json()).volumeUsd,null);
},{volumeUsd:15.52e9,sourceId:'tradingview',sourceUpdatedAt:null,fetchedAt:new Date(now-300000).toISOString()}));
test('malformed, redirected and oversized responses never become exchange volume',async()=>{
  for(const response of [()=>Response.json({}),()=>new Response(null,{status:302,headers:{Location:'https://other.example'}}),()=>new Response('x'.repeat(65537))])await fixture(async f=>{f.setFetch(async()=>response());const result=await fetchVolume(request(),now);assert.equal(result.status,503);assert.equal((await result.json()).volumeUsd,null);assert.equal(f.writes,0);assert.equal(f.calls,3);});
});
test('recovery replaces stale cache and resets error',()=>fixture(async f=>{
  f.setFetch(async()=>Response.json(payload('tradingview',16.2e9)));const data=await(await fetchVolume(request(),now)).json();assert.equal(data.volumeUsd,16.2e9);assert.equal(data.stale,false);assert.equal(data.error,null);assert.equal(data.fetchedAt,new Date(now).toISOString());
},{volumeUsd:15.52e9,sourceId:'tradingview',fetchedAt:new Date(now-300000).toISOString()}));
test('route is public without database and rejects non-GET methods before fetching',async()=>{
  const chunks=['dist/rules.mjs','worker/news.js','worker/calendar.js','worker/volume.js'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8').replace(/^export\s+/gm,''));
  const worker=(await import('data:text/javascript;base64,'+Buffer.from('const ASSETS={};\n'+chunks.join('\n')+'\n'+readFileSync(new URL('./worker/index.js',import.meta.url),'utf8')).toString('base64'))).default;
  await fixture(async f=>{f.setFetch(async()=>Response.json(payload('tradingview')));const response=await worker.fetch(request(),{});assert.equal(response.status,200);assert.equal((await response.json()).volumeUsd,15.52e9);const calls=f.calls;const post=await worker.fetch(new Request(request(),{method:'POST'}),{});assert.equal(post.status,405);assert.equal(post.headers.get('Allow'),'GET');assert.equal(f.calls,calls);});
});
