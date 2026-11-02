import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

// Execute a read-only snapshot with fake hooks, DOM, SDK and APIs. No provider calls.
const source = readFileSync(new URL('./src/components/CustomerPortal.tsx', import.meta.url), 'utf8');
const start = source.indexOf('export const CustomerPortal:');
const end = source.indexOf('  const updateRevisionDraftWithCalc');
assert(start >= 0 && end > start, 'Expected component/checkout boundaries');
const exposed = ['executeCaptureAndVerify', 'savedAttempt', 'isVerifyingPayment', 'inlineError'];
const program = stripTypeScriptTypes(source.slice(start, end).replace('export const', 'const') +
  '\nreturn {' + exposed.join(',') + '};\n};\nCustomerPortal;', { mode: 'strip' });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const KEY = 'clearquote_paypal_attempt';
const triple = orderID => ({ quoteId: 'quote-a', versionNumber: 1, orderID });
const quote = (paid = false, orderID = 'ORDER-A') => ({ id: 'quote-a', currentVersion: 1,
  paymentStatus: paid ? 'paid' : 'unpaid', paymentId: paid ? orderID : undefined,
  versions: [{ versionNumber: 1, status: 'approved', items: [], totalAmount: 825 }] });

async function setup(options = {}) {
  const cells = [], effects = [], scripts = [], messages = [], storage = new Map();
  if (options.saved !== undefined) storage.set(KEY, JSON.stringify(options.saved));
  let cursor = 0, pendingEffects = [], callbacks, alive = true, result;
  const calls = { create: [], capture: [], refresh: [], close: 0, stateAfterUnmount: 0 };
  const props = { quotes: [options.quote || quote()], settings: { paypalConnected: true, paypalMode: 'sandbox' },
    prices: [], backendConnected: true, onUpdateQuote: async q => q,
    onRefreshQuote: async id => { calls.refresh.push(id); if (options.refreshFailure) throw new Error('fake refresh unavailable');
      const canonical = options.canonical || { ...quote(true), id };
      if (options.refreshRerender) { props.quotes = [canonical]; render(); await tick(); }
      return canonical; } };
  const ctx = {
    React: {}, URLSearchParams, Promise, Number, JSON,
    console: { error() {} },
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), removeItem: k => storage.delete(k) },
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], value => { if (!alive) calls.stateAfterUnmount++; cells[i] = typeof value === 'function' ? value(cells[i]) : value;
        if (i === 4) messages.push(cells[i]); }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(fn, deps) { const i = cursor++; const old = effects[i];
      if (!old || !deps || deps.some((v,n) => !Object.is(v,old.deps[n]))) pendingEffects.push({ i, fn, deps }); },
    document: { getElementById(id) { return id === 'paypal-button-container' ? { innerHTML: '' } : null; },
      createElement() { return { remove() {} }; }, body: { appendChild(script) { scripts.push(script); } } },
    window: { paypal: { Buttons(value) { callbacks = value; return { render: () => Promise.resolve(), close: () => { calls.close++; return Promise.resolve(); } }; } } },
    apiFetchPayPalConfig: async () => ({ configured: true, clientId: 'fake-public-id', mode: 'sandbox' }),
    apiCreatePayPalOrder: async (...args) => { calls.create.push(args); return { orderID: 'ORDER-NEW' }; },
    apiCapturePayPalOrder: async (...args) => { calls.capture.push(args);
      if (options.captureGate) return await options.captureGate.promise;
      if (options.captureFailure) throw new Error('fake capture network unavailable');
      return options.captureSequence?.[calls.capture.length-1] || { status: options.captureStatus || 'COMPLETED' }; }
  };
  ctx.useLayoutEffect = ctx.useEffect;
  const component = vm.runInNewContext(program, ctx, { timeout: 1000 });
  function render() { cursor = 0; pendingEffects = []; result = component(props);
    for (const e of pendingEffects) { effects[e.i]?.cleanup?.(); effects[e.i] = { deps: e.deps, cleanup: e.fn() }; }
    return result; }
  function unmount() { alive = false; for (const e of effects) e?.cleanup?.(); }
  render(); await tick();
  for (const script of scripts) script.onload?.();
  await tick();
  return { calls, storage, messages, render, unmount, setQuote(value) { props.quotes = [value]; }, get callbacks() { return callbacks; },
    get state() { return result; }, bound: () => storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null };
}

