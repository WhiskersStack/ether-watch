import test from 'node:test';import assert from 'node:assert/strict';
import {formatCalendarWhen,calendarCountdown,retainCalendar,calendarSafeLink,calendarStatus,CALENDAR_TIME_ZONES,calendarZonePreference,resolveCalendarZone} from './dist/calendar-ui.mjs';
const now=Date.parse('2026-10-17T12:00:00Z');
test('calendar uses Jerusalem/UTC conversion and preserves date-only/unconfirmed precision',()=>{const event={status:'scheduled',date:'2026-10-20',startAt:'2026-10-20T12:30:00Z'};assert.match(formatCalendarWhen(event),/15:30.*Asia\/Jerusalem/);assert.match(formatCalendarWhen({...event,date:'2026-11-05',startAt:'2026-11-05T13:30:00Z'}),/15:30/);assert.match(formatCalendarWhen(event,'UTC'),/12:30.*UTC/);assert.match(formatCalendarWhen({...event,startAt:null}),/20 Oct 2026 · date only/);assert.match(formatCalendarWhen({status:'unconfirmed'}),/^Unconfirmed/);});
test('all requested timezones convert an exact release time, including half-hour offsets and date rollover',()=>{
  const event={status:'scheduled',date:'2026-11-10',startAt:'2026-11-10T13:30:00Z'},expected={
    'Asia/Jerusalem':'10 Nov 2026, 15:30','UTC':'10 Nov 2026, 13:30','Europe/London':'10 Nov 2026, 13:30',
    'America/New_York':'10 Nov 2026, 08:30','America/Chicago':'10 Nov 2026, 07:30','America/Los_Angeles':'10 Nov 2026, 05:30',
    'Asia/Dubai':'10 Nov 2026, 17:30','Asia/Kolkata':'10 Nov 2026, 19:00','Asia/Singapore':'10 Nov 2026, 21:30',
    'Asia/Hong_Kong':'10 Nov 2026, 21:30','Asia/Tokyo':'10 Nov 2026, 22:30','Australia/Sydney':'11 Nov 2026, 00:30'
  };
  assert.deepEqual(CALENDAR_TIME_ZONES.filter(([zone])=>zone!=='local').map(([zone])=>zone).sort(),Object.keys(expected).sort());
  for(const [zone,when] of Object.entries(expected))assert.equal(formatCalendarWhen(event,zone),when+' · '+zone);
});
test('city timezone conversion follows northern and southern daylight-saving seasons',()=>{
  const summer={status:'scheduled',date:'2026-07-01',startAt:'2026-07-01T13:30:00Z'},winter={...summer,date:'2026-11-10',startAt:'2026-11-10T13:30:00Z'};
  for(const [zone,summerTime,winterTime] of [['Europe/London','14:30','13:30'],['America/New_York','09:30','08:30'],['America/Chicago','08:30','07:30'],['America/Los_Angeles','06:30','05:30'],['Asia/Jerusalem','16:30','15:30'],['Australia/Sydney','23:30','00:30']]){
    assert.ok(formatCalendarWhen(summer,zone).includes(summerTime+' · '+zone),zone+' summer');assert.ok(formatCalendarWhen(winter,zone).includes(winterTime+' · '+zone),zone+' winter');
  }
});
test('timezone preferences preserve supported choices and validate automatic device time safely',()=>{
  for(const [zone] of CALENDAR_TIME_ZONES)assert.equal(calendarZonePreference(zone),zone);
  for(const invalid of [null,undefined,'','invalid','constructor','Europe/Paris'])assert.equal(calendarZonePreference(invalid),'Asia/Jerusalem');
  assert.equal(resolveCalendarZone('UTC'),'UTC');assert.equal(resolveCalendarZone('local','Europe/Paris'),'Europe/Paris');assert.equal(resolveCalendarZone('local','not-a-zone'),'UTC');assert.equal(resolveCalendarZone('local',''),'UTC');
});
test('changing timezone never shifts date-only meetings or invents dates for the roadmap',()=>{
  for(const [zone] of CALENDAR_TIME_ZONES){
    assert.equal(formatCalendarWhen({status:'scheduled',date:'2026-10-27',endDate:'2026-10-28',startAt:null},zone),'27 Oct 2026 – 28 Oct 2026 · date only');
    assert.equal(formatCalendarWhen({status:'unconfirmed'},zone),'Unconfirmed · no activation date');
  }
});
test('countdowns require a fresh verified exact time',()=>{const event={status:'scheduled',startAt:new Date(now+900000).toISOString()},source={status:'ok',fetchedAt:new Date(now).toISOString()};assert.equal(calendarCountdown(event,source,now),'In 15m');assert.match(calendarCountdown(event,{...source,status:'stale'},now),/unavailable/);assert.match(calendarCountdown(event,{...source,fetchedAt:new Date(now-21600001).toISOString()},now),/unavailable/);assert.equal(calendarCountdown({...event,startAt:null},source,now),'');});
test('offline calendar retains only unexpired sources and removes past events',()=>{const data={sources:[{id:'new',status:'ok',fetchedAt:new Date(now-1000).toISOString()},{id:'old',status:'stale',fetchedAt:new Date(now-86400001).toISOString()}],events:[{id:1,sourceId:'new',date:'2026-10-18',startAt:null},{id:2,sourceId:'old',date:'2026-10-18',startAt:null},{id:3,sourceId:'new',startAt:new Date(now-1).toISOString()}],roadmap:[{sourceId:'old'},{sourceId:'new'}]};const result=retainCalendar(data,'offline',now);assert.deepEqual(result.events.map(e=>e.id),[1]);assert.equal(result.roadmap.length,1);assert.equal(result.sources[0].status,'stale');assert.equal(result.sources[0].fetchedAt,data.sources[0].fetchedAt);assert.equal(result.sources[1].status,'error');assert.equal(data.sources[0].status,'ok');});

