import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDemoConnection, createApiFetch, readDemoConnection } from './src/services/demoRuntime.ts';
import { demoLaunchUrl } from './launch.mjs';
import { createRequestGuard } from './runtime-access.mjs';
const origin='https://demo-review.trycloudflare.com';
const appOrigin='https://review-preview.admas.dev';
const access='a'.repeat(48);
const connection={origin,access};

test('remote demo connection accepts only an exact HTTPS tunnel and private run token',()=>{
 assert.deepEqual(parseDemoConnection(connection),connection);
 for(const origin of ['http://demo-review.trycloudflare.com','https://evil.example','https://api.trycloudflare.com','https://demo-review.trycloudflare.com/','https://user@demo-review.trycloudflare.com','https://demo-review.trycloudflare.com/path']) assert.equal(parseDemoConnection({origin,access}),null);
 for(const access of ['', 'short', 123, 'a'.repeat(41)+'?']) assert.equal(parseDemoConnection({origin,access}),null);
});
test('payment API requests carry only the private demo token and never app-user Authorization or cookies',async()=>{
 const calls=[];const api=createApiFetch(connection,async (...args)=>{calls.push(args);return new Response('{}');});
 await api('/api/paypal/create-order',{method:'POST',headers:{Authorization:'Bearer app-user-must-not-leak','Content-Type':'application/json'},body:'{}',credentials:'include'});
 const [url,init]=calls[0];assert.equal(url,origin+'/api/paypal/create-order');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers.get('Authorization'),null);assert.equal(init.headers.get('X-ClearQuote-Access'),access);assert.equal(init.headers.get('Content-Type'),'application/json');
 for(const path of ['https://evil.example/api/health','/api/../other','/api/\\other','/other']) assert.throws(()=>api(path));
});
test('ordinary local API calls keep their existing same-origin behavior',async()=>{
 const calls=[];const init={method:'GET'};await createApiFetch(null,async(...args)=>{calls.push(args);return new Response('{}');})('/api/health',init);
 assert.deepEqual(calls,[['/api/health',init]]);
});
test('launcher puts the ephemeral access token only in the approved frontend fragment',()=>{
 const url=new URL(demoLaunchUrl(appOrigin+'/?version=review',origin,access));assert.equal(url.origin,appOrigin);assert.equal(url.search,'?version=review');assert.equal(new URLSearchParams(url.hash.slice(1)).get('clearquote_access'),access);assert.equal(url.search.includes(access),false);
 for(const frontend of ['http://review-preview.admas.dev','https://evil.example','https://user@review-preview.admas.dev','https://review-preview.admas.dev/#old']) assert.throws(()=>demoLaunchUrl(frontend,origin,access));
});
function request(guard,{origin:requestOrigin=appOrigin,token=access,url='/api/health',method='GET',preflightMethod='POST',preflightHeaders='content-type,x-clearquote-access',cookie}={}){
 const out={headers:{},status:200,body:''};const res={setHeader(k,v){out.headers[k]=v},writeHead(s,h={}){out.status=s;Object.assign(out.headers,h)},end(b=''){out.body=b}};
 out.allowed=guard({headers:{host:'127.0.0.1:3000',origin:requestOrigin,'x-clearquote-access':token,'access-control-request-method':preflightMethod,'access-control-request-headers':preflightHeaders,cookie},url,method,socket:{localPort:3000}},res);return out;
}
test('remote access requires exact configured frontend and token; cookies cannot substitute',()=>{
 const guard=createRequestGuard({publicOrigin:origin,accessToken:access,appOrigin});
 assert.equal(request(guard).allowed,true);assert.equal(request(guard).headers['Access-Control-Allow-Origin'],appOrigin);assert.equal(request(guard).headers['Access-Control-Allow-Credentials'],undefined);
 for(const values of [{origin:'https://evil.example'},{token:'wrong'},{token:''},{url:'/'},{origin:'',token:access}]) assert.equal(request(guard,values).status,403);
 assert.equal(request(guard,{token:'wrong',cookie:`cq_demo_access=${access}`}).status,403);
 assert.throws(()=>createRequestGuard({publicOrigin:origin,accessToken:access,appOrigin:appOrigin+'/path'}));assert.throws(()=>createRequestGuard({appOrigin}));
});
test('CORS preflight allows only the exact frontend and API methods/headers, then actual requests still authenticate',()=>{
 const guard=createRequestGuard({publicOrigin:origin,accessToken:access,appOrigin});
 const out=request(guard,{method:'OPTIONS',token:''});assert.equal(out.status,204);assert.equal(out.allowed,false);assert.equal(out.headers['Access-Control-Allow-Origin'],appOrigin);
 for(const values of [{origin:'https://evil.example'},{preflightMethod:'DELETE'},{preflightHeaders:'authorization'},{url:'/'}]) assert.equal(request(guard,{...values,method:'OPTIONS',token:''}).status,403);
 assert.equal(request(guard,{token:''}).status,403);
});

test('frontend removes the private fragment before rendering and restores only a valid tab session',()=>{
 const values=new Map();const changes=[];globalThis.window={location:{hash:'#'+new URLSearchParams({clearquote_api:origin,clearquote_access:access}),pathname:'/',search:'?version=review'},history:{replaceState(...args){changes.push(args);globalThis.window.location.hash='';}},sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
 try {assert.deepEqual(readDemoConnection(),connection);assert.equal(changes[0][2],'/?version=review');assert.deepEqual(readDemoConnection(),connection);globalThis.window.location.hash='#clearquote_api=https://evil.example&clearquote_access=short';assert.equal(readDemoConnection(),null);assert.equal(readDemoConnection(),null);assert.equal(values.size,0);} finally {delete globalThis.window;}
});
