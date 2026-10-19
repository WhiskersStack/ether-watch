const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/dist/app.js','utf8');
function context(){
  const elements={},state={price:null,candles:[],stats:null,lastStats:0,statsError:null,lastCandles:0,dailyError:null,lastSuccess:0,lastTicker:0,tickerError:null,busy:false,aggregateVolume:null,volumeError:null,volumeBusy:false,lastVolumeAttempt:0};
  const ctx=vm.createContext({Date,Number,Math,Promise,AbortSignal,state,elements,chartPrefs:{timeframe:900},candleFeed:{load:async()=>({candles:state.candles,fetchedAt:Date.now(),error:null})},$:id=>elements[id]??={textContent:'',className:'',title:'',style:{},setAttribute(key,value){this[key]=value;}},usd:n=>'$'+n,short:n=>'$'+Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n),acceptTicker:t=>({price:Number(t.price),time:Date.parse(t.time)}),renderPosition(){},renderLevels(){},draw(){}});
  vm.runInContext(source.slice(source.indexOf('function ema('),source.indexOf('function volumeProfile(')),ctx);
  return ctx;
}
function daily(count=50){const end=Math.floor(Date.now()/86400000)*86400-86400;return Array.from({length:count},(_,i)=>({time:end-(count-1-i)*86400,low:90+i,high:110+i,open:100+i,close:100+i,volume:100}));}
const stats={open:'100',volume:'20'};
const ticker=()=>({price:'110',time:new Date().toISOString()});
test('stats failure retains values with explicit stale labels while the ticker remains live',async()=>{
  const ctx=context();ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  ctx.request=async path=>{if(path==='stats')throw Error('HTTP 503');return ticker();};await ctx.refresh();
  assert.match(ctx.elements.connection.textContent,/Live/);assert.match(ctx.elements.change.textContent,/stale/i);
});
test('malformed stats cannot become a zero volume or replace a successful snapshot',async()=>{
  const ctx=context();ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  ctx.request=async path=>path==='ticker'?ticker():{open:'',volume:null};await ctx.refresh();
  assert.equal(Number(ctx.state.stats.volume),20);assert.match(ctx.elements.change.textContent,/stale/i);
});
test('first stats failure is explicitly unavailable and subsequent recovery clears stale state',async()=>{
  const ctx=context();ctx.request=async path=>{if(path==='stats')throw Error('offline');return ticker();};await ctx.refresh();
  assert.match(ctx.elements.change.textContent,/unavailable/i);
  ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  assert.doesNotMatch(ctx.elements.change.textContent,/stale/i);
});
test('failed ticker with successful stats preserves the price and marks 24h change stale',async()=>{
  const ctx=context();ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  const price=ctx.state.price,time=ctx.state.lastSuccess;
  ctx.request=async path=>{if(path==='ticker')throw Error('Ticker unavailable');return {open:'105',volume:'30'};};await ctx.refresh();
  assert.equal(ctx.state.price,price);assert.equal(ctx.state.lastSuccess,time);assert.equal(ctx.state.tickerError,'Ticker unavailable');assert.equal(ctx.state.statsError,null);
  assert.match(ctx.elements.change.textContent,/stale/i);assert.equal(ctx.elements.change.className,'muted');assert.match(ctx.elements.change.title,/Ticker unavailable/);
});
test('24h change clears stale state only after both ticker and stats recover',async()=>{
  const ctx=context();ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  ctx.request=async()=>{throw Error('offline');};await ctx.refresh();
  ctx.request=async path=>{if(path==='stats')throw Error('stats offline');return ticker();};await ctx.refresh();
  assert.equal(ctx.state.tickerError,null);assert.equal(ctx.state.statsError,'stats offline');assert.match(ctx.elements.change.textContent,/stale/i);
  ctx.request=async path=>{if(path==='ticker')throw Error('ticker offline');return stats;};await ctx.refresh();
  assert.equal(ctx.state.statsError,null);assert.equal(ctx.state.tickerError,'ticker offline');assert.match(ctx.elements.change.textContent,/stale/i);
  ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  assert.equal(ctx.state.tickerError,null);assert.equal(ctx.state.statsError,null);assert.doesNotMatch(ctx.elements.change.textContent,/stale/i);assert.equal(ctx.elements.connection.title,'');
});
test('invalid ticker responses cannot refresh old price or make 24h change fresh',async()=>{
  const {acceptTicker}=await import('./dist/rules.mjs');
  const ctx=context();ctx.acceptTicker=acceptTicker;ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  const price=ctx.state.price,time=ctx.state.lastTicker;
  for(const invalid of [{price:'NaN',time:new Date().toISOString()},{price:'0',time:new Date().toISOString()},{price:'120',time:new Date(Date.now()-120001).toISOString()}]){
    ctx.request=async path=>path==='ticker'?invalid:stats;await ctx.refresh();
    assert.equal(ctx.state.price,price);assert.equal(ctx.state.lastTicker,time);assert.ok(ctx.state.tickerError);assert.match(ctx.elements.change.textContent,/stale/i);
  }
  ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();assert.equal(ctx.state.tickerError,null);assert.doesNotMatch(ctx.elements.change.textContent,/stale/i);
});
test('24h change becomes stale when either input or ticker retrieval reaches 45 seconds',async()=>{
  const ctx=context();ctx.request=async path=>path==='ticker'?ticker():stats;await ctx.refresh();
  for(const key of ['lastStats','lastSuccess','lastTicker']){
    ctx.state.lastStats=ctx.state.lastSuccess=ctx.state.lastTicker=Date.now();ctx.state[key]=Date.now()-45000;ctx.renderStats();
    assert.match(ctx.elements.change.textContent,/stale/i,key);assert.equal(ctx.elements.change.className,'muted');
  }
  ctx.state.lastStats=ctx.state.lastSuccess=ctx.state.lastTicker=Date.now();ctx.renderStats();assert.doesNotMatch(ctx.elements.change.textContent,/stale/i);
});
test('first ticker failure leaves 24h change unavailable even if stats succeeded',async()=>{
  const ctx=context();ctx.request=async path=>{if(path==='ticker')throw Error('offline');return stats;};await ctx.refresh();
  assert.equal(ctx.state.price,null);assert.match(ctx.elements.change.textContent,/unavailable/i);assert.equal(ctx.elements.change.className,'muted');
});
test('overview indicators restart after a missing day and clear old warmup values',()=>{
  const ctx=context();ctx.state.candles=daily();ctx.indicators();assert.match(ctx.elements.momentum.textContent,/100/);
  ctx.state.candles=ctx.state.candles.filter((_,i)=>i!==47);ctx.indicators();
  assert.equal(ctx.elements.momentum.textContent,'—');assert.equal(ctx.elements.macd.textContent,'—');assert.equal(ctx.elements.rvol.textContent,'—');assert.equal(ctx.elements['rsi-bar'].style.width,'0%');
});
test('a successful response missing yesterday is stale even when the graph interval is intraday',async()=>{
  const ctx=context();ctx.state.candles=daily().slice(0,-1);ctx.request=async path=>path==='ticker'?ticker():stats;
  await ctx.refresh();assert.match(ctx.elements['daily-freshness'].textContent,/stale/i);
});
test('overview RSI matches the Wilder reference example',()=>{
  const ctx=context();
  assert.ok(Math.abs(ctx.rsi([44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28])-70.46413502109705)<1e-9);
});
test('overview MACD and RSI agree with the chart for complete daily history',async()=>{
  const {calculateChartIndicators}=await import('./dist/chart.mjs');
  const ctx=context();ctx.state.candles=daily(80).map((row,i)=>({...row,close:100+Math.sin(i)*8+i/3}));
  ctx.indicators();const chart=calculateChartIndicators(ctx.state.candles);
  assert.ok(ctx.elements.momentum.textContent.startsWith(chart.rsi.at(-1).toFixed(1)));
  assert.ok(ctx.elements.macd.textContent.includes(chart.histogram.at(-1).toFixed(2)));
});
test('one completed candle cannot generate invalid sparkline coordinates',()=>{
  const ctx=context();ctx.state.candles=daily(1);ctx.indicators();
  assert.doesNotMatch(ctx.elements.spark.d,/NaN|Infinity/);
});

