'use strict';
import { DEFAULT_SETTINGS, validateSettings } from './settings.mjs';
import { acceptTicker } from './quote.mjs';
import { setupNavigation } from './navigation.mjs';
import { retireNotifications } from './retire-notifications.mjs';
import { PriceChart, DEFAULT_CHART_OPTIONS } from './chart.mjs';
import { createCandleFeed } from './market-data.mjs';
import { mountCalendar } from './calendar-ui.mjs';
const $ = id => document.getElementById(id);
const levelNames={R3:'Resistance 3',R2:'Resistance 2',R1:'Immediate resistance',S1:'Immediate support',S2:'Support 2',S3:'Support 3'};
let config=structuredClone(DEFAULT_SETTINGS),levels=[];
let editingConfig=null;
let chartPrefs={...DEFAULT_CHART_OPTIONS,timeframe:86400,bars:90};
try{const saved=JSON.parse(localStorage.getItem('etherwatch-chart')||'{}');for(const key of ['ema','volume','profile','levels','flips','rsi','macd','news'])if(typeof saved[key]==='boolean')chartPrefs[key]=saved[key];if(['candles','line'].includes(saved.type))chartPrefs.type=saved.type;if(['linear','log'].includes(saved.scale))chartPrefs.scale=saved.scale;if(['levels','candles'].includes(saved.fit))chartPrefs.fit=saved.fit;if([900,3600,86400].includes(saved.timeframe))chartPrefs.timeframe=saved.timeframe;if([30,90,180].includes(saved.bars))chartPrefs.bars=saved.bars;}catch{}
let chartReadoutKey='';
const priceChart=new PriceChart($('chart'),{tooltip:$('tooltip'),onSummary:renderChartReadout,onProfile:poc=>{$('poc').textContent=Number.isFinite(poc)?poc.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}):'—';},onEventSelect:group=>selectNewsGroup(group),onGroupsChange:groups=>renderChartNewsGroups(groups)});
const graphState={candles:[],granularity:chartPrefs.timeframe,loadedAt:0,generation:0,busy:false};
const stackedFeeds=matchMedia('(max-width:1023px)');
const newsPageSize=()=>stackedFeeds.matches?3:6;
const newsState={data:null,busy:false,visible:newsPageSize(),selected:null,expanded:false};
const candleFeed=createCandleFeed({fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})});
const newsTopics={ethereum:'Ethereum & crypto',macro:'Macro',network:'Network upgrades',etf:'ETFs',regulation:'Regulation',security:'Security'};
const state = {price:null,candles:[],days:90,lastSuccess:0,lastTicker:0,tickerError:null,lastCandles:0,dailyError:null,busy:false,chartData:[],stats:null,lastStats:0,statsError:null,aggregateVolume:null,volumeError:null,volumeBusy:false,lastVolumeAttempt:0,serverReady:false,canManage:false};
const usd = n => Number.isFinite(n) ? n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
const short = n => Number.isFinite(n) ? '$'+Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n) : '—';
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
void retireNotifications();
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',7000);}
async function api(path,body){const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000),cache:'no-store'});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Service unavailable');error.status=response.status;throw error;}return data;}
function applyConfig(next){
  config=validateSettings(next);
  levels=Object.entries(levelNames).map(([code,name])=>({code,name,price:config.levels[code]}));
  $('range-support').textContent=usd(config.levels.S1);$('range-resistance').textContent=usd(config.levels.R1);
  renderLevels();if(state.price)renderPosition(state.price);draw();
}
function showSettings(data){
  applyConfig(data);state.serverReady=true;state.canManage=data.access?.canManage===true;renderSettingsAccess();
}
function renderSettingsAccess(){
  $('settings-open').disabled=!state.serverReady||!state.canManage;
  document.querySelectorAll('[data-open-settings]').forEach(button=>{button.disabled=$('settings-open').disabled;});
  $('settings-signin').hidden=!state.serverReady||state.canManage;
  $('settings-status').textContent=state.serverReady?(state.canManage?'Saved chart levels · editable by you':'Saved chart levels · read only'):'Saved levels unavailable. Use Refresh to retry.';
}
function renderPosition(price){const support=config.levels.S1,resistance=config.levels.R1;$('range-pin').style.left=Math.max(0,Math.min(100,(price-support)/(resistance-support)*100))+'%';$('range-note').textContent=price<support?'Below immediate support':price>resistance?'Above immediate resistance':'Within immediate range';$('structure').innerHTML=`<span class="eyebrow">${price<support?'SUPPORT BREACH':price>resistance?'RESISTANCE BREACH':'INSIDE THE WATCH ZONE'}</span><h3>${price<support?'Watching '+usd(config.levels.S2):price>resistance?'Watching '+usd(config.levels.R2):'Between key levels'}</h3><p>ETH is ${Math.abs(price/support*100-100).toFixed(2)}% ${price>=support?'above':'below'} S1 and ${Math.abs(price/resistance*100-100).toFixed(2)}% ${price>=resistance?'above':'below'} R1. Saved levels define your watch zone.</p>`;}
function renderLevels(){ $('level-list').innerHTML=levels.map(l=>`<div class="level ${l.code[0]==='S'?'support':''}"><span class="level-code">${l.code}</span><div><span class="level-name">${l.name}</span><span class="level-price">${usd(l.price)}</span></div><span class="level-distance">${state.price?((l.price/state.price-1)*100>=0?'+':'')+((l.price/state.price-1)*100).toFixed(2)+'%':'—'}</span></div>`).join(''); }
function ema(values,period){const out=Array(values.length).fill(null);if(values.length<period)return out;let v=values.slice(0,period).reduce((a,b)=>a+b,0)/period;out[period-1]=v;for(let i=period;i<values.length;i++){v=values[i]*2/(period+1)+v*(1-2/(period+1));out[i]=v;}return out;}
function rsi(values,period=14){if(values.length<=period)return null;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0)/period;loss+=Math.max(-d,0)/period;}for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);}
function completed(){
  const candles=state.candles.filter(c=>c.time+86400<=Date.now()/1000);
  let start=0;
  for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time!==86400)start=i;
  return candles.slice(start);
}
function renderSparkline(closes){
  const series=closes.slice(-30),path=$('spark');
  path.setAttribute('d','');
  path.setAttribute('class','');
  $('spark-baseline').setAttribute('d','');
  $('spark-baseline-label').hidden=true;
  let summary='Daily trend unavailable';
  $('spark-label').textContent=summary;
  if(series.length>1){
    const min=Math.min(...series),max=Math.max(...series),first=series[0],last=series.at(-1);
    const baselineY=max===min?22.5:40-(first-min)/(max-min)*35;
    $('spark-baseline').setAttribute('d','M3,'+baselineY+' L177,'+baselineY);
    $('spark-baseline-label').hidden=false;
    path.setAttribute('d',series.map((value,index)=>{
      const x=3+index/(series.length-1)*174;
      const y=max===min?22.5:40-(value-min)/(max-min)*35;
      return (index?'L':'M')+x+','+y;
    }).join(' '));
    path.setAttribute('class',last>first?'positive':last<first?'negative':'');
    $('spark-label').textContent=series.length+' daily closes';
    summary=series.length+' completed daily closing prices · '+(last>first?'up':last<first?'down':'unchanged')+' '+Math.abs((last/first-1)*100).toFixed(2)+'% from first to last close · dashed baseline marks the first close';
  }
  $('spark-title').textContent=summary;
  $('spark-chart').setAttribute('aria-label',summary);
}
function indicators(){const candles=completed(),closes=candles.map(c=>c.close),strength=rsi(closes);$('momentum').textContent='—';$('momentum').className='value';$('rsi-bar').style.width='0%';$('macd').textContent='—';$('macd').className='';$('macd').title='';$('rvol').textContent='—';$('spark').setAttribute('d','');if(strength!==null){$('momentum').textContent=strength.toFixed(1)+' '+(strength>=70?'Overbought':strength<=30?'Oversold':strength>=50?'Bullish':'Bearish');$('momentum').style.fontSize='23px';$('momentum').className='value '+(strength>=50?'positive':'negative');$('rsi-bar').style.width=strength+'%';}const fast=ema(closes,12),slow=ema(closes,26),macd=closes.map((_,i)=>fast[i]!==null&&slow[i]!==null?fast[i]-slow[i]:null).filter(x=>x!==null),signal=ema(macd,9);if(signal.length&&signal.at(-1)!==null){const h=macd.at(-1)-signal.at(-1);$('macd').textContent=(h>=0?'+':'')+h.toFixed(2)+' histogram';$('macd').className=h>=0?'positive':'negative';$('macd').title=`MACD ${macd.at(-1).toFixed(2)} / Signal ${signal.at(-1).toFixed(2)}`;}if(candles.length>20){const avg=candles.slice(-21,-1).reduce((sum,c)=>sum+c.volume,0)/20;$('rvol').textContent=avg>0?(candles.at(-1).volume/avg).toFixed(2)+'× average':'—';}renderSparkline(closes);}
function renderDailyFreshness(){
  const candles=completed(),latest=candles.at(-1),expected=(Math.floor(Date.now()/86400000)-1)*86400;
  const stale=Boolean(state.dailyError)||!state.lastCandles||Date.now()-state.lastCandles>=300000||latest?.time!==expected;
  $('daily-freshness').textContent=!latest?'Daily indicators unavailable':`Daily indicators ${stale?'stale':'updated'} · completed through ${new Date(latest.time*1000).toISOString().slice(0,10)} UTC`+(candles.length<34?' · warming up after short or missing history':'');
  $('daily-freshness').title=state.dailyError||'';
  $('daily-freshness').className='chart-freshness'+(stale||!latest?' stale':'');
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
  if(!state.stats||!state.price){$('change').textContent='24h change unavailable';$('change').className='stale';return;}
  if(state.price){const change=(state.price/state.stats.open-1)*100;$('change').textContent=(change>=0?'↗ +':'↘ ')+change.toFixed(2)+'%'+(stale?' · stale':'');$('change').className=stale?'stale':change>=0?'positive':'negative';}
  $('change').title=[state.tickerError,state.statsError,'Price updated '+new Date(state.lastTicker).toLocaleTimeString(),'Stats fetched '+new Date(state.lastStats).toLocaleTimeString()].filter(Boolean).join(' · ');
}
function renderVolume(){
  const data=state.aggregateVolume,now=Date.now(),time=Date.parse(data?.fetchedAt),updated=Date.parse(data?.sourceUpdatedAt),age=now-time,sourceAge=now-updated;
  const available=data&&Number.isFinite(time)&&Number.isFinite(updated)&&age>=-60000&&sourceAge>=-60000&&age<3600000&&sourceAge<3600000;
  const stale=Boolean(state.volumeError)||data?.stale||age>=300000||sourceAge>=300000;
  $('volume').textContent=available?short(data.volumeUsd):'—';
  $('volume-note').textContent=!available?'USD · unavailable':stale?'USD · stale':'USD · rolling 24h';
  $('volume-note').className=!available||stale?'stale':'';
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
function feedError(message){state.tickerError=message;$('connection').textContent=state.lastSuccess?'● Stale · reconnecting':'● Feed unavailable';$('connection').style.color='var(--warning)';$('connection').title=message;$('updated').textContent=state.lastSuccess?'Last successful update '+new Date(state.lastSuccess).toLocaleTimeString():'Unable to reach Coinbase · retrying every 15s';}
function chartError(){if(chartPrefs.timeframe===86400&&!state.candles.length){$('chart-empty').style.display='flex';$('chart-empty').innerHTML='Daily chart unavailable<small>The data feed may be blocked or temporarily unavailable.</small>';}else{$('updated').textContent+=' · Daily indicators stale';}}
function volumeProfile(candles,bins=30){if(!candles.length)return null;const min=Math.min(...candles.map(c=>c.low)),max=Math.max(...candles.map(c=>c.high)),step=(max-min||1)/bins,volumes=Array(bins).fill(0);for(const c of candles){if(c.high===c.low){volumes[Math.min(bins-1,Math.floor((c.close-min)/step))]+=c.volume;continue;}for(let i=0;i<bins;i++){const overlap=Math.max(0,Math.min(c.high,min+(i+1)*step)-Math.max(c.low,min+i*step));volumes[i]+=c.volume*overlap/(c.high-c.low);}}const peak=Math.max(...volumes);return {min,step,volumes,peak,poc:min+(volumes.indexOf(peak)+.5)*step};}
function draw(){try{priceChart.setData(graphState.candles,{price:state.price,levels,granularity:chartPrefs.timeframe});}catch(error){$('chart-empty').style.display='flex';$('chart-empty').textContent='Chart data unavailable · '+error.message;}}
function renderChartReadout(summary){
  const key=JSON.stringify(summary);if(key===chartReadoutKey)return;chartReadoutKey=key;
  const money=value=>Number.isFinite(value)?usd(value):'—';
  $('chart-close-label').textContent=summary?.atLatest?(summary.inProgress?'Current candle close':'Last candle close'):'Visible candle close';
  $('chart-close').textContent=money(summary?.close);
  $('chart-close-time').textContent=summary?new Date(summary.time*1000).toISOString().slice(0,16).replace('T',' ')+' UTC'+(summary.inProgress?' · in progress':''):'Waiting for chart data';
  $('chart-baseline').textContent=money(summary?.baseline);
  $('chart-ema20-value').textContent=money(summary?.ema20);$('chart-ema50-value').textContent=money(summary?.ema50);
}
function graphLabels(){const label={900:'15m',3600:'1h',86400:'1D'}[chartPrefs.timeframe];$('chart-caption').textContent=label+' '+(chartPrefs.type==='line'?'closing-price line':'candles')+' with your saved levels';$('chart-interval').textContent='UTC · '+label;$('chart-color-key').hidden=chartPrefs.type!=='line';$('chart-ema20-key').hidden=$('chart-ema50-key').hidden=!chartPrefs.ema;const flips=$('show-flips');flips.disabled=chartPrefs.timeframe!==86400;flips.title=flips.disabled?'Flip markers use completed daily candles. Select 1D to show them.':'';$('chart').setAttribute('aria-label','Ethereum '+label+' '+chartPrefs.type+' chart. Use plus/minus to zoom, arrow keys to pan, and Home to reset.');}
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
    const context=document.createElement('p');context.className='news-relevance';context.textContent=item.context;const view=document.createElement('button');view.type='button';view.className='news-chart-link';view.textContent='View on chart';view.addEventListener('click',()=>focusNews(item));const detail=document.createElement('details'),summary=document.createElement('summary');detail.className='news-context';summary.textContent='Why it matters';detail.append(summary,context);const actions=document.createElement('div');actions.className='news-actions';actions.append(view,detail);card.append(meta,category,heading,actions);list.append(card);
  }
  if(!list.children.length){const empty=document.createElement('div');empty.className='news-empty';empty.textContent=data.error?'News is temporarily unavailable. Try again shortly.':'No recent relevant stories for these filters.';list.append(empty);}
  $('news-more').hidden=items.length<=newsState.visible;$('news-result-count').textContent=`Showing ${Math.min(items.length,newsState.visible)} of ${items.length} matching stories`;
  const failed=(data.sources||[]).filter(s=>s.status!=='ok');$('news-status').textContent=data.error&&!data.items?.length?'News unavailable':data.stale?'Cached stories · refresh unavailable':failed.length?'Some sources unavailable':'Sources updated';
  $('news-status').classList.toggle('stale',Boolean(data.error||data.stale||failed.length));
  $('news-updated').textContent=data.fetchedAt?'Fetched '+new Date(data.fetchedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · publisher times shown on stories':'No successful news fetch yet';
  const health=$('news-source-health');health.replaceChildren();
  for(const source of data.sources||[]){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');const age=source.fetchedAt?Math.max(0,Math.floor((Date.now()-Date.parse(source.fetchedAt))/60000)):null;summary.textContent=`${source.name} · ${{ok:'Fresh',stale:'Cached',error:'Unavailable'}[source.status]||'Unavailable'}${age!==null?' · '+age+'m ago':''}`;body.textContent=`${source.itemCount||0} eligible stories${source.truncated?' · Source limit reached (32 articles)':''}${source.error?' · '+source.error:''}${source.lastAttemptAt?' · Last attempt '+new Date(source.lastAttemptAt).toLocaleString():''}`;details.append(summary,body);health.append(details);}
  const all=data.items||[];priceChart.setEvents(all.map(item=>({id:item.id,time:Date.parse(item.publishedAt)/1000,title:item.title,source:item.source,category:item.category})));
  for(const button of [...$('news-marker-stories').children])if(!all.some(item=>item.id===button.dataset.newsId))button.remove();
  if(newsState.selected&&!all.some(item=>item.id===newsState.selected)){newsState.selected=null;$('news-marker-stories').replaceChildren();$('news-daily').hidden=true;$('news-selection').textContent='Selected story is no longer in the current feed.';}
  $('news-clear').hidden=!newsState.selected&&!$('news-marker-stories').children.length;
}
function renderChartNewsGroups(groups){
  const browser=$('chart-news-browser'),list=$('chart-news-groups');
  if(!browser||!list)return;
  const previous=document.activeElement?.dataset?.clusterTime;
  list.replaceChildren();browser.hidden=!groups.length;
  for(const group of groups){
    const button=document.createElement('button');button.type='button';button.dataset.clusterTime=String(group.time);
    const stamp=time=>new Date(time*1000).toISOString().slice(0,16).replace('T',' ');
    button.textContent=`${group.events.length} headline${group.events.length===1?'':'s'} · ${stamp(group.startTime)}${group.endTime!==group.startTime?' – '+stamp(group.endTime):''} UTC`;
    button.addEventListener('click',()=>priceChart.selectNewsCluster(group.time));list.append(button);
  }
  if(previous)list.querySelector(`[data-cluster-time="${previous}"]`)?.focus();
}
function selectNewsGroup(group){
  const list=$('news-marker-stories');list.replaceChildren();
  for(const event of group.events||[]){const button=document.createElement('button');button.type='button';button.dataset.newsId=event.id;button.textContent=event.title+' · '+new Date(event.time*1000).toLocaleString();button.addEventListener('click',()=>selectNewsEvent(event));list.append(button);}
  $('news-selection').textContent=`${list.children.length} headline(s) ${group.candleCount>1?'across '+group.candleCount+' candles':'published in this candle'}. Choose a story to view its source and context.`;
  $('news-clear').hidden=!list.children.length;
  list.querySelector('button')?.focus();
}
async function selectNewsEvent(event){
  const item=(newsState.data?.items||[]).find(item=>item.id===event.id);if(!item)return;
  const dialog=$('expanded-chart-dialog');if(dialog.open)await new Promise(resolve=>{dialog.addEventListener('close',resolve,{once:true});dialog.close();});
  newsState.selected=item.id;$('news-filter').value='all';$('news-source').value='all';$('news-search').value='';newsState.expanded=true;newsState.visible=Math.max(newsPageSize(),Math.ceil(((newsState.data.items.indexOf(item))+1)/newsPageSize())*newsPageSize());newsRender();
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
  const fetched=Date.parse(previous?.fetchedAt),validTime=time=>Number.isFinite(time)&&time<=now+60000&&now-time<=86400000;
  if(!previous?.sources?.length)return previous&&validTime(fetched)?previous:{items:[],sources:[],fetchedAt:null,stale:true,partial:true,error:'Cached news expired or unavailable'};
  const times=[],sources=previous.sources.map(source=>{const timestamp=source.fetchedAt===undefined?previous.fetchedAt:source.fetchedAt,time=Date.parse(timestamp);if(validTime(time)&&source.status!=='error'){times.push(time);return {...source};}const invalid=timestamp&&(!Number.isFinite(time)||time>now+60000);return {...source,status:'error',error:invalid?'Invalid source verification timestamp':timestamp&&now-time>86400000?'Cached source expired':source.error||'Source unavailable'};});
  const valid=new Set(sources.filter(source=>source.status!=='error').map(source=>source.id));
  return {...previous,sources,items:(previous.items||[]).filter(item=>item.sourceId?valid.has(item.sourceId):validTime(fetched)),fetchedAt:times.length?new Date(Math.min(...times)).toISOString():null,stale:sources.some(source=>source.status==='stale'),partial:previous.partial||sources.some(source=>source.status!=='ok'),error:times.length?previous.error:'News sources unavailable or expired'};
}
function newsFallback(previous,message,now=Date.now()){const data=retainNewsSources(previous,now);return {...data,stale:true,partial:true,error:message,sources:data.sources.map(source=>source.status==='error'?source:{...source,status:'stale',error:message})};}

function setupResponsiveLayout(doc=document,media=window.matchMedia('(max-width: 620px)')){
  const metrics=doc.querySelector('.metrics'),range=metrics.lastElementChild;
  const rangeHome=doc.createComment('Desktop range metric');range.before(rangeHome);
  const rangeDisclosure=doc.createElement('details');rangeDisclosure.className='mobile-range';
  const rangeSummary=doc.createElement('summary');rangeSummary.textContent='Saved S1–R1 range';rangeDisclosure.append(rangeSummary);
  doc.getElementById('levels').append(rangeDisclosure);
  const mobileControls=doc.getElementById('chart-mobile-controls');
  const controls=[doc.querySelector('.chart-toolbar .segmented')];
  const homes=controls.map(node=>{const marker=doc.createComment('Desktop chart control');node.before(marker);return marker;});
  const technical=doc.getElementById('technical-details');
  function sync(){
    if(media.matches){mobileControls.append(...controls);rangeDisclosure.append(range);}
    else{controls.forEach((node,index)=>homes[index].after(node));rangeHome.after(range);}
    rangeDisclosure.hidden=!media.matches;
    mobileControls.hidden=!media.matches;technical.open=!media.matches;
  }
  media.addEventListener('change',sync);sync();
  return ()=>media.removeEventListener('change',sync);
}
async function refreshNews(){if(newsState.busy)return;newsState.busy=true;$('news-refresh').disabled=true;$('news-list').setAttribute('aria-busy','true');$('news-status').textContent='Refreshing sources…';try{const response=await fetch('/api/news',{signal:AbortSignal.timeout(18000),cache:'no-store'});const data=await response.json();if(!response.ok&&!(response.status===503&&Array.isArray(data.sources)))throw new Error(data.error||'News connection unavailable');newsState.data=data;newsRender();}catch(error){newsState.data=newsFallback(newsState.data,error.message);newsRender();}finally{newsState.busy=false;$('news-refresh').disabled=false;$('news-list').setAttribute('aria-busy','false');}}
priceChart.refreshTheme();
document.querySelectorAll('[data-open-settings]').forEach(button=>button.addEventListener('click',()=>$('settings-open').click()));
setupNavigation();
const timeframeButtons=[...document.querySelectorAll('[data-timeframe]')];
const syncTimeframeButtons=()=>timeframeButtons.forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.timeframe)===Number($('chart-timeframe').value))));
timeframeButtons.forEach(button=>button.addEventListener('click',()=>{$('chart-timeframe').value=button.dataset.timeframe;$('chart-timeframe').dispatchEvent(new Event('change'));}));
$('chart-timeframe').addEventListener('change',syncTimeframeButtons);
document.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{chartPrefs.bars=Number(button.dataset.days);document.querySelectorAll('[data-days]').forEach(b=>b.classList.toggle('selected',b===button));saveGraphPrefs();priceChart.resetView();}));
$('refresh').addEventListener('click',async()=>{refreshVolume(true);await loadSettings();await refresh();await refreshGraph(true);});
$('chart-timeframe').value=chartPrefs.timeframe;$('chart-type').value=chartPrefs.type;$('chart-scale').value=chartPrefs.scale;$('chart-fit').value=chartPrefs.fit||'levels';
syncTimeframeButtons();
for(const [id,key] of [['show-profile','profile'],['show-ema','ema'],['show-volume','volume'],['show-levels','levels'],['show-flips','flips'],['show-rsi','rsi'],['show-macd','macd'],['show-news','news']]){$(id).checked=!!chartPrefs[key];$(id).addEventListener('change',()=>{chartPrefs[key]=$(id).checked;saveGraphPrefs();});}
$('chart-timeframe').addEventListener('change',()=>{chartPrefs.timeframe=Number($('chart-timeframe').value);graphState.generation++;graphState.candles=[];graphState.loadedAt=0;$('chart-empty').style.display='flex';$('chart-empty').textContent='Loading selected chart interval…';saveGraphPrefs();refreshGraph(true);});
$('chart-type').addEventListener('change',()=>{chartPrefs.type=$('chart-type').value;saveGraphPrefs();});$('chart-scale').addEventListener('change',()=>{chartPrefs.scale=$('chart-scale').value;saveGraphPrefs();});$('chart-reset').addEventListener('click',()=>priceChart.resetView());$('chart-zoom-in').addEventListener('click',()=>priceChart.zoom(1/1.18));$('chart-zoom-out').addEventListener('click',()=>priceChart.zoom(1.18));$('chart-options-open').addEventListener('click',()=>$('chart-options-dialog').showModal());$('chart-options-close').addEventListener('click',()=>$('chart-options-dialog').close());
$('chart-fit').addEventListener('change',()=>{chartPrefs.fit=$('chart-fit').value;saveGraphPrefs();});
const chartHome=document.createComment('Chart returns here after expanded view');$('chart-panel').before(chartHome);
$('chart-expand').addEventListener('click',()=>{$('expanded-chart-body').append($('chart-panel'));$('expanded-chart-dialog').showModal();});
$('expanded-chart-close').addEventListener('click',()=>$('expanded-chart-dialog').close());
$('expanded-chart-dialog').addEventListener('close',()=>{chartHome.after($('chart-panel'));$('chart-expand').focus();});
setupResponsiveLayout();
document.querySelectorAll('[data-days]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===chartPrefs.bars));priceChart.setOptions(chartPrefs);sizeChartPanes();graphLabels();
$('news-refresh').addEventListener('click',refreshNews);
for(const id of ['news-filter','news-source','news-search'])$(id).addEventListener(id==='news-search'?'input':'change',()=>{newsState.expanded=false;newsState.visible=newsPageSize();newsRender();});
$('news-more').addEventListener('click',()=>{newsState.expanded=true;newsState.visible+=newsPageSize();newsRender();});refreshNews();setInterval(()=>{if(!document.hidden)refreshNews();},300000);
$('news-clear').addEventListener('click',()=>{newsState.selected=null;$('news-selection').textContent='';$('news-marker-stories').replaceChildren();$('news-daily').hidden=true;newsRender();});
$('news-daily').addEventListener('click',async()=>{const item=(newsState.data?.items||[]).find(item=>item.id===newsState.selected);if(!item)return;chartPrefs.timeframe=86400;$('chart-timeframe').value='86400';syncTimeframeButtons();graphState.generation++;graphState.candles=[];graphState.loadedAt=0;saveGraphPrefs();await refreshGraph();focusNews(item);});
mountCalendar();
function fillSettingsFields(next){for(const [code,value] of Object.entries(next.levels))$('level-'+code).value=value;}
function readSettings(){
  if(!editingConfig)throw new Error('Reopen chart levels before saving.');
  return validateSettings({levels:Object.fromEntries(Object.keys(editingConfig.levels).map(code=>[code,$('level-'+code).value])),revision:editingConfig.revision});
}
function fillSettings(){editingConfig=structuredClone(config);fillSettingsFields(editingConfig);$('settings-error').textContent='';}
function resetSettings(){fillSettingsFields(DEFAULT_SETTINGS);$('settings-error').textContent='Defaults are ready. Save to apply.';}
$('settings-open').addEventListener('click',()=>{if(!state.serverReady||!state.canManage)return;fillSettings();$('settings-dialog').showModal();});
$('settings-cancel').addEventListener('click',()=>$('settings-dialog').close());
$('settings-reset').addEventListener('click',resetSettings);
$('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  try{
    const next=readSettings();for(const button of form.querySelectorAll('button'))button.disabled=true;
    showSettings(await api('settings',{levels:next.levels,expectedRevision:editingConfig.revision}));
    $('settings-dialog').close();toast('Chart levels saved.');
  }catch(error){
    $('settings-error').textContent=error.message;
    if([401,403].includes(error.status)){state.canManage=false;renderSettingsAccess();}
  }finally{for(const button of form.querySelectorAll('button'))button.disabled=false;}
});
async function loadSettings(){
  try{showSettings(await api('settings'));}
  catch{state.serverReady=false;renderSettingsAccess();}
}
function syncFeedLayout(){
  const container=document.querySelector('.bottom-grid'),news=$('news'),calendar=$('calendar');
  if(stackedFeeds.matches)container.insertBefore(calendar,news);else container.insertBefore(news,calendar);
  if(!newsState.expanded)newsState.visible=newsPageSize();
  newsRender();
}
stackedFeeds.addEventListener('change',syncFeedLayout);syncFeedLayout();
applyConfig(config);refreshVolume();loadSettings().then(()=>Promise.all([refresh(),refreshGraph()]));
setInterval(()=>{void Promise.all([refresh(),refreshGraph(),refreshVolume()]);},15000);
setInterval(()=>{if(state.lastSuccess&&Date.now()-state.lastSuccess>45000)feedError('No recent successful update');renderChartFreshness();renderStats();renderVolume();renderDailyFreshness();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadSettings();refresh();refreshGraph();refreshNews();refreshVolume();}});
