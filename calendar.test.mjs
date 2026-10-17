import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const calendarCode=readFileSync(new URL('./worker/calendar.js',import.meta.url),'utf8');
const {CALENDAR_SOURCES,calendarText,calendarSafeURL,calendarNYTime,calendarUpcoming,calendarParseBlsHTML,calendarParseBlsICS,calendarParseBeaHTML,calendarParseFomcHTML,calendarMainnetLinks,calendarParseMainnetHTML,calendarParseRoadmapHTML,fetchCalendar}=await import('data:text/javascript;base64,'+Buffer.from(calendarCode).toString('base64'));
const now=Date.parse('2026-10-17T12:00:00Z'),request=()=>new Request('https://ether-watch.example/api/calendar');
const blsRow=(period,date,time)=>'<tr><td>'+period+'</td><td>'+date+'</td><td>'+time+'</td></tr>';
const blsHTML=(rows=[blsRow('September 2026','Oct. 29, 2026','08:30 AM'),blsRow('October 2026','Nov. 10, 2026','08:30 AM'),blsRow('November 2026','Dec. 10, 2026','08:30 AM')])=>'<h2>Schedule of Releases for the Consumer Price Index</h2><table><tr><th>Reference Month</th><th>Release Date</th><th>Release Time</th></tr>'+rows.join('')+'</table>';
const beaRow=(date,time,title='Personal Income and Outlays, September 2026')=>'<tr class="scheduled-releases-type-press"><td class="scheduled-date no-wrap"><div class="release-date">'+date+'</div><small class="text-muted">'+time+'</small></td><td>News</td><td class="release-title views-field">'+title+'</td></tr>';
const beaHTML=(year=2026,rows=[beaRow('October 29','8:30 AM')])=>'<h1>Release Schedule</h1><table><thead><tr><th>Year '+year+'</th><th>Release</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
const fedRow=(month,days)=>'<div class="fomc-meeting__month col-xs-5"><strong>'+month+'</strong></div><div class="fomc-meeting__date col-xs-4">'+days+'</div>';
const fedHTML='<h4><a>2026 FOMC Meetings</a></h4>'+fedRow('October','27-28')+fedRow('December','8-9*')+'<h4>2027 Tentative FOMC Meetings</h4>'+fedRow('Jan/Feb','31-1');
const mainnetURL='https://blog.ethereum.org/2026/10/01/sample-mainnet-announcement';
const oldMainnetURL='https://blog.ethereum.org/2025/11/06/earlier-mainnet-announcement';
// Synthetic fixtures exercise the verified official HTML shapes; their dates are not published forecasts.
const protocolHTML='<h1>Protocol Announcements</h1><a href="/2026/10/02/sample-testnet-announcement"><h2>Sample Testnet Announcement</h2></a><a href="'+mainnetURL+'"><h2>Sample Mainnet Announcement</h2></a><a href="'+oldMainnetURL+'">Earlier Mainnet Announcement</a>';
const mainnetHTML='<h1>Sample Mainnet Announcement</h1><p>The upgrade is scheduled to activate on the Ethereum mainnet at slot 13,164,544 (October 28, 2026, 13:14:15 UTC).</p>';
const oldMainnetHTML='<h1>Earlier Mainnet Announcement</h1><p>The upgrade is scheduled to activate on the Ethereum mainnet on May 07, 2025 at epoch 364032 (10:05:11 UTC).</p>';
const roadmapHTML='<h1>Ethereum roadmap</h1><h2>Earlier</h2><p>December 3, 2025</p><h2>Sample</h2><p>Q4 2026</p><h3>Main features</h3><h2>Future</h2><p>2027</p>';
function fixtureFetch(overrides={},calls=[]){return async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);if(Object.hasOwn(overrides,url)){const override=overrides[url];if(override instanceof Error)throw override;return typeof override==='function'?override(url,options):new Response(override);}
  const bodies={
    [CALENDAR_SOURCES[0].url]:blsHTML(),[CALENDAR_SOURCES[1].url]:beaHTML(),[CALENDAR_SOURCES[2].url]:fedHTML,
    [CALENDAR_SOURCES[3].url]:protocolHTML,'https://ethereum.org/roadmap/':roadmapHTML,[mainnetURL]:mainnetHTML,[oldMainnetURL]:oldMainnetHTML
  };
  assert.ok(Object.hasOwn(bodies,url),'Unexpected fixture request '+url);return new Response(bodies[url],{headers:{'Content-Type':'text/html'}});
};}
function memoryCache(){const entries=new Map();return {entries,async match(key){return entries.get(key.url)?.clone();},async put(key,response){entries.set(key.url,response.clone());}};}
const noNetwork=async()=>{throw new TypeError('Offline fixture');};

