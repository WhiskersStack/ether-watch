import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {retireNotifications} from './dist/retire-notifications.mjs';

test('cleanup preserves unrelated preferences/workers and never requests notification permission',async()=>{
  const values=new Map([['etherwatch-alerts','old'],['etherwatch-armed','true'],['etherwatch-migrated','1'],['etherwatch-chart','keep'],['etherwatch-theme','classic'],['etherwatch-calendar-zone','UTC']]);
  const calls=[];const registration={active:{scriptURL:'https://fixture.example/notification-worker.js'},async update(){calls.push('update');},pushManager:{async getSubscription(){return {async unsubscribe(){calls.push('unsubscribe');}};}},async unregister(){calls.push('unregister');}};
  const other={active:{scriptURL:'https://fixture.example/other-worker.js'},async unregister(){throw Error('Unrelated registration');}};
  await retireNotifications({location:{origin:'https://fixture.example'},localStorage:{removeItem:k=>values.delete(k)},indexedDB:{deleteDatabase(name){calls.push(name);return {};}},navigator:{serviceWorker:{getRegistrations:async()=>[registration,other]}}});
  assert.deepEqual([...values.keys()],['etherwatch-chart','etherwatch-theme','etherwatch-calendar-zone']);assert.deepEqual(calls,['ether-watch-push-receipts','update','unsubscribe','unregister']);
});
test('blocked storage and offline worker update do not block unregistration',async()=>{
  let removed=false;
  await retireNotifications({location:{origin:'https://fixture.example'},get localStorage(){throw Error('blocked');},get indexedDB(){throw Error('blocked');},navigator:{serviceWorker:{getRegistrations:async()=>[{active:{scriptURL:'https://fixture.example/notification-worker.js'},update:async()=>{throw Error('offline');},pushManager:{getSubscription:async()=>{throw Error('denied');}},unregister:async()=>{removed=true;}}]}}});
  assert.equal(removed,true);await retireNotifications({});
});
test('replacement worker activates cleanup without push/display/receipt handlers',async()=>{
  const handlers={},calls=[];let work;
  const self={addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>calls.push('skip'),clients:{claim:async()=>calls.push('claim')},registration:{pushManager:{getSubscription:async()=>({unsubscribe:async()=>calls.push('unsubscribe')})},unregister:async()=>calls.push('unregister')},indexedDB:{deleteDatabase(name){calls.push(name);const request={};queueMicrotask(()=>request.onblocked());return request;}}};
  vm.runInNewContext(readFileSync(new URL('./dist/notification-worker.js',import.meta.url),'utf8'),{self,Promise});
  assert.deepEqual(Object.keys(handlers),['install','activate']);handlers.install({waitUntil:p=>work=p});await work;handlers.activate({waitUntil:p=>work=p});await work;
  assert.deepEqual(calls,['skip','claim','unsubscribe','ether-watch-push-receipts','unregister']);
});
