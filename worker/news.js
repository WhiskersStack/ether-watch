// Public publisher feeds only. This route inherits the Site's owner-only access.
export const NEWS_SOURCES = Object.freeze([
  {id:'ethereum',name:'Ethereum Foundation',url:'https://blog.ethereum.org/feed.xml',domains:['blog.ethereum.org'],kind:'network'},
  {id:'coindesk',name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml',domains:['coindesk.com','www.coindesk.com'],kind:'publisher'},
  {id:'decrypt',name:'Decrypt',url:'https://decrypt.co/feed',domains:['decrypt.co','www.decrypt.co'],kind:'publisher'},
  {id:'fed',name:'Federal Reserve',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',domains:['federalreserve.gov','www.federalreserve.gov'],kind:'macro'}
]);
const newsFreshMs=5*60*1000,newsStaleMs=24*60*60*1000,newsArticleAgeMs=30*24*60*60*1000;
const newsMaxBytes=2*1024*1024,newsSourceLimit=32,newsLimit=newsSourceLimit*NEWS_SOURCES.length;
const newsEntities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—',hellip:'…'};

export function newsDecode(value){
  return String(value??'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(entity,key)=>{
    if(key[0]!=='#')return newsEntities[key.toLowerCase()]??entity;
    const number=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):'';
  });
}
function newsUnwrap(value){return String(value??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim();}
export function newsPlainText(value){
  let text=newsUnwrap(value);
  // Decode before stripping so encoded markup never survives as headline HTML.
  for(let pass=0;pass<2;pass++)text=newsDecode(text);
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}
function newsField(block,tag){const match=block.match(new RegExp('<(?:[\\w-]+:)?'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+tag+'\\s*>','i'));return match?newsUnwrap(match[1]):'';}
function newsAttribute(tag,name){const match=tag.match(new RegExp('\\b'+name+'\\s*=\\s*(["\x27])([\\s\\S]*?)\\1','i'));return match?newsDecode(match[2]):'';}
function newsLink(block){
  for(const match of block.matchAll(/<(?:[\w-]+:)?link\b[^>]*\/?\s*>/gi)){
    const rel=newsAttribute(match[0],'rel'),href=newsAttribute(match[0],'href');
    if(href&&(!rel||rel==='alternate'))return href;
  }
  return newsDecode(newsField(block,'link'));
}
export function newsSafeUrl(value,source){
  try{
    const url=new URL(newsDecode(newsUnwrap(value)));
    if(url.protocol!=='https:'||url.username||url.password||url.port||!source.domains.includes(url.hostname))return null;
    url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(fbclid|gclid|ref)$/i.test(key))url.searchParams.delete(key);
    return url.href;
  }catch{return null;}
}
export function newsDate(value){
  const raw=newsPlainText(value);
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i);
  const rfc=raw.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|UT|[+-]\d{4})$/i);
  if(!iso&&!rfc)return null;
  const year=Number(iso?iso[1]:rfc[3]),month=iso?Number(iso[2]):'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(rfc[2].toLowerCase())+1,day=Number(iso?iso[3]:rfc[1]);
  if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed)?parsed:null;
}
export function newsRelevance(title,description,source){
  const text=(title+' '+description).toLowerCase();
  const eth=/\b(?:ethereum|ether|eth)\b|\beip[-\s]?\d+\b/.test(text);
  const crypto=/\b(?:bitcoin|btc|crypto(?:currency|currencies)?|digital assets?|stablecoins?)\b/.test(text);
  const macro=source.kind==='macro'||/\b(?:federal reserve|fed|fomc|interest rates?|rate cuts?|rate hikes?|inflation|cpi|pce|treasury yields?)\b/.test(text);
  const ecosystem=eth||crypto||source.kind==='network';
  const network=source.kind==='network'||eth&&/\b(?:upgrade\w*|network|validators?|staking|staked|rollups?|layer[- ]?2|gas|fees?|blobs?)\b/.test(text);
  const etf=ecosystem&&/\b(?:etfs?|exchange[- ]traded funds?)\b/.test(text);
  const regulation=ecosystem&&/\b(?:sec|securities|regulat\w*|legislation|lawsuits?|enforcement|ban|bans)\b/.test(text);
  const security=ecosystem&&/\b(?:hack\w*|exploit\w*|breach\w*|vulnerabilit\w*|security|attack\w*)\b/.test(text);
  const market=crypto&&/\b(?:markets?|sell[- ]?off|rally|rallies|liquidat\w*|exchanges?|inflows?|outflows?|trading volume)\b/.test(text);
  const ethereum=ecosystem;
  const topics=Object.entries({ethereum,macro,network,etf,regulation,security}).filter(([,matches])=>matches).map(([topic])=>topic);
  let relevance;
  if(macro)relevance={category:'Macro',context:'Interest rates and liquidity can influence demand for risk assets, including ETH.'};
  else if(source.kind==='network')relevance={category:'Network',context:'Ethereum network changes may affect transaction costs, validator participation and ETH demand.'};
  else if(etf)relevance={category:'ETF & flows',context:'Fund flows may change crypto demand and liquidity; the effect on ETH depends on the assets involved.'};
  else if(regulation)relevance={category:'Regulation',context:'Policy and enforcement changes may affect crypto access, participation and market confidence.'};
  else if(security)relevance={category:'Security',context:'Security incidents can affect confidence and liquidity; any spillover to ETH may be indirect.'};
  else if(network)relevance={category:'Network',context:'Network usage and changes may affect transaction costs, validator participation and ETH demand.'};
  else if(eth)relevance={category:'Ethereum',context:'This report concerns ETH or its ecosystem; the headline alone does not establish a price effect.'};
  else if(market)relevance={category:'Ethereum',context:'Broad crypto positioning and liquidity may spill over into ETH; any effect is uncertain.'};
  return relevance?{...relevance,topics}:null;
}
export function newsNormalize(items,now=Date.now(),limit=newsLimit){
  const urls=new Set(),titles=new Set();
  return items.filter(item=>Number.isFinite(newsDate(item.publishedAt))&&newsDate(item.publishedAt)<=now&&newsDate(item.publishedAt)>=now-newsArticleAgeMs)
    .sort((a,b)=>newsDate(b.publishedAt)-newsDate(a.publishedAt))
    .filter(item=>{const key=item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();if(urls.has(item.url)||titles.has(key))return false;urls.add(item.url);titles.add(key);return true;}).slice(0,limit);
}
function newsParseFeedResult(xml,source,now){
  if(typeof xml!=='string'||xml.length>newsMaxBytes)throw new Error('Feed is too large');
  const clean=xml.replace(/^\uFEFF/,'').replace(/<!--[\s\S]*?-->/g,'');
  const root=clean.match(/<(?:[\w-]+:)?(rss|feed|RDF)\b/i);
  if(!root||!new RegExp('<\\/(?:[\\w-]+:)?'+root[1]+'\\s*>\\s*$','i').test(clean.trim())||/<!ENTITY\b|<!DOCTYPE\b/i.test(clean))throw new Error('Invalid RSS or Atom feed');
  const items=[];
  for(const match of clean.matchAll(/<(?:[\w-]+:)?(item|entry)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>/gi)){
    const block=match[2],title=newsPlainText(newsField(block,'title')).slice(0,300),url=newsSafeUrl(newsLink(block),source);
    const date=newsDate(newsField(block,'pubDate')||newsField(block,'published')||newsField(block,'date')||newsField(block,'updated'));
    if(!title||!url||date===null||date>now||date<now-newsArticleAgeMs)continue;
    const description=newsPlainText(newsField(block,'description')||newsField(block,'summary')).slice(0,1000);
    const relevance=newsRelevance(title,description,source);
    if(relevance)items.push({id:url,title,url,source:source.name,sourceId:source.id,publishedAt:new Date(date).toISOString(),...relevance});
  }
  const candidates=newsNormalize(items,now,newsSourceLimit+1);
  return {items:candidates.slice(0,newsSourceLimit),truncated:candidates.length>newsSourceLimit};
}
export function parseNewsFeed(xml,source,now=Date.now()){return newsParseFeedResult(xml,source,now).items;}
async function newsReadBody(response){
  if(Number(response.headers.get('Content-Length'))>newsMaxBytes)throw new Error('Feed is too large');
  if(!response.body){const text=await response.text();if(text.length>newsMaxBytes)throw new Error('Feed is too large');return text;}
  const reader=response.body.getReader(),decoder=new TextDecoder(),parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>newsMaxBytes){await reader.cancel();throw new Error('Feed is too large');}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());return parts.join('');}finally{reader.releaseLock();}
}
function newsFailure(error){return error?.name==='TimeoutError'||error?.name==='AbortError'?'Feed request timed out':/^(HTTP \d{3}|Feed is too large|Invalid RSS or Atom feed|Unexpected feed redirect)$/.test(error?.message??'')?error.message:'Feed request failed';}
async function newsLoadSource(source,request,now){
  const cache=globalThis.caches?.default,key=new Request(new URL('/__ether-watch-news/v2/'+source.id,request.url).href);
  let previous=null;
  if(cache){try{const stored=await cache.match(key);if(stored){const data=await stored.json(),time=Date.parse(data.fetchedAt);if(Array.isArray(data.items)&&Number.isFinite(time)&&time<=now&&now-time<=newsStaleMs)previous=data;}}catch{/* A cache miss must not block live sources. */}}
  const metadata={id:source.id,name:source.name,url:source.url};
  if(previous&&now-Date.parse(previous.fetchedAt)<newsFreshMs){const items=newsNormalize(previous.items,now,newsSourceLimit);return {items,source:{...metadata,status:'ok',fetchedAt:previous.fetchedAt,lastAttemptAt:previous.fetchedAt,error:null,itemCount:items.length,truncated:previous.truncated===true}};}
  try{
    const response=await fetch(source.url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9'}});
    if(!response.ok)throw new Error('HTTP '+response.status);
    if(response.url&&!source.domains.includes(new URL(response.url).hostname))throw new Error('Unexpected feed redirect');
    const {items,truncated}=newsParseFeedResult(await newsReadBody(response),source,now),fetchedAt=new Date(now).toISOString();
    if(cache){try{await cache.put(key,Response.json({items,fetchedAt,truncated},{headers:{'Cache-Control':'public,max-age=86400'}}));}catch{/* A cache write failure does not invalidate fresh headlines. */}}
    return {items,source:{...metadata,status:'ok',fetchedAt,lastAttemptAt:fetchedAt,error:null,itemCount:items.length,truncated}};
  }catch(error){
    const items=previous?newsNormalize(previous.items,now,newsSourceLimit):[];
    return {items,source:{...metadata,status:previous?'stale':'error',fetchedAt:previous?.fetchedAt??null,lastAttemptAt:new Date(now).toISOString(),error:newsFailure(error),itemCount:items.length,truncated:previous?.truncated===true}};
  }
}
export async function fetchNews(request){
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'GET'}});
  const now=Date.now(),results=await Promise.all(NEWS_SOURCES.map(source=>newsLoadSource(source,request,now))),sources=results.map(result=>result.source);
  const items=newsNormalize(results.flatMap(result=>result.items),now),times=sources.map(source=>Date.parse(source.fetchedAt)).filter(Number.isFinite);
  const unavailable=sources.every(source=>source.status==='error');
  return Response.json({items,sources,fetchedAt:times.length?new Date(Math.min(...times)).toISOString():null,checkedAt:new Date(now).toISOString(),stale:sources.some(source=>source.status==='stale'),partial:sources.some(source=>source.status!=='ok'),error:unavailable?'All news sources are unavailable. Retry later.':null},{status:unavailable?503:200,headers});
}
