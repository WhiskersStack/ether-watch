'use strict';
import { DEFAULT_CONFIG, validateConfig, acceptTicker } from './rules.mjs';
import { PriceChart, DEFAULT_CHART_OPTIONS } from './chart.mjs';
import { createCandleFeed } from './market-data.mjs';
import { mountCalendar } from './calendar-ui.mjs';
const $ = id => document.getElementById(id);
const levelNames={R3:'Resistance 3',R2:'Resistance 2',R1:'Immediate resistance',S1:'Immediate support',S2:'Support 2',S3:'Support 3'};
let config=structuredClone(DEFAULT_CONFIG),levels=[];
let editingConfig=null,legacyPaused=false;
let chartPrefs={...DEFAULT_CHART_OPTIONS,timeframe:86400,bars:90};
try{const saved=JSON.parse(localStorage.getItem('etherwatch-chart')||'{}');for(const key of ['ema','volume','profile','levels','flips','rsi','macd','news'])if(typeof saved[key]==='boolean')chartPrefs[key]=saved[key];if(['candles','line'].includes(saved.type))chartPrefs.type=saved.type;if(['linear','log'].includes(saved.scale))chartPrefs.scale=saved.scale;if(['levels','candles'].includes(saved.fit))chartPrefs.fit=saved.fit;if([900,3600,86400].includes(saved.timeframe))chartPrefs.timeframe=saved.timeframe;if([30,90,180].includes(saved.bars))chartPrefs.bars=saved.bars;}catch{}
const priceChart=new PriceChart($('chart'),{tooltip:$('tooltip'),onProfile:poc=>{$('poc').textContent=Number.isFinite(poc)?poc.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}):'—';},onEventSelect:group=>selectNewsGroup(group)});
const graphState={candles:[],granularity:chartPrefs.timeframe,loadedAt:0,generation:0,busy:false};
const newsState={data:null,busy:false,visible:6,selected:null};
const candleFeed=createCandleFeed({fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})});
const newsTopics={ethereum:'Ethereum & crypto',macro:'Macro',network:'Network upgrades',etf:'ETFs',regulation:'Regulation',security:'Security'};
try{legacyPaused=localStorage.getItem('etherwatch-armed')==='false'&&!localStorage.getItem('etherwatch-migrated');}catch{}
const state = {price:null,candles:[],days:90,armed:true,events:[],decisions:[],lastSuccess:0,lastTicker:0,tickerError:null,lastCandles:0,dailyError:null,busy:false,chartData:[],stats:null,lastStats:0,statsError:null,aggregateVolume:null,volumeError:null,volumeBusy:false,lastVolumeAttempt:0,serverReady:false,canManage:false,canCheck:false,seen:new Set(),bootstrapped:false,background:null,lastCheck:0};
const usd = n => Number.isFinite(n) ? n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
const short = n => Number.isFinite(n) ? '$'+Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n) : '—';
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try {state.events=JSON.parse(localStorage.getItem('etherwatch-alerts')||'[]').filter(e=>e&&typeof e.message==='string'&&Number.isFinite(e.time)).slice(0,50);state.armed=localStorage.getItem('etherwatch-armed')!=='false';} catch {}
// Appearance changes never load data, save alert rules, or recreate the chart.
function applyTheme(value, persistChoice = true) {
  const theme = ['classic','daylight','midnight','dusk'].includes(value) ? value : 'classic';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'daylight' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('theme-select').value = theme;
  if (persistChoice) { try { localStorage.setItem('etherwatch-theme', theme); } catch {} }
  priceChart.refreshTheme();
}
function persist(){try{localStorage.setItem('etherwatch-alerts',JSON.stringify(state.events.slice(0,50)));if(!legacyPaused)localStorage.setItem('etherwatch-armed',String(state.armed));}catch{}}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',7000);}
function validHistoryRecord(record){return record&&typeof record.message==='string'&&Number.isFinite(record.time);}
function historyRecordId(record){return record.id||record.time+':'+record.message;}
function historyLevel(record){return Object.hasOwn(levelNames,record.rule)?record.rule:'unrecorded';}
function historyKind(record){return ['breach','proximity'].includes(record.kind)?record.kind:'unrecorded';}
function historyDelivery(record){return record.delivery||'local';}
function filterHistory(records,level,kind,delivery='all'){return records.filter(record=>(level==='all'||historyLevel(record)===level)&&(kind==='all'||historyKind(record)===kind)&&(delivery==='all'||historyDelivery(record)===delivery));}
function mergeHistoryRecords(incoming,previous,limit=200){
  const records=[];
  for(const record of [...incoming,...previous]){
    if(!validHistoryRecord(record)||records.some(saved=>record.id&&saved.id?saved.id===record.id:saved.time===record.time&&saved.message===record.message))continue;
    records.push(record);
  }
  return records.sort((a,b)=>b.time-a.time).slice(0,limit);
}
function historyTime(value,utc=false){
  if(!Number.isFinite(value))return 'Not recorded';
  const date=new Date(utc?value*1000:value);
  if(!Number.isFinite(date.getTime()))return 'Not recorded';
  return utc?date.toISOString().replace('T',' ').replace('.000Z',' UTC'):date.toLocaleString();
}
function historyEvidence(record){
  const evidence=record.evidence;
  if(!evidence||typeof evidence!=='object')return 'Not recorded';
  const labels={distancePercent:'Distance at evaluation (%)',thresholdPercent:'Proximity threshold (%)',relativeVolume:'Relative volume (×)',minRelativeVolume:'Required relative volume (×)',candleVolume:'Signal candle volume (ETH)',averageVolume:'Preceding average volume (ETH)',lookbackCandles:'Completed daily lookback',volumeSource:'Volume source'};
  const parts=[];
  for(const [key,label] of Object.entries(labels)){
    const value=evidence[key];
    if(typeof value==='number'&&Number.isFinite(value))parts.push(label+': '+value.toLocaleString('en-US',{maximumFractionDigits:6}));
    else if(typeof value==='string'&&value)parts.push(label+': '+value);
  }
  return parts.join(' · ')||'Not recorded';
}
function historyRecordMarkup(record,open=false,decision=false){
  const delivery={pending:'Pending Codex report',reported:'Acknowledged by Codex',cancelled:'Cancelled after settings change',local:'Saved in this browser'}[historyDelivery(record)]||'Not recorded';
  const fields=[
    ['Recorded level',historyLevel(record)==='unrecorded'?'Not recorded':historyLevel(record)],
    ['Historical level price',Number.isFinite(record.levelPrice)&&record.levelPrice>0?usd(record.levelPrice):'Not recorded'],
    ['Evaluated at',historyTime(record.evaluatedAt)],
    ['Candle start',historyTime(record.candleTime,true)],
    ['Signal',{breach:'Breach',proximity:'Proximity'}[historyKind(record)]||'Not recorded'],
    ['Mode',{immediate:'Immediate breach',close:'Completed daily close',retest:'Daily retest'}[record.mode]||'Not recorded'],
    ['Configuration revision',Number.isSafeInteger(record.revision)&&record.revision>0?String(record.revision):'Not recorded'],
    [decision?'Decision reason':'Delivery',decision?(typeof record.reason==='string'?record.reason:'Not recorded'):delivery],
    ['Evidence',historyEvidence(record)]
  ];
  return '<details class="event history-record'+(decision?' decision-record':'')+'" data-history-id="'+escapeHTML(historyRecordId(record))+'"'+(open?' open':'')+'><summary><span class="history-message">'+escapeHTML(record.message)+'</span><small>'+escapeHTML(historyTime(record.time))+' · '+escapeHTML(decision?'Evaluation decision':delivery)+'</small></summary><dl class="history-details">'+fields.map(([label,value])=>'<div><dt>'+escapeHTML(label)+'</dt><dd>'+escapeHTML(value)+'</dd></div>').join('')+'</dl></details>';
}
function renderHistoryList(list,records,empty,decision=false){
  const key=JSON.stringify(records);
  if(list.dataset.historyKey===key)return;
  const open=new Set([...list.querySelectorAll('details[open]')].map(record=>record.dataset.historyId));
  list.innerHTML=records.length?records.map(record=>historyRecordMarkup(record,open.has(String(historyRecordId(record))),decision)).join(''):'<div class="empty-alert">'+escapeHTML(empty)+'</div>';
  list.dataset.historyKey=key;
}
function renderEvents(){
  $('alert-count').textContent=state.events.length;
  const records=filterHistory(state.events,$('history-level').value,$('history-kind').value,$('history-delivery').value);
  $('history-count').textContent='Showing '+records.length+' of '+state.events.length+' saved alerts · latest 200 server records; latest 50 kept in this browser';
  renderHistoryList($('alert-list'),records,state.events.length?'No alerts match these filters.':'All quiet for now. New threshold breaches will appear here.');
}
function renderDecisions(){
  $('decision-count').textContent=state.decisions.length;
  const records=filterHistory(state.decisions,$('decisions-level').value,$('decisions-kind').value);
  $('decisions-count').textContent='Showing '+records.length+' of '+state.decisions.length+' evaluation decisions · latest 200';
  renderHistoryList($('decision-list'),records,state.decisions.length?'No decisions match these filters.':'No evaluation decisions recorded.',true);
}
async function api(path,body){const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000),cache:'no-store'});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Monitor service unavailable');error.status=response.status;throw error;}return data;}
function applyConfig(next){config=validateConfig(next);state.armed=config.armed;levels=Object.entries(levelNames).map(([code,name])=>({code,name,price:config.levels[code]}));$('range-support').textContent=usd(config.levels.S1);$('range-resistance').textContent=usd(config.levels.R1);$('rule-summary').textContent=`${{immediate:'Immediate breach',close:'Completed daily close',retest:'Daily retest'}[config.mode]} · ${config.cooldownMinutes}m cooldown · Saved revision ${config.revision}`;renderArmed();renderLevels();if(state.price)renderPosition(state.price);draw();}
function showMonitor(data,notify=false){state.serverReady=true;if(data.access){state.canManage=data.access.canManage===true;state.canCheck=data.access.canCheck===true;}if(data.config)applyConfig(data.config);const events=(Array.isArray(data.events)?data.events:[]).filter(validHistoryRecord);for(const event of events){const key=historyRecordId(event);if(!state.seen.has(key)){state.seen.add(key);if(notify&&state.bootstrapped&&Date.now()-event.time<120000){toast(event.message);if('Notification' in window&&Notification.permission==='granted'){try{new Notification('Ether Watch · Price alert',{body:event.message,tag:key});}catch{}}}}}state.events=mergeHistoryRecords(events,state.events);if(Array.isArray(data.decisions))state.decisions=mergeHistoryRecords(data.decisions,state.decisions);renderEvents();renderDecisions();persist();state.bootstrapped=true;const bg=data.background||{};state.background=bg;const delayed=bg.lastCheck&&Date.now()-bg.lastCheck>bg.intervalMinutes*120000;$('background-status').textContent=!bg.enabled?(bg.lastCheck?'Scheduled checks paused':'Scheduled checks off'):bg.lastError?'Background check failed':config.armed?(delayed?'Background check delayed':'Codex monitoring configured'):'Alerts paused';$('background-last').textContent=(bg.lastCheck?'Last background check: '+new Date(bg.lastCheck).toLocaleString():'No background check recorded')+(data.lastEvaluatedCandle?' · Daily candle: '+new Date(data.lastEvaluatedCandle*1000).toISOString().slice(0,10):'');$('background-note').textContent=!bg.enabled?'Scheduled Codex checks are paused. Browser alerts continue while this page is open and connected.':bg.lastError?bg.lastError:`Checks every ${bg.intervalMinutes} minutes while Codex and this machine are available. Brief breaches between checks can be missed.`;if(!state.canCheck)$('background-note').textContent+=' This view cannot evaluate alerts; sign in as the owner to manage browser monitoring.';if(data.evaluationError)$('rule-summary').textContent+=' · Evaluation error: '+data.evaluationError;renderMonitorStrip();}
function renderMonitorStrip(){
  $('settings-open').disabled=$('pause').disabled=!state.serverReady||!state.canManage;
  $('notify').disabled=!state.canCheck;
  $('monitor-signin').hidden=Boolean(state.canManage);
  $('monitor-alerts').textContent=state.serverReady?(!state.canCheck?'Read-only dashboard':config.armed?'Browser alerts armed':'Alerts paused'):'Alert service unavailable';
  $('monitor-distances').textContent=state.price?`S1 ${Math.abs(state.price/config.levels.S1*100-100).toFixed(2)}% ${state.price>=config.levels.S1?'above':'below'} · R1 ${Math.abs(state.price/config.levels.R1*100-100).toFixed(2)}% ${state.price>=config.levels.R1?'above':'below'}`:'S1 / R1 distances awaiting price';
  const bg=state.background;$('monitor-schedule').textContent=bg?(!bg.enabled?'Scheduled checks paused':bg.lastError?'Scheduled check failed':bg.lastCheck&&Date.now()-bg.lastCheck>bg.intervalMinutes*120000?'Scheduled check delayed':'Scheduled checks configured'):'Schedule status unavailable';
  $('monitor-check').textContent=!state.canCheck?'Owner sign-in required for alert checks':state.lastCheck?'Browser rules checked '+new Date(state.lastCheck).toLocaleTimeString():'Browser rules not yet checked';
}
async function checkAlert(){if(!state.serverReady||!state.canCheck)return;try{const data=await api('check',{source:'browser'});state.lastCheck=Date.now();showMonitor(data,true);}catch(e){if(e.status===401||e.status===403){state.canManage=false;state.canCheck=false;renderMonitorStrip();}$('rule-summary').textContent='Alert evaluation unavailable · '+e.message;$('monitor-check').textContent='Browser rule check failed';}}
function renderPosition(price){const support=config.levels.S1,resistance=config.levels.R1;$('range-pin').style.left=Math.max(0,Math.min(100,(price-support)/(resistance-support)*100))+'%';$('range-note').textContent=price<support?'Below immediate support':price>resistance?'Above immediate resistance':'Within immediate range';$('structure').innerHTML=`<span class="eyebrow">${price<support?'SUPPORT BREACH':price>resistance?'RESISTANCE BREACH':'INSIDE THE WATCH ZONE'}</span><h3>${price<support?'Watching '+usd(config.levels.S2):price>resistance?'Watching '+usd(config.levels.R2):'Between key levels'}</h3><p>ETH is ${Math.abs(price/support*100-100).toFixed(2)}% ${price>=support?'above':'below'} S1 and ${Math.abs(price/resistance*100-100).toFixed(2)}% ${price>=resistance?'above':'below'} R1. Saved levels define your watch zone.</p>`;renderMonitorStrip();}
function renderLevels(){ $('level-list').innerHTML=levels.map(l=>`<div class="level ${l.code[0]==='S'?'support':''}"><span class="level-code">${l.code}</span><div><span class="level-name">${l.name}</span><span class="level-price">${usd(l.price)}</span></div><span class="level-distance">${state.price?((l.price/state.price-1)*100>=0?'+':'')+((l.price/state.price-1)*100).toFixed(2)+'%':'—'}</span></div>`).join(''); }
function ema(values,period){const out=Array(values.length).fill(null);if(values.length<period)return out;let v=values.slice(0,period).reduce((a,b)=>a+b,0)/period;out[period-1]=v;for(let i=period;i<values.length;i++){v=values[i]*2/(period+1)+v*(1-2/(period+1));out[i]=v;}return out;}
function rsi(values,period=14){if(values.length<=period)return null;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0)/period;loss+=Math.max(-d,0)/period;}for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);}
function completed(){
  const candles=state.candles.filter(c=>c.time+86400<=Date.now()/1000);
  let start=0;
  for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time!==86400)start=i;
  return candles.slice(start);
}
function indicators(){const candles=completed(),closes=candles.map(c=>c.close),strength=rsi(closes);$('momentum').textContent='—';$('momentum').className='value';$('rsi-bar').style.width='0%';$('macd').textContent='—';$('macd').className='';$('macd').title='';$('rvol').textContent='—';$('spark').setAttribute('d','');if(strength!==null){$('momentum').textContent=strength.toFixed(1)+' '+(strength>=70?'Overbought':strength<=30?'Oversold':strength>=50?'Bullish':'Bearish');$('momentum').style.fontSize='23px';$('momentum').className='value '+(strength>=50?'positive':'negative');$('rsi-bar').style.width=strength+'%';}const fast=ema(closes,12),slow=ema(closes,26),macd=closes.map((_,i)=>fast[i]!==null&&slow[i]!==null?fast[i]-slow[i]:null).filter(x=>x!==null),signal=ema(macd,9);if(signal.length&&signal.at(-1)!==null){const h=macd.at(-1)-signal.at(-1);$('macd').textContent=(h>=0?'+':'')+h.toFixed(2)+' histogram';$('macd').className=h>=0?'positive':'negative';$('macd').title=`MACD ${macd.at(-1).toFixed(2)} / Signal ${signal.at(-1).toFixed(2)}`;}if(candles.length>20){const avg=candles.slice(-21,-1).reduce((sum,c)=>sum+c.volume,0)/20;$('rvol').textContent=avg>0?(candles.at(-1).volume/avg).toFixed(2)+'× average':'—';}if(closes.length>1){const series=closes.slice(-30),min=Math.min(...series),max=Math.max(...series);$('spark').setAttribute('d',series.map((v,i)=>`${i?'L':'M'}${i/(series.length-1)*180},${40-(v-min)/(max-min||1)*35}`).join(' '));}}
function renderDailyFreshness(){
  const candles=completed(),latest=candles.at(-1),expected=(Math.floor(Date.now()/86400000)-1)*86400;
  const stale=Boolean(state.dailyError)||!state.lastCandles||Date.now()-state.lastCandles>=300000||latest?.time!==expected;
  $('daily-freshness').textContent=!latest?'Daily indicators unavailable':`Daily indicators ${stale?'stale':'updated'} · completed through ${new Date(latest.time*1000).toISOString().slice(0,10)} UTC`+(candles.length<34?' · warming up after short or missing history':'');
  $('daily-freshness').title=state.dailyError||'';
}
async function request(path){const response=await fetch('https://api.exchange.coinbase.com/products/ETH-USD/'+path,{signal:AbortSignal.timeout(12000),cache:'no-store'});if(!response.ok)throw new Error('Market feed returned '+response.status);return response.json();}
function readStats(stats){
  const value=key=>{const raw=stats?.[key];if(!['string','number'].includes(typeof raw)||typeof raw==='string'&&!raw.trim()||!Number.isFinite(Number(raw)))throw new Error('Invalid 24h '+key);return Number(raw);};
  const open=value('open'),volume=value('volume');
  if(open<=0||volume<0)throw new Error('Invalid 24h price or volume');
  return {open,volume};
}
function renderStats(){
  const now=Date.now(),stale=Boolean(state.statsError||state.tickerError)||!state.lastStats||!state.lastSuccess||!state.lastTicker||now-state.lastStats>=45000||now-state.lastSuccess>=45000||now-state.lastTicker>=45000;
  if(!state.stats||!state.price){$('change').textContent='24h change unavailable';$('change').className='muted';return;}
  if(state.price){const change=(state.price/state.stats.open-1)*100;$('change').textContent=(change>=0?'↗ +':'↘ ')+change.toFixed(2)+'%'+(stale?' · stale':'');$('change').className=stale?'muted':change>=0?'positive':'negative';}
  $('change').title=[state.tickerError,state.statsError,'Price updated '+new Date(state.lastTicker).toLocaleTimeString(),'Stats fetched '+new Date(state.lastStats).toLocaleTimeString()].filter(Boolean).join(' · ');
}
function renderVolume(){
  const data=state.aggregateVolume,now=Date.now(),time=Date.parse(data?.fetchedAt),updated=Date.parse(data?.sourceUpdatedAt),age=now-time,sourceAge=now-updated;
  const available=data&&Number.isFinite(time)&&Number.isFinite(updated)&&age>=-60000&&sourceAge>=-60000&&age<3600000&&sourceAge<3600000;
  const stale=Boolean(state.volumeError)||data?.stale||age>=300000||sourceAge>=300000;
  $('volume').textContent=available?short(data.volumeUsd):'—';
  $('volume-note').textContent='ETH spot volume · rolling 24h · USD'+(!available?' · unavailable':stale?' · stale':'');
  $('volume-updated').textContent=available?'Provider updated '+new Date(updated).toLocaleTimeString():'Provider update unavailable';
  $('volume-freshness').textContent=available?'Fetched '+new Date(time).toLocaleTimeString():'Awaiting CoinMarketCap';
  $('volume-source').textContent='CoinMarketCap';
  $('volume-source').href='https://coinmarketcap.com/currencies/ethereum/';
  $('volume-note').title=(state.volumeError?state.volumeError+' · ':'')+'Aggregate Ethereum spot trading volume over the rolling last 24 hours, in USD.';
}
async function refreshVolume(force=false){
  if(state.volumeBusy||!force&&state.lastVolumeAttempt&&Date.now()-state.lastVolumeAttempt<(state.volumeError?60000:300000))return;
  state.volumeBusy=true;state.lastVolumeAttempt=Date.now();
  try{
    const data=await api('volume'),now=Date.now(),time=Date.parse(data?.fetchedAt),updated=Date.parse(data?.sourceUpdatedAt);
    if(data?.asset!=='ETH'||data.currency!=='USD'||data.scope!=='aggregate'||data.sourceId!=='coinmarketcap'||data.source!=='CoinMarketCap'||data.sourceUrl!=='https://coinmarketcap.com/currencies/ethereum/'||typeof data.volumeUsd!=='number'||!Number.isFinite(data.volumeUsd)||data.volumeUsd<=0||data.volumeUsd>Number.MAX_SAFE_INTEGER||typeof data.fetchedAt!=='string'||typeof data.sourceUpdatedAt!=='string'||typeof data.stale!=='boolean'||!Number.isFinite(time)||!Number.isFinite(updated)||time>now+60000||updated>now+60000||now-time>=3600000||now-updated>=3600000)throw new Error('Invalid aggregate volume');
    state.aggregateVolume=data;state.volumeError=data.stale?data.error||'Source refresh unavailable':null;
  }catch(error){state.volumeError=error.message;}finally{state.volumeBusy=false;renderVolume();}
}
function updatePrice(ticker){const {price,time}=acceptTicker(ticker,Date.now());state.price=price;state.lastSuccess=Date.now();state.lastTicker=time;state.tickerError=null;$('price').textContent=usd(price);$('connection').textContent='● Live · 15s updates';$('connection').style.color='var(--green)';$('connection').title='';$('updated').textContent='Updated '+new Date(time).toLocaleTimeString()+' · Coinbase';renderStats();renderPosition(price);renderLevels();draw();}
async function refresh(){
  if(state.busy)return;state.busy=true;$('refresh').disabled=true;
  try{
    const needCandles=Date.now()-state.lastCandles>300000;
    const results=await Promise.allSettled([request('ticker'),request('stats'),...(needCandles?[candleFeed.load(86400,{maxAgeMs:300000})]:[])]);
    try{if(results[1].status!=='fulfilled')throw results[1].reason;state.stats=readStats(results[1].value);state.lastStats=Date.now();state.statsError=null;}catch(error){state.statsError=error.message;}
    if(results[0].status==='fulfilled'){try{updatePrice(results[0].value);}catch(error){feedError(error.message);}}else feedError(results[0].reason.message);
    if(needCandles){
      if(results[2].status==='fulfilled'){
        const snapshot=results[2].value;
        state.dailyError=snapshot.error;
        if(snapshot.candles.length){state.candles=snapshot.candles;state.lastCandles=snapshot.fetchedAt;indicators();}else chartError();
        if(snapshot.error)chartError();
      }else{state.dailyError=results[2].reason?.message||'Daily feed unavailable';chartError();}
    }
  }catch(error){chartError();}finally{renderStats();renderDailyFreshness();state.busy=false;$('refresh').disabled=false;}
}
function feedError(message){state.tickerError=message;$('connection').textContent=state.lastSuccess?'● Stale · reconnecting':'● Feed unavailable';$('connection').style.color='var(--red)';$('connection').title=message;$('updated').textContent=state.lastSuccess?'Last successful update '+new Date(state.lastSuccess).toLocaleTimeString():'Unable to reach Coinbase · retrying every 15s';}
function chartError(){if(chartPrefs.timeframe===86400&&!state.candles.length){$('chart-empty').style.display='flex';$('chart-empty').innerHTML='Daily chart unavailable<small>The data feed may be blocked or temporarily unavailable.</small>';}else{$('updated').textContent+=' · Daily indicators stale';}}
function volumeProfile(candles,bins=30){if(!candles.length)return null;const min=Math.min(...candles.map(c=>c.low)),max=Math.max(...candles.map(c=>c.high)),step=(max-min||1)/bins,volumes=Array(bins).fill(0);for(const c of candles){if(c.high===c.low){volumes[Math.min(bins-1,Math.floor((c.close-min)/step))]+=c.volume;continue;}for(let i=0;i<bins;i++){const overlap=Math.max(0,Math.min(c.high,min+(i+1)*step)-Math.max(c.low,min+i*step));volumes[i]+=c.volume*overlap/(c.high-c.low);}}const peak=Math.max(...volumes);return {min,step,volumes,peak,poc:min+(volumes.indexOf(peak)+.5)*step};}
function draw(){try{priceChart.setData(graphState.candles,{price:state.price,levels,granularity:chartPrefs.timeframe});}catch(error){$('chart-empty').style.display='flex';$('chart-empty').textContent='Chart data unavailable · '+error.message;}}
function graphLabels(){const label={900:'15m',3600:'1h',86400:'1D'}[chartPrefs.timeframe];$('chart-caption').textContent=label+' '+(chartPrefs.type==='line'?'closing-price line':'candles')+' with your saved levels';$('chart-interval').textContent='UTC · '+label;const flips=$('show-flips');flips.disabled=chartPrefs.timeframe!==86400;flips.title=flips.disabled?'Flip markers use completed daily candles. Select 1D to show them.':'';$('chart').setAttribute('aria-label','Ethereum '+label+' '+chartPrefs.type+' chart. Use plus/minus to zoom, arrow keys to pan, and Home to reset.');}
function sizeChartPanes(){$('chart').parentElement.style.setProperty('--indicator-height',(priceChart.extraPaneHeight||0)+'px');}
function saveGraphPrefs(){try{localStorage.setItem('etherwatch-chart',JSON.stringify(chartPrefs));}catch{}priceChart.setOptions(chartPrefs);sizeChartPanes();graphLabels();draw();}
function renderChartFreshness(){const fetched=graphState.loadedAt,stale=!fetched||Date.now()-fetched>120000;const el=$('chart-freshness');el.textContent=fetched?`${{900:'15m',3600:'1h',86400:'1D'}[chartPrefs.timeframe]} candles · fetched ${new Date(fetched).toLocaleTimeString()}${stale?' · stale':graphState.error?' · refresh unavailable':' · refreshes every 60s'}`:'Chart awaiting first successful fetch';el.classList.toggle('stale',stale||!!graphState.error);el.title=graphState.error||'';}
async function refreshGraph(force=false){
  if(document.hidden)return;
  const granularity=chartPrefs.timeframe,generation=++graphState.generation;
  const snapshot=await candleFeed.load(granularity,{maxAgeMs:60000,force});
  if(generation!==graphState.generation||granularity!==chartPrefs.timeframe)return;
  graphState.error=snapshot.error;graphState.loadedAt=snapshot.fetchedAt;
  if(snapshot.candles.length){graphState.candles=snapshot.candles;graphState.granularity=granularity;$('chart-empty').style.display='none';draw();}
  else{$('chart-empty').style.display='flex';$('chart-empty').textContent='Chart data unavailable · '+(snapshot.error||'No candles returned');}
  renderChartFreshness();
}
function filterNews(items,topic,source,query){const q=query.trim().toLocaleLowerCase();return items.filter(item=>{const topics=item.topics||[item.category==='Macro'?'macro':'ethereum'];return (topic==='all'||topics.includes(topic))&&(source==='all'||source===item.sourceId)&&(!q||[item.title,item.source,...topics.map(key=>newsTopics[key]||key)].join(' ').toLocaleLowerCase().includes(q));});}
function newsRender(){
  const list=$('news-list');list.replaceChildren();let data=newsState.data;if(!data)return;
  data=newsState.data=retainNewsSources(data);
  const items=filterNews(data.items||[],$('news-filter').value,$('news-source').value,$('news-search').value);
  for(const item of items.slice(0,newsState.visible)){
    let url;try{url=new URL(item.url);if(url.protocol!=='https:')continue;}catch{continue;}
    const card=document.createElement('article');card.className='news-card';card.dataset.newsId=item.id;card.classList.toggle('selected-news',item.id===newsState.selected);
    const meta=document.createElement('div');meta.className='news-meta';const byline=document.createElement('span');byline.textContent=item.source+((data.sources||[]).some(s=>s.id===item.sourceId&&s.status==='stale')?' · cached':'');
    const date=document.createElement('time');date.dateTime=item.publishedAt;date.textContent=new Date(item.publishedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});meta.append(byline,date);
    const category=document.createElement('span');category.className='tag news-category';category.textContent=(item.topics||[]).map(key=>newsTopics[key]||key).join(' · ')||item.category;
    const heading=document.createElement('h3'),link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.title;heading.append(link);
    const context=document.createElement('p');context.className='news-relevance';context.textContent=item.context;const view=document.createElement('button');view.type='button';view.className='news-chart-link';view.textContent='View on chart';view.addEventListener('click',()=>focusNews(item));card.append(meta,category,heading,context,view);list.append(card);
  }
  if(!list.children.length){const empty=document.createElement('div');empty.className='news-empty';empty.textContent=data.error?'News is temporarily unavailable. Try again shortly.':'No recent relevant stories for these filters.';list.append(empty);}
  $('news-more').hidden=items.length<=newsState.visible;$('news-result-count').textContent=`Showing ${Math.min(items.length,newsState.visible)} of ${items.length} matching stories`;
  const failed=(data.sources||[]).filter(s=>s.status!=='ok');$('news-status').textContent=data.error&&!data.items?.length?'News unavailable':data.stale?'Cached stories · refresh unavailable':failed.length?'Some sources unavailable':'Sources updated';
  $('news-updated').textContent=data.fetchedAt?'Fetched '+new Date(data.fetchedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · publisher times shown on stories':'No successful news fetch yet';
  const health=$('news-source-health');health.replaceChildren();
  for(const source of data.sources||[]){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');const age=source.fetchedAt?Math.max(0,Math.floor((Date.now()-Date.parse(source.fetchedAt))/60000)):null;summary.textContent=`${source.name} · ${{ok:'Fresh',stale:'Cached',error:'Unavailable'}[source.status]||'Unavailable'}${age!==null?' · '+age+'m ago':''}`;body.textContent=`${source.itemCount||0} eligible stories${source.truncated?' · Source limit reached (32 articles)':''}${source.error?' · '+source.error:''}${source.lastAttemptAt?' · Last attempt '+new Date(source.lastAttemptAt).toLocaleString():''}`;details.append(summary,body);health.append(details);}
  const all=data.items||[];priceChart.setEvents(all.map(item=>({id:item.id,time:Date.parse(item.publishedAt)/1000,title:item.title,source:item.source,category:item.category})));
  for(const button of [...$('news-marker-stories').children])if(!all.some(item=>item.id===button.dataset.newsId))button.remove();
  if(newsState.selected&&!all.some(item=>item.id===newsState.selected)){newsState.selected=null;$('news-marker-stories').replaceChildren();$('news-daily').hidden=true;$('news-selection').textContent='Selected story is no longer in the current feed.';}
  $('news-clear').hidden=!newsState.selected&&!$('news-marker-stories').children.length;
}
function selectNewsGroup(group){
  const list=$('news-marker-stories');list.replaceChildren();
  for(const event of group.events||[]){const button=document.createElement('button');button.type='button';button.dataset.newsId=event.id;button.textContent=event.title;button.addEventListener('click',()=>selectNewsEvent(event));list.append(button);}
  $('news-selection').textContent=`${list.children.length} headline(s) published in this candle. Choose a story to view its source and context.`;
  $('news-clear').hidden=!list.children.length;
  list.querySelector('button')?.focus();
}
async function selectNewsEvent(event){
  const item=(newsState.data?.items||[]).find(item=>item.id===event.id);if(!item)return;
  const dialog=$('expanded-chart-dialog');if(dialog.open)await new Promise(resolve=>{dialog.addEventListener('close',resolve,{once:true});dialog.close();});
  newsState.selected=item.id;$('news-filter').value='all';$('news-source').value='all';$('news-search').value='';newsState.visible=Math.max(6,Math.ceil(((newsState.data.items.indexOf(item))+1)/6)*6);newsRender();
  $('news-selection').textContent=item.title+' · '+new Date(item.publishedAt).toLocaleString()+' · Publication timing is context, not proof of price causation.';
  const card=[...$('news-list').children].find(card=>card.dataset.newsId===item.id);if(card){card.tabIndex=-1;card.focus();card.scrollIntoView({block:'nearest'});}
}
function focusNews(item){
  newsState.selected=item.id;$('news-marker-stories').replaceChildren();chartPrefs.news=true;$('show-news').checked=true;saveGraphPrefs();
  const result=priceChart.focusTime(Date.parse(item.publishedAt)/1000);newsRender();
  $('news-selection').textContent=result.focused?'Chart focused on publication time · '+item.title:'Publication time is outside the loaded chart history or falls in a missing interval.';
  $('news-daily').hidden=result.focused||chartPrefs.timeframe===86400;
  if(result.focused){$('chart').focus();$('chart').scrollIntoView({block:'center'});}
}
function retainNewsSources(previous,now=Date.now()){
  const fetched=Date.parse(previous?.fetchedAt),validTime=time=>Number.isFinite(time)&&time<=now&&now-time<=86400000;
  if(!previous?.sources?.length)return previous&&validTime(fetched)?previous:{items:[],sources:[],fetchedAt:null,stale:true,partial:true,error:'Cached news expired or unavailable'};
  const times=[],sources=previous.sources.map(source=>{const time=source.fetchedAt===undefined?fetched:Date.parse(source.fetchedAt);if(validTime(time)&&source.status!=='error'){times.push(time);return {...source};}return {...source,status:'error',error:source.fetchedAt? 'Cached source expired':source.error||'Source unavailable'};});
  const valid=new Set(sources.filter(source=>source.status!=='error').map(source=>source.id));
  return {...previous,sources,items:(previous.items||[]).filter(item=>item.sourceId?valid.has(item.sourceId):validTime(fetched)),fetchedAt:times.length?new Date(Math.min(...times)).toISOString():null,stale:sources.some(source=>source.status==='stale'),partial:previous.partial||sources.some(source=>source.status!=='ok'),error:times.length?previous.error:'News sources unavailable or expired'};
}
function newsFallback(previous,message,now=Date.now()){const data=retainNewsSources(previous,now);return {...data,stale:true,partial:true,error:message,sources:data.sources.map(source=>source.status==='error'?source:{...source,status:'stale',error:message})};}
async function refreshNews(){if(newsState.busy)return;newsState.busy=true;$('news-refresh').disabled=true;$('news-list').setAttribute('aria-busy','true');$('news-status').textContent='Refreshing sources…';try{const response=await fetch('/api/news',{signal:AbortSignal.timeout(18000),cache:'no-store'});const data=await response.json();if(!response.ok&&!(response.status===503&&Array.isArray(data.sources)))throw new Error(data.error||'News connection unavailable');newsState.data=data;newsRender();}catch(error){newsState.data=newsFallback(newsState.data,error.message);newsRender();}finally{newsState.busy=false;$('news-refresh').disabled=false;$('news-list').setAttribute('aria-busy','false');}}
applyTheme(document.documentElement.dataset.theme, false);
$('theme-select').addEventListener('change',event=>applyTheme(event.target.value));
document.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{chartPrefs.bars=Number(button.dataset.days);document.querySelectorAll('[data-days]').forEach(b=>b.classList.toggle('selected',b===button));saveGraphPrefs();priceChart.resetView();}));
$('refresh').addEventListener('click',async()=>{refreshVolume(true);await loadSettings();await refresh();await refreshGraph(true);await checkAlert();});
$('chart-timeframe').value=chartPrefs.timeframe;$('chart-type').value=chartPrefs.type;$('chart-scale').value=chartPrefs.scale;$('chart-fit').value=chartPrefs.fit||'levels';
for(const [id,key] of [['show-profile','profile'],['show-ema','ema'],['show-volume','volume'],['show-levels','levels'],['show-flips','flips'],['show-rsi','rsi'],['show-macd','macd'],['show-news','news']]){$(id).checked=!!chartPrefs[key];$(id).addEventListener('change',()=>{chartPrefs[key]=$(id).checked;saveGraphPrefs();});}
$('chart-timeframe').addEventListener('change',()=>{chartPrefs.timeframe=Number($('chart-timeframe').value);graphState.generation++;graphState.candles=[];graphState.loadedAt=0;$('chart-empty').style.display='flex';$('chart-empty').textContent='Loading selected chart interval…';saveGraphPrefs();refreshGraph(true);});
$('chart-type').addEventListener('change',()=>{chartPrefs.type=$('chart-type').value;saveGraphPrefs();});$('chart-scale').addEventListener('change',()=>{chartPrefs.scale=$('chart-scale').value;saveGraphPrefs();});$('chart-reset').addEventListener('click',()=>priceChart.resetView());$('chart-options-open').addEventListener('click',()=>$('chart-options-dialog').showModal());$('chart-options-close').addEventListener('click',()=>$('chart-options-dialog').close());
$('chart-fit').addEventListener('change',()=>{chartPrefs.fit=$('chart-fit').value;saveGraphPrefs();});
const chartHome=document.createComment('Chart returns here after expanded view');$('chart-panel').before(chartHome);
$('chart-expand').addEventListener('click',()=>{$('expanded-chart-body').append($('chart-panel'));$('expanded-chart-dialog').showModal();});
$('expanded-chart-close').addEventListener('click',()=>$('expanded-chart-dialog').close());
$('expanded-chart-dialog').addEventListener('close',()=>{chartHome.after($('chart-panel'));$('chart-expand').focus();});
document.querySelectorAll('[data-days]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===chartPrefs.bars));priceChart.setOptions(chartPrefs);sizeChartPanes();graphLabels();
$('news-refresh').addEventListener('click',refreshNews);
for(const id of ['news-filter','news-source','news-search'])$(id).addEventListener(id==='news-search'?'input':'change',()=>{newsState.visible=6;newsRender();});
$('news-more').addEventListener('click',()=>{newsState.visible+=6;newsRender();});refreshNews();setInterval(()=>{if(!document.hidden)refreshNews();},300000);
$('news-clear').addEventListener('click',()=>{newsState.selected=null;$('news-selection').textContent='';$('news-marker-stories').replaceChildren();$('news-daily').hidden=true;newsRender();});
$('news-daily').addEventListener('click',async()=>{const item=(newsState.data?.items||[]).find(item=>item.id===newsState.selected);if(!item)return;chartPrefs.timeframe=86400;$('chart-timeframe').value='86400';graphState.generation++;graphState.candles=[];graphState.loadedAt=0;saveGraphPrefs();await refreshGraph();focusNews(item);});
mountCalendar();
function renderArmed(){
  $('pause').textContent=state.armed?'Pause alerts':'Resume alerts';
  $('armed-badge').textContent=state.serverReady?(state.armed?'ARMED':'PAUSED'):'LOADING';
  const selected=config.selectedLevels.map(code=>code+' '+usd(config.levels[code])).join(' / ');
  const options=(config.proximity.enabled?' · Proximity within '+config.proximity.distancePercent+'%':' · Proximity off')+(config.volumeConfirmation.enabled?' · Volume ≥ '+config.volumeConfirmation.minRelativeVolume+'× preceding '+config.volumeConfirmation.lookbackCandles+' daily candles':' · Volume confirmation off');
  $('rule-summary').textContent=selected+' · '+{immediate:'Immediate breach',close:'Completed daily close',retest:'Daily retest'}[config.mode]+' · '+config.cooldownMinutes+'m cooldown'+(config.mode==='retest'?' · ±'+config.retestTolerance+'% within '+config.retestCandles+' daily candles':'')+options+' · Revision '+config.revision+' · '+(state.armed?'armed':'paused');
}
$('pause').addEventListener('click',async()=>{if(!state.serverReady)return toast('Saved settings service is unavailable.');try{showMonitor(await api('config',{...config,armed:!config.armed,expectedRevision:config.revision}));persist();}catch(e){toast(e.message);}});
$('notify').addEventListener('click',async()=>{if(!('Notification' in window)){toast('This browser does not support desktop notifications. In-page alerts remain available.');return;}try{const permission=await Notification.requestPermission();$('notification-note').textContent=permission==='granted'?'Browser notifications enabled. Keep this page open and connected.':'Notifications are not enabled. You can change permission in browser settings; in-page alerts still work.';$('notify').textContent=permission==='granted'?'Notifications enabled':'Enable notifications';}catch{toast('Browser notifications unavailable. In-page alerts remain active.');}});
function syncVolumeConfirmation(){
  const immediate=$('alert-mode').value==='immediate';
  $('volume-confirmation').disabled=immediate;
  if(immediate)$('volume-confirmation').checked=false;
  $('volume-confirmation-note').textContent=(immediate?'Volume confirmation is off in immediate mode. Choose daily-close or retest to enable it. ':'')+'When enabled, the signal candle must have at least 1.5× the average volume of the preceding 20 completed daily candles.';
}
function fillSettingsFields(next){
  for(const [code,value] of Object.entries(next.levels))$('level-'+code).value=value;
  for(const code of Object.keys(DEFAULT_CONFIG.levels))$('alert-level-'+code).checked=next.selectedLevels.includes(code);
  $('alert-mode').value=next.mode;
  $('cooldown-minutes').value=next.cooldownMinutes;
  $('proximity-enabled').checked=next.proximity.enabled;
  $('proximity-distance').value=next.proximity.distancePercent;
  $('volume-confirmation').checked=next.volumeConfirmation.enabled;
  syncVolumeConfirmation();
}
function readSettings(){
  if(!editingConfig)throw new Error('Reopen settings before saving.');
  const mode=$('alert-mode').value;
  return validateConfig({...editingConfig,
    levels:Object.fromEntries(Object.keys(editingConfig.levels).map(code=>[code,$('level-'+code).value])),
    mode,cooldownMinutes:$('cooldown-minutes').value,
    selectedLevels:Object.keys(DEFAULT_CONFIG.levels).filter(code=>$('alert-level-'+code).checked),
    proximity:{enabled:$('proximity-enabled').checked,distancePercent:$('proximity-distance').value},
    volumeConfirmation:{enabled:mode!=='immediate'&&$('volume-confirmation').checked,lookbackCandles:20,minRelativeVolume:1.5}
  });
}
function fillSettings(){editingConfig=structuredClone(config);fillSettingsFields(editingConfig);$('settings-error').textContent='';}
function resetSettings(){fillSettingsFields(DEFAULT_CONFIG);$('settings-error').textContent='Defaults are ready. Save to apply.';}
$('settings-open').addEventListener('click',()=>{if(!state.serverReady)return toast('Saved settings service is unavailable. Try Refresh.');fillSettings();$('settings-dialog').showModal();});
$('settings-cancel').addEventListener('click',()=>$('settings-dialog').close());
$('settings-reset').addEventListener('click',resetSettings);
$('alert-mode').addEventListener('change',syncVolumeConfirmation);
for(const id of ['history-level','history-kind','history-delivery'])$(id).addEventListener('change',renderEvents);
for(const id of ['decisions-level','decisions-kind'])$(id).addEventListener('change',renderDecisions);
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;try{const next=readSettings();for(const button of form.querySelectorAll('button'))button.disabled=true;showMonitor(await api('config',{...next,expectedRevision:editingConfig.revision}));$('settings-dialog').close();toast('Levels and alert options saved.');}catch(e){$('settings-error').textContent=e.message;}finally{for(const button of form.querySelectorAll('button'))button.disabled=false;}});
async function loadSettings(){try{let data=await api('state');if(legacyPaused&&data.access?.canManage&&data.config.revision===1)data=await api('config',{...data.config,armed:false,expectedRevision:1});showMonitor(data);if(data.access?.canManage){legacyPaused=false;try{localStorage.setItem('etherwatch-migrated','1');}catch{}}}catch(e){state.serverReady=false;$('armed-badge').textContent='UNAVAILABLE';$('rule-summary').textContent='Saved monitor service unavailable';$('background-status').textContent='Configuration unavailable';$('background-note').textContent='Live chart data remains available. Alert settings could not be loaded.';}}
applyConfig(config);renderEvents();refreshVolume();loadSettings().then(async()=>{await Promise.all([refresh(),refreshGraph()]);await checkAlert();});setInterval(async()=>{await Promise.all([refresh(),refreshGraph(),refreshVolume()]);await checkAlert();},15000);setInterval(()=>{if(state.lastSuccess&&Date.now()-state.lastSuccess>45000)feedError('No recent successful update');renderChartFreshness();renderStats();renderVolume();renderDailyFreshness();},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadSettings();refresh();refreshGraph();refreshNews();refreshVolume();}});
