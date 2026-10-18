import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import * as engineAPI from './dist/rules.mjs';
function fixture(path){const local=new URL(path,import.meta.url);return existsSync(local)?local:new URL('../sites/ether-watch/'+path.slice(2),import.meta.url);}
const engine=readFileSync(new URL('./dist/rules.mjs',import.meta.url),'utf8').replace(/^export\s+/gm,'');
const source=readFileSync(new URL('./worker/index.js',import.meta.url),'utf8');
const news=readFileSync(fixture('./worker/news.js'),'utf8').replace(/^export\s+/gm,'');
const calendar=readFileSync(new URL('./worker/calendar.js',import.meta.url),'utf8').replace(/^export\s+/gm,'');
const worker=(await import('data:text/javascript;base64,'+Buffer.from('const ASSETS={"/":{body:"fixture",type:"text/html"}};\n'+engine+'\n'+news+'\n'+calendar+'\n'+source).toString('base64'))).default;
function database(seed){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(fixture('./drizzle/0000_monitor.sql'),'utf8'));
  if(seed)sqlite.prepare('INSERT INTO monitor (id,version,data) VALUES (1,0,?)').run(JSON.stringify(seed));
  let conflicts=0,updates=0;
  return {
    conflictNext(count=1){conflicts=count;},
    updateCount(){return updates;},
    read(){const row=sqlite.prepare('SELECT version,data FROM monitor WHERE id=1').get();return row?{version:row.version,data:JSON.parse(row.data)}:null;},
    prepare(sql){return {bind(...values){return {
      async run(){if(sql.startsWith('UPDATE monitor SET version = version + 1')){updates++;if(conflicts){conflicts--;return {meta:{changes:0}};}}const result=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},
      async first(){return sqlite.prepare(sql).get(...values);}
    };},async first(){return sqlite.prepare(sql).get();}};}
  };
}
function request(path,body,owner=true,origin){return new Request('https://monitor.example/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{'oai-authenticated-user-id':'test-owner'}:path==='config'?{}:{'X-Ether-Watch-Monitor-Token':'fixture-monitor-service-token-32-characters'}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});}

test('all monitor writes reject anonymous, nonowner, forged-platform, invalid and oversized service credentials before storage or network',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unauthorized outbound request');};
  try{for(const path of ['config','check','background','ack'])for(const headers of [{},{'oai-authenticated-user-id':'another-visitor'},{'OAI-Sites-Authorization':'Bearer fixture-platform-token'},{'X-Ether-Watch-Monitor-Token':'wrong-token'},{'X-Ether-Watch-Monitor-Token':'x'.repeat(257)}]){
    const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()};
    const response=await worker.fetch(new Request('https://monitor.example/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({source:'codex',enabled:true,intervalMinutes:5,ids:['fixture']})}),env);
    assert.ok([401,403].includes(response.status),path);assert.equal(env.DB.read(),null,path);assert.equal(env.DB.updateCount(),0);
  }assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('missing or malformed owner and service configuration fails closed',async()=>{
  for(const settings of [{},{MONITOR_OWNER_ID:''},{MONITOR_SERVICE_TOKEN:'too-short'},{MONITOR_SERVICE_TOKEN:'x'.repeat(257)}]){
    const env={...settings,DB:database()};const response=await worker.fetch(request('background',{enabled:true,intervalMinutes:5}),env);
    assert.equal(response.status,403);assert.equal(env.DB.read(),null);
    const service=await worker.fetch(request('check',{source:'codex'},false),env);assert.equal(service.status,401);assert.equal(env.DB.read(),null);
  }
});
test('service permission is limited to checks and acknowledgements',async()=>{
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()};
  for(const path of ['config','background']){
    const response=await worker.fetch(new Request('https://monitor.example/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Ether-Watch-Monitor-Token':env.MONITOR_SERVICE_TOKEN},body:JSON.stringify({enabled:true,intervalMinutes:5})}),env);
    assert.equal(response.status,403);assert.equal(env.DB.read(),null);
  }
});
test('public state exposes caller permissions without exposing configured credentials or owner identity',async()=>{
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()};
  const publicResponse=await worker.fetch(new Request('https://monitor.example/api/state'),env),data=await publicResponse.json();
  assert.deepEqual(data.access,{userId:null,canManage:false,canCheck:false});assert.ok(!JSON.stringify(data).includes(env.MONITOR_SERVICE_TOKEN));assert.ok(!JSON.stringify(data).includes(env.MONITOR_OWNER_ID));
  const owner=await (await worker.fetch(request('state'),env)).json();assert.equal(owner.access.canManage,true);assert.equal(owner.access.canCheck,true);
});
test('body source cannot impersonate service activity and authenticated service determines its own source',async()=>{
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()},original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({price:'2500',time:new Date().toISOString()});
  try{
    const owner=await (await worker.fetch(request('check',{source:'codex'}),env)).json();assert.equal(owner.background.lastCheck,null);
    const service=await (await worker.fetch(request('check',{source:'browser'},false),env)).json();assert.ok(service.background.lastCheck);
  }finally{globalThis.fetch=original;}
});
test('settings persist, reject invalid values, detect revision conflict and require identity',async()=>{const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()};let response=await worker.fetch(request('state'),env);const before=await response.json();assert.equal(before.config.levels.S1,2416);const edited={...before.config,levels:{...before.config.levels,S1:2400},expectedRevision:1};response=await worker.fetch(request('config',edited),env);assert.equal(response.status,200);const after=await response.json();assert.equal(after.config.levels.S1,2400);assert.equal(after.config.revision,2);assert.equal((await (await worker.fetch(request('state'),env)).json()).config.revision,2);assert.equal((await worker.fetch(request('config',edited),env)).status,503);assert.equal((await worker.fetch(request('config',{...edited,expectedRevision:2},false),env)).status,401);assert.equal((await worker.fetch(request('config',{...edited,expectedRevision:2},true,'https://other.example'),env)).status,403);const invalid={...edited,expectedRevision:2,levels:{...edited.levels,S1:0}};assert.equal((await worker.fetch(request('config',invalid),env)).status,400);});
test('unattended checks persist one breach and acknowledgement, then stale data fails',async()=>{const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()},original=globalThis.fetch;let price=2300,stale=false;globalThis.fetch=async url=>{assert.match(url,/api.exchange.coinbase.com/);return Response.json(url.endsWith('ticker')?{price:String(price),time:new Date(Date.now()-(stale?180000:0)).toISOString()}:[]);};try{const response=await worker.fetch(request('check',{source:'codex'},false),env);assert.equal(response.status,200);const first=await response.json();assert.equal(first.pending.length,1);assert.ok(first.background.lastCheck);const second=await (await worker.fetch(request('check',{source:'browser'}),env)).json();assert.equal(second.events.length,1);await worker.fetch(request('ack',{ids:[first.pending[0].id]},false),env);const third=await (await worker.fetch(request('check',{source:'codex'},false),env)).json();assert.equal(third.pending.length,0);stale=true;assert.equal((await worker.fetch(request('check',{source:'codex'},false),env)).status,503);const failed=await (await worker.fetch(request('state'),env)).json();assert.equal(failed.events.length,1);assert.ok(failed.background.lastError);}finally{globalThis.fetch=original;}});
test('overlapping checks save one event and pausing cancels pending report without deleting history',async()=>{const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()},original=globalThis.fetch;const time=new Date().toISOString();globalThis.fetch=async()=>Response.json({price:'2300',time});try{await Promise.all([worker.fetch(request('check',{source:'codex'},false),env),worker.fetch(request('check',{source:'browser'}),env)]);const before=await (await worker.fetch(request('state'),env)).json();assert.equal(before.events.length,1);const paused=await (await worker.fetch(request('config',{...before.config,armed:false,expectedRevision:before.config.revision}),env)).json();assert.equal(paused.events.length,1);assert.equal(paused.events[0].delivery,'cancelled');assert.equal((await (await worker.fetch(request('check',{source:'codex'},false),env)).json()).pending.length,0);}finally{globalThis.fetch=original;}});
test('a settings change during network load is rejected and records a visible background error',async()=>{const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()},original=globalThis.fetch;let resolveTicker,started;const ready=new Promise(resolve=>{started=resolve;});globalThis.fetch=()=>new Promise(resolve=>{resolveTicker=resolve;started();});try{const running=worker.fetch(request('check',{source:'codex'},false),env);await ready;const data=await (await worker.fetch(request('state'),env)).json();await worker.fetch(request('config',{...data.config,mode:'close',expectedRevision:1}),env);resolveTicker(Response.json({price:'2300',time:new Date().toISOString()}));const result=await running;assert.equal(result.status,503);const after=await (await worker.fetch(request('state'),env)).json();assert.equal(after.events.length,0);assert.match(after.background.lastError,/Settings changed/);}finally{globalThis.fetch=original;}});
test('news route serves safe publisher data without requiring monitor storage',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<rss><channel><item><title>Ethereum protocol upgrade</title><link>https://blog.ethereum.org/test-story</link><pubDate>'+new Date().toUTCString()+'</pubDate></item></channel></rss>');try{const response=await worker.fetch(new Request('https://monitor.example/api/news'),{});assert.equal(response.status,200);const data=await response.json();assert.equal(data.sources.length,4);assert.equal(data.items[0].title,'Ethereum protocol upgrade');assert.equal((await worker.fetch(new Request('https://monitor.example/api/news',{method:'POST'}),{})).status,405);}finally{globalThis.fetch=original;}});

const START=Date.UTC(2026,9,17),DAY=86400,D=START/1000;
function config(overrides={}){return engineAPI.validateConfig({...engineAPI.DEFAULT_CONFIG,levels:{...engineAPI.DEFAULT_CONFIG.levels},...overrides});}
function monitor(configuration=config()){return {config:configuration,engine:null,events:[],decisions:[],background:{enabled:false,intervalMinutes:5,lastCheck:null,lastError:null}};}
function legacyConfig(configuration){const value={...configuration};for(const key of ['selectedLevels','proximity','volumeConfirmation'])delete value[key];return value;}
function legacyEngine(state,configuration){const value=structuredClone(state),old=legacyConfig(configuration);value.version=1;value.configKey=JSON.stringify({levels:old.levels,mode:old.mode,cooldownMinutes:old.cooldownMinutes,retestTolerance:old.retestTolerance,retestCandles:old.retestCandles,revision:old.revision});for(const key of ['proximityZones','proximityCursor','proximityLastAlertAt'])delete value[key];return value;}
function candle(time,close=2500,volume=100,low=close-10,high=close+10){return [time,low,high,close,close,volume];}
function history(close=2500){return Array.from({length:20},(_,index)=>candle(D-(20-index)*DAY,close));}
function historicalEvent(id,time,delivery='pending'){return {id,rule:'S1',direction:'below',mode:'immediate',time,price:2300,message:'Saved fixture event',delivery};}
async function stateOf(env){const response=await worker.fetch(request('state'),env);assert.equal(response.status,200);return response.json();}
async function checkOf(env,source='browser'){const response=await worker.fetch(request('check',{source},source!=='codex'),env);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
async function fakeMarket(clock,operation){const originalFetch=globalThis.fetch,originalNow=Date.now;Date.now=()=>clock.now;globalThis.fetch=async url=>{assert.match(url,/^https:\/\/api\.exchange\.coinbase\.com\/products\/ETH-USD\//);if(url.endsWith('ticker'))return Response.json({price:String(clock.price),time:new Date(clock.now-(clock.stale?180000:0)).toISOString()});if(url.includes('candles?granularity=86400')){if(clock.candleFailure)throw new Error(clock.candleFailure);return Response.json(clock.candles??[]);}throw new Error('Unexpected fixture URL');};try{return await operation();}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}}

test('legacy config reads normalize defaults and no-op saves preserve revision, history, and engine',async()=>{
  const configuration=config(),generated=engineAPI.evaluate(configuration,null,{price:2300,time:START},START);
  const seed=monitor(legacyConfig(configuration));seed.engine=legacyEngine(generated.state,configuration);
  seed.events=[{...historicalEvent(generated.events[0].id,START,'reported'),message:generated.events[0].message}];delete seed.decisions;
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(seed)};
  const before=await stateOf(env);
  assert.deepEqual(before.config.selectedLevels,['S1','R1']);assert.equal(before.config.proximity.enabled,false);assert.equal(before.config.volumeConfirmation.enabled,false);assert.deepEqual(before.decisions,[]);
  const response=await worker.fetch(request('config',{...seed.config,expectedRevision:1}),env),saved=await response.json();
  assert.equal(response.status,200);assert.equal(saved.config.revision,1);assert.equal(saved.events[0].delivery,'reported');assert.equal(env.DB.read().data.engine.version,1);
  await fakeMarket({now:START+1000,price:2290},async()=>{
    const checked=await checkOf(env,'codex');assert.equal(checked.events.length,1);assert.equal(checked.pending.length,0);assert.equal(checked.background.enabled,false);
    const stored=env.DB.read().data;assert.equal(stored.engine.version,2);assert.equal(stored.engine.activatedAt,START);assert.equal(stored.engine.lastAlertAt.S1,START);assert.equal(stored.engine.quoteCursor,START+1000);
  });
});

test('older clients preserve omitted advanced controls on no-op and real config saves',async()=>{
  const configuration=config({mode:'close',selectedLevels:['S2','R1'],proximity:{enabled:true,distancePercent:0.75},volumeConfirmation:{enabled:true,lookbackCandles:20,minRelativeVolume:1.5}});
  const seed=monitor(configuration);seed.events=[historicalEvent('saved-pending',START)];seed.decisions=[{id:'saved-decision',time:START,evaluatedAt:START,reason:'cooldown'}];
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(seed)},legacy=legacyConfig(configuration);
  const unchanged=await (await worker.fetch(request('config',{...legacy,expectedRevision:1}),env)).json();
  assert.equal(unchanged.config.revision,1);assert.deepEqual(unchanged.config.selectedLevels,['S2','R1']);assert.deepEqual(unchanged.config.proximity,configuration.proximity);assert.deepEqual(unchanged.config.volumeConfirmation,configuration.volumeConfirmation);assert.equal(unchanged.events[0].delivery,'pending');assert.equal(unchanged.decisions.length,1);
  const changed=await (await worker.fetch(request('config',{...legacy,levels:{...legacy.levels,S1:2400},expectedRevision:1}),env)).json();
  assert.equal(changed.config.revision,2);assert.deepEqual(changed.config.proximity,configuration.proximity);assert.deepEqual(changed.config.volumeConfirmation,configuration.volumeConfirmation);assert.deepEqual(changed.config.selectedLevels,configuration.selectedLevels);assert.equal(changed.events[0].delivery,'cancelled');assert.equal(changed.decisions[0].id,'saved-decision');assert.equal(changed.background.enabled,false);
});

test('explicit malformed advanced fields reject without changing saved settings',async()=>{
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database()},before=await stateOf(env);
  for(const field of ['selectedLevels','proximity','volumeConfirmation']){
    const response=await worker.fetch(request('config',{...before.config,[field]:null,expectedRevision:1}),env);
    assert.equal(response.status,400);assert.equal((await stateOf(env)).config.revision,1);
  }
  assert.equal((await worker.fetch(request('config',null),env)).status,400);
  assert.equal((await worker.fetch(request('config',{...before.config,volumeConfirmation:{enabled:true},expectedRevision:1}),env)).status,400);
  const after=await stateOf(env);assert.deepEqual(after.config,before.config);assert.equal(after.background.enabled,false);
});

test('concurrent retries persist one cooldown decision with engine state and preserve pending events',async()=>{
  const configuration=config(),first=engineAPI.evaluate(configuration,null,{price:2300,time:START},START);
  const reentered=engineAPI.evaluate(configuration,first.state,{price:2416,time:START+1000},START+1000);
  const seed=monitor(configuration);seed.engine=reentered.state;seed.events=first.events.map(event=>({...event,delivery:'pending'}));
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(seed)};env.DB.conflictNext();
  await fakeMarket({now:START+2000,price:2300},async()=>{
    const results=await Promise.all([checkOf(env,'codex'),checkOf(env)]);assert.equal(results.length,2);
    const after=await stateOf(env);assert.equal(after.events.length,1);assert.equal(after.events[0].delivery,'pending');assert.equal(after.decisions.length,1);assert.equal(after.decisions[0].reason,'cooldown');assert.equal(after.decisions[0].time,START+2000);assert.equal(after.background.enabled,false);
    assert.equal(env.DB.read().data.engine.quoteCursor,START+2000);assert.equal(env.DB.read().data.engine.zones.S1,'outside');assert.ok(env.DB.updateCount()>=3);
    await checkOf(env);const repeated=await stateOf(env);assert.equal(repeated.decisions.length,1);assert.equal(repeated.decisions[0].id,after.decisions[0].id);
  });
});

test('decision history is separately deduplicated and bounded to the newest 200 transitions',async()=>{
  const configuration=config(),first=engineAPI.evaluate(configuration,null,{price:2300,time:START},START);
  const seed=monitor(configuration);seed.engine=engineAPI.evaluate(configuration,first.state,{price:2416,time:START+1000},START+1000).state;
  seed.events=[historicalEvent('keep-pending',START),historicalEvent('keep-reported',START-1000,'reported')];
  seed.decisions=Array.from({length:220},(_,index)=>({id:'old-'+index,time:START-index-1,evaluatedAt:START-index-1,reason:'cooldown'}));seed.decisions.push({...seed.decisions[0]});
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(seed)};
  await fakeMarket({now:START+2000,price:2300},async()=>{
    const result=await checkOf(env);assert.equal(result.decisions.length,200);assert.equal(new Set(result.decisions.map(item=>item.id)).size,200);assert.equal(result.decisions[0].reason,'cooldown');assert.match(result.decisions[0].id,/^eth-decision:/);assert.ok(!result.decisions.some(item=>item.id==='old-219'));assert.ok(result.events.some(item=>item.id==='keep-pending'&&item.delivery==='pending'));assert.ok(result.events.some(item=>item.id==='keep-reported'));
  });
});