test('never-successful sources preserve actionable failure details',()=>{const result=retainCalendar({sources:[{id:'bls',status:'error',fetchedAt:null,error:'HTTP 403'}],events:[],roadmap:[]},null,now);assert.equal(result.sources[0].error,'HTTP 403');});
test('FRED fallback links and provenance survive calendar retention without allowing other hosts',()=>{
  const url='https://fred.stlouisfed.org/releases/calendar?rid=10&y=2026',source={id:'bls',name:'St. Louis Fed / FRED (BLS CPI schedule)',url,status:'ok',fetchedAt:new Date(now).toISOString()},event={sourceId:'bls',source:source.name,url,date:'2026-11-10',startAt:'2026-11-10T13:30:00.000Z'};
  assert.equal(calendarSafeLink(event),url);assert.equal(calendarSafeLink({...event,url:'https://fred.stlouisfed.org.evil.example/'}),null);assert.equal(calendarSafeLink({...event,url:'javascript:alert(1)'}),null);
  const retained=retainCalendar({sources:[source],events:[event],roadmap:[]},null,now);assert.equal(retained.events[0].source,source.name);assert.equal(retained.sources[0].url,url);assert.match(formatCalendarWhen(event,'UTC'),/13:30.*UTC/);
});
test('small verification clock differences retain events and countdowns without changing timestamps',()=>{
  const event={id:'cpi',sourceId:'bls',status:'scheduled',date:'2026-10-20',startAt:new Date(now+900000).toISOString()};
  for(const skew of [500,60000]){
    const source={id:'bls',status:'ok',fetchedAt:new Date(now+skew).toISOString()},data={sources:[source],events:[event],roadmap:[]},retained=retainCalendar(data,null,now);
    assert.equal(retained.sources[0].status,'ok');assert.equal(retained.sources[0].fetchedAt,source.fetchedAt);assert.deepEqual(retained.events,[event]);assert.equal(calendarCountdown(event,retained.sources[0],now),'In 15m');
    const caughtUp=retainCalendar(retained,null,now+skew+1);assert.equal(caughtUp.sources[0].status,'ok');assert.deepEqual(caughtUp.events,[event]);assert.equal(data.sources[0].status,'ok');
  }
});
test('verification times beyond the clock bound or malformed times fail explicitly without an expired label',()=>{
  const event={sourceId:'bls',status:'scheduled',date:'2026-10-20',startAt:new Date(now+900000).toISOString()};
  for(const fetchedAt of [new Date(now+60001).toISOString(),'not-a-timestamp']){
    const source={id:'bls',status:'ok',fetchedAt},retained=retainCalendar({sources:[source],events:[event],roadmap:[]},null,now);
    assert.equal(retained.sources[0].status,'error');assert.match(retained.sources[0].error,/Invalid schedule verification timestamp/);assert.doesNotMatch(retained.sources[0].error,/expired/);assert.equal(retained.events.length,0);assert.match(calendarCountdown(event,source,now),/invalid schedule verification timestamp/);
  }
});
test('clock tolerance preserves actual freshness and expiry ages',()=>{
  const fetchedAt=new Date(now+60000).toISOString(),source={id:'bls',status:'ok',fetchedAt},event={sourceId:'bls',status:'scheduled',date:'2026-10-20',startAt:new Date(now+2*86400000).toISOString()},data={sources:[source],events:[event],roadmap:[]};
  assert.doesNotMatch(calendarCountdown(event,source,now+60000+21600000),/unavailable/);assert.match(calendarCountdown(event,source,now+60000+21600001),/unavailable/);
  const boundary=retainCalendar(data,null,now+60000+86400000);assert.equal(boundary.sources[0].status,'ok');assert.equal(boundary.events.length,1);assert.equal(boundary.sources[0].fetchedAt,fetchedAt);
  const expired=retainCalendar(data,null,now+60000+86400001);assert.equal(expired.sources[0].status,'error');assert.equal(expired.sources[0].error,'Cached schedule expired');assert.equal(expired.events.length,0);
});
test('healthy source notices remain verified while actual stale or failed sources remain partial',()=>{
  const notice='Direct BLS schedules unavailable; using the St. Louis Fed / FRED calendar of BLS CPI releases.',sources=[{id:'bls',status:'ok',warning:notice},{id:'bea',status:'ok'},{id:'fed',status:'ok'},{id:'ethereum',status:'ok'}];
  assert.equal(calendarStatus(sources),'Official schedules verified · source notice');assert.equal(sources[0].warning,notice);assert.equal(calendarStatus(sources.map(source=>({...source,warning:null}))),'Official schedules verified');
  for(const status of ['stale','error'])assert.equal(calendarStatus(sources.map(source=>source.id==='bea'?{...source,status}:source)),'Some schedules are cached or unavailable');
  assert.equal(calendarStatus(sources.map(source=>({...source,status:'error'}))),'Calendar unavailable');
});
