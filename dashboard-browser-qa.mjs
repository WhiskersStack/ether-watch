// Bounded synthetic browser QA. Start fixture-preview.mjs separately and stop it afterward.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/Jen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=process.argv[2];
assert.ok(output && path.isAbsolute(output),'Supply an absolute screenshot output directory');
await fs.mkdir(output,{recursive:true});
const origin='http://127.0.0.1:4175',checks=[],errors=[],requests=[],warnings=[];
let browser;
try {
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-sync','--disable-component-update','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  context.on('request',request=>requests.push(request.url()));
  const page=await context.newPage();page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))warnings.push(message.text());});
  const stable=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const active=id=>page.waitForFunction(id=>document.querySelector('#terminal-navigation [aria-current="location"]')?.getAttribute('href')==='#'+id,id);
  const capture=async name=>{await stable();await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});};
  const dimensions=()=>page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,order:[...document.querySelector('.bottom-grid').children].map(el=>el.id),news:document.querySelector('#news').getBoundingClientRect().width,events:document.querySelector('#calendar').getBoundingClientRect().width}));
  const load=async suffix=>{await page.goto(origin+'/'+(suffix||''),{waitUntil:'networkidle'});await stable();};
  const goTop=async()=>{await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await active('overview');};
  const nav=async name=>{if(await page.locator('#navigation-toggle').isVisible()){await page.locator('#navigation-toggle').click();}await page.getByRole('link',{name,exact:true}).click();await stable();};
  await load();await page.waitForFunction(()=>document.querySelector('#price').textContent.includes('2,510.12'));
  assert.equal(await page.locator('#alerts').count(),0);
  assert.equal(await page.getByRole('link',{name:/Alerts/}).count(),0);
  assert.equal(await page.locator('#news-list .news-card').count(),6);
  let d=await dimensions();assert.deepEqual(d.order,['news','calendar']);assert.ok(Math.abs(d.news/d.events-2)<0.1);assert.ok(d.documentWidth<=d.width);
  await capture('01-desktop-overview');checks.push('Desktop layout, chart, six stories, no alert UI');
  await nav('News');await active('news');await page.waitForFunction(()=>Math.abs(document.querySelector('#news').getBoundingClientRect().top-document.querySelector('.terminal-header').getBoundingClientRect().bottom-20)<5);
  await capture('02-desktop-news-events');await goTop();await capture('03-overview-after-news');checks.push('News click then scroll to top updates aria-current and underline');
  await nav('Levels');await active('levels');await page.waitForFunction(()=>window.scrollY>0);await stable();await active('levels');
  await nav('Events');await active('calendar');await page.goBack();await active('levels');await page.goForward();await active('calendar');checks.push('Shared-row explicit selection and browser Back/Forward');
  await nav('Overview');await active('overview');await nav('Chart');await active('chart-panel');
  assert.equal(await page.locator('#chart-panel').evaluate(el=>el===document.activeElement),true);
  await goTop();const historyBefore=await page.evaluate(()=>history.length);
  await page.evaluate(()=>window.scrollTo({top:document.querySelector('#chart-panel').getBoundingClientRect().top+scrollY-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-offset'))+3,behavior:'instant'}));await active('chart-panel');
  await page.evaluate(()=>window.scrollTo({top:document.querySelector('#news').getBoundingClientRect().top+scrollY-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-offset'))+3,behavior:'instant'}));await active('news');
  assert.equal(await page.evaluate(()=>history.length),historyBefore);checks.push('All anchors, section focus and passive row defaults without history entries');
  await page.locator('#news-more').click();assert.equal(await page.locator('#news-list .news-card').count(),12);
  await page.locator('#news .feed-controls>summary').click();await page.locator('#news-search').fill('Fixture');assert.equal(await page.locator('#news-list .news-card').count(),6);await page.locator('#news-search').fill('');await page.locator('#news .feed-controls>summary').click();checks.push('Desktop load-more increment and filtering reset');
  await goTop();await page.locator('#chart-expand').click();assert.equal(await page.locator('#expanded-chart-dialog').evaluate(el=>el.open),true);await page.locator('#expanded-chart-close').click();await page.locator('.grid > #chart-panel').waitFor({state:'attached'});assert.equal(await page.locator('.grid > #chart-panel').count(),1);checks.push('Expanded chart returns to its layout');
  await page.locator('#settings-open').click();await page.locator('#level-S1').fill('0');await page.locator('#settings-save').click();assert.match(await page.locator('#settings-error').textContent(),/positive/);
  await page.locator('#level-S1').fill('2400');await page.locator('#settings-save').click();await page.waitForFunction(()=>!document.querySelector('#settings-dialog').open);assert.match(await page.locator('#level-list').textContent(),/2,400/);
  await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('#level-list').textContent(),/2,400/);
  await page.locator('#settings-open').click();await page.locator('#settings-reset').click();assert.equal(await page.locator('#level-S1').inputValue(),'2416');await page.locator('#settings-cancel').click();assert.match(await page.locator('#level-list').textContent(),/2,400/);checks.push('Levels validate, save, persist and cancel reset');
  await load('?viewer=true');assert.equal(await page.locator('#settings-open').isDisabled(),true);assert.equal(await page.locator('#settings-signin').isVisible(),true);await capture('04-signed-out-levels');checks.push('Signed-out editing explanation');
  await page.setViewportSize({width:1024,height:1000});await load();d=await dimensions();assert.deepEqual(d.order,['news','calendar']);assert.ok(Math.abs(d.news/d.events-2)<0.1);assert.ok(d.documentWidth<=d.width);await capture('05-tablet-1024');checks.push('1024px desktop-grid boundary');
  await page.setViewportSize({width:390,height:844});await load();d=await dimensions();assert.deepEqual(d.order,['calendar','news']);assert.ok(d.documentWidth<=d.width);assert.equal(await page.locator('#news-list .news-card').count(),3);await capture('06-phone-overview');
  await nav('Events');await active('calendar');await capture('07-phone-events');assert.equal(await page.locator('#calendar-roadmap-disclosure').evaluate(el=>el.open),false);await page.locator('#calendar-roadmap-title').click();assert.match(await page.locator('#calendar-roadmap').textContent(),/Unconfirmed/i);await page.locator('#calendar-roadmap-title').click();
  await nav('News');await active('news');await capture('08-phone-news');await page.locator('#news-more').click();assert.equal(await page.locator('#news-list .news-card').count(),6);
  await page.setViewportSize({width:1440,height:1000});await stable();await page.setViewportSize({width:390,height:844});await stable();assert.equal(await page.locator('#news-list .news-card').count(),6);checks.push('Phone order, compact news, roadmap disclosure and resize preserves revealed stories');
  await goTop();await page.locator('#navigation-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#navigation-toggle').evaluate(el=>el===document.activeElement),true);checks.push('Mobile menu Escape returns focus');
  await page.setViewportSize({width:320,height:844});await load();d=await dimensions();assert.ok(d.documentWidth<=d.width);await capture('09-narrow-overview');await nav('Events');await active('calendar');await capture('10-narrow-events');checks.push('320px reflow and sticky header');
  await page.emulateMedia({reducedMotion:'reduce'});await nav('News');await active('news');await goTop();await page.goto(origin+'/#alerts',{waitUntil:'networkidle'});await page.waitForURL('**/#overview');await active('overview');checks.push('Reduced motion and obsolete alert anchors');
  for(const scenario of ['loading','empty','stale','failure']){
    await load('?scenario='+scenario);
    await page.waitForFunction(()=>document.querySelector('#news-list').getAttribute('aria-busy')==='false');
    if(scenario==='empty')assert.match(await page.locator('#news-list').textContent(),/No recent/);
    if(scenario==='stale')assert.match(await page.locator('#news-status').textContent(),/Cached/);
    if(scenario==='failure'){assert.match(await page.locator('#settings-status').textContent(),/unavailable/);assert.equal(await page.locator('#settings-signin').isVisible(),false);assert.match(await page.locator('#news-status').textContent(),/unavailable/i);}
    if(scenario!=='loading'){await nav('News');await active('news');await capture('state-'+scenario);}
    checks.push('Fixture '+scenario+' state');
  }
  assert.equal(errors.length,0,errors.join('\n'));assert.ok(requests.every(url=>new URL(url).origin===origin));
  assert.ok(!requests.some(url=>/\/api\/(state|config|push|check|background)/.test(url)));
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,warnings:[...new Set(warnings)],requests:requests.length,externalRequests:0},null,2));
  console.log(JSON.stringify({passed:checks.length,errors,requests:requests.length,externalRequests:0,output}));
}catch(error){
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({checks,errors,message:error.message,stack:error.stack},null,2));throw error;
}finally{await browser?.close();}