test('a full pending queue fails without advancing state or dropping pending events, then recovers after acknowledgement',async()=>{
  const seed=monitor();seed.events=Array.from({length:200},(_,index)=>historicalEvent('pending-'+index,START-index-1000));seed.decisions=[{id:'old-decision',time:START-1000,evaluatedAt:START-1000,reason:'cooldown'}];
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(seed)};
  await fakeMarket({now:START,price:2300},async()=>{
    const failed=await worker.fetch(request('check',{source:'codex'},false),env);assert.equal(failed.status,503);
    const data=env.DB.read().data;assert.equal(data.engine,null);assert.equal(data.events.length,200);assert.ok(data.events.every(item=>item.delivery==='pending'));assert.equal(data.decisions[0].id,'old-decision');assert.match(data.evaluationError,/queue is full/);assert.equal(data.background.enabled,false);
    const acknowledged=await worker.fetch(request('ack',{ids:['pending-0']},false),env);assert.equal(acknowledged.status,200);
    const recovered=await checkOf(env,'codex');assert.equal(recovered.events.length,200);assert.equal(recovered.pending.length,200);assert.ok(recovered.events.some(item=>item.id===`eth:1:immediate:S1:below:${START}`));assert.ok(recovered.events.some(item=>item.id==='pending-199'));assert.equal(recovered.evaluationError,null);assert.equal(recovered.background.enabled,false);
  });
});

