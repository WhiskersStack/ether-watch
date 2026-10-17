// Official public schedules only; the owning Worker provides the Site access boundary.
export const CALENDAR_SOURCES = Object.freeze([
  {id:'bls',name:'Bureau of Labor Statistics',url:'https://www.bls.gov/schedule/news_release/cpi.htm',domains:['www.bls.gov','bls.gov']},
  {id:'bea',name:'Bureau of Economic Analysis',url:'https://www.bea.gov/news/schedule/full',domains:['www.bea.gov','bea.gov']},
  {id:'fed',name:'Federal Reserve',url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',domains:['www.federalreserve.gov','federalreserve.gov']},
  {id:'ethereum',name:'Ethereum official sources',url:'https://blog.ethereum.org/category/protocol',domains:['blog.ethereum.org','ethereum.org','www.ethereum.org']}
]);
const calendarFreshMs=6*60*60*1000,calendarStaleMs=24*60*60*1000,calendarWindowMs=30*24*60*60*1000;
const calendarMaxBytes=2*1024*1024,calendarMaxEvents=200,calendarMaxRequests=16;
const calendarMonths=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const calendarEntities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘'};
function calendarDecode(value){return String(value??'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(entity,key)=>{if(key[0]!=='#')return calendarEntities[key.toLowerCase()]??entity;const number=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):'';});}
export function calendarText(value){let text=String(value??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');for(let pass=0;pass<2;pass++)text=calendarDecode(text);return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();}
function calendarAttribute(tag,name){const match=tag.match(new RegExp('\\b'+name+'\\s*=\\s*(["\x27])([\\s\\S]*?)\\1','i'));return match?calendarDecode(match[2]):'';}
export function calendarSafeURL(value,source,base=source.url){try{const url=new URL(calendarDecode(value),base);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&source.domains.includes(url.hostname)?url.href:null;}catch{return null;}}
function calendarCheckedText(value){if(typeof value!=='string'||value.length>calendarMaxBytes)throw new Error('Official calendar is too large');return value.replace(/^\uFEFF/,'').replace(/<!--[\s\S]*?-->/g,'');}
function calendarDate(year,month,day){year=Number(year);month=Number(month);day=Number(day);if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');}
function calendarMonthDate(value,year){const match=calendarText(value).match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i);return match?calendarDate(match[3]??year,calendarMonths.indexOf(match[1].slice(0,3).toLowerCase())+1,match[2]):null;}
function calendarClock(value){const match=calendarText(value).match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);if(!match)return null;let hour=Number(match[1]);const minute=Number(match[2]),second=Number(match[3]??0),period=match[4]?.toLowerCase().replaceAll('.','');if(period){if(hour<1||hour>12)return null;hour=hour%12+(period==='pm'?12:0);}return hour<24&&minute<60&&second<60?{hour,minute,second}:null;}
function calendarZoneParts(time,zone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));return Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));}
function calendarUTC(date,clock){if(!date||!clock)return null;const [year,month,day]=date.split('-').map(Number);return new Date(Date.UTC(year,month-1,day,clock.hour,clock.minute,clock.second)).toISOString();}
export function calendarNYTime(date,clock){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date??'')||!clock)return null;
  const [year,month,day]=date.split('-').map(Number);if(calendarDate(year,month,day)!==date||!Number.isInteger(clock.hour)||clock.hour<0||clock.hour>23||!Number.isInteger(clock.minute)||clock.minute<0||clock.minute>59||!Number.isInteger(clock.second??0)||clock.second<0||clock.second>59)return null;
  const second=clock.second??0,guess=Date.UTC(year,month-1,day,clock.hour,clock.minute,second),offsets=new Set(),matches=[];
  for(const delta of [-43200000,43200000]){const time=guess+delta,parts=calendarZoneParts(time,'America/New_York');offsets.add(Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-time);}
  for(const offset of offsets){const time=guess-offset,parts=calendarZoneParts(time,'America/New_York');if(parts.year===year&&parts.month===month&&parts.day===day&&parts.hour===clock.hour&&parts.minute===clock.minute&&parts.second===second)matches.push(time);}
  // A missing or repeated local hour is not an exact time we can safely assert.
  return matches.length===1?new Date(matches[0]).toISOString():null;
}
function calendarEvent(source,kind,title,date,clock=null,zone='America/New_York',url=source.url,endDate=null){const startAt=zone==='UTC'?calendarUTC(date,clock):zone==='America/New_York'?calendarNYTime(date,clock):null;return {id:source.id+':'+kind+':'+date+':'+title,title:calendarText(title).slice(0,200),kind,status:'scheduled',source:source.name,sourceId:source.id,url:calendarSafeURL(url,source)??source.url,date,endDate:endDate??date,startAt,timeZone:zone,timePrecision:startAt?'time':'date',context:kind==='cpi'||kind==='pce'?'Official inflation-related release. Market reactions depend on the released data and expectations.':kind==='fomc'?'Official meeting dates; the calendar does not verify an exact decision time. Meeting dates can change.':'Official mainnet activation announcement. This schedule does not predict an ETH price effect.'};}
function calendarClassBody(html,className){const match=html.match(new RegExp('<([a-z][\\w-]*)\\b[^>]*class=["\x27][^"\x27]*\\b'+className+'\\b[^"\x27]*["\x27][^>]*>([\\s\\S]*?)<\\/\\1\\s*>','i'));return match?.[2]??'';}
function calendarUnique(events){const ids=new Set();return events.filter(event=>event.date&&calendarSafeURL(event.url,CALENDAR_SOURCES.find(source=>source.id===event.sourceId))).sort((a,b)=>a.date.localeCompare(b.date)||(a.startAt??'').localeCompare(b.startAt??'')).filter(event=>{if(ids.has(event.id))return false;ids.add(event.id);return true;}).slice(0,calendarMaxEvents);}
export function calendarUpcoming(events,now=Date.now()){
  const today=calendarZoneParts(now,'America/New_York'),end=calendarZoneParts(now+calendarWindowMs,'America/New_York');
  const firstDate=calendarDate(today.year,today.month,today.day),lastDate=calendarDate(end.year,end.month,end.day);
  return calendarUnique(events).filter(event=>event.startAt?Date.parse(event.startAt)>=now&&Date.parse(event.startAt)<=now+calendarWindowMs:(event.endDate??event.date)>=firstDate&&event.date<=lastDate).slice(0,40);
}
export function calendarParseBlsHTML(html){
  html=calendarCheckedText(html);const source=CALENDAR_SOURCES[0];
  if(!/Schedule of Releases for the Consumer Price Index/i.test(calendarText(html)))throw new Error('Official calendar format is unrecognized');
  const table=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(match=>/Reference Month\s+Release Date\s+Release Time/i.test(calendarText(match[1])));
  if(!table)throw new Error('Official calendar format is unrecognized');
  const events=[];
  for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match=>calendarText(match[1]));if(cells.length!==3)continue;const date=calendarMonthDate(cells[1]);if(date)events.push(calendarEvent(source,'cpi','Consumer Price Index · '+cells[0],date,calendarClock(cells[2])));}
  if(!events.length)throw new Error('Official calendar format is unrecognized');return calendarUnique(events);
}
export function calendarParseBlsICS(ics){
  ics=calendarCheckedText(ics).replace(/\r?\n[ \t]/g,'');if(!/BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/.test(ics))throw new Error('Official calendar format is unrecognized');
  const source=CALENDAR_SOURCES[0],events=[];let count=0;
  for(const match of ics.matchAll(/BEGIN:VEVENT\s*([\s\S]*?)END:VEVENT/g)){if(++count>2000)break;const block=match[1];if(/^STATUS:CANCELLED\s*$/mi.test(block)||/^RRULE:/mi.test(block))continue;const summary=block.match(/^SUMMARY(?:;[^:]*)?:(.+)$/mi)?.[1]?.replace(/\\[nN]/g,' ').replace(/\\([,;\\])/g,'$1');if(!/\bConsumer Price Index\b/i.test(summary??''))continue;
    const start=block.match(/^DTSTART([^:]*):([^\r\n]+)$/mi),value=start?.[2]?.trim(),parts=value?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);if(!parts)continue;const date=calendarDate(parts[1],parts[2],parts[3]);if(!date)continue;const clock=parts[4]===undefined?null:calendarClock(parts[4]+':'+parts[5]+':'+parts[6]);const tz=start[1].match(/;TZID="?([^;"\r\n]+)"?/i)?.[1];const zone=parts[7]?'UTC':/^(America\/New_York|US[-\/]Eastern|EST5EDT)$/i.test(tz??'')?'America/New_York':null;events.push(calendarEvent(source,'cpi',calendarText(summary),date,clock,zone));
  }
  if(!events.length)throw new Error('Official calendar format is unrecognized');return calendarUnique(events);
}
export function calendarParseBeaHTML(html){
  html=calendarCheckedText(html);const source=CALENDAR_SOURCES[1],text=calendarText(html),year=text.match(/\bYear\s+(20\d{2})\b/)?.[1];
  if(!/Release Schedule/i.test(text)||!year)throw new Error('Official calendar format is unrecognized');
  const events=[];let recognized=0;
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const title=calendarText(calendarClassBody(row[1],'release-title'));if(!/^Personal Income and Outlays\b/i.test(title))continue;recognized++;const cell=calendarClassBody(row[1],'scheduled-date'),date=calendarMonthDate(calendarText(calendarClassBody(cell,'release-date'))||calendarText(cell),year);if(!date)continue;events.push(calendarEvent(source,'pce',title,date,calendarClock(cell)));}
  if(!recognized||!events.length)throw new Error('Official calendar format is unrecognized');return calendarUnique(events);
}
export function calendarParseFomcHTML(html){
  html=calendarCheckedText(html);const source=CALENDAR_SOURCES[2],headings=[...html.matchAll(/<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/gi)].map(match=>({index:match.index,end:match.index+match[0].length,year:calendarText(match[1]).match(/\b(20\d{2})\s+(?:Tentative\s+)?FOMC Meetings\b/i)?.[1]})).filter(heading=>heading.year),events=[];
  if(!headings.length)throw new Error('Official calendar format is unrecognized');
  for(let index=0;index<headings.length;index++){const heading=headings[index],body=html.slice(heading.end,headings[index+1]?.index??html.length),months=[...body.matchAll(/<div\b[^>]*class=["'][^"']*\bfomc-meeting__month\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
    for(let row=0;row<months.length;row++){const label=calendarText(months[row][1]),monthParts=label.split('/').map(name=>calendarMonths.indexOf(name.trim().slice(0,3).toLowerCase())+1),fragment=body.slice(months[row].index+months[row][0].length,months[row+1]?.index??body.length),days=calendarText(calendarClassBody(fragment,'fomc-meeting__date')).match(/^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\*?$/);if(!days||monthParts.some(month=>month<1)||monthParts.length>2)continue;const date=calendarDate(heading.year,monthParts[0],days[1]),endDate=calendarDate(heading.year,monthParts.at(-1),days[2]??days[1]);if(date&&endDate&&endDate>=date)events.push(calendarEvent(source,'fomc','FOMC meeting',date,null,'America/New_York',source.url,endDate));}
  }
  if(!events.length)throw new Error('Official calendar format is unrecognized');return calendarUnique(events);
}
export function calendarMainnetLinks(html){
  html=calendarCheckedText(html);if(!/Protocol Announcements/i.test(calendarText(html)))throw new Error('Official calendar format is unrecognized');const source=CALENDAR_SOURCES[3],links=[],seen=new Set();let posts=0;
  for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){const title=calendarText(match[2]),url=calendarSafeURL(calendarAttribute(match[0],'href'),source);if(!url||new URL(url).hostname!=='blog.ethereum.org'||!/^\/\d{4}\/\d{2}\/\d{2}\//.test(new URL(url).pathname))continue;posts++;if(!/\bMainnet Announcement\b/i.test(title)||/\btestnet\b/i.test(title)||seen.has(url))continue;seen.add(url);links.push({title,url});if(links.length===2)break;}if(!posts)throw new Error('Official calendar format is unrecognized');return links;
}
export function calendarParseMainnetHTML(html,url){
  html=calendarCheckedText(html);const source=CALENDAR_SOURCES[3],safe=calendarSafeURL(url,source),title=calendarText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);if(!safe||!title||!/\bMainnet Announcement\b/i.test(title)||/\btestnet\b/i.test(title))throw new Error('Official calendar format is unrecognized');
  const blocks=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>calendarText(match[1]));
  for(const block of blocks){if(!/\bmainnet\b/i.test(block)||!/(?:scheduled|activat|will go live)/i.test(block)||/\b(?:testnet|sepolia|hoodi|holesky|TBD)\b|not (?:yet )?(?:decided|confirmed|scheduled)/i.test(block))continue;const date=calendarMonthDate(block);if(!date)continue;const exact=block.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s+UTC\b/),clock=exact?calendarClock(exact[0]):null;return [calendarEvent(source,'ethereum-upgrade',title,date,clock,clock?'UTC':null,safe)];}
  return [];
}
export function calendarParseRoadmapHTML(html,now=Date.now()){
  html=calendarCheckedText(html);if(!/Ethereum roadmap/i.test(calendarText(html)))throw new Error('Official calendar format is unrecognized');const source=CALENDAR_SOURCES[3],roadmap=[];let recognized=0;
  for(const match of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)){const title=calendarText(match[1]),targetLabel=calendarText(match[2]),target=targetLabel.match(/^(?:Q[1-4]\s+)?(20\d{2})$/);if(calendarMonthDate(targetLabel))recognized++;if(!target)continue;recognized++;if(Number(target[1])<new Date(now).getUTCFullYear()||!title||title.length>120)continue;roadmap.push({id:'ethereum:roadmap:'+title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-'),title,kind:'ethereum-upgrade',status:'unconfirmed',source:source.name,sourceId:source.id,url:'https://ethereum.org/roadmap/',date:null,startAt:null,timeZone:null,timePrecision:'undated',targetLabel,context:'Official planning target: '+targetLabel+'. A mainnet activation date is not confirmed by this roadmap.'});if(roadmap.length===3)break;}
  if(!recognized)throw new Error('Official calendar format is unrecognized');return roadmap;
}
async function calendarReadBody(response){if(Number(response.headers.get('Content-Length'))>calendarMaxBytes)throw new Error('Official calendar is too large');if(!response.body)return calendarCheckedText(await response.text());const reader=response.body.getReader(),decoder=new TextDecoder(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>calendarMaxBytes){await reader.cancel();throw new Error('Official calendar is too large');}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());return parts.join('');}finally{reader.releaseLock();}}
async function calendarFetchText(url,source,fetcher,budget){
  let target=calendarSafeURL(url,source);if(!target)throw new Error('Official calendar URL is not allowed');
  for(let redirect=0;redirect<3;redirect++){if(++budget.requests>calendarMaxRequests)throw new Error('Official calendar request limit reached');const response=await fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(6000),headers:{Accept:'text/html, text/calendar;q=0.9'}});if([301,302,303,307,308].includes(response.status)){target=calendarSafeURL(response.headers.get('Location')??'',source,target);if(!target)throw new Error('Official calendar redirect is not allowed');continue;}if(!response.ok)throw new Error('HTTP '+response.status);if(response.url&&!calendarSafeURL(response.url,source))throw new Error('Official calendar redirect is not allowed');return calendarReadBody(response);}throw new Error('Official calendar redirect limit reached');
}
async function calendarReadSource(source,fetcher,now,budget){
  if(source.id==='bls'){try{return {events:calendarParseBlsHTML(await calendarFetchText(source.url,source,fetcher,budget)),roadmap:[],warning:null};}catch{const ics=await calendarFetchText('https://www.bls.gov/schedule/news_release/bls.ics',source,fetcher,budget);return {events:calendarParseBlsICS(ics),roadmap:[],warning:'CPI HTML schedule unavailable; using the official iCalendar.'};}}
  if(source.id==='bea'){const urls=[source.url];if(new Date(now+calendarWindowMs).getUTCFullYear()!==new Date(now).getUTCFullYear())urls.push('https://www.bea.gov/news/schedule/next-year');const results=await Promise.allSettled(urls.map(url=>calendarFetchText(url,source,fetcher,budget).then(calendarParseBeaHTML))),valid=results.filter(result=>result.status==='fulfilled');if(!valid.length)throw results[0].reason;return {events:calendarUnique(valid.flatMap(result=>result.value)),roadmap:[],warning:valid.length<results.length?'One BEA schedule year is unavailable.':null};}
  if(source.id==='fed')return {events:calendarParseFomcHTML(await calendarFetchText(source.url,source,fetcher,budget)),roadmap:[],warning:null};
  const [protocol,planning]=await Promise.allSettled([calendarFetchText(source.url,source,fetcher,budget).then(calendarMainnetLinks),calendarFetchText('https://ethereum.org/roadmap/',source,fetcher,budget).then(html=>calendarParseRoadmapHTML(html,now))]);
  if(protocol.status==='rejected'&&planning.status==='rejected')throw new Error('Official Ethereum calendars are unavailable');
  const events=[],warnings=[];let verified=0;
  if(protocol.status==='fulfilled'){const articles=await Promise.allSettled(protocol.value.map(link=>calendarFetchText(link.url,source,fetcher,budget).then(html=>calendarParseMainnetHTML(html,link.url))));for(const article of articles){if(article.status==='fulfilled'){events.push(...article.value);verified++;if(!article.value.length)warnings.push('A mainnet announcement has no verifiable activation date.');}else warnings.push('A mainnet announcement could not be verified.');}}else warnings.push('Mainnet announcements are unavailable.');
  if(planning.status==='rejected')warnings.push('The official roadmap is unavailable.');
  if(planning.status==='rejected'&&protocol.status==='fulfilled'&&protocol.value.length&&verified===0)throw new Error('Official Ethereum calendars are unavailable');
  const roadmap=planning.status==='fulfilled'?planning.value.filter(card=>!events.some(event=>event.title.toLowerCase().includes(card.title.toLowerCase()))):[];
  return {events:calendarUnique(events),roadmap,warning:warnings.length?[...new Set(warnings)].join(' '):null};
}
function calendarFailure(error){return ['TimeoutError','AbortError'].includes(error?.name)?'Official calendar request timed out':/^(HTTP \d{3}|Official [A-Za-z ]+\.?$)/.test(error?.message??'')?error.message:'Official calendar request failed';}
async function calendarLoadSource(source,request,deps,now,budget){
  const cache=deps.cache===undefined?globalThis.caches?.default:deps.cache,key=new Request(new URL('/__ether-watch-calendar/v1/'+source.id,request.url).href),metadata={id:source.id,name:source.name,url:source.url};let previous=null;
  if(cache){try{const response=await cache.match(key);if(response){const data=await response.json(),time=Date.parse(data.fetchedAt);if(Array.isArray(data.events)&&Array.isArray(data.roadmap)&&Number.isFinite(time)&&time<=now&&now-time<=calendarStaleMs)previous=data;}}catch{/* Unavailable edge cache does not block official sources. */}}
  const result=(data,status,error=null)=>{const events=calendarUpcoming(data?.events??[],now),roadmap=(data?.roadmap??[]).slice(0,3);return {events,roadmap,source:{...metadata,status,fetchedAt:data?.fetchedAt??null,lastAttemptAt:status==='ok'?(data?.fetchedAt??new Date(now).toISOString()):new Date(now).toISOString(),error,warning:data?.warning??null,eventCount:events.length,roadmapCount:roadmap.length}};};
  if(previous&&now-Date.parse(previous.fetchedAt)<calendarFreshMs)return result(previous,'ok');
  try{const data={...await calendarReadSource(source,deps.fetch??globalThis.fetch,now,budget),fetchedAt:new Date(now).toISOString()};if(cache){try{await cache.put(key,Response.json(data,{headers:{'Cache-Control':'public,max-age=86400'}}));}catch{/* Verified official data remains usable without cache persistence. */}}return result(data,'ok');}catch(error){return result(previous,previous?'stale':'error',calendarFailure(error));}
}
export async function fetchCalendar(request,deps={}){
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'GET'}});
  const now=typeof deps.now==='function'?deps.now():deps.now??Date.now(),budget={requests:0},results=await Promise.all(CALENDAR_SOURCES.map(source=>calendarLoadSource(source,request,deps,now,budget))),sources=results.map(result=>result.source),times=sources.map(source=>Date.parse(source.fetchedAt)).filter(Number.isFinite),unavailable=sources.every(source=>source.status==='error');
  return Response.json({events:calendarUpcoming(results.flatMap(result=>result.events),now),roadmap:results.flatMap(result=>result.roadmap).slice(0,3),sources,fetchedAt:times.length?new Date(Math.min(...times)).toISOString():null,checkedAt:new Date(now).toISOString(),stale:sources.some(source=>source.status==='stale'),partial:sources.some(source=>source.status!=='ok'||source.warning),error:unavailable?'Official calendars are unavailable. Retry later.':null},{status:unavailable?503:200,headers});
}
