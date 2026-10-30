// One documented ETH spot-volume provider, with a D1 cache shared by every origin.
export const CMC_VOLUME_SOURCE=Object.freeze({id:'coinmarketcap',name:'CoinMarketCap',url:'https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest?id=1027&convert=USD',publicUrl:'https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD',page:'https://coinmarketcap.com/currencies/ethereum/'});
const volumeCacheKey='eth-usd-cmc-spot-v1',volumeFreshMs=300000,volumeStaleMs=3600000,volumeFailureMs=900000,volumeMaxBytes=65536;
function volumeTime(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return NaN;
  const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'))?time:NaN;
}
export function parseCoinMarketCapVolume(payload,now=Date.now()){
  if(![0,'0'].includes(payload?.status?.error_code)||!Array.isArray(payload.data)||payload.data.length!==1)throw new Error('Invalid CoinMarketCap ETH volume response');
  const coin=payload.data[0];
  if(coin?.id!==1027||coin.symbol!=='ETH'||!Array.isArray(coin.quote)||coin.quote.length!==1)throw new Error('Invalid CoinMarketCap ETH volume response');
  const quote=coin.quote[0],volumeUsd=quote?.volume_24h,updated=volumeTime(quote?.last_updated);
  if(quote?.symbol!=='USD'||quote.id!==2781||typeof volumeUsd!=='number'||!Number.isFinite(volumeUsd)||volumeUsd<=0||volumeUsd>Number.MAX_SAFE_INTEGER)throw new Error('Invalid CoinMarketCap ETH volume response');
  if(!Number.isFinite(updated)||updated>now+60000||now-updated>=volumeStaleMs)throw new Error('CoinMarketCap volume timestamp unavailable or stale');
  return {volumeUsd,sourceUpdatedAt:new Date(updated).toISOString()};
}
function volumeSnapshot(raw,now){
  try{const data=JSON.parse(raw),fetched=volumeTime(data.fetchedAt),updated=volumeTime(data.sourceUpdatedAt);
    return typeof data.volumeUsd==='number'&&Number.isFinite(data.volumeUsd)&&data.volumeUsd>0&&data.volumeUsd<=Number.MAX_SAFE_INTEGER&&Number.isFinite(fetched)&&Number.isFinite(updated)&&fetched<=now+60000&&updated<=now+60000&&updated<=fetched+60000&&now-fetched<volumeStaleMs&&now-updated<volumeStaleMs?data:null;
  }catch{return null;}
}
async function volumeReadBody(response){
  if(Number(response.headers.get('Content-Length'))>volumeMaxBytes)throw new Error('Volume response is too large');
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty volume response');
  const decoder=new TextDecoder(),parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>volumeMaxBytes){await reader.cancel();throw new Error('Volume response is too large');}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());return JSON.parse(parts.join(''));}finally{reader.releaseLock();}
}
function volumeRetryAt(value,now){
  if(typeof value!=='string'||value.length>100)return 0;
  if(/^\d+$/.test(value.trim())){const seconds=Number(value);return Number.isFinite(seconds)?Math.min(Number.MAX_SAFE_INTEGER,now+seconds*1000):0;}
  const time=Date.parse(value);return Number.isFinite(time)&&time>now?time:0;
}
function volumeFailure(error){return ['TimeoutError','AbortError'].includes(error?.name)?'CoinMarketCap volume request timed out':/^(HTTP \d{3}|Unexpected volume redirect|Volume response is too large|Empty volume response|Invalid CoinMarketCap ETH volume response|CoinMarketCap volume timestamp unavailable or stale)$/.test(error?.message??'')?error.message:'CoinMarketCap volume unavailable';}
export async function fetchVolume(request,env={},deps={}){
  const baseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...baseHeaders,Allow:'GET'}});
  const clock=()=>typeof deps.now==='function'?deps.now():deps.now??Date.now();
  const respond=(data,error=null,retryAt=0)=>{
    const now=clock(),snapshot=data?volumeSnapshot(JSON.stringify(data),now):null;
    const delayed=snapshot&&(now-volumeTime(snapshot.fetchedAt)>=volumeFreshMs||now-volumeTime(snapshot.sourceUpdatedAt)>=volumeFreshMs);
    return Response.json({asset:'ETH',currency:'USD',scope:'aggregate',source:CMC_VOLUME_SOURCE.name,sourceId:CMC_VOLUME_SOURCE.id,sourceUrl:CMC_VOLUME_SOURCE.page,sourceUpdatedAt:snapshot?.sourceUpdatedAt??null,volumeUsd:snapshot?.volumeUsd??null,fetchedAt:snapshot?.fetchedAt??null,checkedAt:new Date(now).toISOString(),stale:!snapshot||Boolean(error)||Boolean(delayed),error:error||(delayed?'CoinMarketCap volume is awaiting refresh':snapshot?null:'CoinMarketCap volume unavailable')},{status:snapshot?200:503,headers:{...baseHeaders,...(!snapshot&&retryAt>now?{'Retry-After':String(Math.max(1,Math.ceil((retryAt-now)/1000)))}:{})}});
  };
  if(!env.DB)return respond(null,'Volume cache unavailable');
  const db=typeof env.DB.withSession==='function'?env.DB.withSession('first-primary'):env.DB;
  const load=()=>db.prepare('SELECT data, next_attempt_at, lease_until, last_error FROM market_data_cache WHERE cache_key = ?').bind(volumeCacheKey).first();
  let row,previous;
  try{
    await db.prepare('INSERT OR IGNORE INTO market_data_cache (cache_key) VALUES (?)').bind(volumeCacheKey).run();
    row=await load();if(!row)throw new Error('Missing volume cache');previous=volumeSnapshot(row.data,clock());
  }catch{return respond(null,'Volume cache unavailable');}
  const key=env.CMC_API_KEY,hasKey=typeof key==='string'&&key.trim().length>0&&key.length<=1024&&!/[\r\n]/.test(key);
  const publicMode=!hasKey&&env.CMC_USE_PUBLIC_API==='true';
  if(!hasKey&&!publicMode)return respond(previous,'Volume source is not configured');
  let now=clock();
  if(row.next_attempt_at>now||row.lease_until>now)return respond(previous,row.last_error||(!previous?'Volume refresh in progress':null),Math.max(row.next_attempt_at,row.lease_until));
  const token=crypto.randomUUID();
  try{
    const acquired=await db.prepare('UPDATE market_data_cache SET next_attempt_at = ?, lease_until = ?, lease_token = ? WHERE cache_key = ? AND next_attempt_at <= ? AND lease_until <= ?').bind(now+volumeFreshMs,now+30000,token,volumeCacheKey,now,now).run();
    if(acquired.meta?.changes!==1){row=await load();return respond(volumeSnapshot(row?.data,clock()),row?.last_error||(!row?.data?'Volume refresh in progress':null),Math.max(row?.next_attempt_at??0,row?.lease_until??0));}
  }catch{return respond(previous,'Volume cache unavailable');}
  let retryAt=0;
  try{
    const url=publicMode?CMC_VOLUME_SOURCE.publicUrl:CMC_VOLUME_SOURCE.url;
    const response=await(deps.fetch??globalThis.fetch)(url,{signal:AbortSignal.timeout(12000),redirect:'manual',headers:{Accept:'application/json',...(hasKey?{'X-CMC_PRO_API_KEY':key}:{})}});
    retryAt=volumeRetryAt(response.headers.get('Retry-After'),clock());
    if(response.status>=300&&response.status<400)throw new Error('Unexpected volume redirect');
    if(!response.ok)throw new Error('HTTP '+response.status);
    if(response.url&&response.url!==url)throw new Error('Unexpected volume redirect');
    const parsed=parseCoinMarketCapVolume(await volumeReadBody(response),clock()),data={...parsed,fetchedAt:new Date(clock()).toISOString()};
    const saved=await db.prepare('UPDATE market_data_cache SET data = ?, next_attempt_at = ?, lease_until = 0, lease_token = NULL, last_error = NULL WHERE cache_key = ? AND lease_token = ?').bind(JSON.stringify(data),Math.max(now+volumeFreshMs,clock()+volumeFreshMs),volumeCacheKey,token).run();
    if(saved.meta?.changes!==1)throw new Error('Volume cache changed');
    return respond(data);
  }catch(error){
    const failure=volumeFailure(error),nextAttempt=Math.max(clock()+volumeFailureMs,retryAt,now+volumeFreshMs);
    try{await db.prepare('UPDATE market_data_cache SET next_attempt_at = ?, lease_until = 0, lease_token = NULL, last_error = ? WHERE cache_key = ? AND lease_token = ?').bind(nextAttempt,failure,volumeCacheKey,token).run();}catch{return respond(previous,'Volume cache unavailable',nextAttempt);}
    return respond(previous,failure,nextAttempt);
  }
}