const aggregate=()=>({asset:'ETH',currency:'USD',scope:'aggregate',source:'CoinMarketCap',sourceId:'coinmarketcap',sourceUrl:'https://coinmarketcap.com/currencies/ethereum/',volumeUsd:15.52e9,sourceUpdatedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),stale:false,error:null});
test('headline uses CoinMarketCap aggregate dollars independently of Coinbase price and stats',async()=>{
  const ctx=context();ctx.api=async()=>aggregate();await ctx.refreshVolume();assert.equal(ctx.elements.volume.textContent,'$15.52B');
  assert.equal(ctx.elements['volume-note'].textContent,'ETH spot volume · rolling 24h · USD');assert.equal(ctx.elements['volume-source'].textContent,'CoinMarketCap');
  assert.match(ctx.elements['volume-updated'].textContent,/^Provider updated /);assert.match(ctx.elements['volume-freshness'].textContent,/^Fetched /);
  ctx.state.price=1;ctx.state.stats={open:1,volume:900000};ctx.state.lastStats=Date.now();ctx.renderStats();assert.equal(ctx.elements.volume.textContent,'$15.52B');
  ctx.state.statsError='offline';ctx.renderStats();assert.doesNotMatch(ctx.elements['volume-note'].textContent,/stale/i);
});
test('aggregate outage never falls back to exchange volume; recovery clears stale state',async()=>{
  const ctx=context();ctx.state.price=2500;ctx.state.stats={open:2400,volume:30000};ctx.api=async()=>{throw Error('offline');};await ctx.refreshVolume(true);ctx.renderStats();assert.equal(ctx.elements.volume.textContent,'—');assert.match(ctx.elements['volume-note'].textContent,/unavailable/i);
  ctx.api=async()=>aggregate();await ctx.refreshVolume(true);const time=ctx.state.aggregateVolume.fetchedAt;
  ctx.api=async()=>({...aggregate(),volumeUsd:null});await ctx.refreshVolume(true);assert.equal(ctx.elements.volume.textContent,'$15.52B');assert.match(ctx.elements['volume-note'].textContent,/stale/i);assert.equal(ctx.state.aggregateVolume.fetchedAt,time);
  ctx.api=async()=>({...aggregate(),volumeUsd:16.2e9});await ctx.refreshVolume(true);assert.equal(ctx.elements.volume.textContent,'$16.2B');assert.doesNotMatch(ctx.elements['volume-note'].textContent,/stale/i);
});
test('old aggregate snapshots expire by provider update or retrieval and independent polling is throttled',async()=>{
  const ctx=context();let calls=0;ctx.api=async()=>{calls++;return aggregate();};await ctx.refreshVolume();await ctx.refreshVolume();assert.equal(calls,1);
  for(const key of ['sourceUpdatedAt','fetchedAt']){ctx.state.aggregateVolume=aggregate();ctx.state.aggregateVolume[key]=new Date(Date.now()-3600000).toISOString();ctx.renderVolume();assert.equal(ctx.elements.volume.textContent,'—');assert.match(ctx.elements['volume-note'].textContent,/unavailable/i);}
  await ctx.refreshVolume(true);assert.equal(calls,2);assert.equal(ctx.elements.volume.textContent,'$15.52B');
});