test('New York release times follow DST and reject nonexistent or ambiguous local hours',()=>{
  assert.equal(calendarNYTime('2026-10-29',{hour:8,minute:30,second:0}),'2026-10-29T12:30:00.000Z');
  assert.equal(calendarNYTime('2026-11-10',{hour:8,minute:30,second:0}),'2026-11-10T13:30:00.000Z');
  assert.equal(calendarNYTime('2026-03-08',{hour:2,minute:30,second:0}),null);
  assert.equal(calendarNYTime('2026-11-01',{hour:1,minute:30,second:0}),null);
  assert.equal(calendarNYTime('2026-02-31',{hour:8,minute:30}),null);
  assert.equal(calendarNYTime('2026-10-29',{hour:25,minute:0}),null);
});
test('CPI table uses its published release date and time, never the reference period',()=>{
  const events=calendarParseBlsHTML(blsHTML());assert.equal(events.length,3);assert.equal(events[0].date,'2026-10-29');assert.equal(events[0].startAt,'2026-10-29T12:30:00.000Z');assert.equal(events[1].startAt,'2026-11-10T13:30:00.000Z');assert.equal(events[0].sourceId,'bls');
  const dateOnly=calendarParseBlsHTML(blsHTML([blsRow('October 2026','Nov. 10, 2026','To be announced')]))[0];assert.equal(dateOnly.startAt,null);assert.equal(dateOnly.timePrecision,'date');
  assert.throws(()=>calendarParseBlsHTML(blsHTML([blsRow('January 2026','Feb. 31, 2026','08:30 AM')])),/unrecognized/);
});
test('iCalendar handles UTC, known Eastern zones, all-day dates, folding and cancellation',()=>{
  const event=lines=>'BEGIN:VEVENT\r\n'+lines.join('\r\n')+'\r\nEND:VEVENT\r\n';
  const ics='BEGIN:VCALENDAR\r\n'+[
    event(['SUMMARY:Consumer Price Index for',' October 2026','DTSTART;TZID=US-Eastern:20261110T083000']),
    event(['SUMMARY:Consumer Price Index UTC fixture','DTSTART:20261029T123000Z']),
    event(['SUMMARY:Consumer Price Index date-only fixture','DTSTART;VALUE=DATE:20261111']),
    event(['SUMMARY:Consumer Price Index unknown-zone fixture','DTSTART;TZID=Unknown/Zone:20261112T083000']),
    event(['SUMMARY:Consumer Price Index cancelled','DTSTART:20261113T123000Z','STATUS:CANCELLED']),
    event(['SUMMARY:Consumer Price Index recurring fixture','DTSTART:20261114T123000Z','RRULE:FREQ=MONTHLY']),
    event(['SUMMARY:Unrelated release','DTSTART:20261115T123000Z'])
  ].join('')+'END:VCALENDAR';
  const events=calendarParseBlsICS(ics);assert.equal(events.length,4);assert.equal(events.find(event=>event.date==='2026-11-10').startAt,'2026-11-10T13:30:00.000Z');assert.equal(events.find(event=>event.date==='2026-10-29').startAt,'2026-10-29T12:30:00.000Z');assert.ok(events.filter(event=>event.date>='2026-11-11').every(event=>event.startAt===null&&event.timePrecision==='date'));
});
test('BEA schedule reads its explicit year and only Personal Income and Outlays releases',()=>{
  const events=calendarParseBeaHTML(beaHTML(2026,[beaRow('October 29','8:30 AM'),beaRow('October 29','8:30 AM','GDP release'),beaRow('November 25','','Personal Income and Outlays, October 2026')]));
  assert.equal(events.length,2);assert.equal(events[0].kind,'pce');assert.equal(events[0].startAt,'2026-10-29T12:30:00.000Z');assert.equal(events[1].startAt,null);assert.equal(events[1].timePrecision,'date');
  assert.throws(()=>calendarParseBeaHTML(beaHTML().replace('Year 2026','Year unavailable')),/unrecognized/);
});
test('FOMC meetings remain date-only, including a cross-month meeting range',()=>{
  const events=calendarParseFomcHTML(fedHTML);assert.equal(events.length,3);assert.equal(events[0].date,'2026-10-27');assert.equal(events[0].endDate,'2026-10-28');assert.equal(events[2].date,'2027-01-31');assert.equal(events[2].endDate,'2027-02-01');assert.ok(events.every(event=>event.startAt===null&&event.timePrecision==='date'));assert.ok(events.every(event=>!event.context.includes('2:00')));
});
test('upcoming window excludes past timestamps, keeps ongoing date-only meetings and deduplicates',()=>{
  const events=calendarParseBlsHTML(blsHTML()),meeting=calendarParseFomcHTML(fedHTML)[0];
  assert.equal(calendarUpcoming([...events,...events],now).length,2);
  assert.equal(calendarUpcoming([meeting],Date.parse('2026-10-28T22:00:00Z')).length,1);
  assert.equal(calendarUpcoming([meeting],Date.parse('2026-10-29T12:00:00Z')).length,0);
  assert.equal(calendarUpcoming(events,Date.parse('2026-10-29T12:30:00.001Z')).some(event=>event.date==='2026-10-29'),false);
});
test('mainnet discovery excludes testnets and unsafe or undated article URLs',()=>{
  const links=calendarMainnetLinks(protocolHTML+'<a href="https://evil.example/2026/10/01/upgrade">Fake Mainnet Announcement</a>');assert.equal(links.length,2);assert.equal(links[0].url,mainnetURL);
  assert.deepEqual(calendarMainnetLinks('<h1>Protocol Announcements</h1><a href="/2026/10/02/testnet">Sample Testnet Announcement</a>'),[]);
  assert.throws(()=>calendarMainnetLinks('<h1>Protocol Announcements</h1><div>Unknown feed structure</div>'),/unrecognized/);
});
test('mainnet activation parsing handles slot numbers, explicit UTC and missing exact time',()=>{
  const event=calendarParseMainnetHTML(mainnetHTML,mainnetURL)[0];assert.equal(event.date,'2026-10-28');assert.equal(event.startAt,'2026-10-28T13:14:15.000Z');assert.equal(event.timeZone,'UTC');
  assert.equal(calendarParseMainnetHTML(oldMainnetHTML,oldMainnetURL)[0].startAt,'2025-05-07T10:05:11.000Z');
  const dateOnly=calendarParseMainnetHTML('<h1>Sample Mainnet Announcement</h1><p>The upgrade is scheduled to activate on mainnet on October 28, 2026; the exact time is not provided.</p>',mainnetURL)[0];assert.equal(dateOnly.startAt,null);assert.equal(dateOnly.timePrecision,'date');
  const labelled=calendarParseMainnetHTML('<h1>Sample Mainnet Announcement</h1><p>The upgrade is scheduled to activate on mainnet on October 28, 2026 at 8:30 a.m. EDT (12:30:00 UTC).</p>',mainnetURL)[0];assert.equal(labelled.startAt,'2026-10-28T12:30:00.000Z');
  assert.deepEqual(calendarParseMainnetHTML('<h1>Sample Mainnet Announcement</h1><p>Mainnet activation dates have not yet been decided. Sepolia activates on October 28, 2026 at 12:30:00 UTC.</p>',mainnetURL),[]);
  assert.throws(()=>calendarParseMainnetHTML('<h1>Sample Testnet Announcement</h1><p>Sepolia activates on October 28, 2026 at 12:30 UTC.</p>',mainnetURL),/unrecognized/);
});
test('roadmap quarter and year targets stay undated and unconfirmed',()=>{
  const cards=calendarParseRoadmapHTML(roadmapHTML,now);assert.equal(cards.length,2);assert.equal(cards[0].targetLabel,'Q4 2026');assert.ok(cards.every(card=>card.date===null&&card.startAt===null&&card.status==='unconfirmed'&&card.timePrecision==='undated'));assert.ok(cards.every(card=>card.url==='https://ethereum.org/roadmap/'));
  assert.throws(()=>calendarParseRoadmapHTML('<h1>Ethereum roadmap</h1><div>Unrecognized redesign</div>',now),/unrecognized/);
});
test('official URL allowlists and plain text reject active content and external targets',()=>{
  const source=CALENDAR_SOURCES[0];for(const value of ['http://www.bls.gov/schedule/','https://www.bls.gov.evil.example/','https://user:pass@www.bls.gov/schedule/','https://www.bls.gov:8080/schedule/','javascript:alert(1)'])assert.equal(calendarSafeURL(value,source),null,value);
  assert.equal(calendarSafeURL('/schedule/news_release/cpi.htm',source),source.url);assert.equal(calendarText('&lt;script&gt;bad()&lt;/script&gt; CPI &amp; prices'),'CPI & prices');
});
test('GET API returns verified next-30-day events, source health and separate undated roadmap',async()=>{
  const calls=[],response=await fetchCalendar(request(),{fetch:fixtureFetch({},calls),cache:null,now}),body=await response.json();assert.equal(response.status,200);assert.equal(body.events.length,5);assert.equal(body.roadmap.length,1);assert.equal(body.roadmap[0].title,'Future');assert.equal(body.stale,false);assert.equal(body.partial,false);assert.equal(body.fetchedAt,new Date(now).toISOString());assert.equal(body.sources.length,4);assert.ok(body.sources.every(source=>source.status==='ok'&&source.error===null));assert.equal(calls.length,7);assert.equal(response.headers.get('Cache-Control'),'no-store');
  let called=false;const denied=await fetchCalendar(new Request(request().url,{method:'POST'}),{fetch:()=>{called=true;throw new Error('Unexpected fetch');},cache:null,now});assert.equal(denied.status,405);assert.equal(denied.headers.get('Allow'),'GET');assert.equal(called,false);
});
test('six-hour cache preserves original retrieval times and refreshes only after expiry',async()=>{
  const cache=memoryCache(),calls=[],deps={fetch:fixtureFetch({},calls),cache,now};const first=await (await fetchCalendar(request(),deps)).json();assert.equal(calls.length,7);assert.equal(cache.entries.size,4);
  const second=await (await fetchCalendar(request(),{...deps,now:now+5*3600000})).json();assert.equal(calls.length,7);assert.equal(second.fetchedAt,first.fetchedAt);assert.ok(second.sources.every(source=>source.fetchedAt===first.fetchedAt&&source.lastAttemptAt===first.fetchedAt));
  const third=await (await fetchCalendar(request(),{...deps,now:()=>now+6*3600000+1})).json();assert.equal(calls.length,14);assert.equal(third.fetchedAt,new Date(now+6*3600000+1).toISOString());
});
test('failed refresh retains labeled cache through 24 hours and then expires without invented events',async()=>{
  const cache=memoryCache(),first=await (await fetchCalendar(request(),{fetch:fixtureFetch(),cache,now})).json();const staleResponse=await fetchCalendar(request(),{fetch:noNetwork,cache,now:now+7*3600000}),stale=await staleResponse.json();assert.equal(staleResponse.status,200);assert.equal(stale.stale,true);assert.equal(stale.partial,true);assert.equal(stale.fetchedAt,first.fetchedAt);assert.ok(stale.sources.every(source=>source.status==='stale'&&source.error));assert.equal(stale.events.length,5);
  const expiredResponse=await fetchCalendar(request(),{fetch:noNetwork,cache,now:now+24*3600000+1}),expired=await expiredResponse.json();assert.equal(expiredResponse.status,503);assert.equal(expired.events.length,0);assert.equal(expired.roadmap.length,0);assert.equal(expired.fetchedAt,null);assert.ok(expired.sources.every(source=>source.status==='error'));assert.match(expired.error,/unavailable/);
});
test('BLS HTML failure falls back to official iCalendar with an explicit warning',async()=>{
  const overrides={[CALENDAR_SOURCES[0].url]:'<h1>Access denied</h1>','https://www.bls.gov/schedule/news_release/bls.ics':'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Consumer Price Index fixture\nDTSTART;TZID=America/New_York:20261110T083000\nEND:VEVENT\nEND:VCALENDAR'};
  const body=await (await fetchCalendar(request(),{fetch:fixtureFetch(overrides),cache:null,now})).json(),source=body.sources.find(source=>source.id==='bls');assert.equal(source.status,'ok');assert.match(source.warning,/official iCalendar/);assert.equal(body.partial,true);assert.equal(body.events.filter(event=>event.kind==='cpi').length,1);
});
test('changed formats and oversized bodies surface source errors without suppressing other sources',async()=>{
  const overrides={[CALENDAR_SOURCES[0].url]:'unknown','https://www.bls.gov/schedule/news_release/bls.ics':'unknown',[CALENDAR_SOURCES[1].url]:()=>new Response('large',{headers:{'Content-Length':String(3*1024*1024)}})};
  const response=await fetchCalendar(request(),{fetch:fixtureFetch(overrides),cache:null,now}),body=await response.json();assert.equal(response.status,200);assert.equal(body.partial,true);assert.equal(body.events.some(event=>['cpi','pce'].includes(event.kind)),false);assert.equal(body.sources[0].status,'error');assert.match(body.sources[0].error,/unrecognized/);assert.equal(body.sources[1].status,'error');assert.match(body.sources[1].error,/too large/);assert.equal(body.sources[2].status,'ok');
});
test('verified roadmap survives a protocol-source failure with an explicit partial warning',async()=>{
  const body=await (await fetchCalendar(request(),{fetch:fixtureFetch({[CALENDAR_SOURCES[3].url]:new Error('fixture failure')}),cache:null,now})).json(),source=body.sources.find(source=>source.id==='ethereum');assert.equal(source.status,'ok');assert.match(source.warning,/Mainnet announcements are unavailable/);assert.equal(body.partial,true);assert.equal(body.events.some(event=>event.kind==='ethereum-upgrade'),false);assert.equal(body.roadmap.length,2);
});
test('cross-host redirects are rejected before requesting an external host',async()=>{
  const calls=[],overrides={[CALENDAR_SOURCES[2].url]:()=>new Response(null,{status:302,headers:{Location:'https://evil.example/calendar'}})},body=await (await fetchCalendar(request(),{fetch:fixtureFetch(overrides,calls),cache:null,now})).json();assert.equal(body.sources.find(source=>source.id==='fed').status,'error');assert.match(body.sources.find(source=>source.id==='fed').error,/redirect is not allowed/);assert.equal(calls.some(call=>call.url.includes('evil.example')),false);
});
test('redirect loops cannot exceed the shared sixteen-request budget',async()=>{
  let calls=0;const response=await fetchCalendar(request(),{fetch:async url=>{calls++;return new Response(null,{status:302,headers:{Location:url}});},cache:null,now}),body=await response.json();assert.equal(response.status,503);assert.ok(calls<=16);assert.equal(body.events.length,0);assert.equal(body.roadmap.length,0);
});
test('streamed body limit is enforced without a Content-Length header',async()=>{
  const overrides={[CALENDAR_SOURCES[1].url]:() =>new Response('x'.repeat(2*1024*1024+1))},body=await (await fetchCalendar(request(),{fetch:fixtureFetch(overrides),cache:null,now})).json();assert.equal(body.sources.find(source=>source.id==='bea').status,'error');assert.match(body.sources.find(source=>source.id==='bea').error,/too large/);assert.equal(body.events.some(event=>event.kind==='pce'),false);
});
test('BEA next-year schedule is consulted when the 30-day window crosses New Year',async()=>{
  const clock=Date.parse('2026-12-20T12:00:00Z'),calls=[],overrides={[CALENDAR_SOURCES[1].url]:beaHTML(2026,[beaRow('December 23','8:30 AM')]),'https://www.bea.gov/news/schedule/next-year':beaHTML(2027,[beaRow('January 8','8:30 AM','Personal Income and Outlays, December 2026')])};
  const body=await (await fetchCalendar(request(),{fetch:fixtureFetch(overrides,calls),cache:null,now:clock})).json();assert.ok(calls.some(call=>call.url.endsWith('/next-year')));assert.equal(body.events.find(event=>event.kind==='pce'&&event.date==='2027-01-08').startAt,'2027-01-08T13:30:00.000Z');
});
test('BEA retains verified current-year events when the next-year schedule is unavailable',async()=>{
  const clock=Date.parse('2026-12-20T12:00:00Z'),overrides={[CALENDAR_SOURCES[1].url]:beaHTML(2026,[beaRow('December 23','8:30 AM')]),'https://www.bea.gov/news/schedule/next-year':new Error('Not yet available')};
  const body=await (await fetchCalendar(request(),{fetch:fixtureFetch(overrides),cache:null,now:clock})).json(),source=body.sources.find(source=>source.id==='bea');assert.equal(source.status,'ok');assert.match(source.warning,/schedule year is unavailable/);assert.equal(body.partial,true);assert.equal(body.events.find(event=>event.kind==='pce').date,'2026-12-23');
});
