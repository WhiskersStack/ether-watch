import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {notificationPermission,requestNotificationPermission,showDeviceNotification} from './dist/notifications.mjs';

test('Android delivery uses an activated service worker instead of the unsupported constructor',async()=>{
  const calls=[];function MobileNotification(){throw Error('Illegal constructor on Android');}MobileNotification.permission='granted';
  const registration={showNotification:async(title,options)=>calls.push({title,options})},service={register:async(url,options)=>{assert.equal(url,'/notification-worker.js');assert.deepEqual(options,{scope:'/'});},ready:Promise.resolve(registration)};
  const options={body:'Qualified alert',tag:'event-one'},mode=await showDeviceNotification('Ether Watch',options,{Notification:MobileNotification,navigator:{serviceWorker:service},isSecureContext:true});
  assert.equal(mode,'service-worker');assert.deepEqual(calls,[{title:'Ether Watch',options}]);
});
test('desktop browsers without service workers retain constructor delivery',async()=>{
  const calls=[];function DesktopNotification(title,options){calls.push({title,options});}DesktopNotification.permission='granted';
  assert.equal(await showDeviceNotification('Test',{body:'One'},{Notification:DesktopNotification}),'page');assert.equal(calls.length,1);
});
test('only explicit permission requests prompt and existing denials are not reprompted',async()=>{
  let requests=0;const api={permission:'default',requestPermission:async()=>{requests++;return 'granted';}},browser={Notification:api};
  await assert.rejects(showDeviceNotification('Alert',{},browser),/Allow notifications/);assert.equal(requests,0);
  assert.equal(await requestNotificationPermission(browser),'granted');assert.equal(requests,1);
  api.permission='denied';assert.equal(await requestNotificationPermission(browser),'denied');assert.equal(requests,1);assert.equal(notificationPermission(browser),'denied');
});
test('unsupported and insecure contexts fail visibly without attempting registration',async()=>{
  assert.equal(notificationPermission({}),'unsupported');await assert.rejects(requestNotificationPermission({}),/regular browser/);
  await assert.rejects(showDeviceNotification('Test',{},{}),/regular browser/);await assert.rejects(requestNotificationPermission({isSecureContext:false,Notification:{}}),/HTTPS/);
});
test('an ignored permission prompt cannot leave the controls waiting indefinitely',async()=>{
  await assert.rejects(requestNotificationPermission({Notification:{permission:'default',requestPermission:()=>new Promise(()=>{})}},5),/No permission response/);
});
test('activation failure never falls back to an Android constructor and activation is bounded',async()=>{
  let constructors=0;function MobileNotification(){constructors++;}MobileNotification.permission='granted';
  const browser={Notification:MobileNotification,navigator:{serviceWorker:{register:async()=>{throw Error('registration failed');},ready:new Promise(()=>{})}}};
  await assert.rejects(showDeviceNotification('Test',{},browser),/registration failed/);assert.equal(constructors,0);
  browser.navigator.serviceWorker.register=async()=>{};await assert.rejects(showDeviceNotification('Test',{},browser,5),/timed out/);assert.equal(constructors,0);
});
const app=fs.readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
function controls(overrides={}){
  const elements={},sent=[],forbidden=()=>{throw Error('Device test must not touch monitoring, storage or network');};
  const context=vm.createContext({$:id=>elements[id]??={},notificationPermission:()=> 'granted',requestNotificationPermission:async()=> 'granted',showDeviceNotification:async(title,options)=>sent.push({title,options}),api:forbidden,fetch:forbidden,checkAlert:forbidden,localStorage:{setItem:forbidden},...overrides});
  vm.runInContext(app.slice(app.indexOf('let notificationBusy=false;'),app.indexOf("$('notify').addEventListener('click',enableNotifications)")),context);
  return {context,elements,sent};
}
test('manual device test is local, clearly identified and does not claim OS delivery',async()=>{
  const {context,elements,sent}=controls();await context.testDeviceNotification();assert.equal(sent.length,1);assert.equal(sent[0].title,'Ether Watch · Test notification');assert.equal(sent[0].options.tag,'ether-watch-device-test');
  assert.equal(elements.notify.disabled,false);assert.equal(elements['notification-test'].disabled,false);assert.match(elements['notification-note'].textContent,/confirm it appeared/);assert.doesNotMatch(elements['notification-note'].textContent,/delivered/i);
});
test('denied device permission sends nothing and provides recovery instructions',async()=>{
  const {context,elements,sent}=controls({requestNotificationPermission:async()=> 'denied'});await context.testDeviceNotification();assert.equal(sent.length,0);assert.match(elements['notification-note'].textContent,/blocked/);assert.equal(elements['notification-test'].disabled,false);
});
test('repeated test clicks cannot overlap and controls recover after completion',async()=>{
  let complete,calls=0;const {context,elements}=controls({showDeviceNotification:async()=>{calls++;await new Promise(resolve=>complete=resolve);}});
  const first=context.testDeviceNotification();await Promise.resolve();await Promise.resolve();await context.testDeviceNotification();assert.equal(calls,1);assert.equal(elements['notification-test'].disabled,true);complete();await first;assert.equal(elements['notification-test'].disabled,false);
});
test('delivery errors stay visible while the test controls and saved alert remain intact',async()=>{
  const {context,elements}=controls({showDeviceNotification:async()=>{throw Error('OS refused');}});await context.testDeviceNotification();assert.match(elements['notification-note'].textContent,/could not be sent/);assert.equal(elements['notification-test'].disabled,false);
  const event={message:'Existing saved alert'};await context.deliverPriceNotification(event,'one');assert.match(elements['notification-note'].textContent,/in-page alert remains in history/);assert.deepEqual(event,{message:'Existing saved alert'});
});
function clickContext(clients){
  const handlers={},self={location:{origin:'https://etherwatch.app'},clients,addEventListener:(name,handler)=>handlers[name]=handler};
  vm.runInNewContext(fs.readFileSync(new URL('./dist/notification-worker.js',import.meta.url),'utf8'),{self,URL});return handlers;
}
test('notification clicks focus an existing same-origin page without trusting notification URLs',async()=>{
  const calls=[],handlers=clickContext({matchAll:async()=>[{url:'https://other.example/',focus:async()=>{throw Error('External page');}},{url:'https://etherwatch.app/',navigate:async url=>calls.push(url),focus:async()=>calls.push('focus')}],openWindow:async()=>{throw Error('Existing page should be reused');}});
  assert.deepEqual(Object.keys(handlers),['notificationclick']);let pending;handlers.notificationclick({notification:{data:{url:'https://other.example/'},close:()=>calls.push('close')},waitUntil:task=>pending=task});await pending;assert.deepEqual(calls,['close','https://etherwatch.app/#alerts','focus']);
});
test('notification click opens only the fixed local alerts page when no window exists',async()=>{
  const calls=[],handlers=clickContext({matchAll:async()=>[],openWindow:async url=>calls.push(url)});let pending;handlers.notificationclick({notification:{close(){}},waitUntil:task=>pending=task});await pending;assert.deepEqual(calls,['https://etherwatch.app/#alerts']);
});
