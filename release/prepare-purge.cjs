// Promote the exact reviewed purge SQL into the source migration chain after its gate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const [gatePath]=process.argv.slice(2);
assert.ok(gatePath&&path.isAbsolute(gatePath),'Provide the absolute release gate JSON path.');
const gate=JSON.parse(fs.readFileSync(gatePath,'utf8'));
assert.equal(gate.project_id,'appgprj_6acfc8555d7c81918cdf33a9acf1fa6f');
assert.equal(gate.retirement_verified,true);
assert.equal(gate.settings_verified,true);
assert.equal(gate.owner_credentials_removed,true,'Owner credential cleanup remains required.');
assert.equal(gate.alert_schedule_disabled,true);
const drain=Date.parse(gate.drain_verified_at),notBefore=Date.parse(gate.purge_not_before);
assert.ok(Number.isFinite(drain)&&Number.isFinite(notBefore)&&notBefore-drain>=3600000,'Require a full one-hour window after verified drain.');
assert.ok(Date.now()>=notBefore,'The retirement delivery window has not ended.');
const journalPath=path.join(root,'drizzle/meta/_journal.json');
const journal=JSON.parse(fs.readFileSync(journalPath,'utf8'));
const sql=fs.readFileSync(path.join(__dirname,'0004_purge_alerts.sql'),'utf8');
const destination=path.join(root,'drizzle/0004_purge_alerts.sql');
if(journal.entries.some(entry=>entry.tag==='0004_purge_alerts')){
  assert.equal(fs.readFileSync(destination,'utf8'),sql,'Never rewrite an existing migration.');
}else{
  assert.equal(journal.entries.at(-1).tag,'0003_dashboard_settings');
  if(fs.existsSync(destination))assert.equal(fs.readFileSync(destination,'utf8'),sql);
  else fs.writeFileSync(destination,sql,{flag:'wx'});
  journal.entries.push({idx:4,version:'6',when:1793300000001,tag:'0004_purge_alerts',breakpoints:true});
  fs.writeFileSync(journalPath,JSON.stringify(journal,null,2)+'\n');
}
console.log('Reviewed purge migration is in the source journal; build final, package, inspect archive, then publish.');