test('proximity and secondary breach records persist with independent cooldown and source evidence',async()=>{
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(monitor(config({selectedLevels:['S2'],proximity:{enabled:true,distancePercent:0.5}})))},clock={now:START,price:2500};
  await fakeMarket(clock,async()=>{
    assert.equal((await checkOf(env)).events.length,0);
    clock.now+=1000;clock.price=2380;
    const near=await checkOf(env);assert.equal(near.events.length,1);assert.equal(near.events[0].kind,'proximity');assert.equal(near.events[0].levelPrice,2373);assert.equal(near.events[0].evidence.thresholdPercent,0.5);
    clock.now+=1000;clock.price=2372;
    const breached=await checkOf(env,'codex');assert.equal(breached.events.length,2);assert.equal(breached.pending.length,2);assert.equal(new Set(breached.events.map(item=>item.id)).size,2);assert.ok(breached.events.some(item=>item.kind==='breach'));assert.equal(breached.background.enabled,false);
  });
});

test('daily low-volume decisions persist and are not converted to notifications by repeat checks',async()=>{
  const configuration=config({mode:'close',volumeConfirmation:{enabled:true,lookbackCandles:20,minRelativeVolume:1.5}}),env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(monitor(configuration))},clock={now:START,price:2500,candles:history()};
  await fakeMarket(clock,async()=>{
    await checkOf(env);
    clock.now+=DAY*1000;clock.price=2560;clock.candles.push(candle(D,2560,149));
    const low=await checkOf(env,'codex');assert.equal(low.events.length,0);assert.equal(low.pending.length,0);assert.equal(low.decisions.length,1);assert.equal(low.decisions[0].reason,'volume-low');assert.equal(low.decisions[0].evidence.relativeVolume,1.49);assert.equal(low.lastEvaluatedCandle,D);
    clock.now+=1000;const repeat=await checkOf(env);assert.equal(repeat.decisions.length,1);assert.equal(repeat.events.length,0);
    clock.stale=true;assert.equal((await worker.fetch(request('check',{source:'codex'},false),env)).status,503);
    const failed=await stateOf(env);assert.equal(failed.decisions[0].id,low.decisions[0].id);assert.equal(failed.lastEvaluatedCandle,D);assert.equal(failed.background.enabled,false);
  });
});

