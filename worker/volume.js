// Aggregate ETH turnover in USD. Never substitute exchange base-asset volume.
export const AGGREGATE_VOLUME_SOURCES=Object.freeze([
  {id:'tradingview',name:'TradingView',url:'https://scanner.tradingview.com/coin/scan',page:'https://www.tradingview.com/symbols/ETHUSD/?exchange=BITSTAMP'},
  {id:'coingecko',name:'CoinGecko',url:'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_vol=true&include_last_updated_at=true',page:'https://www.coingecko.com/en/coins/ethereum'},
  {id:'coinpaprika',name:'CoinPaprika',url:'https://api.coinpaprika.com/v1/tickers/eth-ethereum?quotes=USD',page:'https://coinpaprika.com/coin/eth-ethereum/'}
]);
const volumeFreshMs=300000,volumeStaleMs=3600000,volumeMaxBytes=65536;
export function parseAggregateVolume(data,source,now=Date.now()){
  let volumeUsd,updated;
  if(source.id==='tradingview'){
    const row=data?.data?.[0];
    if(data?.totalCount!==1||data.data.length!==1||row?.s!=='CRYPTO:ETHUSD'||!Array.isArray(row.d)||row.d.length!==1)throw new Error('Invalid aggregate ETH volume');
    volumeUsd=row.d[0];
  }else if(source.id==='coingecko'){
    volumeUsd=data?.ethereum?.usd_24h_vol;updated=data?.ethereum?.last_updated_at*1000;
  }else if(source.id==='coinpaprika'){
    if(data?.id!=='eth-ethereum'||data.symbol!=='ETH')throw new Error('Invalid aggregate ETH volume');
    volumeUsd=data.quotes?.USD?.volume_24h;updated=Date.parse(data.last_updated);
  }else throw new Error('Unknown aggregate volume source');
  if(typeof volumeUsd!=='number'||!Number.isFinite(volumeUsd)||volumeUsd<=0||volumeUsd>Number.MAX_SAFE_INTEGER)throw new Error('Invalid aggregate ETH volume');
  if(source.id!=='tradingview'&&(!Number.isFinite(updated)||updated>now+60000||now-updated>=volumeStaleMs))throw new Error('Aggregate volume source timestamp unavailable or stale');
  return {volumeUsd,sourceUpdatedAt:updated?new Date(updated).toISOString():null};
}
async function volumeReadBody(response){
  if(Number(response.headers.get('Content-Length'))>volumeMaxBytes)throw new Error('Volume response is too large');
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty volume response');
  const decoder=new TextDecoder(),parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>volumeMaxBytes){await reader.cancel();throw new Error('Volume response is too large');}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());return JSON.parse(parts.join(''));}finally{reader.releaseLock();}
}
export async function fetchVolume(request,now=Date.now()){
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'GET'}});
  const cache=globalThis.caches?.default,key=new Request(new URL('/__ether-watch-volume/v2',request.url).href);let previous=null;
  if(cache){try{const stored=await cache.match(key);if(stored){const data=await stored.json(),time=Date.parse(data.fetchedAt);if(AGGREGATE_VOLUME_SOURCES.some(s=>s.id===data.sourceId)&&typeof data.volumeUsd==='number'&&Number.isFinite(data.volumeUsd)&&data.volumeUsd>0&&data.volumeUsd<=Number.MAX_SAFE_INTEGER&&Number.isFinite(time)&&time<=now&&now-time<volumeStaleMs)previous=data;}}catch{/* A cache miss must not block live sources. */}}
  const respond=(data,stale,error=null)=>{const source=AGGREGATE_VOLUME_SOURCES.find(s=>s.id===data?.sourceId);return Response.json({asset:'ETH',currency:'USD',scope:'aggregate',source:source?.name??null,sourceId:source?.id??null,sourceUrl:source?.page??null,sourceUpdatedAt:data?.sourceUpdatedAt??null,volumeUsd:data?.volumeUsd??null,fetchedAt:data?.fetchedAt??null,checkedAt:new Date(now).toISOString(),stale,error},{status:data?200:503,headers});};
  if(previous&&now-Date.parse(previous.fetchedAt)<volumeFreshMs)return respond(previous,false);
  for(const source of AGGREGATE_VOLUME_SOURCES){
    try{
      const options={signal:AbortSignal.timeout(4000),redirect:'manual',headers:{Accept:'application/json'}};
      if(source.id==='tradingview'){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify({symbols:{tickers:['CRYPTO:ETHUSD'],query:{types:[]}},columns:['24h_vol_cmc']});}
      const response=await fetch(source.url,options);
      if(response.status>=300&&response.status<400)throw new Error('Unexpected volume redirect');
      if(!response.ok)throw new Error('HTTP '+response.status);
      if(response.url&&response.url!==source.url)throw new Error('Unexpected volume redirect');
      const data={...parseAggregateVolume(await volumeReadBody(response),source,now),sourceId:source.id,fetchedAt:new Date(now).toISOString()};
      if(cache){try{await cache.put(key,Response.json(data,{headers:{'Cache-Control':'public,max-age=3600'}}));}catch{/* Fresh data remains valid without a cache write. */}}
      return respond(data,false);
    }catch(error){console.warn('Aggregate volume source failed:',source.name,error?.name,error?.message);}
  }
  return respond(previous,true,'Aggregate volume sources unavailable');
}
