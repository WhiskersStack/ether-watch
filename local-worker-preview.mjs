// Development preview only: loopback, in-memory SQLite, explicit test identity.
import http from 'node:http';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('./',import.meta.url),assets={};
for(const [url,file,type] of [['/','index.html','text/html'],['/style.css','style.css','text/css'],['/app.js','app.js','text/javascript'],['/rules.mjs','rules.mjs','text/javascript'],['/chart.mjs','chart.mjs','text/javascript'],['/market-data.mjs','market-data.mjs','text/javascript']])assets[url]={body:fs.readFileSync(new URL('dist/'+file,root),'utf8'),type};
const engine=fs.readFileSync(new URL('dist/rules.mjs',root),'utf8').replace(/^export\s+/gm,'');
const source=fs.readFileSync(new URL('worker/index.js',root),'utf8');
const news=fs.readFileSync(new URL('worker/news.js',root),'utf8').replace(/^export\s+/gm,'');
const worker=(await import('data:text/javascript;base64,'+Buffer.from('const ASSETS='+JSON.stringify(assets)+';\n'+engine+'\n'+news+'\n'+source).toString('base64'))).default;
const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('drizzle/0000_monitor.sql',root),'utf8'));
const env={DB:{prepare(sql){return {bind(...values){return {async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return sqlite.prepare(sql).get(...values);}};},async first(){return sqlite.prepare(sql).get();}};}}};
http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-preview-owner');const response=await worker.fetch(new Request('http://127.0.0.1:4174'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500);res.end(error.message);}}).listen(4174,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4174'));
