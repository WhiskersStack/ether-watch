const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/dist/app.js','utf8');
function extract(from,to){const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
test('read-only viewers do not evaluate alerts or consume a pending legacy pause migration',async()=>{
  const calls=[],writes=[],ctx=vm.createContext({state:{serverReady:true,canCheck:false},legacyPaused:true,localStorage:{setItem(key){writes.push(key);}},api:async path=>{calls.push(path);return {config:{revision:1},access:{canManage:false,canCheck:false}};},showMonitor(){},$:()=>({}),renderMonitorStrip(){}});
  vm.runInContext(extract('async function checkAlert()','function renderPosition('),ctx);await ctx.checkAlert();assert.equal(calls.length,0);
  vm.runInContext(extract('async function loadSettings()','applyConfig(config);renderEvents();'),ctx);await ctx.loadSettings();assert.deepEqual(calls,['state']);assert.equal(ctx.legacyPaused,true);assert.deepEqual(writes,[]);
});
test('read-only history persistence preserves an unmigrated local pause',()=>{
  const values={'etherwatch-armed':'false'},ctx=vm.createContext({legacyPaused:true,state:{armed:true,events:[]},localStorage:{setItem:(key,value)=>values[key]=value}});
  vm.runInContext(extract('function persist()','function toast('),ctx);ctx.persist();assert.equal(values['etherwatch-armed'],'false');
});
test('configured owner still migrates the legacy paused preference exactly once',async()=>{
  const calls=[],values={},ctx=vm.createContext({legacyPaused:true,state:{},localStorage:{setItem:(key,value)=>values[key]=value},api:async(path,body)=>{calls.push({path,body});return {config:{revision:path==='state'?1:2},access:{canManage:true,canCheck:true}};},showMonitor(){},$:()=>({})});
  vm.runInContext(extract('async function loadSettings()','applyConfig(config);renderEvents();'),ctx);await ctx.loadSettings();
  assert.deepEqual(calls.map(call=>call.path),['state','config']);assert.equal(calls[1].body.armed,false);assert.equal(calls[1].body.expectedRevision,1);assert.equal(ctx.legacyPaused,false);assert.equal(values['etherwatch-migrated'],'1');
  await ctx.loadSettings();assert.deepEqual(calls.map(call=>call.path),['state','config','state']);
});
test('monitor controls reflect owner permission and sign-in uses a top-level platform route',()=>{
  const elements={},ctx=vm.createContext({Date,state:{serverReady:true,canManage:false,canCheck:false,price:null,background:null,lastCheck:0},config:{armed:true},$:id=>elements[id]??={}});
  vm.runInContext(extract('function renderMonitorStrip()','async function checkAlert()'),ctx);ctx.renderMonitorStrip();
  assert.equal(elements['settings-open'].disabled,true);assert.equal(elements.pause.disabled,true);assert.equal(elements['monitor-signin'].hidden,false);assert.match(elements['monitor-alerts'].textContent,/Read-only/);
  ctx.state.canManage=ctx.state.canCheck=true;ctx.renderMonitorStrip();assert.equal(elements.pause.disabled,false);assert.equal(elements['monitor-signin'].hidden,true);
  const html=fs.readFileSync(__dirname+'/dist/index.html','utf8');assert.match(html,/href="\/signin-with-chatgpt\?return_to=%2F" target="_top"/);
});

const themeHTML=fs.readFileSync(__dirname+'/dist/index.html','utf8');
const themeCSS=fs.readFileSync(__dirname+'/dist/style.css','utf8');
const themeNames=['classic','daylight','midnight','dusk'];
function themeTokens(theme){
  const rules=[...themeCSS.matchAll(/:root(?:\[data-theme="([^"]+)"\])?\s*\{([^}]+)\}/g)];
  const tokens={};
  for(const [,name,body] of rules)if(!name||name===theme)for(const [,key,value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g))tokens[key]=value.trim();
  const resolve=key=>tokens[key]?.startsWith('var(')?resolve(tokens[key].slice(6,-1)):tokens[key];
  return Object.fromEntries(Object.keys(tokens).map(key=>[key,resolve(key)]));
}
function contrast(a,b){
  const luminance=color=>{const rgb=color.slice(1).match(/../g).slice(0,3).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (light+.05)/(dark+.05);
}
for(const theme of themeNames){
  test(theme+' palette keeps text, controls, and chart indicators readable',()=>{
    const t=themeTokens(theme);
    for(const background of ['bg','panel','surface','input','button','chip','selected','monitor','history','decision','primary-from','primary-to'])for(const foreground of ['text','muted','text-soft'])assert.ok(contrast(t[foreground],t[background])>=4.5,theme+' '+foreground+' on '+background+' '+contrast(t[foreground],t[background]));
    for(const foreground of ['green','red','warning','accent'])assert.ok(contrast(t[foreground],t.panel)>=4.5,theme+' '+foreground);
    assert.ok(contrast(t['on-accent'],t.accent)>=4.5);
    for(const background of ['bg','panel','input'])assert.ok(contrast(t['control-border'],t[background])>=3,theme+' control border on '+background);
    for(const key of ['up','down','ema20','ema50','rsi','support','resistance'])assert.ok(contrast(t['chart-'+key],t.panel)>=3,theme+' chart '+key);
    assert.notEqual(t['chart-up'],t['chart-down']);assert.notEqual(t['chart-ema20'],t['chart-ema50']);
  });
  test(theme+' is restored before stylesheet/app loading and updates browser chrome',()=>{
    const boot=themeHTML.match(/<script>([\s\S]*?)<\/script>/)[1],root={dataset:{},style:{}},meta={};
    const ctx=vm.createContext({localStorage:{getItem:key=>key==='etherwatch-theme'?theme:null},document:{documentElement:root,querySelector:()=>meta}});
    vm.runInContext(boot,ctx);
    assert.equal(root.dataset.theme,theme);assert.equal(root.style.colorScheme,theme==='daylight'?'light':'dark');assert.equal(meta.content,themeTokens(theme).bg);
    assert.ok(themeHTML.indexOf(boot)<themeHTML.indexOf('rel="stylesheet"'));
  });
}
test('theme bootstrap safely handles missing, invalid, prototype-name, and denied storage',()=>{
  const boot=themeHTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const saved of [null,'unknown','__proto__','constructor','toString','denied']){
    const root={dataset:{},style:{}},meta={},ctx=vm.createContext({document:{documentElement:root,querySelector:()=>meta}});
    Object.defineProperty(ctx,'localStorage',{get(){if(saved==='denied')throw Error('SecurityError');return {getItem:()=>saved};}});
    vm.runInContext(boot,ctx);assert.equal(root.dataset.theme,'classic');assert.equal(meta.content,'#101315');
  }
});
test('theme selection persists only appearance and repaints without data, alerts, or timers',()=>{
  const stored={'etherwatch-chart':'saved chart preferences','etherwatch-armed':'false','etherwatch-alerts':'saved history','etherwatch-calendar-zone':'UTC'},original={...stored};
  const root={dataset:{theme:'classic'},style:{}},meta={},select={},calls=[];
  const forbidden=()=>{throw Error('Theme change must not touch application effects');};
  const ctx=vm.createContext({document:{documentElement:root,querySelector:()=>meta},$:()=>select,getComputedStyle:()=>({getPropertyValue:()=>themeTokens(root.dataset.theme).bg}),localStorage:{setItem:(k,v)=>stored[k]=v},priceChart:{refreshTheme:()=>calls.push('paint')},fetch:forbidden,api:forbidden,loadSettings:forbidden,refresh:forbidden,refreshGraph:forbidden,checkAlert:forbidden,setInterval:forbidden,setTimeout:forbidden,Notification:forbidden});
  vm.runInContext(extract('function applyTheme(','function persist()'),ctx);
  for(const theme of themeNames){ctx.applyTheme(theme);assert.equal(root.dataset.theme,theme);assert.equal(select.value,theme);assert.equal(stored['etherwatch-theme'],theme);assert.equal(meta.content,themeTokens(theme).bg);}
  assert.equal(calls.length,4);for(const [key,value]of Object.entries(original))assert.equal(stored[key],value);
  ctx.applyTheme('invalid');assert.equal(select.value,'classic');
  ctx.localStorage.setItem=forbidden;ctx.applyTheme('dusk',false);assert.equal(select.value,'dusk');
  Object.defineProperty(ctx,'localStorage',{get(){throw Error('SecurityError');}});ctx.applyTheme('daylight');assert.equal(select.value,'daylight');
});
test('every literal UI binding has a unique markup target',()=>{const html=fs.readFileSync(__dirname+'/dist/index.html','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);for(const match of source.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1]),'Missing markup target '+match[1]);});
test('client news fallback expires sources individually without advancing timestamps',()=>{const now=Date.now(),ctx=vm.createContext({Date,Set});vm.runInContext(extract('function retainNewsSources(','async function refreshNews('),ctx);const data={fetchedAt:new Date(now-1000).toISOString(),sources:[{id:'fresh',fetchedAt:new Date(now-1000).toISOString()},{id:'old',fetchedAt:new Date(now-86400001).toISOString()}],items:[{sourceId:'fresh'},{sourceId:'old'}]};const result=ctx.newsFallback(data,'offline',now);assert.equal(result.items.length,1);assert.equal(result.items[0].sourceId,'fresh');assert.equal(result.sources[1].status,'error');assert.equal(result.fetchedAt,data.fetchedAt);});
test('news fallback preserves original freshness and expires after 24 hours',()=>{const now=Date.now(),ctx=vm.createContext({Date});vm.runInContext(extract('function retainNewsSources(','async function refreshNews('),ctx);const previous={items:[{title:'fixture'}],sources:[{status:'ok'}],fetchedAt:new Date(now-10000).toISOString(),stale:false};const result=ctx.newsFallback(previous,'offline',now);assert.equal(result.stale,true);assert.equal(result.sources[0].status,'stale');assert.equal(result.fetchedAt,previous.fetchedAt);assert.equal(previous.stale,false);assert.equal(ctx.newsFallback(previous,'offline',now+86400000).items.length,0);assert.equal(ctx.newsFallback({...previous,fetchedAt:'bad'},'offline',now).items.length,0);});
function graphContext(load){const elements={};return vm.createContext({Date,document:{hidden:false},$:id=>elements[id]??=( {style:{display:'flex'},classList:{toggle(){}},textContent:'',title:''}),chartPrefs:{timeframe:86400},graphState:{candles:[],granularity:86400,loadedAt:0,generation:0},candleFeed:{load},draw(){},elements});}
test('failed candle refresh keeps the successful chart and exposes its own stale age',async()=>{const candles=[{time:0}],fetchedAt=Date.now()-180000,ctx=graphContext(async()=>({candles,fetchedAt,error:'offline'}));vm.runInContext(extract('function renderChartFreshness(','function filterNews('),ctx);await ctx.refreshGraph();assert.equal(ctx.elements['chart-empty'].style.display,'none');assert.equal(ctx.graphState.candles,candles);assert.match(ctx.elements['chart-freshness'].textContent,/stale/);assert.equal(ctx.elements['chart-freshness'].title,'offline');});
test('late timeframe response and hidden page cannot replace the current chart',async()=>{let resolve,calls=0;const ctx=graphContext(()=>{calls++;return new Promise(done=>resolve=done);});vm.runInContext(extract('function renderChartFreshness(','function filterNews('),ctx);const pending=ctx.refreshGraph();ctx.chartPrefs.timeframe=900;ctx.graphState.generation++;resolve({candles:[{time:0}],fetchedAt:Date.now(),error:null});await pending;assert.equal(ctx.graphState.candles.length,0);ctx.document.hidden=true;await ctx.refreshGraph();assert.equal(calls,1);});
test('news filters overlap topics and treat search punctuation literally before pagination',()=>{const ctx=vm.createContext({newsTopics:{ethereum:'Ethereum & crypto',macro:'Macro',etf:'ETFs'}});vm.runInContext(extract('function filterNews(','function newsRender('),ctx);const items=[{title:'ETH [ETF] update',source:'Fixture',sourceId:'one',topics:['ethereum','macro','etf']},{title:'Other update',source:'Fixture',sourceId:'two',topics:['ethereum']}];assert.equal(ctx.filterNews(items,'macro','one','[ETF]').length,1);assert.equal(ctx.filterNews(items,'etf','all','Ethereum').length,1);assert.equal(ctx.filterNews(items,'macro','two','').length,0);});

test('one expired source cannot clear newer news from another source',()=>{const now=Date.now(),ctx=vm.createContext({Date,Set});vm.runInContext(extract('function retainNewsSources(','async function refreshNews('),ctx);const data={fetchedAt:new Date(now-86400001).toISOString(),sources:[{id:'old',status:'stale',fetchedAt:new Date(now-86400001).toISOString()},{id:'fresh',status:'ok',fetchedAt:new Date(now-1000).toISOString()}],items:[{sourceId:'old'},{sourceId:'fresh'}]};const result=ctx.newsFallback(data,'offline',now);assert.equal(result.items.length,1);assert.equal(result.items[0].sourceId,'fresh');assert.equal(result.sources[1].fetchedAt,data.sources[1].fetchedAt);assert.equal(result.sources[0].status,'error');});

test('fresh news survives bounded device clock differences and later renders',()=>{
  const now=Date.parse('2026-10-19T05:30:00Z'),ctx=vm.createContext({Date,Set});vm.runInContext(extract('function retainNewsSources(','async function refreshNews('),ctx);
  for(const skew of [500,60000]){
    const fetchedAt=new Date(now+skew).toISOString(),data={fetchedAt,sources:[{id:'ethereum',status:'ok',fetchedAt}],items:[{id:'one',sourceId:'ethereum'}],partial:false,stale:false,error:null};
    const retained=ctx.retainNewsSources(data,now);assert.equal(retained.items.length,1);assert.equal(retained.sources[0].status,'ok');assert.equal(retained.fetchedAt,fetchedAt);assert.equal(retained.partial,false);assert.equal(retained.error,null);
    const later=ctx.retainNewsSources(retained,now+skew+1);assert.equal(later.items.length,1);assert.equal(later.sources[0].status,'ok');assert.equal(later.fetchedAt,fetchedAt);assert.equal(data.items.length,1);
    const legacy=ctx.retainNewsSources({...data,sources:[{id:'ethereum',status:'ok'}]},now);assert.equal(legacy.items.length,1);assert.equal(legacy.fetchedAt,fetchedAt);
  }
});
test('invalid verification times reject only their news source with an accurate explanation',()=>{
  const now=Date.parse('2026-10-19T05:30:00Z'),ctx=vm.createContext({Date,Set});vm.runInContext(extract('function retainNewsSources(','async function refreshNews('),ctx);
  for(const fetchedAt of [new Date(now+60001).toISOString(),'invalid']){
    const data={fetchedAt:new Date(now-1000).toISOString(),sources:[{id:'bad',status:'ok',fetchedAt},{id:'good',status:'ok',fetchedAt:new Date(now-1000).toISOString()}],items:[{sourceId:'bad'},{sourceId:'good'}]},result=ctx.retainNewsSources(data,now);
    assert.equal(result.items.length,1);assert.equal(result.items[0].sourceId,'good');assert.equal(result.sources[0].status,'error');assert.equal(result.sources[0].error,'Invalid source verification timestamp');assert.equal(result.sources[1].status,'ok');assert.equal(data.items.length,2);
  }
});
test('news clock tolerance does not extend the 24-hour expiry or hide upstream failures',()=>{
  const now=Date.parse('2026-10-19T05:30:00Z'),ctx=vm.createContext({Date,Set});vm.runInContext(extract('function retainNewsSources(','async function refreshNews('),ctx);
  const fetchedAt=new Date(now+60000).toISOString(),data={fetchedAt,sources:[{id:'ethereum',status:'ok',fetchedAt},{id:'failed',status:'error',fetchedAt:null,error:'HTTP 403'}],items:[{sourceId:'ethereum'},{sourceId:'failed'}]};
  const cached=ctx.newsFallback(data,'offline',now);assert.equal(cached.items.length,1);assert.equal(cached.sources[0].status,'stale');assert.equal(cached.fetchedAt,fetchedAt);assert.equal(cached.sources[1].error,'HTTP 403');
  const boundary=ctx.retainNewsSources(data,now+60000+86400000);assert.equal(boundary.items.length,1);assert.equal(boundary.fetchedAt,fetchedAt);
  const expired=ctx.retainNewsSources(data,now+60000+86400001);assert.equal(expired.items.length,0);assert.equal(expired.sources[0].error,'Cached source expired');assert.equal(expired.fetchedAt,null);
});

test('expanded chart closes before the selected story receives focus',async()=>{let closeHandler,closed=false,focused=false;const card={dataset:{newsId:'one'},focus(){assert.ok(closed,'Background story is inert until modal closes');focused=true;},scrollIntoView(){assert.ok(focused);}};const dialog={open:true,addEventListener(name,handler){assert.equal(name,'close');closeHandler=handler;},close(){this.open=false;Promise.resolve().then(()=>{closed=true;closeHandler();});}};const elements={'expanded-chart-dialog':dialog,'news-filter':{},'news-source':{},'news-search':{},'news-selection':{},'news-list':{children:[card]}};const ctx=vm.createContext({Date,Math,Promise,$:id=>elements[id],newsState:{data:{items:[{id:'one',title:'Fixture',publishedAt:new Date().toISOString()}]}},newsRender(){}});vm.runInContext(extract('async function selectNewsEvent(','function focusNews('),ctx);await ctx.selectNewsEvent({id:'one'});assert.ok(focused);});

async function alertSettingsContext(overrides={}){
  const {DEFAULT_CONFIG,validateConfig}=await import('./dist/rules.mjs');
  const config=validateConfig({...structuredClone(DEFAULT_CONFIG),mode:'close',revision:7,armed:false,retestTolerance:0.4,retestCandles:4,...overrides});
  const elements={},ctx=vm.createContext({DEFAULT_CONFIG,validateConfig,config,editingConfig:null,structuredClone,elements,$:id=>elements[id]??={value:'',checked:false,disabled:false,textContent:''}});
  vm.runInContext(extract('function syncVolumeConfirmation(',"$('settings-open').addEventListener("),ctx);
  return ctx;
}
test('alert editor preserves revision, pause, retest fields and selected optional rules',async()=>{
  const ctx=await alertSettingsContext({selectedLevels:['S3','R3'],proximity:{enabled:true,distancePercent:0.75},volumeConfirmation:{enabled:true,lookbackCandles:20,minRelativeVolume:1.5}});
  ctx.fillSettings();const next=ctx.readSettings();
  assert.deepEqual(next.selectedLevels,['S3','R3']);assert.equal(next.proximity.distancePercent,0.75);assert.equal(next.proximity.enabled,true);assert.equal(next.volumeConfirmation.enabled,true);
  assert.equal(next.revision,7);assert.equal(next.armed,false);assert.equal(next.retestTolerance,0.4);assert.equal(next.retestCandles,4);
  assert.equal(ctx.elements['alert-level-S1'].checked,false);assert.equal(ctx.elements['volume-confirmation'].disabled,false);
});
test('immediate mode clears and disables daily-volume confirmation before save',async()=>{
  const ctx=await alertSettingsContext({volumeConfirmation:{enabled:true,lookbackCandles:20,minRelativeVolume:1.5}});
  ctx.fillSettings();ctx.elements['alert-mode'].value='immediate';ctx.syncVolumeConfirmation();
  assert.equal(ctx.elements['volume-confirmation'].disabled,true);assert.equal(ctx.elements['volume-confirmation'].checked,false);assert.match(ctx.elements['volume-confirmation-note'].textContent,/off in immediate mode/);
  ctx.elements['volume-confirmation'].checked=true;
  assert.equal(ctx.readSettings().volumeConfirmation.enabled,false);
  ctx.elements['alert-mode'].value='retest';ctx.syncVolumeConfirmation();assert.equal(ctx.elements['volume-confirmation'].disabled,false);
});
test('reset restores editable rule defaults while keeping the editing revision and saved pause state',async()=>{
  const ctx=await alertSettingsContext({selectedLevels:['S3','R3'],proximity:{enabled:true,distancePercent:2},volumeConfirmation:{enabled:true,lookbackCandles:20,minRelativeVolume:1.5}});
  ctx.fillSettings();ctx.resetSettings();const next=ctx.readSettings();
  assert.deepEqual(next.selectedLevels,['S1','R1']);assert.equal(next.proximity.enabled,false);assert.equal(next.proximity.distancePercent,0.5);assert.equal(next.volumeConfirmation.enabled,false);assert.equal(next.mode,'immediate');
  assert.equal(next.revision,7);assert.equal(next.armed,false);assert.equal(ctx.editingConfig.revision,7);
});
test('editor rejects empty selections, blank cooldowns and nonpositive proximity distances',async()=>{
  const ctx=await alertSettingsContext();ctx.fillSettings();
  for(const id of Object.keys(ctx.DEFAULT_CONFIG.levels))ctx.elements['alert-level-'+id].checked=false;
  assert.throws(()=>ctx.readSettings(),/at least one/);
  ctx.fillSettings();ctx.elements['cooldown-minutes'].value='';assert.throws(()=>ctx.readSettings(),/finite number/);
  ctx.fillSettings();ctx.elements['proximity-distance'].value='0';assert.throws(()=>ctx.readSettings(),/positive percentage/);
  ctx.elements['proximity-distance'].value='';assert.throws(()=>ctx.readSettings(),/finite number/);
});
function alertHistoryContext(){
  const ctx=vm.createContext({Date,Set,levelNames:{S3:'Support 3',S2:'Support 2',S1:'Immediate support',R1:'Immediate resistance',R2:'Resistance 2',R3:'Resistance 3'},config:{levels:{S1:9999}}});
  const declarations=source.split(/\r?\n/).filter(line=>line.startsWith('const escapeHTML = ')||line.startsWith('const usd = ')).join('\n');
  vm.runInContext(declarations+'\n'+extract('function validHistoryRecord(','async function api('),ctx);
  return ctx;
}
test('history filters use recorded metadata and distinguish local, reported and proximity events',()=>{
  const ctx=alertHistoryContext(),records=[{id:'a',rule:'S1',kind:'breach',delivery:'reported'},{id:'b',rule:'R3',kind:'proximity',delivery:'pending'},{id:'old',message:'Legacy'}];
  assert.deepEqual(ctx.filterHistory(records,'S1','breach','reported').map(row=>row.id),['a']);
  assert.deepEqual(ctx.filterHistory(records,'R3','proximity','pending').map(row=>row.id),['b']);
  assert.deepEqual(ctx.filterHistory(records,'unrecorded','unrecorded','local').map(row=>row.id),['old']);
});
test('legacy history never borrows current levels and recorded evidence is escaped',()=>{
  const ctx=alertHistoryContext(),legacy=ctx.historyRecordMarkup({message:'<img src=x onerror=alert(1)> & legacy',time:1000});
  assert.match(legacy,/Not recorded/);assert.doesNotMatch(legacy,/9999|<img/);assert.match(legacy,/&lt;img/);
  const recorded=ctx.historyRecordMarkup({id:'event',message:'Recorded signal',time:1000,rule:'S1',kind:'breach',levelPrice:2416,evaluatedAt:2000,candleTime:0,mode:'close',revision:3,delivery:'reported',evidence:{relativeVolume:1.7,volumeSource:'<script>bad</script>'}});
  assert.match(recorded,/\$2,416\.00/);assert.match(recorded,/Acknowledged by Codex/);assert.match(recorded,/1970-01-01 00:00:00 UTC/);assert.match(recorded,/1\.7/);assert.match(recorded,/&lt;script&gt;/);assert.doesNotMatch(recorded,/<script>/);
  const html=fs.readFileSync(__dirname+'/dist/index.html','utf8');assert.match(html,/does not confirm an OS notification was received/);
});
test('server history merges updated delivery states without clearing old records and retains the latest 200',()=>{
  const ctx=alertHistoryContext(),old={message:'Legacy alert',time:1},pending={id:'one',message:'Signal',time:3,delivery:'pending'};
  const records=ctx.mergeHistoryRecords([{...pending,delivery:'reported'}],[pending,old]);
  assert.equal(records.length,2);assert.equal(records[0].delivery,'reported');assert.ok(records.includes(old));
  const many=ctx.mergeHistoryRecords(Array.from({length:205},(_,i)=>({id:'event-'+i,message:'Signal '+i,time:i})),[]);
  assert.equal(many.length,200);assert.equal(many[0].time,204);assert.equal(many.at(-1).time,5);
});
test('browser history persistence keeps 50 while retaining 200 in active memory',()=>{
  const values={},state={armed:true,events:Array.from({length:200},(_,i)=>({message:'Signal '+i,time:i}))},ctx=vm.createContext({state,legacyPaused:false,localStorage:{setItem(key,value){values[key]=value;}}});
  vm.runInContext(extract('function persist()','function toast('),ctx);ctx.persist();
  assert.equal(JSON.parse(values['etherwatch-alerts']).length,50);assert.equal(state.events.length,200);
});
test('decisions remain separate from alerts and never trigger browser notification delivery',()=>{
  const ctx=alertHistoryContext(),elements={};let toasts=0;
  Object.assign(ctx,{state:{events:[],decisions:[],seen:new Set(),bootstrapped:true},$:id=>elements[id]??={textContent:''},renderEvents(){},renderDecisions(){},persist(){},renderMonitorStrip(){},toast(){toasts++;}});
  vm.runInContext(extract('function showMonitor(','function renderMonitorStrip('),ctx);
  ctx.showMonitor({events:[],decisions:[{id:'decision',message:'Cooldown suppression',time:Date.now(),rule:'S1',kind:'breach',reason:'cooldown'}]},true);
  assert.equal(ctx.state.events.length,0);assert.equal(ctx.state.decisions.length,1);assert.equal(toasts,0);
});
