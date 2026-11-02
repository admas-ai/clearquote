import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGuard } from './runtime-access.mjs';
const accessToken='a'.repeat(48);
function request(guard, {host='127.0.0.1:3000',origin,cookie,url='/api/health',method='GET'}={}) {
  const result={headers:{},status:200,body:''};
  const res={setHeader(k,v){result.headers[k]=v},writeHead(s,h={}){result.status=s;Object.assign(result.headers,h)},end(b=''){result.body=b}};
  result.allowed=guard({headers:{host,origin,cookie},url,method,socket:{localPort:3000}},res);return result;
}
test('default loopback and same-origin guard stays strict',()=>{
  const guard=createRequestGuard();
  assert.equal(request(guard).allowed,true);
  for(const values of [{host:'evil.example:3000'},{host:'127.0.0.1:4000'},{origin:'https://evil.example'},{host:'user@localhost:3000'}]) assert.equal(request(guard,values).status,403);
});
test('public origin requires HTTPS and a private access token',()=>{
  for(const publicOrigin of ['*','http://example.com','https://example.com/path','https://example.com/','https://user@example.com']) assert.throws(()=>createRequestGuard({publicOrigin,accessToken}));
  assert.throws(()=>createRequestGuard({publicOrigin:'https://demo.example.com'}));
});
test('tunneled demo rejects anonymous access, other origins and replay after restart',()=>{
  const guard=createRequestGuard({publicOrigin:'https://demo.example.com',accessToken});
  assert.equal(request(guard).status,403);
  assert.equal(request(guard,{cookie:`cq_demo_access=${accessToken}`,origin:'https://demo.example.com'}).allowed,true);
  assert.equal(request(guard,{cookie:`cq_demo_access=${accessToken}`,origin:'https://other.example.com'}).status,403);
  assert.equal(request(guard,{cookie:'cq_demo_access=old-token'}).status,403);
});
test('launcher access establishes secure HttpOnly cookie and removes token from URL',()=>{
  const guard=createRequestGuard({publicOrigin:'https://demo.example.com',accessToken});
  const result=request(guard,{url:`/__clearquote_access?key=${accessToken}`});
  assert.equal(result.status,303);assert.equal(result.headers.Location,'/');
  assert.match(result.headers['Set-Cookie'],/HttpOnly; SameSite=Lax; Path=\/; Secure/);
  assert.equal(request(guard,{url:'/__clearquote_access?key=wrong'}).status,403);
});
