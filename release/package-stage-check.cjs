// Verify the actual Sites archive, not just generated dist metadata.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sourceJournal=JSON.parse(fs.readFileSync(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
const final=sourceJournal.entries.some(entry=>entry.tag==='0004_purge_alerts');
const stage=final?'final':'settings';
const archive=path.join(path.dirname(root),'ether-watch-package-audit-'+Date.now()+'.tar');
const env={...process.env,PATH:'C:\\Program Files\\Git\\bin;'+process.env.PATH,TAR_OPTIONS:'--force-local'};
const run=(exe,args)=>execFileSync(exe,args,{cwd:root,env,encoding:'utf8',timeout:30000,windowsHide:true});
run(process.execPath,['build-worker.cjs',stage]);
run(process.execPath,['C:/Users/Jen/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/package-site.mjs',root,archive]);
const entries=run('tar.exe',['-tzf',archive]);
const archivedJournal=JSON.parse(run('tar.exe',['-xOzf',archive,'dist/.openai/drizzle/meta/_journal.json']));
assert.deepEqual(archivedJournal,sourceJournal);
assert.ok(entries.includes('dist/.openai/drizzle/0003_dashboard_settings.sql'));
assert.equal(entries.includes('dist/.openai/drizzle/0004_purge_alerts.sql'),final);
for(const entry of sourceJournal.entries){
  const filename=entry.tag+'.sql';
  assert.equal(run('tar.exe',['-xOzf',archive,'dist/.openai/drizzle/'+filename]),fs.readFileSync(path.join(root,'drizzle',filename),'utf8'),filename);
}
console.log(JSON.stringify({stage,migrations:sourceJournal.entries.map(e=>e.tag),archive,archiveMatchesSource:true}));