const findings = [];
async function check(name, fn) { try { await fn(); findings.push({ name, pass: true }); }
  catch (e) { findings.push({ name, pass: false, error: e.message }); } }

await check('Concurrent duplicate approval for the same order makes one capture call', async () => {
  const gate = deferred(); const t = await setup({ captureGate: gate });
  const a = t.callbacks.onApprove({ orderID: 'ORDER-A' }); const b = t.callbacks.onApprove({ orderID: 'ORDER-A' });
  await tick(); assert.equal(t.calls.capture.length,1); gate.resolve({ status: 'PENDING' }); await Promise.all([a,b]);
  assert.equal(t.bound().orderID,'ORDER-A');
});
await check('A different approval cannot overwrite the unresolved bound order', async () => {
  const gate = deferred(); const t = await setup({ captureGate: gate });
  const a = t.callbacks.onApprove({ orderID: 'ORDER-A' });
  const b = t.callbacks.onApprove({ orderID: 'ORDER-B' }).catch(() => {});
  const boundDuringCapture = t.bound(); gate.resolve({ status: 'PENDING' }); await Promise.all([a,b]);
  assert.equal(boundDuringCapture.orderID,'ORDER-A','Conflicting callback overwrote ORDER-A recovery');
});
await check('After a pending approval, existing SDK callback cannot create another order', async () => {
  const t = await setup({ captureStatus: 'PENDING' }); await t.callbacks.onApprove({ orderID: 'ORDER-A' });
  t.render(); await tick(); await t.callbacks.createOrder().catch(() => {});
  assert.equal(t.calls.create.length,0,'createOrder still calls API after unresolved PENDING capture');
});
await check('A saved pending attempt also blocks creation of another order on remount', async () => {
  const t = await setup({ saved: triple('ORDER-A'), captureStatus: 'PENDING' });
  assert.equal(t.calls.capture.length,0,'Recovery on remount must wait for explicit recheck');
  await t.callbacks.createOrder().catch(() => {});
  assert.equal(t.calls.create.length,0,'Same-version recovery did not block createOrder');
});
await check('A paid receipt for another order cannot clear unresolved recovery', async () => {
  const t = await setup({ saved: triple('ORDER-A'), quote: quote(true,'ORDER-B') });
  assert.equal(t.bound()?.orderID,'ORDER-A','Nonmatching paid order cleared recovery');
});
await check('Unmount during capture prevents refresh and late state writes', async () => {
  const gate = deferred(); const t = await setup({ captureGate: gate });
  const a = t.callbacks.onApprove({ orderID: 'ORDER-A' }); await tick();
  assert.equal(t.calls.capture.length,1,'Capture must start before disposal'); t.unmount();
  gate.resolve({ status: 'COMPLETED' }); await a;
  assert.equal(t.calls.refresh.length,0,'Disposed capture still refreshed the quote');
  assert.equal(t.calls.stateAfterUnmount,0,'Disposed capture still changed component state');
});
await check('Missing order ID never starts capture or persists invalid recovery', async () => {
  const t = await setup(); await t.callbacks.onApprove({}).catch(() => {});
  assert.equal(t.calls.capture.length,0,'Missing order ID reached capture API');
  assert.equal(t.bound(),null,'Malformed approval persisted recovery');
});
await check('Canonical refresh failure retains the exact recovery triple', async () => {
  const t = await setup({ refreshFailure: true }); await t.callbacks.onApprove({ orderID: 'ORDER-A' });
  assert.equal(t.bound().orderID,'ORDER-A'); assert.equal(t.calls.refresh.length,1);
});
await check('Disposed SDK callbacks cannot start create or capture', async () => {
  const t = await setup(); t.unmount(); await t.callbacks.createOrder().catch(() => {});
  await t.callbacks.onApprove({ orderID: 'ORDER-A' }).catch(() => {});
  assert.equal(t.calls.create.length,0); assert.equal(t.calls.capture.length,0); assert.equal(t.calls.close,1);
});

