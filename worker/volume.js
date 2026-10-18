// Read the published ETH statistic, not an individual exchange's base-asset volume.
export const VOLUME_SOURCE_URL='https://www.tradingview.com/symbols/ETHUSD/?exchange=BITSTAMP';
const volumeFreshMs=5*60*1000,volumeStaleMs=60*60*1000,volumeMaxBytes=1024*1024;
export function parsePublishedVolume(html){
  if(typeof html!=='string'||html.length>volumeMaxBytes)throw new Error('Invalid volume page');
  const values=[];
  for(const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
    let data;try{data=JSON.parse(script[1]);}catch{continue;}
    const documents=Array.isArray(data)?data:[data];
    for(const document of documents){
      if(document?.['@type']!=='FAQPage'||!Array.isArray(document.mainEntity))continue;
      for(const item of document.mainEntity){
        if(item?.['@type']!=='Question'||item.name!=='What is the daily trading volume of Ethereum?')continue;
        const text=item.acceptedAnswer?.text;
        if(typeof text!=='string')throw new Error('Invalid ETH volume statistic');
        const clean=text.replace(/[\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/gu,' ').trim();
        const match=clean.match(/^Ethereum \(ETH\) trading volume in 24 hours is ((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([KMBT]?) USD(?:\.|$)/);
        if(!match)throw new Error('Invalid ETH volume statistic');
        const value=Number(match[1].replace(/,/g,''))*({'':1,K:1e3,M:1e6,B:1e9,T:1e12}[match[2]]);
        if(!Number.isFinite(value)||value<=0||value>Number.MAX_SAFE_INTEGER)throw new Error('Invalid ETH volume statistic');
        values.push(value);
      }
    }
  }
  if(values.length!==1)throw new Error('ETH volume statistic missing or ambiguous');
  return values[0];
}
async function volumeReadBody(response){
  if(Number(response.headers.get('Content-Length'))>volumeMaxBytes)throw new Error('Volume page is too large');
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Empty volume page');
  const decoder=new TextDecoder(),parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>volumeMaxBytes){await reader.cancel();throw new Error('Volume page is too large');}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());return parts.join('');}finally{reader.releaseLock();}
}
export async function fetchVolume(request,now=Date.now()){
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'GET'}});
  const cache=globalThis.caches?.default,key=new Request(new URL('/__ether-watch-volume/v1',request.url).href);
  let previous=null;
  if(cache){try{const stored=await cache.match(key);if(stored){const data=await stored.json(),time=Date.parse(data.fetchedAt);if(typeof data.volumeUsd==='number'&&Number.isFinite(data.volumeUsd)&&data.volumeUsd>0&&data.volumeUsd<=Number.MAX_SAFE_INTEGER&&Number.isFinite(time)&&time<=now&&now-time<volumeStaleMs)previous=data;}}catch{/* A cache miss must not block the source. */}}
  const metadata={asset:'ETH',currency:'USD',scope:'aggregate',source:'TradingView',sourceUrl:VOLUME_SOURCE_URL,sourceUpdatedAt:null};
  const respond=(data,stale,error=null)=>Response.json({...metadata,volumeUsd:data?.volumeUsd??null,fetchedAt:data?.fetchedAt??null,checkedAt:new Date(now).toISOString(),stale,error},{status:data?200:503,headers});
  if(previous&&now-Date.parse(previous.fetchedAt)<volumeFreshMs)return respond(previous,false);
  try{
    const response=await fetch(VOLUME_SOURCE_URL,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{Accept:'text/html','Accept-Language':'en-US,en;q=0.9'}});
    if(!response.ok)throw new Error('HTTP '+response.status);
    if(response.url&&response.url!==VOLUME_SOURCE_URL)throw new Error('Unexpected volume redirect');
    const volumeUsd=parsePublishedVolume(await volumeReadBody(response)),data={volumeUsd,fetchedAt:new Date(now).toISOString()};
    if(cache){try{await cache.put(key,Response.json(data,{headers:{'Cache-Control':'public,max-age=3600'}}));}catch{/* Fresh data remains valid without a cache write. */}}
    return respond(data,false);
  }catch(error){
    const reason=/^(HTTP \d{3}|Volume page is too large|Invalid ETH volume statistic|ETH volume statistic missing or ambiguous|Unexpected volume redirect)$/.test(error?.message??'')?error.message:'TradingView volume unavailable';
    return respond(previous,true,reason);
  }
}
