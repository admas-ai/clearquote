import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

// Isolate all server state in a fresh temporary directory; never touch an owner's data.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clearquote-http-'));
for (const file of ['server.mjs', 'runtime-access.mjs']) await fs.copyFile(new URL(file, import.meta.url), path.join(root, file));
await fs.mkdir(path.join(root, 'src/data'), {recursive:true});
await fs.copyFile(new URL('src/data/initialData.ts', import.meta.url), path.join(root, 'src/data/initialData.ts'));
await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
const token = 'http-test-token-'.repeat(4);
const appOrigin = 'https://review-preview.admas.dev';
process.env.PUBLIC_ORIGIN = 'https://review-test.trycloudflare.com';
process.env.DEMO_APP_ORIGIN = appOrigin;
process.env.DEMO_ACCESS_TOKEN = token;
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
const {handleApiRequest} = await import(pathToFileURL(path.join(root, 'server.mjs')).href);
const server = http.createServer((req,res) => { if (!handleApiRequest(req,res)) {res.writeHead(404);res.end();} });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});

test('real HTTP handler accepts the exact frontend plus private token and returns canonical data',async()=>{
  const headers = {Origin:appOrigin,'X-ClearQuote-Access':token};
  const health = await fetch(base+'/api/health',{headers});
  assert.equal(health.status,200);assert.equal(health.headers.get('access-control-allow-origin'),appOrigin);
  assert.equal((await health.json()).status,'ok');
  const quotes=await fetch(base+'/api/quotes',{headers});assert.equal(quotes.status,200);assert.ok(Array.isArray(await quotes.json()));
});
test('real HTTP preflight is token-free while every actual API request remains private',async()=>{
  const options=await fetch(base+'/api/quotes',{method:'OPTIONS',headers:{Origin:appOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-clearquote-access'}});
  assert.equal(options.status,204);assert.match(options.headers.get('access-control-allow-headers'),/X-ClearQuote-Access/);
  for(const headers of [{Origin:appOrigin},{Origin:appOrigin,'X-ClearQuote-Access':'old-token'},{Origin:'https://other.example','X-ClearQuote-Access':token}]) assert.equal((await fetch(base+'/api/health',{headers})).status,403);
});
test('remote token grants no static-file access and local private-cookie access still works',async()=>{
  assert.equal((await fetch(base+'/',{headers:{Origin:appOrigin,'X-ClearQuote-Access':token}})).status,403);
  const gate=await fetch(base+'/__clearquote_access?key='+token,{redirect:'manual'});assert.equal(gate.status,303);assert.equal(gate.headers.get('location'),'/');
  assert.match(gate.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Path=\/; Secure/);
  const local=await fetch(base+'/api/health',{headers:{Cookie:`cq_demo_access=${token}`}});assert.equal(local.status,200);
});
