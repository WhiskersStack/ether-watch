import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sourceCode=readFileSync(new URL('./worker/news.js',import.meta.url),'utf8');
const {NEWS_SOURCES,newsPlainText,newsSafeUrl,newsDate,newsRelevance,newsNormalize,parseNewsFeed,fetchNews}=await import('data:text/javascript;base64,'+Buffer.from(sourceCode).toString('base64'));
const publisher=NEWS_SOURCES.find(source=>source.id==='coindesk'),now=Date.parse('2026-10-14T20:00:00Z');
function rss(items){return '<?xml version="1.0"?><rss><channel>'+items.join('')+'</channel></rss>';}
function entry(title,date='Wed, 14 Oct 2026 18:00:00 GMT',url='https://www.coindesk.com/markets/eth-update'){return '<item><title>'+title+'</title><link><![CDATA['+url+']]></link><pubDate>'+date+'</pubDate></item>';}
function cacheMemory(){const entries=new Map();return {entries,async match(key){const response=entries.get(key.url);return response?.clone();},async put(key,response){entries.set(key.url,response.clone());}};}
async function withNetwork(run){const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;try{await run();}finally{globalThis.fetch=originalFetch;if(originalCaches===undefined)delete globalThis.caches;else globalThis.caches=originalCaches;}}