test('a fresh proximity warning survives a failed daily request and recovery preserves the daily setup',async()=>{
  const configuration=config({mode:'retest',proximity:{enabled:true,distancePercent:0.5}}),env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(monitor(configuration))},clock={now:START,price:2500,candles:[candle(D-DAY,2500)]};
  await fakeMarket(clock,async()=>{
    await checkOf(env,'codex');clock.now+=DAY*1000;clock.candles.push(candle(D,2560));await checkOf(env,'codex');
    const before=env.DB.read().data,previousCheck=before.background.lastCheck;assert.ok(before.engine.setups.R1);
    clock.now+=1000;clock.price=2545;clock.candleFailure='Daily request offline';
    const partial=await checkOf(env,'codex');assert.equal(partial.events.length,1);assert.equal(partial.events[0].kind,'proximity');assert.match(partial.evaluationError,/Daily request offline/);assert.equal(partial.background.lastCheck,previousCheck);assert.match(partial.background.lastError,/Daily request offline/);assert.equal(partial.background.enabled,false);
    const failed=env.DB.read().data;assert.equal(failed.engine.candleCursor,before.engine.candleCursor);assert.deepEqual(failed.engine.setups.R1,before.engine.setups.R1);
    clock.now+=1000;await checkOf(env);assert.equal((await stateOf(env)).events.length,1);
    clock.now+=1000;clock.candleFailure=null;const recovery=await checkOf(env,'codex');assert.equal(recovery.events.length,1);assert.equal(recovery.evaluationError,null);assert.equal(recovery.background.lastError,null);assert.deepEqual(env.DB.read().data.engine.setups.R1,before.engine.setups.R1);
    clock.now=START+2*DAY*1000;clock.candles.push(candle(D+DAY,2565,100,2554,2580));const confirmed=await checkOf(env);assert.equal(confirmed.events.length,2);assert.equal(confirmed.events.filter(item=>item.kind==='breach').length,1);assert.equal(env.DB.read().data.engine.setups.R1,null);
  });
});

test('daily request failures without proximity retain the original failed-check contract',async()=>{
  const env={MONITOR_OWNER_ID:'test-owner',MONITOR_SERVICE_TOKEN:'fixture-monitor-service-token-32-characters',DB:database(monitor(config({mode:'close'})))};
  await fakeMarket({now:START,price:2500,candleFailure:'Daily unavailable'},async()=>{
    const response=await worker.fetch(request('check',{source:'codex'},false),env);assert.equal(response.status,503);
    const after=await stateOf(env);assert.equal(after.events.length,0);assert.deepEqual(after.decisions,[]);assert.equal(after.lastEvaluatedCandle,null);assert.match(after.evaluationError,/Daily unavailable/);assert.equal(after.background.enabled,false);
  });
});

test('calendar route reports source failures without requiring monitor storage',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('unknown official format');try{const response=await worker.fetch(new Request('https://monitor.example/api/calendar'),{});assert.equal(response.status,503);const data=await response.json();assert.equal(data.sources.length,4);assert.equal(data.events.length,0);assert.equal(data.roadmap.length,0);assert.equal((await worker.fetch(new Request('https://monitor.example/api/calendar',{method:'POST'}),{})).status,405);}finally{globalThis.fetch=original;}});
