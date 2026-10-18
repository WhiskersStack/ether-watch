// Public market reads; shared monitor writes require an explicit owner or service grant.
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const initial=()=>({config:validateConfig({...DEFAULT_CONFIG,revision:1}),engine:null,events:[],decisions:[],background:{enabled:false,intervalMinutes:5,lastCheck:null,lastError:null}});
async function load(db){await db.prepare('INSERT OR IGNORE INTO monitor (id, version, data) VALUES (1, 0, ?)').bind(JSON.stringify(initial())).run();const row=await db.prepare('SELECT version, data FROM monitor WHERE id = 1').first();if(!row)throw new Error('Monitor storage unavailable');return {version:row.version,data:JSON.parse(row.data)};}
async function change(db,operation){for(let attempt=0;attempt<5;attempt++){const row=await load(db),data=operation(row.data);const result=await db.prepare('UPDATE monitor SET version = version + 1, data = ? WHERE id = 1 AND version = ?').bind(JSON.stringify(data),row.version).run();if(result.meta?.changes===1)return data;}throw new Error('Settings changed concurrently. Please retry.');}
function publicState(data){return {config:validateConfig(data.config),events:data.events,decisions:data.decisions??[],background:data.background,lastEvaluatedCandle:data.engine?.lastEvaluatedCandle??null,evaluationError:data.evaluationError??null};}
function validOrigin(request){const origin=request.headers.get('Origin');return !origin||origin===new URL(request.url).origin;}
async function monitorAccess(request,env){
  const userId=request.headers.get('oai-authenticated-user-id')||null;
  const owner=typeof env.MONITOR_OWNER_ID==='string'&&Boolean(env.MONITOR_OWNER_ID.trim())&&userId===env.MONITOR_OWNER_ID;
  const expected=env.MONITOR_SERVICE_TOKEN,supplied=request.headers.get('X-Ether-Watch-Monitor-Token');
  let service=false;
  if(typeof expected==='string'&&expected.length>=32&&expected.length<=256&&supplied&&supplied.length<=256){
    const digest=value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    const [a,b]=await Promise.all([digest(expected),digest(supplied)]);
    const left=new Uint8Array(a),right=new Uint8Array(b);let difference=0;
    for(let i=0;i<left.length;i++)difference|=left[i]^right[i];
    service=difference===0;
  }
  return {userId,owner,service};
}
async function bodyJSON(request){if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new Error('JSON request required');const text=await request.text();if(text.length>16000)throw new Error('Request is too large');return JSON.parse(text);}
async function market(path){const response=await fetch('https://api.exchange.coinbase.com/products/ETH-USD/'+path,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Coinbase feed unavailable ('+response.status+')');return response.json();}
function mergeSavedConfig(input,current){const next={...input};for(const key of ['selectedLevels','proximity','volumeConfirmation'])if(!Object.hasOwn(input,key))next[key]=current[key];return validateConfig(next);}
function retainDecisions(previous,fresh){const seen=new Set();return [...(previous??[]),...(fresh??[])].filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;}).sort((a,b)=>b.time-a.time||b.evaluatedAt-a.evaluatedAt).slice(0,200);}
async function runCheck(db,source){
  try{
    const current=(await load(db)).data,config=validateConfig(current.config);
    const [ticker,candles]=await Promise.allSettled([market('ticker'),config.mode==='immediate'?Promise.resolve([]):market('candles?granularity=86400')]);
    if(ticker.status!=='fulfilled')throw ticker.reason;
    if(candles.status!=='fulfilled'&&!config.proximity.enabled)throw candles.reason;
    const now=Date.now(),snapshot={...acceptTicker(ticker.value,now),candles:candles.status==='fulfilled'?candles.value:[],...(candles.status==='fulfilled'?{}:{candleError:candles.reason?.message||'Daily candle feed unavailable'})};
    return await change(db,data=>{
      if(data.config.revision!==current.config.revision)throw new Error('Settings changed during this check. Retrying on the next check.');
      const result=evaluate(data.config,data.engine,snapshot,Date.now()),known=new Set(data.events.map(e=>e.id));
      const fresh=result.events.filter(e=>!known.has(e.id)).map(e=>({...e,delivery:'pending'}));
      const all=[...fresh,...data.events],pending=all.filter(e=>e.delivery==='pending');
      if(pending.length>200)throw new Error('Pending notification queue is full. Review notifications before more checks.');
      const retained=[...pending,...all.filter(e=>e.delivery!=='pending').slice(0,200-pending.length)].sort((a,b)=>b.time-a.time);
      return {...data,engine:result.state,events:retained,decisions:retainDecisions(data.decisions,result.decisions),evaluationError:result.evaluationError??null,background:source==='codex'?{...data.background,...(result.evaluationError?{lastAttempt:Date.now(),lastError:result.evaluationError}:{lastCheck:Date.now(),lastError:null})}:data.background};
    });
  }catch(error){
    await change(db,data=>({...data,evaluationError:error.message,background:source==='codex'?{...data.background,lastAttempt:Date.now(),lastError:error.message}:data.background}));
    throw error;
  }
}
async function route(request,env){const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/')){const asset=ASSETS[path];if(!asset)return new Response('Not found',{status:404});return new Response(asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});}if(path==='/api/volume')return fetchVolume(request);if(path==='/api/news')return fetchNews(request);if(path==='/api/calendar')return fetchCalendar(request);if(!env.DB)return json({error:'Monitor storage is not configured'},503);
if(request.method==='GET'&&path==='/api/state'){const access=await monitorAccess(request,env);return json({...publicState((await load(env.DB)).data),access:{userId:access.userId,canManage:access.owner,canCheck:access.owner||access.service}});}
if(request.method!=='POST')return json({error:'Method not allowed'},405);
if(!validOrigin(request))return json({error:'Same-origin request required'},403);
const access=await monitorAccess(request,env);
if(!access.owner&&!(access.service&&['/api/check','/api/ack'].includes(path)))return json({error:!access.userId&&!access.service?'Owner sign-in or authorized monitor service required':'Owner permission required'},!access.userId&&!access.service?401:403);
const input=await bodyJSON(request);
if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'Request body must be an object.'},400);
if(path==='/api/config'){
  try{
    const data=await change(env.DB,old=>{
      if(input.expectedRevision!==old.config.revision)throw new Error('Settings were updated elsewhere. Refresh and try again.');
      let next;try{next=mergeSavedConfig(input,old.config);}catch(error){error.status=400;throw error;}
      if(JSON.stringify({...next,revision:old.config.revision})===JSON.stringify(validateConfig(old.config)))return old;
      return {...old,config:{...next,revision:old.config.revision+1},events:old.events.map(e=>e.delivery==='pending'?{...e,delivery:'cancelled',reason:'Settings changed before Codex reported this event'}:e)};
    });
    return json(publicState(data));
  }catch(error){if(error.status===400)return json({error:error.message},400);throw error;}
}
if(path==='/api/check'){const source=access.service?'codex':'browser',data=await runCheck(env.DB,source);return json({...publicState(data),pending:data.config.armed?data.events.filter(e=>e.delivery==='pending'):[]});}
if(path==='/api/background'){if(typeof input.enabled!=='boolean'||!Number.isInteger(input.intervalMinutes)||input.intervalMinutes<5||input.intervalMinutes>1440)throw new Error('Invalid background configuration');return json(publicState(await change(env.DB,data=>({...data,background:{...data.background,enabled:input.enabled,intervalMinutes:input.intervalMinutes}}))));}
if(path==='/api/ack'){if(!Array.isArray(input.ids)||input.ids.length>200||!input.ids.every(id=>typeof id==='string'&&id.length<250))throw new Error('Invalid event IDs');const ids=new Set(input.ids);return json(publicState(await change(env.DB,data=>({...data,events:data.events.map(e=>ids.has(e.id)?{...e,delivery:'reported',reportedAt:Date.now()}:e)}))));}
return json({error:'Unknown monitor route'},404);}
export default {async fetch(request,env){try{return await route(request,env);}catch(error){return json({error:error.message||'Monitor service unavailable'},503);}}};
