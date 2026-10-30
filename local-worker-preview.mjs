// The supported local preview is synthetic and has no production database or delivery paths.
import {createFixtureServer,denyOutboundNetwork} from './fixture-preview.mjs';
denyOutboundNetwork();
const port=Number(process.argv[2]||4175);
createFixtureServer().listen(port,'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:'+port+'/'));
