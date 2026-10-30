// Bounded public release verification. Confirm the tombstone before exercising retired APIs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const stage=process.argv[2]||'retirement';
assert.ok(['retirement','settings','final'].includes(stage));
const origin='https://etherwatch.app';
const fetchSite=(route,options={})=>fetch(origin+route,{redirect:'error',signal:AbortSignal.timeout(15000),...options});
const tombstone=await fetchSite('/notification-worker.js');
assert.equal(tombstone.status,200);
assert.equal(await tombstone.text(),await readFile(new URL('../dist/notification-worker.js',import.meta.url),'utf8'));
let checks=1;
for(const route of ['/api/state','/api/config','/api/check','/api/ack','/api/background','/api/push','/api/push/status','/api/push/subscribe','/api/push/unsubscribe','/api/push/test','/api/push/retry','/api/push/probe','/api/push/receipt','/api/push/confirm','/mcp'])for(const method of ['GET','POST']){
  const response=await fetchSite(route,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  if(route==='/mcp')assert.ok([404,410].includes(response.status),'Retired MCP must remain unavailable');else assert.equal(response.status,410,method+' '+route);checks++;
}
const response=await fetchSite('/api/settings');
assert.equal(response.status,stage==='retirement'?503:200);
let settings=null;
if(stage!=='retirement'){settings=await response.json();assert.equal(settings.access.canManage,false);}
console.log(JSON.stringify({stage,checks:checks+1,verifiedAt:new Date().toISOString(),settings}));
