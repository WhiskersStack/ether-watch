import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DEFAULT_SETTINGS, validateSettings} from './dist/settings.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = read('./drizzle/0003_dashboard_settings.sql');
const purge = read('./release/0004_purge_alerts.sql');
const compiled = ['dist/settings.mjs','worker/news.js','worker/calendar.js','worker/volume.js'].map(file => read(file).replace(/^export\s+/gm, '')).join('\n');
const worker = (await import('data:text/javascript;base64,' + Buffer.from('const ASSETS={};\n'+compiled+'\n'+read('worker/index.js')).toString('base64'))).default;
function fixture(seed = {config: structuredClone(DEFAULT_SETTINGS), events:[{message:'old'}], pushJobs:[{state:'queued'},{state:'retry'},{state:'sending'},{state:'displayed'}]}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_monitor','0001_market_data_cache','0002_push_subscriptions']) sqlite.exec(read('./drizzle/'+file+'.sql'));
  if (seed !== null) sqlite.prepare('INSERT INTO monitor(id,version,data) VALUES(1,0,?)').run(typeof seed === 'string' ? seed : JSON.stringify(seed));
  sqlite.prepare('INSERT INTO market_data_cache(cache_key,data) VALUES(?,?)').run('fixture','keep');
  const DB = {prepare(sql) {
    let values=[];
    return {
      bind(...args){values=args;return this;},
      async first(){return sqlite.prepare(sql).get(...values);},
      async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}
    };
  }};
  return {sqlite,DB,MONITOR_OWNER_ID:'fixture-owner'};
}
function transaction(sqlite, sql) { sqlite.exec('BEGIN');try{sqlite.exec(sql);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;} }
function request(method='GET',body,identity='fixture-owner',extra={}) {return new Request('https://fixture.example/api/settings',{method,headers:{...(identity?{'oai-authenticated-user-id':identity}:{}),'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}

test('migration preserves exact custom levels/revision, cancels only pending jobs; purge retains settings/cache',()=>{
  const seed={config:{levels:{S3:100,S2:200,S1:300,R1:400,R2:500,R3:600},revision:7},events:[{message:'delete'}],pushJobs:[{state:'queued'},{state:'retry'},{state:'sending'},{state:'displayed'}]};
  const f=fixture(seed);try{
    transaction(f.sqlite,migration);
    const before=f.sqlite.prepare('SELECT * FROM dashboard_settings').get();assert.equal(before.s1,300);assert.equal(before.revision,7);
    const old=JSON.parse(f.sqlite.prepare('SELECT data FROM monitor').get().data);
    assert.equal(old.config.armed,false);assert.equal(old.background.enabled,false);assert.deepEqual(old.pushJobs.map(j=>j.state),['cancelled','cancelled','cancelled','displayed']);
    transaction(f.sqlite,purge);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM dashboard_settings').get(),before);
    assert.equal(f.sqlite.prepare('SELECT data FROM market_data_cache').get().data,'keep');
    for(const table of ['monitor','push_subscriptions'])assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name=?').get(table).n,0);
  }finally{f.sqlite.close();}
});
test('missing legacy row gets explicit defaults',()=>{const f=fixture(null);try{transaction(f.sqlite,migration);transaction(f.sqlite,purge);assert.equal(f.sqlite.prepare('SELECT s1 FROM dashboard_settings').get().s1,2416);}finally{f.sqlite.close();}});
for(const seed of ['broken JSON',{config:{...DEFAULT_SETTINGS,revision:true}},{config:{...DEFAULT_SETTINGS,levels:{...DEFAULT_SETTINGS.levels,S3:true}}},{config:{levels:{},revision:1}},{config:{...DEFAULT_SETTINGS,levels:{...DEFAULT_SETTINGS.levels,S1:0}}},{config:{...DEFAULT_SETTINGS,revision:0}},{config:{...DEFAULT_SETTINGS,levels:{...DEFAULT_SETTINGS.levels,S2:2416}}},{config:{...DEFAULT_SETTINGS,levels:{...DEFAULT_SETTINGS.levels,S1:2416.123}}}]) {
  test('invalid legacy settings abort without purging: '+JSON.stringify(seed).slice(0,100),()=>{const f=fixture(seed);try{assert.throws(()=>transaction(f.sqlite,migration));assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM monitor').get().n,1);assert.ok(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='push_subscriptions'").get());}finally{f.sqlite.close();}});
}
test('purge refuses a mismatched copy and preserves legacy records',()=>{const f=fixture();try{transaction(f.sqlite,migration);f.sqlite.exec('UPDATE dashboard_settings SET s1=2400');assert.throws(()=>transaction(f.sqlite,purge));assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM monitor').get().n,1);}finally{f.sqlite.close();}});
test('level validation rejects nonnumeric, precision and ordering errors',()=>{for(const value of [null,{},'',NaN,Infinity,0,-1,'1e3',2416.001])assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,levels:{...DEFAULT_SETTINGS.levels,S1:value}}));assert.deepEqual(validateSettings(DEFAULT_SETTINGS),DEFAULT_SETTINGS);});
test('settings API preserves owner auth, JSON validation, concurrent revisions and read-only GET',async()=>{
  const f=fixture();try{
    transaction(f.sqlite,migration);const snapshot=f.sqlite.prepare('SELECT * FROM dashboard_settings').get();
    let r=await worker.fetch(request('GET',undefined,null),f);assert.equal(r.status,200);assert.equal((await r.json()).access.canManage,false);assert.deepEqual(f.sqlite.prepare('SELECT * FROM dashboard_settings').get(),snapshot);
    const body={levels:{...DEFAULT_SETTINGS.levels,S1:2400},expectedRevision:1};
    assert.equal((await worker.fetch(request('POST',body,null),f)).status,401);
    assert.equal((await worker.fetch(request('POST',body,'other'),f)).status,403);
    assert.equal((await worker.fetch(request('POST',body,'fixture-owner',{Origin:'https://other.example'}),f)).status,403);
    assert.equal((await worker.fetch(request('POST',{...body,armed:true}),f)).status,400);
    assert.equal((await worker.fetch(request('POST',{...body,levels:{...body.levels,S1:0}}),f)).status,400);
    const attempts=await Promise.all([worker.fetch(request('POST',body),f),worker.fetch(request('POST',body),f)]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
    const saved=await (await worker.fetch(request(),f)).json();assert.equal(saved.levels.S1,2400);assert.equal(saved.revision,2);
    transaction(f.sqlite,purge);assert.equal((await (await worker.fetch(request(),f)).json()).levels.S1,2400);
  }finally{f.sqlite.close();}
});
test('all retired endpoints reject GET/POST before touching storage or network, including stale tools',async()=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=()=>{calls++;throw Error('Unexpected network');};
  const env=new Proxy({}, {get(){calls++;throw Error('Unexpected environment access');}});
  try{for(const path of ['/api/state','/api/config','/api/check','/api/ack','/api/background','/api/push','/api/push/status','/api/push/subscribe','/api/push/unsubscribe','/api/push/test','/api/push/retry','/api/push/probe','/api/push/receipt','/api/push/confirm','/mcp'])for(const method of ['GET','POST']){
    const r=await worker.fetch(new Request('https://fixture.example'+path,{method,...(method==='POST'?{body:JSON.stringify({method:'tools/call',params:{name:'cloud_monitor_check'}})}:{})}),env);assert.equal(r.status,410,path);
  }assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});
test('settings missing storage fails without silently replacing saved levels',async()=>{assert.equal((await worker.fetch(request(),{})).status,503);});

test('purge refuses a missing legacy revision even after a newer owner save',()=>{const f=fixture();try{transaction(f.sqlite,migration);f.sqlite.exec("UPDATE dashboard_settings SET revision=2; UPDATE monitor SET data=json_remove(data,'$.config.revision')");assert.throws(()=>transaction(f.sqlite,purge));assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM monitor').get().n,1);}finally{f.sqlite.close();}});
