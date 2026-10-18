const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/background-check.cjs','utf8');
async function run(input){
  let receive;const requests=[],output=[],process={exitCode:0,stdin:{isTTY:false,setEncoding(){},pause(){},on(name,handler){receive=handler;}}};
  vm.runInNewContext(source,{process,AbortSignal,console:{log:text=>output.push(text),error:text=>output.push(text)},fetch:async(url,options)=>{requests.push({url,options});return Response.json({ok:true});}});
  await receive(JSON.stringify(input)+'\n');return {requests,output,process};
}
const fixture={origin:'https://ether-watch-jen.aquarose3.chatgpt.site',token:'fixture-dispatch-value',serviceToken:'fixture-monitor-credential-at-least-32-characters'};
test('helper forwards separate fixture credentials only to its fixed origin without printing them',async()=>{
  const result=await run({...fixture,operation:'ack',body:{ids:['fixture-event']}});
  assert.equal(result.process.exitCode,0);assert.equal(result.requests.length,1);assert.equal(result.requests[0].url,fixture.origin+'/api/ack');
  assert.equal(result.requests[0].options.headers['X-Ether-Watch-Monitor-Token'],fixture.serviceToken);assert.equal(result.requests[0].options.headers['OAI-Sites-Authorization'],'Bearer '+fixture.token);assert.equal(result.requests[0].options.redirect,'error');
  for(const value of [fixture.token,fixture.serviceToken])assert.ok(!result.output.join('\n').includes(value));
});
test('helper rejects missing service credential, other origins and privileged background operations without a request',async()=>{
  for(const input of [{...fixture,serviceToken:undefined,operation:'check'},{...fixture,origin:'https://other.example',operation:'check'},{...fixture,operation:'background',body:{enabled:true,intervalMinutes:5}}]){
    const result=await run(input);assert.equal(result.process.exitCode,1);assert.equal(result.requests.length,0);assert.ok(!result.output.join('\n').includes(fixture.serviceToken));
  }
  const read=await run({...fixture,serviceToken:undefined,operation:'state'});assert.equal(read.process.exitCode,0);assert.equal(read.requests[0].options.method,'GET');
});