await check('A version change during capture cannot refresh or clear the old attempt', async () => {
  const gate = deferred(); const t = await setup({ captureGate: gate });
  const a = t.callbacks.onApprove({ orderID: 'ORDER-A' });
  await tick(); assert.equal(t.calls.capture.length,1,'Capture must start before version change');
  const newer = quote(); newer.currentVersion = 2; newer.versions = [{ versionNumber: 2, status: 'approved', items: [], totalAmount: 950 }];
  t.setQuote(newer); t.render(); await tick();
  gate.resolve({ status: 'COMPLETED' }); await a;
  assert.equal(t.calls.refresh.length,0,'Old capture refreshed after canonical version changed');
  assert.equal(t.bound()?.orderID,'ORDER-A','Stale result cleared recovery');
});
await check('Explicit recheck uses the same bound triple and clears only the matching receipt', async () => {
  const t = await setup({ captureSequence: [{ status: 'PENDING' }, { status: 'COMPLETED' }] });
  await t.callbacks.onApprove({ orderID: 'ORDER-A' }); t.render(); await tick();
  assert.equal(t.calls.capture.length,1,'State update must not trigger automatic capture');
  await t.state.executeCaptureAndVerify('quote-a',1,'ORDER-A');
  assert.equal(t.calls.capture.length,2); assert.equal(t.calls.create.length,0);
  assert.deepEqual(t.calls.capture[0],t.calls.capture[1]); assert.equal(t.bound(),null);
});
await check('A matching canonical paid refresh may rerender the parent before verification completes', async () => {
  const t = await setup({ refreshRerender: true });
  await t.callbacks.onApprove({ orderID: 'ORDER-A' });
  assert.equal(t.bound(),null,'Own successful paid rerender invalidated payment verification');
  assert.equal(t.calls.refresh.length,1);
});
for (const [field,value] of [['id','quote-b'],['currentVersion',2],['paymentId','ORDER-B']]) {
  await check('Mismatched canonical '+field+' cannot clear the bound recovery', async () => {
    const t = await setup({ canonical: { ...quote(true), [field]: value } });
    await t.callbacks.onApprove({ orderID: 'ORDER-A' });
    assert.equal(t.bound()?.orderID,'ORDER-A','Mismatched canonical receipt cleared recovery');
  });
}

await check('Cancellation before approval reports no completion and performs no provider action', async () => {
  const t = await setup(); t.callbacks.onCancel(); t.render();
  assert.equal(t.state.inlineError,'Checkout cancelled; no completion confirmed.');
  assert.equal(t.bound(),null); assert.equal(t.calls.create.length,0); assert.equal(t.calls.capture.length,0);
});
await check('Cancellation preserves an unresolved order and asks for payment status', async () => {
  const t = await setup({ captureStatus: 'PENDING' }); await t.callbacks.onApprove({ orderID: 'ORDER-A' });
  t.callbacks.onCancel(); t.render();
  assert.equal(t.bound()?.orderID,'ORDER-A'); assert.match(t.state.inlineError,/still pending.*Check payment status/);
  assert.equal(t.calls.create.length,0); assert.equal(t.calls.capture.length,1);
});
await check('Disposed cancellation callback cannot write state or change recovery', async () => {
  const t = await setup({ saved: triple('ORDER-A') }); t.unmount(); t.callbacks.onCancel();
  assert.equal(t.calls.stateAfterUnmount,0); assert.equal(t.bound()?.orderID,'ORDER-A');
  assert.equal(t.calls.create.length,0); assert.equal(t.calls.capture.length,0);
});

const report = { snapshot: 'Persisted CustomerPortal checkout snapshot', source_snapshot_bytes: Buffer.byteLength(source,'utf8'),
  source_snapshot_sha256: createHash('sha256').update(source).digest('hex'), providers: 'Fully fake hooks, DOM, SDK, APIs and storage; no genuine provider calls',
  scope: 'Executed actual persisted checkout-function snapshot; does not replace full React/browser or real Sandbox verification',
  passed: findings.filter(x => x.pass).length, failed: findings.filter(x => !x.pass).length, findings };
writeFileSync(new URL('./checkout-test-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if (report.failed) process.exitCode = 1;
