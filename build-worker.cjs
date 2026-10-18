// Builds a self-contained Worker without dependencies. Website sources stay in dist/.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,target=path.join(root,'dist');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'.openai/hosting.json'),'utf8'));
if(manifest.static||manifest.d1!=='DB')throw new Error('Approve and configure the Worker/D1 manifest before building.');
const assets={};
for(const [url,file,type] of [['/','index.html','text/html;charset=utf-8'],['/index.html','index.html','text/html;charset=utf-8'],['/style.css','style.css','text/css;charset=utf-8'],['/app.js','app.js','text/javascript;charset=utf-8'],['/rules.mjs','rules.mjs','text/javascript;charset=utf-8'],['/chart.mjs','chart.mjs','text/javascript;charset=utf-8'],['/market-data.mjs','market-data.mjs','text/javascript;charset=utf-8']])assets[url]={body:fs.readFileSync(path.join(root,'dist',file),'utf8'),type};
const rules=fs.readFileSync(path.join(root,'dist/rules.mjs'),'utf8').replace(/^export\s+/gm,'');
const news=fs.readFileSync(path.join(root,'worker/news.js'),'utf8').replace(/^export\s+/gm,'');
const calendar=fs.readFileSync(path.join(root,'worker/calendar.js'),'utf8').replace(/^export\s+/gm,'');
const volume=fs.readFileSync(path.join(root,'worker/volume.js'),'utf8').replace(/^export\s+/gm,'');
const worker=fs.readFileSync(path.join(root,'worker/index.js'),'utf8');
fs.mkdirSync(path.join(target,'server'),{recursive:true});fs.mkdirSync(path.join(target,'.openai'),{recursive:true});
assets['/calendar-ui.mjs']={body:fs.readFileSync(path.join(root,'dist/calendar-ui.mjs'),'utf8'),type:'text/javascript;charset=utf-8'};
fs.writeFileSync(path.join(target,'server/index.js'),'const ASSETS='+JSON.stringify(assets)+';\n'+rules+'\n'+news+'\n'+calendar+'\n'+volume+'\n'+worker);
fs.writeFileSync(path.join(target,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Worker prepared: dist/server/index.js');
