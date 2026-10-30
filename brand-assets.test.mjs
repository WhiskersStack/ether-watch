import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the packaged asset map and production response path together.
// Run node build-worker.cjs before this integration test.
const source=readFileSync(new URL('./dist/server/index.js',import.meta.url));
const worker=(await import('data:text/javascript;base64,'+source.toString('base64'))).default;
for(const [file,type] of [['favicon.svg','image/svg+xml'],['favicon.ico','image/x-icon'],['apple-touch-icon.png','image/png']]){
  test('packaged '+file+' is served without corrupting its bytes',async()=>{
    const response=await worker.fetch(new Request('https://etherwatch.example/'+file),{});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Content-Type').split(';')[0],type);
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(new URL('./dist/'+file,import.meta.url)));
  });
}
