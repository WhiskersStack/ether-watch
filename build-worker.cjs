// Builds a self-contained Worker without dependencies. Website sources stay in dist/.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,target=path.join(root,'dist');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'.openai/hosting.json'),'utf8'));
if(manifest.static||manifest.d1!=='DB')throw new Error('Approve and configure the Worker/D1 manifest before building.');
const stage=process.argv[2]||'retirement';
if(!['retirement','settings','final'].includes(stage))throw new Error('Use retirement, settings, or final.');
const assets={};
for(const [url,file,type] of [['/','index.html','text/html;charset=utf-8'],['/index.html','index.html','text/html;charset=utf-8'],['/style.css','style.css','text/css;charset=utf-8'],['/app.js','app.js','text/javascript;charset=utf-8'],...['settings.mjs','quote.mjs','navigation.mjs','retire-notifications.mjs'].map(file=>['/'+file,file,'text/javascript;charset=utf-8']),['/chart.mjs','chart.mjs','text/javascript;charset=utf-8'],['/market-data.mjs','market-data.mjs','text/javascript;charset=utf-8'],['/notification-worker.js','notification-worker.js','text/javascript;charset=utf-8']])assets[url]={body:fs.readFileSync(path.join(root,'dist',file),'utf8'),type};
for(const [url,file,type] of [['/favicon.svg','favicon.svg','image/svg+xml;charset=utf-8'],['/favicon.ico','favicon.ico','image/x-icon'],['/apple-touch-icon.png','apple-touch-icon.png','image/png']]){const encoding=file.endsWith('.svg')?'utf8':'base64';assets[url]={body:fs.readFileSync(path.join(root,'dist',file)).toString(encoding),type,...(encoding==='base64'?{encoding}: {})};}
const settings=fs.readFileSync(path.join(root,'dist/settings.mjs'),'utf8').replace(/^export\s+/gm,'');
const news=fs.readFileSync(path.join(root,'worker/news.js'),'utf8').replace(/^export\s+/gm,'');
const calendar=fs.readFileSync(path.join(root,'worker/calendar.js'),'utf8').replace(/^export\s+/gm,'');
const volume=fs.readFileSync(path.join(root,'worker/volume.js'),'utf8').replace(/^export\s+/gm,'');
const worker=fs.readFileSync(path.join(root,'worker/index.js'),'utf8');
fs.mkdirSync(path.join(target,'server'),{recursive:true});fs.mkdirSync(path.join(target,'.openai'),{recursive:true});
assets['/calendar-ui.mjs']={body:fs.readFileSync(path.join(root,'dist/calendar-ui.mjs'),'utf8'),type:'text/javascript;charset=utf-8'};
fs.writeFileSync(path.join(target,'server/index.js'),'const ASSETS='+JSON.stringify(assets)+';\n'+settings+'\n'+news+'\n'+calendar+'\n'+volume+'\n'+worker);
fs.writeFileSync(path.join(target,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
fs.cpSync(path.join(root,'drizzle'),path.join(target,'.openai/drizzle'),{recursive:true});
// Sites packages the SOURCE drizzle directory over generated metadata.
// Applied migrations are immutable; never try to hide one only in dist/.
const journal=JSON.parse(fs.readFileSync(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
const hasPurge=journal.entries.some(entry=>entry.tag==='0004_purge_alerts');
if(stage==='final'&&!hasPurge)throw new Error('Prepare the approved source purge migration after the retirement window first.');
if(stage!=='final'&&hasPurge)throw new Error('Source already includes the purge migration; use final and never roll back alert data.');
console.log('Worker prepared ('+stage+'): dist/server/index.js');