test('RSS extracts safe plain-text titles, CDATA, entities and original timestamps',()=>{
  const feed=rss([entry('<![CDATA[Ethereum &amp; <b>ETF</b> flows &#x2014; today]]>')]);
  const [item]=parseNewsFeed(feed,publisher,now);
  assert.equal(item.title,'Ethereum & ETF flows — today');assert.equal(item.category,'ETF & flows');assert.equal(item.publishedAt,'2026-10-14T18:00:00.000Z');
  assert.deepEqual(item.topics,['ethereum','etf']);
  assert.equal(item.url,'https://www.coindesk.com/markets/eth-update');assert.equal(item.source,'CoinDesk');assert.equal(item.sourceId,'coindesk');
  assert.equal(newsPlainText('&lt;script&gt;bad()&lt;/script&gt; ETH &rsquo; &amp; signal'),'ETH ’ & signal');
});
test('Atom selects alternate links and published date, with namespace and BOM support',()=>{
  const feed='\uFEFF<atom:feed><atom:entry><atom:title>Ethereum staking upgrade</atom:title><atom:link rel="self" href="https://www.coindesk.com/api/1"/><atom:link rel="alternate" href="https://www.coindesk.com/tech/upgrade?utm_source=rss&amp;keep=1#top"/><atom:published>2026-10-14T17:00:00+00:00</atom:published><atom:updated>2026-10-14T18:00:00Z</atom:updated></atom:entry></atom:feed>';
  const [item]=parseNewsFeed(feed,publisher,now);assert.equal(item.url,'https://www.coindesk.com/tech/upgrade?keep=1');assert.equal(item.category,'Network');assert.equal(item.publishedAt,'2026-10-14T17:00:00.000Z');
});
test('publisher links require HTTPS, exact allowed hosts and no credentials',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,ETH','http://www.coindesk.com/eth','https://www.coindesk.com.evil.test/eth','https://evil.test/?url=coindesk.com','https://user:pass@www.coindesk.com/eth','https://www.coindesk.com:8080/eth'])assert.equal(newsSafeUrl(url,publisher),null,url);
  assert.equal(newsSafeUrl('https://www.coindesk.com/eth?utm_medium=feed&x=1',publisher),'https://www.coindesk.com/eth?x=1');
});
test('chronology rejects invalid, future and old dates, deduplicates and filters unrelated stories',()=>{
  const feed=rss([entry('Ethereum second update','Wed, 14 Oct 2026 19:00:00 GMT','https://www.coindesk.com/second'),entry('ETH ETF flows'),entry('ETH ETF flows','Wed, 14 Oct 2026 18:30:00 GMT','https://www.coindesk.com/duplicate'),entry('Unrelated football report','Wed, 14 Oct 2026 19:45:00 GMT','https://www.coindesk.com/sports'),entry('Ethereum future','Thu, 15 Oct 2026 00:00:00 GMT','https://www.coindesk.com/future'),entry('Ethereum broken date','bad-date','https://www.coindesk.com/bad'),entry('Ethereum invalid date','Tue, 31 Feb 2026 12:00:00 GMT','https://www.coindesk.com/invalid'),entry('Ethereum old','Mon, 01 Jun 2026 00:00:00 GMT','https://www.coindesk.com/old')]);
  const items=parseNewsFeed(feed,publisher,now);assert.equal(items.length,2);assert.equal(items[0].title,'Ethereum second update');assert.equal(items[1].url,'https://www.coindesk.com/duplicate');
  for(const date of ['1','yesterday','2026-02-31T00:00:00Z','2026-13-01T00:00:00Z',''])assert.equal(newsDate(date),null);
  assert.equal(newsNormalize([...items,...items],now).length,2);
});
test('official network and monetary feeds retain relevant posts while categories explain potential mechanisms',()=>{
  const eth=parseNewsFeed(rss([entry('Protocol research update','Wed, 14 Oct 2026 18:00:00 GMT','https://blog.ethereum.org/2026/10/14/update')]),NEWS_SOURCES[0],now);
  assert.equal(eth[0].category,'Network');
  assert.deepEqual(eth[0].topics,['ethereum','network']);
  const fed=parseNewsFeed(rss([entry('Minutes of the discount rate meetings','Wed, 14 Oct 2026 18:00:00 GMT','https://www.federalreserve.gov/newsevents/pressreleases/monetary20261014a.htm')]),NEWS_SOURCES[3],now);
  assert.equal(fed[0].category,'Macro');assert.match(fed[0].context,/can influence/);
  assert.deepEqual(fed[0].topics,['macro']);
  assert.throws(()=>parseNewsFeed('<html>unavailable</html>',publisher,now),/Invalid RSS/);
  assert.throws(()=>parseNewsFeed('<rss><channel>'+entry('Ethereum update'),publisher,now),/Invalid RSS/);
});
test('mixed relevance keeps independent topics without changing the primary category',()=>{
  const mixed=newsRelevance('Ethereum ETF investors watch Fed policy after SEC security breach','Ethereum network staking upgrade',publisher);
  assert.equal(mixed.category,'Macro');assert.deepEqual(mixed.topics,['ethereum','macro','network','etf','regulation','security']);
  assert.deepEqual(newsRelevance('Bitcoin ETF inflows rise','',publisher).topics,['ethereum','etf']);
  assert.deepEqual(newsRelevance('Bitcoin investors watch Fed policy','',publisher).topics,['ethereum','macro']);
  assert.deepEqual(newsRelevance('CPI inflation release','',publisher).topics,['macro']);
  assert.equal(newsRelevance('Football final tonight','',publisher),null);
});
test('parser retains the newest 32 unique eligible source articles',()=>{
  const rows=Array.from({length:35},(_,i)=>entry('Ethereum report '+i,new Date(now-i*60000).toUTCString(),'https://www.coindesk.com/report-'+i));
  const items=parseNewsFeed(rss([...rows,rows[0],entry('Ethereum old','Mon, 01 Jun 2026 00:00:00 GMT','https://www.coindesk.com/old')]),publisher,now);
  assert.equal(items.length,32);assert.equal(items[0].title,'Ethereum report 0');assert.equal(items.at(-1).title,'Ethereum report 31');
});
test('news route uses five-minute cache without refetching and preserves retrieved timestamps',async()=>withNetwork(async()=>{
  const cache=cacheMemory();globalThis.caches={default:cache};let calls=0;const date=new Date(Date.now()-60000).toUTCString();
  globalThis.fetch=async url=>{calls++;const descriptor=NEWS_SOURCES.find(source=>source.url===url);return new Response(rss([entry(descriptor.kind==='macro'?'Federal Reserve interest rate decision':'Ethereum ETF update',date,'https://'+descriptor.domains[0]+'/example')]),{headers:{'Content-Type':'application/xml'}});};
  const request=new Request('https://ether-watch.example/api/news');const first=await (await fetchNews(request)).json(),second=await (await fetchNews(request)).json();
  assert.equal(calls,4);assert.equal(first.fetchedAt,second.fetchedAt);assert.equal(second.stale,false);assert.equal(second.partial,false);assert.equal(second.sources.length,4);assert.ok(second.items.length>0);assert.ok(cache.entries.size===4);
  assert.ok(second.sources.every(source=>source.truncated===false));assert.ok([...cache.entries.keys()].every(url=>url.includes('/v2/')));
  const method=await fetchNews(new Request(request.url,{method:'POST'}));assert.equal(method.status,405);assert.equal(method.headers.get('Allow'),'GET');
}));
test('merged response preserves older macro candidates beyond the newest 16 stories',async()=>withNetwork(async()=>{
  delete globalThis.caches;const clock=Date.now();
  globalThis.fetch=async url=>new Response(rss(url===publisher.url?Array.from({length:32},(_,i)=>entry('Ethereum report '+i,new Date(clock-(i+1)*60000).toUTCString(),'https://www.coindesk.com/report-'+i)):url===NEWS_SOURCES[3].url?[entry('Federal Reserve interest rate decision',new Date(clock-3600000).toUTCString(),'https://www.federalreserve.gov/decision')]:[]));
  const response=await fetchNews(new Request('https://ether-watch.example/api/news')),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.items.length,33);assert.equal(body.items.filter(item=>item.topics.includes('macro')).length,1);assert.equal(body.items.at(-1).sourceId,'fed');assert.ok(body.sources.every(source=>source.truncated===false));
}));
test('response is bounded to 32 per source and preserves truncation through fresh and stale cache',async()=>withNetwork(async()=>{
  const cache=cacheMemory();globalThis.caches={default:cache};const clock=Date.now();let calls=0;
  globalThis.fetch=async url=>{calls++;const descriptor=NEWS_SOURCES.find(source=>source.url===url);return new Response(rss(Array.from({length:33},(_,i)=>entry(descriptor.id+' Ethereum report '+i,new Date(clock-(i+1)*60000).toUTCString(),'https://'+descriptor.domains[0]+'/report-'+i))));};
  const request=new Request('https://ether-watch.example/api/news'),first=await (await fetchNews(request)).json();
  assert.equal(first.items.length,128);assert.ok(first.sources.every(source=>source.itemCount===32&&source.truncated===true));
  const second=await (await fetchNews(request)).json();assert.equal(calls,4);assert.equal(second.items.length,128);assert.ok(second.sources.every(source=>source.truncated===true));assert.equal(second.fetchedAt,first.fetchedAt);
  for(const [url,response] of [...cache.entries]){const stored=await response.json();await cache.put(new Request(url),Response.json({...stored,fetchedAt:new Date(clock-600000).toISOString()}));}
  globalThis.fetch=async()=>{throw new TypeError('Network unavailable');};
  const stale=await (await fetchNews(request)).json();assert.equal(stale.items.length,128);assert.equal(stale.stale,true);assert.ok(stale.sources.every(source=>source.status==='stale'&&source.truncated===true));
}));
test('old cache version does not supply an incomplete candidate pool',async()=>withNetwork(async()=>{
  const cache=cacheMemory();globalThis.caches={default:cache};
  const items=parseNewsFeed(rss([entry('Ethereum prior headline',new Date(Date.now()-60000).toUTCString())]),publisher,Date.now());
  await cache.put(new Request('https://ether-watch.example/__ether-watch-news/v1/coindesk'),Response.json({items,fetchedAt:new Date().toISOString()}));
  globalThis.fetch=async()=>{throw new TypeError('Network unavailable');};
  const response=await fetchNews(new Request('https://ether-watch.example/api/news')),body=await response.json();assert.equal(response.status,503);assert.equal(body.items.length,0);assert.ok(body.sources.every(source=>source.status==='error'&&source.truncated===false));
}));
test('failed sources serve labeled stale cache for at most 24 hours, without invented stories',async()=>withNetwork(async()=>{
  const cache=cacheMemory();globalThis.caches={default:cache};const request=new Request('https://ether-watch.example/api/news'),old=new Date(Date.now()-600000).toISOString();
  const [item]=parseNewsFeed(rss([entry('Ethereum prior headline',new Date(Date.now()-3600000).toUTCString())]),publisher,Date.now());
  await cache.put(new Request('https://ether-watch.example/__ether-watch-news/v2/coindesk'),Response.json({items:[item],fetchedAt:old}));
  globalThis.fetch=async()=>{throw new TypeError('Network unavailable');};
  const response=await fetchNews(request),body=await response.json();assert.equal(response.status,200);assert.equal(body.stale,true);assert.equal(body.partial,true);assert.equal(body.items.length,1);assert.equal(body.items[0].title,'Ethereum prior headline');assert.equal(body.fetchedAt,old);
  const failed=body.sources.find(source=>source.id==='coindesk');assert.equal(failed.status,'stale');assert.equal(failed.error,'Feed request failed');
  await cache.put(new Request('https://ether-watch.example/__ether-watch-news/v2/coindesk'),Response.json({items:[item],fetchedAt:new Date(Date.now()-25*3600000).toISOString()}));
  const expired=await fetchNews(request);assert.equal(expired.status,503);const expiredBody=await expired.json();assert.equal(expiredBody.items.length,0);assert.equal(expiredBody.fetchedAt,null);assert.equal(expiredBody.stale,false);assert.match(expiredBody.error,/All news sources/);
}));
test('partial feed failures and oversized or malformed XML remain visible',async()=>withNetwork(async()=>{
  delete globalThis.caches;
  globalThis.fetch=async url=>{if(url===NEWS_SOURCES[0].url)return new Response('not XML');if(url===NEWS_SOURCES[1].url)return new Response('down',{status:429});if(url===NEWS_SOURCES[2].url)return new Response('oversized',{headers:{'Content-Length':String(3*1024*1024)}});return new Response(rss([entry('Fed interest rate update',new Date(Date.now()-60000).toUTCString(),'https://www.federalreserve.gov/update')]));};
  const response=await fetchNews(new Request('https://ether-watch.example/api/news')),body=await response.json();assert.equal(response.status,200);assert.equal(body.partial,true);assert.equal(body.items.length,1);assert.equal(body.sources[0].error,'Invalid RSS or Atom feed');assert.equal(body.sources[1].error,'HTTP 429');assert.equal(body.sources[2].error,'Feed is too large');assert.equal(body.sources[3].status,'ok');assert.equal(response.headers.get('Cache-Control'),'no-store');
}));
