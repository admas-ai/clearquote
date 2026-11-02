import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, '.runtime');
const cloudflareVersion = '2026.10.7';
const downloads = {
  'win32-x64': { name: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  'linux-x64': { name: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
  'linux-arm64': { name: 'cloudflared-linux-arm64', sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775' },
};
const children = new Set();
export function extractTunnelOrigin(text) {
  for (const match of text.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/g)) {
    if (new URL(match[0]).hostname !== 'api.trycloudflare.com') return match[0];
  }
  return null;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function helperEnvironment() {
  const environment = {};
  for (const name of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMDATA','HOME']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
function privatePrompt(label) {
  if (!process.stdin.isTTY) throw new Error('Open this launcher in a terminal to enter credentials privately.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const finish = () => { process.stdin.off('data', read); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const read = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
        if (character === '\r' || character === '\n') { finish(); resolve(value.trim()); value = ''; return; }
        if (character === '\u007f' || character === '\b') { if (value) { value = value.slice(0,-1); process.stdout.write('\b \b'); } }
        else if (character >= ' ' && character !== '\u001b') { value += character; process.stdout.write('*'); }
      }
    };
    process.stdin.on('data', read);
  });
}
async function freePort() {
  return new Promise((resolve,reject) => {
    const server=net.createServer(); server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
  });
}
async function cloudflared() {
  const asset = downloads[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('This launcher supports Windows x64 and Linux x64/arm64. Use --local for other platforms.');
  await fs.mkdir(runtime,{recursive:true});
  const destination=path.join(runtime,asset.name);
  const hash = data => createHash('sha256').update(data).digest('hex');
  try { if (hash(await fs.readFile(destination)) === asset.sha256) return destination; } catch {}
  console.log(`Downloading official Cloudflare cloudflared ${cloudflareVersion}; verifying its published SHA-256.`);
  const response=await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${cloudflareVersion}/${asset.name}`,{signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error('Cloudflare download failed. Please check your internet connection.');
  const data=Buffer.from(await response.arrayBuffer());
  if (data.length > 150000000 || hash(data)!==asset.sha256) throw new Error('Cloudflare download failed checksum verification. Nothing was run.');
  await fs.writeFile(destination,data,{mode:0o700});await fs.chmod(destination,0o700);
  return destination;
}
async function tunnel(port) {
  const binary=await cloudflared();
  const config=path.join(runtime,'quick-tunnel.yml');
  await fs.writeFile(config,'# Empty isolated configuration for this temporary demo tunnel.\n');
  const child=spawn(binary,['tunnel','--config',config,'--no-autoupdate','--url',`http://127.0.0.1:${port}`,'--http-host-header',`127.0.0.1:${port}`],{cwd:root,env:helperEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true});
  children.add(child);
  const origin=await new Promise((resolve,reject)=>{
    let collected='';
    const timer=setTimeout(()=>reject(new Error('The temporary HTTPS link could not start. Close this window and try again, or use --local.')),60000);
    const read=chunk=>{
      collected=(collected+chunk.toString()).slice(-20000);
      const origin=extractTunnelOrigin(collected);
      if(origin){clearTimeout(timer);resolve(origin);}
    };
    child.stdout.on('data',read);child.stderr.on('data',read);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Cloudflare could not run.'));});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Cloudflare stopped before the HTTPS link was ready.'));});
  });
  child.once('exit',()=>{if(!stopping){console.error('The temporary demo link closed. Restart the launcher.');stop(1);}});
  return origin;
}
function openBrowser(url) {
  const environment=helperEnvironment();
  let child;
  if(process.platform==='win32') child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{env:environment,stdio:'ignore',windowsHide:true});
  else if(process.platform==='darwin') child=spawn('open',[url],{env:environment,stdio:'ignore'});
  else child=spawn('xdg-open',[url],{env:environment,stdio:'ignore'});
  child.once('error',()=>console.log('Automatic browser opening was unavailable. Keep this terminal open and ask for help opening the private demo.'));
  child.unref();
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('ClearQuote launcher — Node.js 24 or later.\nnode launch.mjs: private PayPal entry + temporary HTTPS demo.\nnode launch.mjs --local: loopback demo without AdmasLLM (HTTPS origin required).\nnode launch.mjs --check: check package files without credentials or network.\nNo PayPal credentials are written to disk. Ctrl+C stops the server and tunnel.');return;
  }
  if(Number(process.versions.node.split('.')[0])<24) throw new Error('Install Node.js 24 LTS from https://nodejs.org and run Start-ClearQuote.cmd again.');
  for(const file of ['dist/index.html','dist/admas-public-config.json','server.mjs','runtime-access.mjs','src/data/initialData.ts']) await fs.access(path.join(root,file));
  if(process.argv.includes('--check')) { console.log('ClearQuote package files and Node.js version verified. No credentials used; no provider calls.');return; }
  console.log('ClearQuote Sandbox demo\nEnter the EXISTING ClearQuote PayPal Sandbox credentials. Input is masked and kept in server memory only.\nDo not use live PayPal credentials.');
  let clientId=await privatePrompt('Sandbox Client ID: ');
  let clientSecret=await privatePrompt('Sandbox Secret key 1: ');
  if(!/^[A-Za-z0-9_-]{20,}$/.test(clientId)||!/^[A-Za-z0-9_-]{20,}$/.test(clientSecret)) throw new Error('The Sandbox Client ID or Secret is incomplete. Restart and paste each value once.');
  const port=await freePort();
  const local=process.argv.includes('--local');
  const publicOrigin=local?'':await tunnel(port);
  const accessToken=randomBytes(32).toString('base64url');
  const environment={...helperEnvironment(),PORT:String(port),PAYPAL_CLIENT_ID:clientId,PAYPAL_CLIENT_SECRET:clientSecret,DEMO_ACCESS_TOKEN:accessToken,PUBLIC_ORIGIN:publicOrigin};
  const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
  children.add(server);
  clientId='';clientSecret='';delete environment.PAYPAL_CLIENT_ID;delete environment.PAYPAL_CLIENT_SECRET;
  server.stdout.resume();server.stderr.on('data',()=>{ /* Do not print provider responses or environment values. */ });
  server.once('error',()=>{console.error('The application server could not start.');stop(1);});
  server.once('exit',()=>{if(!stopping){console.error('The application server stopped. Restart the launcher.');stop(1);}});
  const localUrl=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let attempt=0;attempt<40&&!stopping;attempt++) {
    try {
      const response=await fetch(`${localUrl}/api/health`,{headers:{Cookie:`cq_demo_access=${accessToken}`},signal:AbortSignal.timeout(1000)});
      if(response.ok){const health=await response.json();if(health.status==='ok'&&health.paypal?.configured){ready=true;break;}}
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready) throw new Error('The application server did not become ready. No payment has been attempted.');
  await fs.mkdir(runtime,{recursive:true});
  await fs.writeFile(path.join(runtime,'run-info.json'),JSON.stringify({url:publicOrigin||localUrl,startedAt:new Date().toISOString(),mode:'paypal-sandbox'},null,2));
  console.log('\nApplication ready. PayPal credentials loaded; no payment has been attempted.');
  console.log(`Demo base URL (safe to share for origin registration): ${publicOrigin||localUrl}`);
  if(publicOrigin) console.log('Send only this base URL back in the ClearQuote chat so its exact HTTPS origin can be approved for AdmasLLM. Then use AI sign-in in the app.');
  else console.log('Local mode: PayPal Sandbox is available; AdmasLLM requires the HTTPS demo mode.');
  console.log('Keep this window open. Ctrl+C stops the demo.');
  openBrowser(`${publicOrigin||localUrl}/__clearquote_access?key=${accessToken}`);
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);stop(1);});
}
