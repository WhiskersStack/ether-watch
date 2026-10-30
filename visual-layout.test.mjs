import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterChartEvents} from './dist/chart.mjs';
import {calendarDateBadge} from './dist/calendar-ui.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('responsive moves preserve node identity, values and desktop ordering across repeated resizes',()=>{
  class Node {
    constructor(name){this.name=name;this.children=[];this.classList={contains:value=>name===value};}
    append(...nodes){for(const node of nodes){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.push(node);}}
    before(node){this.parent.insert(node,this.parent.children.indexOf(this));}
    after(node){this.parent.insert(node,this.parent.children.indexOf(this)+1);}
    insert(node,index){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.splice(index,0,node);}
    get lastElementChild(){return this.children.at(-1);}
  }
  const metrics=new Node('metrics'),toolbar=new Node('toolbar'),mobile=new Node('mobile'),monitor=new Node('monitor'),technical=new Node('technical'),levels=new Node('levels');
  const cards=['primary','volume','momentum','range'].map(name=>new Node(name));metrics.append(...cards);
  const controls=['timeframe','style','segmented','fit','profile'].map(name=>new Node(name));toolbar.append(...controls.slice(0,3));controls[4].checked=true;controls[3].value='candles';
  const doc={querySelector:selector=>({'.metrics':metrics,'.chart-toolbar .segmented':controls[2],'.chart-toolbar .chart-fit-field':controls[3],'.chart-toolbar .profile-toggle':controls[4]})[selector],getElementById:id=>({'levels':levels,'chart-mobile-controls':mobile,'monitor-details':monitor,'technical-details':technical})[id],createComment:()=>new Node('comment'),createElement:tag=>new Node(tag)};
  let listener;const media={matches:false,addEventListener:(_,fn)=>listener=fn,removeEventListener:()=>listener=null};
  const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
  const setup=runInNewContext('('+source.slice(source.indexOf('function setupResponsiveLayout('),source.indexOf('async function refreshNews('))+')');
  const dispose=setup(doc,media);
  for(let i=0;i<3;i++){
    media.matches=true;listener();assert.deepEqual(metrics.children.filter(node=>node.name!=='comment'),cards.slice(0,3));assert.equal(levels.children[0].children.at(-1),cards[3]);assert.deepEqual(mobile.children,[controls[2]]);assert.equal(technical.open,false);
    media.matches=false;listener();assert.deepEqual(metrics.children.filter(node=>node.name!=='comment'),cards);assert.deepEqual(toolbar.children.filter(node=>node.name!=='comment'),controls.slice(0,3));assert.equal(mobile.children.length,0);assert.equal(mobile.hidden,true);assert.equal(controls[4].checked,true);assert.equal(controls[3].value,'candles');assert.equal(technical.open,true);
  }
  dispose();assert.equal(listener,null);
});

test('screen-space clusters retain original stories and times without overlapping touch targets',()=>{
  const groups=Array.from({length:40},(_,index)=>({index,time:1000+index*60,events:[{id:String(index),time:1010+index*60}]}));
  for(const width of [160,220,700]){
    const clusters=clusterChartEvents(groups,index=>10+index*width/40,10,width+10);
    assert.deepEqual(clusters.flatMap(group=>group.events.map(event=>event.id)),groups.flatMap(group=>group.events.map(event=>event.id)));
    for(let i=0;i<clusters.length;i++){
      const group=clusters[i];
      if(i)assert.ok(group.x-clusters[i-1].x>=44-1e-9);
      assert.equal(group.startTime,Math.min(...group.events.map(event=>event.time)));
      assert.equal(group.endTime,Math.max(...group.events.map(event=>event.time)));
      assert.ok(group.minX>=10&&group.maxX<=width+10);
      assert.equal(group.candleCount,group.events.length);
    }
    clusters[0].events[0].id='changed';assert.equal(groups[0].events[0].id,'0');
  }
  assert.deepEqual(clusterChartEvents([],x=>x,0,100),[]);
});

test('calendar date badges respect timezone rollover and date-only precision',()=>{
  const timed={status:'scheduled',date:'2026-11-10',startAt:'2026-11-10T23:30:00Z'};
  assert.equal(calendarDateBadge(timed,'Asia/Tokyo').day,'11');
  assert.equal(calendarDateBadge(timed,'America/New_York').day,'10');
  assert.equal(calendarDateBadge({...timed,startAt:null},'Asia/Tokyo').day,'10');
  assert.equal(calendarDateBadge({status:'unconfirmed'}),null);
});
