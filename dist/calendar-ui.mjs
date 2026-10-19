const DAY=86400000,MAX_AGE=DAY,FRESH_AGE=21600000,CLOCK_SKEW=60000;
export const CALENDAR_TIME_ZONES=Object.freeze([
  ['Asia/Jerusalem','Jerusalem'],
  ['local','Device timezone'],
  ['UTC','UTC'],
  ['Europe/London','London'],
  ['America/New_York','New York'],
  ['America/Chicago','Chicago'],
  ['America/Los_Angeles','Los Angeles'],
  ['Asia/Dubai','Dubai'],
  ['Asia/Kolkata','India (Kolkata)'],
  ['Asia/Singapore','Singapore'],
  ['Asia/Hong_Kong','Hong Kong'],
  ['Asia/Tokyo','Tokyo'],
  ['Australia/Sydney','Sydney']
]);
export function calendarZonePreference(value){return CALENDAR_TIME_ZONES.some(([zone])=>zone===value)?value:'Asia/Jerusalem';}
export function resolveCalendarZone(value,deviceZone){
  const zone=calendarZonePreference(value);if(zone!=='local')return zone;
  try{const local=deviceZone??new Intl.DateTimeFormat().resolvedOptions().timeZone;if(!local)return 'UTC';new Intl.DateTimeFormat('en',{timeZone:local});return local;}catch{return 'UTC';}
}
const hosts=new Set(['www.bls.gov','www.bea.gov','www.federalreserve.gov','blog.ethereum.org','ethereum.org','fred.stlouisfed.org']);
export function calendarSafeLink(event){try{const url=new URL(event.url);return url.protocol==='https:'&&!url.username&&!url.password&&hosts.has(url.hostname)?url.href:null;}catch{return null;}}
export function formatCalendarWhen(event,zone='Asia/Jerusalem'){
  if(event.status==='unconfirmed'||!event.date)return 'Unconfirmed · no activation date';
  zone=resolveCalendarZone(zone);
  if(event.startAt&&Number.isFinite(Date.parse(event.startAt)))return new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(event.startAt))+' · '+zone;
  const date=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium'}).format(new Date(value+'T12:00:00Z'));
  return date(event.date)+(event.endDate&&event.endDate!==event.date?' – '+date(event.endDate):'')+' · date only';
}
export function calendarCountdown(event,source,now=Date.now()){
  const verified=Date.parse(source?.fetchedAt),start=Date.parse(event.startAt);
  if(event.status==='unconfirmed'||!Number.isFinite(start))return '';
  if(source?.fetchedAt&&(!Number.isFinite(verified)||verified>now+CLOCK_SKEW))return 'Countdown unavailable: invalid schedule verification timestamp';
  if(source?.status!=='ok'||!Number.isFinite(verified)||now-verified>FRESH_AGE)return 'Countdown unavailable until schedule is reverified';
  const remaining=start-now;if(remaining<=0)return 'Scheduled time reached';
  const minutes=Math.ceil(remaining/60000);return minutes>=1440?'In '+Math.floor(minutes/1440)+'d '+Math.floor(minutes%1440/60)+'h':minutes>=60?'In '+Math.floor(minutes/60)+'h '+minutes%60+'m':'In '+minutes+'m';
}
export function retainCalendar(data,message=null,now=Date.now()){
  const sources=(data?.sources||[]).map(source=>{const fetched=Date.parse(source.fetchedAt),invalid=source.fetchedAt&&(!Number.isFinite(fetched)||fetched>now+CLOCK_SKEW),usable=Number.isFinite(fetched)&&!invalid&&now-fetched<=MAX_AGE;return {...source,status:!usable?'error':message?'stale':source.status,error:!usable?(invalid?'Invalid schedule verification timestamp':source.fetchedAt?'Cached schedule expired':source.error||message||'Schedule unavailable'):message||source.error};});
  const usable=new Set(sources.filter(source=>source.status!=='error').map(source=>source.id));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const events=(data?.events||[]).filter(event=>usable.has(event.sourceId)&&(event.startAt?Date.parse(event.startAt)>=now:(event.endDate||event.date)>=today));
  return {...data,sources,events,roadmap:(data?.roadmap||[]).filter(event=>usable.has(event.sourceId)),error:message||data?.error||null};
}
export function calendarStatus(sources){
  if(sources.every(source=>source.status==='error'))return 'Calendar unavailable';
  if(sources.some(source=>source.status!=='ok'))return 'Some schedules are cached or unavailable';
  return sources.some(source=>source.warning)?'Official schedules verified · source notice':'Official schedules verified';
}
export function mountCalendar(){
  const $=id=>document.getElementById(id),state={data:null,busy:false,zone:'Asia/Jerusalem'};
  try{state.zone=calendarZonePreference(localStorage.getItem('etherwatch-calendar-zone'));}catch{}
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  $('calendar-zone').replaceChildren(...CALENDAR_TIME_ZONES.map(([zone,label])=>{const option=node('option',label);option.value=zone;return option;}));$('calendar-zone').value=state.zone;
  function render(){
    if(!state.data)return;state.data=retainCalendar(state.data);
    const data=state.data,list=$('calendar-events'),roadmap=$('calendar-roadmap');list.replaceChildren();roadmap.replaceChildren();
    const sources=new Map(data.sources.map(source=>[source.id,source]));
    for(const [events,target] of [[data.events,list],[data.roadmap,roadmap]])for(const event of events){
      const url=calendarSafeLink(event);if(!url)continue;
      const card=node('article',undefined,'calendar-card'),heading=node('h3'),link=node('a',event.title);link.href=url;link.target='_blank';link.rel='noopener noreferrer';heading.append(link);
      const source=sources.get(event.sourceId),when=node('p',formatCalendarWhen(event,state.zone),'calendar-when'),countdown=node('p',calendarCountdown(event,source),'calendar-countdown');
      const verified=source?.fetchedAt?' · verified '+new Date(source.fetchedAt).toLocaleString():'';
      card.dataset.calendarId=event.id;card.append(node('span',event.status==='unconfirmed'?'UNCONFIRMED':event.kind.toUpperCase(),'tag'),heading,when,countdown,node('p',event.context,'calendar-context'),node('small',event.source+(source?.status==='stale'?' · cached':'')+verified));target.append(card);
    }
    if(!list.children.length)list.append(node('p',data.sources.every(source=>source.status==='error')?'Official schedules are unavailable. Try Refresh calendar.':'No verified events in the next 30 days.','news-empty'));
    $('calendar-roadmap-title').hidden=!roadmap.children.length;
    const health=$('calendar-sources'),opened=new Set([...health.querySelectorAll('details[open]')].map(el=>el.dataset.source));health.replaceChildren();
    for(const source of data.sources){const details=node('details'),summary=node('summary',source.name+' · '+({ok:'Verified',stale:'Cached',error:'Unavailable'}[source.status]||'Unavailable'));details.dataset.source=source.id;details.open=opened.has(source.id);details.append(summary,node('p',[source.fetchedAt?'Last verified '+new Date(source.fetchedAt).toLocaleString():'Not yet verified',source.error,source.warning].filter(Boolean).join(' · ')));health.append(details);}
    $('calendar-status').textContent=calendarStatus(data.sources);
  }
  async function refresh(){
    if(state.busy||document.hidden)return;state.busy=true;$('calendar-refresh').disabled=true;$('calendar-events').setAttribute('aria-busy','true');$('calendar-status').textContent='Checking official schedules…';
    try{const response=await fetch('/api/calendar',{signal:AbortSignal.timeout(25000),cache:'no-store'}),data=await response.json();if(!Array.isArray(data.events)||!Array.isArray(data.roadmap)||!Array.isArray(data.sources)||!response.ok&&response.status!==503)throw Error('Calendar connection unavailable');state.data=data;}
    catch(error){state.data=retainCalendar(state.data,error.message);}
    finally{state.busy=false;$('calendar-refresh').disabled=false;$('calendar-events').setAttribute('aria-busy','false');render();}
  }
  $('calendar-refresh').addEventListener('click',refresh);$('calendar-zone').addEventListener('change',()=>{state.zone=calendarZonePreference($('calendar-zone').value);try{localStorage.setItem('etherwatch-calendar-zone',state.zone);}catch{}render();});
  setInterval(()=>{if(!document.hidden)refresh();},3600000);
  setInterval(()=>{if(document.hidden||!state.data)return;const before=state.data.events?.length||0,next=retainCalendar(state.data);if(next.events.length!==before||next.roadmap.length!==(state.data.roadmap?.length||0)||next.sources.some((source,index)=>source.status!==state.data.sources[index]?.status)){state.data=next;render();return;}const sources=new Map(next.sources.map(source=>[source.id,source]));for(const event of next.events){const card=[...$('calendar-events').children].find(el=>el.dataset.calendarId===event.id);if(card)card.querySelector('.calendar-countdown').textContent=calendarCountdown(event,sources.get(event.sourceId));}},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();return {refresh};
}
