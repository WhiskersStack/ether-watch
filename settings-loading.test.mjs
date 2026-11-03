import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DEFAULT_SETTINGS, validateSettings} from './dist/settings.mjs';

const source = readFileSync(new URL('./dist/app.js', import.meta.url), 'utf8');
function extract(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
const saved = {levels:{S3:100,S2:200,S1:300,R1:400,R2:500,R3:600},revision:7,access:{canManage:true}};
function fixture() {
  const elements = {}, calls = [], chart = {}, listeners = {}, signal = new AbortController();
  const element = id => elements[id] ??= {textContent:'',innerHTML:'',style:{},hidden:false,disabled:false,value:'',
    addEventListener(type, fn){listeners[id+':'+type]=fn;},showModal(){this.open=true;},close(){this.open=false;}};
  let response = async () => Response.json(saved);
  const state = {serverReady:false,canManage:false,price:350};
  const context = vm.createContext({
    structuredClone,Number,Object,Math,JSON,Error,DEFAULT_SETTINGS,validateSettings,state,
    $:element,document:{querySelectorAll:()=>[element('edit-shortcut')],querySelector:()=>element('fieldset')},
    AbortSignal:{timeout(ms){assert.equal(ms,18000);return signal.signal;}},
    fetch:async(path,options)=>{calls.push({path,options});return response(path,options);},
    graphState:{candles:[{time:1}]},chartPrefs:{timeframe:86400},
    priceChart:{setData(candles,options){chart.candles=candles;chart.options=options;}},toast(){}
  });
  vm.runInContext(extract('const levelNames=', 'let chartPrefs='), context);
  vm.runInContext(extract('const usd =', 'const short ='), context);
  vm.runInContext(extract('async function api(', 'function ema('), context);
  vm.runInContext(extract('function draw(', 'function renderChartReadout('), context);
  vm.runInContext(extract('function fillSettingsFields(', 'function syncFeedLayout('), context);
  return {context,state,elements,calls,chart,listeners,signal,
    respond(fn){response=fn;},element,
    config:()=>vm.runInContext('config',context),
    submit:()=>listeners['settings-form:submit']({preventDefault(){},currentTarget:{querySelectorAll:()=>[]}})};
}
function unavailable(f) {
  assert.equal(f.state.serverReady,false);
  assert.equal(f.elements['settings-open'].disabled,true);
  assert.equal(f.elements['settings-save'].disabled,true);
  assert.equal(f.elements.fieldset.disabled,true);
  assert.equal(f.elements['range-pin'].hidden,true);
  assert.equal(f.chart.options.levels.length,0);
  assert.doesNotMatch(f.elements['level-list'].innerHTML,/NaN|undefined|\d+\.\d+%/);
}
test('initial loading has no defaults, no overlays or position calculation, and coalesces reads', async () => {
  const f=fixture();let resolve;
  f.respond(()=>new Promise(done=>resolve=done));
  const pending=f.context.loadSettings();
  assert.equal(f.context.loadSettings(),pending);
  assert.equal(f.calls.length,1);assert.equal(f.config(),null);
  unavailable(f);assert.equal(f.elements['range-support'].textContent,'—');
  assert.match(f.elements['settings-status'].textContent,/Loading/);
  assert.doesNotMatch(f.elements.structure.innerHTML,/\d+\.\d+%/);
  resolve(Response.json(saved));await pending;
  assert.equal(f.state.serverReady,true);assert.equal(f.elements['settings-open'].disabled,false);
  assert.equal(f.elements['range-support'].textContent,'$300.00');assert.equal(f.chart.options.levels.length,6);
  assert.equal(f.elements['chart-levels-status'].hidden,true);assert.equal(f.elements['range-pin'].hidden,false);
});
for(const [name,respond] of [
  ['HTTP 503',async()=>Response.json({error:'offline'},{status:503})],
  ['HTTP 500',async()=>Response.json({error:'offline'},{status:500})],
  ['disconnected',async()=>{throw new TypeError('Failed to fetch');}],
  ['invalid JSON',async()=>new Response('<html>failure</html>')],
  ['missing configuration',async()=>Response.json({})],
  ['invalid levels',async()=>Response.json({...saved,levels:{...saved.levels,S1:0}})],
  ['missing revision',async()=>Response.json({levels:saved.levels,access:saved.access})],
  ['null revision',async()=>Response.json({...saved,revision:null})]
]) test(name+' never presents defaults as saved and recovers without a write',async()=>{
  const f=fixture();f.respond(respond);await f.context.loadSettings();
  unavailable(f);assert.equal(f.config(),null);assert.equal(f.elements['range-support'].textContent,'—');
  assert.match(f.elements['settings-status'].textContent,/unavailable/);
  await f.submit();assert.equal(f.calls.length,1);
  f.respond(async()=>Response.json(saved));await f.context.loadSettings();
  assert.equal(f.config().revision,7);assert.equal(f.config().levels.S1,300);
  assert.equal(f.state.serverReady,true);assert.ok(f.calls.every(call=>call.options.method==='GET'));
});
test('API timeout follows the same unavailable path and retains the bounded request signal',async()=>{
  const f=fixture();f.respond((path,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  const pending=f.context.loadSettings();f.signal.abort(new DOMException('Timed out','TimeoutError'));await pending;
  unavailable(f);assert.equal(f.config(),null);assert.match(f.elements['settings-status'].textContent,/unavailable/);
});
test('refresh failure keeps exact last verified levels/revision, pauses calculations and recovers',async()=>{
  const f=fixture();await f.context.loadSettings();f.context.fillSettings();
  f.respond(async()=>{throw Error('offline');});await f.context.loadSettings();
  unavailable(f);assert.equal(f.config().revision,7);assert.equal(f.elements['range-support'].textContent,'$300.00');
  assert.match(f.elements['settings-status'].textContent,/stale.*last verified/);
  assert.match(f.elements['range-note'].textContent,/Stale/);
  const calls=f.calls.length;await f.submit();assert.equal(f.calls.length,calls);
  f.respond(async()=>Response.json({...saved,revision:8,levels:{...saved.levels,S1:310}}));await f.context.loadSettings();
  assert.equal(f.elements['range-support'].textContent,'$310.00');assert.equal(f.config().revision,8);
  assert.equal(f.elements.fieldset.disabled,false);assert.equal(f.chart.options.levels.length,6);
  assert.doesNotMatch(f.elements['settings-status'].textContent,/stale|unavailable/);
});
test('viewer remains read only and saves keep the editor revision on conflict',async()=>{
  const f=fixture();f.respond(async()=>Response.json({...saved,access:{canManage:false}}));await f.context.loadSettings();
  assert.equal(f.elements['settings-open'].disabled,true);assert.equal(f.elements['settings-signin'].hidden,false);
  f.respond(async()=>Response.json(saved));await f.context.loadSettings();f.context.fillSettings();
  f.respond(async()=>Response.json({error:'Settings were updated elsewhere. Refresh and try again.'},{status:409}));
  await f.submit();assert.equal(JSON.parse(f.calls.at(-1).options.body).expectedRevision,7);
  assert.equal(f.config().revision,7);assert.match(f.elements['settings-error'].textContent,/updated elsewhere/);
});
test('initial HTML does not claim hard-coded levels before JavaScript or settings retrieval',()=>{
  const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
  assert.match(html,/<span id="range-support">—<\/span>/);
  assert.match(html,/<span id="range-resistance">—<\/span>/);
  assert.match(html,/<i id="range-pin" hidden>/);
  assert.doesNotMatch(html,/<input id="level-[^"]+"[^>]*\bvalue=/);
  assert.doesNotMatch(source,/applyConfig\(config\)/);
});
