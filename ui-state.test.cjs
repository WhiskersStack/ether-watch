const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/dist/app.js','utf8');
function extract(from,to){const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const themeHTML=fs.readFileSync(__dirname+'/dist/index.html','utf8');
const themeCSS=fs.readFileSync(__dirname+'/dist/style.css','utf8');
const themeNames=['classic'];
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
  test(theme+' is declared before styles and remains the only available palette',()=>{
    assert.match(themeHTML,/<html\b[^>]*data-theme="classic"/);
    assert.match(themeHTML,new RegExp('<meta name="theme-color" content="'+themeTokens(theme).bg+'"'));
    assert.match(themeCSS,/:root\s*\{\s*color-scheme:\s*dark;/);
    assert.ok(themeHTML.indexOf('data-theme="classic"')<themeHTML.indexOf('rel="stylesheet"'));
    assert.doesNotMatch(themeHTML,/theme-select|theme-control/);
    assert.doesNotMatch(themeCSS,/data-theme="(?:daylight|midnight|dusk)"|theme-control/);
    assert.doesNotMatch(source,/applyTheme|theme-select/);
  });
}

test('Classic startup migrates old themes while preserving other preferences and avoiding application effects',()=>{
  const boot=themeHTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  const original={'etherwatch-chart':'saved chart preferences','etherwatch-armed':'false','etherwatch-alerts':'saved history','etherwatch-calendar-zone':'UTC'};
  const forbidden=()=>{throw Error('Appearance migration must not touch application effects');};
  for(const saved of [null,'classic','daylight','midnight','dusk','unknown','__proto__','constructor','toString']){
    const stored={...original,'etherwatch-theme':saved},writes=[];
    const ctx=vm.createContext({localStorage:{getItem:key=>stored[key]??null,setItem:(key,value)=>{writes.push(key);stored[key]=value;}},fetch:forbidden,api:forbidden,loadSettings:forbidden,refresh:forbidden,refreshGraph:forbidden,checkAlert:forbidden,setInterval:forbidden,setTimeout:forbidden,Notification:forbidden});
    vm.runInContext(boot,ctx);vm.runInContext(boot,ctx);
    assert.equal(stored['etherwatch-theme'],'classic');
    assert.deepEqual(writes,saved==='classic'?[]:['etherwatch-theme']);
    for(const [key,value] of Object.entries(original))assert.equal(stored[key],value);
  }
});

test('Classic startup tolerates denied storage access, reads, and writes',()=>{
  const boot=themeHTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const failure of ['access','read','write']){
    const ctx=vm.createContext({});
    Object.defineProperty(ctx,'localStorage',{get(){if(failure==='access')throw Error('SecurityError');return {getItem(){if(failure==='read')throw Error('SecurityError');return 'dusk';},setItem(){throw Error('QuotaExceededError');}};}});
    assert.doesNotThrow(()=>vm.runInContext(boot,ctx));
  }
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

test('expanded chart closes before the selected story receives focus',async()=>{let closeHandler,closed=false,focused=false;const card={dataset:{newsId:'one'},focus(){assert.ok(closed,'Background story is inert until modal closes');focused=true;},scrollIntoView(){assert.ok(focused);}};const dialog={open:true,addEventListener(name,handler){assert.equal(name,'close');closeHandler=handler;},close(){this.open=false;Promise.resolve().then(()=>{closed=true;closeHandler();});}};const elements={'expanded-chart-dialog':dialog,'news-filter':{},'news-source':{},'news-search':{},'news-selection':{},'news-list':{children:[card]}};const ctx=vm.createContext({Date,Math,Promise,newsPageSize:()=>6,$:id=>elements[id],newsState:{data:{items:[{id:'one',title:'Fixture',publishedAt:new Date().toISOString()}]}},newsRender(){}});vm.runInContext(extract('async function selectNewsEvent(','function focusNews('),ctx);await ctx.selectNewsEvent({id:'one'});assert.ok(focused);});
