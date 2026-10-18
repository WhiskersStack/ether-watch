import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./worker/volume.js',import.meta.url),'utf8');
const {parsePublishedVolume,fetchVolume,VOLUME_SOURCE_URL}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const now=Date.parse('2026-10-18T06:00:00Z'),request=()=>new Request('https://example.com/api/volume');
const faq=(text='Ethereum (ETH) trading volume in 24 hours is ‪15.52 B‬ USD. See other coins.',name='What is the daily trading volume of Ethereum?')=>'<script type="application/ld+json">'+JSON.stringify({'@type':'FAQPage',mainEntity:[{'@type':'Question',name,acceptedAnswer:{'@type':'Answer',text}}]})+'</script>';
test('published ETH volume converts Unicode compact USD into dollars',()=>assert.equal(parsePublishedVolume(faq()),15_520_000_000));
for(const [text,expected] of [['6.25 B',6.25e9],['1.2 T',1.2e12],['450 M',450e6],['125 K',125e3],['1,234,567.89',1234567.89]])test('parses '+text+' USD without a price conversion',()=>assert.equal(parsePublishedVolume(faq('Ethereum (ETH) trading volume in 24 hours is '+text+' USD.')),expected));
for(const text of ['Ethereum (ETH) trading volume in 24 hours is 15.52 B ETH.','Bitcoin (BTC) trading volume in 24 hours is 15.52 B USD.','Ethereum (ETH) trading volume in 24 hours is -1 B USD.','Ethereum (ETH) trading volume in 24 hours is 0 USD.','Ethereum (ETH) trading volume in 24 hours is 1,23 B USD.','Ethereum (ETH) trading volume in 24 hours is 1e10 USD.','Ethereum (ETH) trading volume in 24 hours is 90000000000000000 USD.'])test('rejects invalid published statistic: '+text,()=>assert.throws(()=>parsePublishedVolume(faq(text))));
test('rejects missing, malformed, wrong-asset and ambiguous FAQ data',()=>{
  for(const html of ['<html>15.52 B USD</html>','<script type="application/ld+json">{</script>',faq(undefined,'What is the daily trading volume of Bitcoin?'),faq()+faq()])assert.throws(()=>parsePublishedVolume(html));
});
async function fixture(operation,stored=null){
  const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;let calls=0,writes=0;
  globalThis.caches={default:{async match(){return stored?Response.json(stored):undefined;},async put(key,response){writes++;stored=await response.json();}}};
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,VOLUME_SOURCE_URL);assert.equal(options.redirect,'error');return Response.json({});};
  try{await operation({setFetch:fn=>globalThis.fetch=async(...args)=>{calls++;return fn(...args);},get stored(){return stored;},get calls(){return calls;},get writes(){return writes;}});}finally{globalThis.fetch=oldFetch;if(oldCaches===undefined)delete globalThis.caches;else globalThis.caches=oldCaches;}
}
test('GET publishes dollars, source and retrieval time; fresh cache avoids upstream requests',()=>fixture(async f=>{
  f.setFetch(async(url,options)=>{assert.equal(url,VOLUME_SOURCE_URL);assert.equal(options.redirect,'error');return new Response(faq());});
  const result=await fetchVolume(request(),now),data=await result.json();
  assert.equal(result.status,200);assert.equal(data.volumeUsd,15.52e9);assert.equal(data.source,'TradingView');assert.equal(data.currency,'USD');assert.equal(data.scope,'aggregate');assert.equal(data.sourceUpdatedAt,null);assert.equal(data.fetchedAt,new Date(now).toISOString());assert.equal(data.stale,false);assert.equal(f.writes,1);
  await fetchVolume(request(),now+299999);assert.equal(f.calls,1);
}));
test('failure retains original timestamp, marks stale, and expires after one hour',()=>fixture(async f=>{
  const fetchedAt=f.stored.fetchedAt;f.setFetch(async()=>new Response('blocked',{status:403}));
  const stale=await(await fetchVolume(request(),now)).json();assert.equal(stale.volumeUsd,15.52e9);assert.equal(stale.fetchedAt,fetchedAt);assert.equal(stale.stale,true);assert.equal(stale.error,'HTTP 403');assert.equal(f.writes,0);
  const expired=await fetchVolume(request(),Date.parse(fetchedAt)+3600000);assert.equal(expired.status,503);assert.equal((await expired.json()).volumeUsd,null);
},{volumeUsd:15.52e9,fetchedAt:new Date(now-300000).toISOString()}));
test('malformed, oversized or unavailable responses never become exchange volume',async()=>{
  for(const response of [new Response(faq('bad')),new Response('x'.repeat(1048577)),new Response('blocked',{status:503})])await fixture(async f=>{f.setFetch(async()=>response);const result=await fetchVolume(request(),now);assert.equal(result.status,503);assert.equal((await result.json()).volumeUsd,null);assert.equal(f.writes,0);});
});
test('recovery replaces stale cache and resets error',()=>fixture(async f=>{
  f.setFetch(async()=>new Response(faq('Ethereum (ETH) trading volume in 24 hours is 16.2 B USD.')));
  const data=await(await fetchVolume(request(),now)).json();assert.equal(data.volumeUsd,16.2e9);assert.equal(data.stale,false);assert.equal(data.error,null);assert.equal(data.fetchedAt,new Date(now).toISOString());
},{volumeUsd:15.52e9,fetchedAt:new Date(now-300000).toISOString()}));
test('volume route is public without database and rejects non-GET methods before fetching',async()=>{
  const chunks=['dist/rules.mjs','worker/news.js','worker/calendar.js','worker/volume.js'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8').replace(/^export\s+/gm,''));
  const worker=(await import('data:text/javascript;base64,'+Buffer.from('const ASSETS={};\n'+chunks.join('\n')+'\n'+readFileSync(new URL('./worker/index.js',import.meta.url),'utf8')).toString('base64'))).default;
  await fixture(async f=>{f.setFetch(async()=>new Response(faq()));const response=await worker.fetch(request(),{});assert.equal(response.status,200);assert.equal((await response.json()).volumeUsd,15.52e9);const calls=f.calls;const post=await worker.fetch(new Request(request(),{method:'POST'}),{});assert.equal(post.status,405);assert.equal(post.headers.get('Allow'),'GET');assert.equal(f.calls,calls);});
});