test('aggregate rejects other providers, wrong scope, invalid values and unsafe source links',async()=>{
  const ctx=context();ctx.api=async()=>aggregate();await ctx.refreshVolume(true);const stored=ctx.state.aggregateVolume;
  for(const patch of [{source:'CoinGecko',sourceId:'coingecko',sourceUrl:'https://www.coingecko.com/en/coins/ethereum'},{sourceId:'tradingview'},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://coinmarketcap.com.evil.example/currencies/ethereum/'},{asset:'BTC'},{currency:'ILS'},{scope:'exchange'},{volumeUsd:0},{volumeUsd:-1},{volumeUsd:'15520000000'},{volumeUsd:Infinity},{volumeUsd:Number.MAX_SAFE_INTEGER+1}]){
    ctx.api=async()=>({...aggregate(),...patch});await ctx.refreshVolume(true);assert.equal(ctx.state.aggregateVolume,stored);assert.equal(ctx.elements.volume.textContent,'$15.52B');assert.match(ctx.elements['volume-note'].textContent,/stale/);assert.equal(ctx.elements['volume-source'].href,'https://coinmarketcap.com/currencies/ethereum/');
  }
});
test('aggregate validates both timestamps and allows at most 60 seconds of future skew',async()=>{
  const ctx=context();ctx.api=async()=>aggregate();await ctx.refreshVolume(true);const stored=ctx.state.aggregateVolume;
  for(const key of ['sourceUpdatedAt','fetchedAt'])for(const value of [null,'bad date',[new Date().toISOString()],new Date(Date.now()+61000).toISOString(),new Date(Date.now()-3600000).toISOString()]){
    ctx.api=async()=>({...aggregate(),[key]:value});await ctx.refreshVolume(true);assert.equal(ctx.state.aggregateVolume,stored);assert.match(ctx.elements['volume-note'].textContent,/stale/);
  }
  ctx.api=async()=>({...aggregate(),sourceUpdatedAt:new Date(Date.now()+59000).toISOString(),fetchedAt:new Date(Date.now()+59000).toISOString()});await ctx.refreshVolume(true);assert.equal(ctx.elements.volume.textContent,'$15.52B');assert.doesNotMatch(ctx.elements['volume-note'].textContent,/stale|unavailable/);
});
test('cached aggregate reports provider staleness without relabeling old data as fresh',async()=>{
  const ctx=context(),data={...aggregate(),sourceUpdatedAt:new Date(Date.now()-300000).toISOString(),fetchedAt:new Date(Date.now()-120000).toISOString(),stale:true,error:'Provider unavailable'};
  ctx.api=async()=>data;await ctx.refreshVolume(true);assert.equal(ctx.elements.volume.textContent,'$15.52B');assert.match(ctx.elements['volume-note'].textContent,/stale/);assert.equal(ctx.state.aggregateVolume.sourceUpdatedAt,data.sourceUpdatedAt);assert.equal(ctx.state.aggregateVolume.fetchedAt,data.fetchedAt);
  assert.equal(ctx.elements['volume-updated'].textContent,'Provider updated '+new Date(data.sourceUpdatedAt).toLocaleTimeString());assert.equal(ctx.elements['volume-freshness'].textContent,'Fetched '+new Date(data.fetchedAt).toLocaleTimeString());
});
