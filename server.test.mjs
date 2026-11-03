import assert from 'assert';
import http from 'http';
 
async function runAuditTests() {
  console.log('Running ClearQuote Isolated Fake-Provider Audit & Regression Tests...');
 
  process.env.PAYPAL_CLIENT_ID = 'test-only-id';
  process.env.PAYPAL_CLIENT_SECRET = 'test-only-secret';
  process.env.PAYPAL_MERCHANT_ID = 'expected-merchant';
 
  const realFetch = globalThis.fetch;
  let createCalls = 0, captureCalls = 0, scenario = 'normal', aiReply = null;
  const orders = new Map(), providerReceipts = new Map(), captureKeys = [], createKeys = [], providerOrdersByKey = new Map();
 
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === '127.0.0.1') return realFetch(url, options);
    if (u.origin === 'https://ai.invalid') return Response.json({ choices: [{ message: { content: JSON.stringify(aiReply) } }] });
    if (u.origin !== 'https://api-m.sandbox.paypal.com') throw new Error('Unexpected outbound request blocked');
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'test-only-token' });
    if (u.pathname === '/v2/checkout/orders') {
      createCalls++;
      const key = options.headers['PayPal-Request-Id'];
      createKeys.push(key);
      if (providerOrdersByKey.has(key)) {
        const id = providerOrdersByKey.get(key);
        return Response.json({ id, status: 'CREATED', purchase_units: [orders.get(id)] });
      }
      const payload = JSON.parse(options.body), id = 'TEST-ORDER-' + createCalls;
      const pu = { ...payload.purchase_units[0], payee: { merchant_id: 'expected-merchant' } };
      orders.set(id, pu);
      providerOrdersByKey.set(key, id);
      if (scenario === 'create-timeout-once') { scenario = 'normal'; throw new Error('Simulated timeout after provider created order'); }
      if (scenario === 'concurrent') await new Promise(r => setTimeout(r, 50));
      return Response.json({ id, status: 'CREATED', purchase_units: [pu] });
    }
 
    const details = u.pathname.match(/^\/v2\/checkout\/orders\/(TEST-ORDER-\d+)$/);
    if (details && (!options.method || options.method === 'GET')) {
      const receipt = providerReceipts.get(details[1]);
      if (receipt && scenario === 'minimal-reconcile-unavailable') return Response.json({ error: 'Temporary receipt lookup failure' }, { status: 503 });
      return Response.json({ id: details[1], status: receipt ? 'COMPLETED' : 'APPROVED', purchase_units: [receipt || orders.get(details[1])] });
    }
 
    const match = u.pathname.match(/^\/v2\/checkout\/orders\/(TEST-ORDER-\d+)\/capture$/);
    if (match) {
      captureCalls++;
      captureKeys.push(options.headers['PayPal-Request-Id']);
      if (scenario === 'timeout-once') { scenario = 'normal'; throw new Error('Simulated ambiguous timeout'); }
      if (scenario === 'capture-inflight') await new Promise(r => setTimeout(r, 50));
      const pu = orders.get(match[1]);
      const amount = { ...pu.amount };
      if (scenario === 'missing-currency') delete amount.currency_code;
      const receipt = {
        ...pu,
        payee: { merchant_id: scenario === 'wrong-merchant' ? 'wrong-merchant' : 'expected-merchant' },
        payments: { captures: [{ id: 'TEST-CAPTURE-' + captureCalls, status: scenario === 'pending-capture' ? 'PENDING' : 'COMPLETED', amount }] }
      };
      providerReceipts.set(match[1], receipt);
      if (scenario === 'minimal-capture' || scenario === 'minimal-reconcile-unavailable' ||
          (scenario === 'representation-required' && options.headers.Prefer !== 'return=representation')) {
        return Response.json({ id: match[1], status: 'COMPLETED', links: [] });
      }
      return Response.json({ id: match[1], status: 'COMPLETED', purchase_units: [receipt] });
    }
 
    throw new Error('Unhandled fake-provider endpoint ' + u.pathname);
  };
 
  let { handleApiRequest } = await import('./server.mjs');
  const server = http.createServer((req, res) => {
    if (!handleApiRequest(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
 
  async function request(route, body, method = 'POST') {
    const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  }
 
  async function quote() {
    const r = await request('/api/quotes', { customerName: 'Isolated Synthetic Audit', items: [{ name: 'Desk', quantity: 1, unitPrice: 825, category: 'material' }] });
    await new Promise(r => setTimeout(r, 3));
    if (r.status !== 201) throw new Error('Fixture creation failed ' + JSON.stringify(r));
    return r.data.id;
  }
 
  const transition = (id, action, versionNumber = 1) => request('/api/quotes/' + id, { action, versionNumber, expectedVersion: versionNumber }, 'PUT');
 
  async function approved() {
    const id = await quote();
    await transition(id, 'send');
    await transition(id, 'approve');
    return id;
  }
 
  const makeOrder = id => request('/api/paypal/create-order', { quoteId: id, versionNumber: 1 });
  const capture = (id, orderID) => request('/api/paypal/capture-order', { quoteId: id, versionNumber: 1, orderID });
 
  const findings = [];
  try {
    let goodId = await approved();
    let goodOrder = await makeOrder(goodId);
    let good = await capture(goodId, goodOrder.data.orderID);
    let saved = await request('/api/quotes', undefined, 'GET');
    findings.push({ check: 'valid completed capture marks the exact quote paid', pass: good.status === 200 && good.data.status === 'COMPLETED' && saved.data.find(q => q.id === goodId)?.paymentStatus === 'paid', actualStatus: good.status });
 
    const priorCaptures = captureCalls;
    const duplicate = await capture(goodId, goodOrder.data.orderID);
    findings.push({ check: 'duplicate completed capture returns receipt without provider call', pass: duplicate.status === 200 && captureCalls === priorCaptures, actualStatus: duplicate.status });

    for (const responseMode of ['representation-required', 'minimal-capture']) {
      scenario = 'normal';
      const receiptId = await approved();
      const receiptOrder = await makeOrder(receiptId);
      scenario = responseMode;
      const callsBefore = captureCalls;
      const received = await capture(receiptId, receiptOrder.data.orderID);
      const canonical = await request('/api/quotes', undefined, 'GET');
      findings.push({ check: responseMode + ' produces a fully verified receipt with one capture',
        pass: received.status === 200 && received.data.status === 'COMPLETED' &&
          captureCalls === callsBefore + 1 && canonical.data.find(q => q.id === receiptId)?.paymentStatus === 'paid',
        actualStatus: received.status });
    }
    scenario = 'normal';
    const recoveryId = await approved();
    const recoveryOrder = await makeOrder(recoveryId);
    const recoveryCalls = captureCalls;
    scenario = 'minimal-reconcile-unavailable';
    const unavailable = await capture(recoveryId, recoveryOrder.data.orderID);
    const unresolved = await request('/api/quotes', undefined, 'GET');
    scenario = 'normal';
    const recovered = await capture(recoveryId, recoveryOrder.data.orderID);
    findings.push({ check: 'a lost minimal receipt recovers the same order without a second capture',
      pass: unavailable.status === 502 && unresolved.data.find(q => q.id === recoveryId)?.paymentStatus === 'unpaid' &&
        recovered.status === 200 && recovered.data.status === 'COMPLETED' && captureCalls === recoveryCalls + 1,
      actualStatus: recovered.status });
 
    let id = await quote();
    let r = await transition(id, 'approve');
    findings.push({ check: 'approval before owner send is rejected', pass: r.status >= 400, actualStatus: r.status });
 
    id = await quote();
    await transition(id, 'send');
    let before = createCalls;
    r = await makeOrder(id);
    findings.push({ check: 'checkout before customer approval is rejected', pass: r.status >= 400 && createCalls === before, actualStatus: r.status, providerCalls: createCalls - before });
 
    id = await approved();
    let o = await makeOrder(id);
    await request('/api/quotes/' + id, { action: 'revise', versionNumber: 1, expectedVersion: 1, items: [{ name: 'Revised Desk', quantity: 1, unitPrice: 950, category: 'material' }] }, 'PUT');
    r = await capture(id, o.data.orderID);
    findings.push({ check: 'stale version cannot be captured after revision', pass: r.status >= 400, actualStatus: r.status });
 
    for (const bad of ['missing-currency', 'wrong-merchant']) {
      scenario = 'normal';
      id = await approved();
      o = await makeOrder(id);
      scenario = bad;
      r = await capture(id, o.data.orderID);
      findings.push({ check: bad + ' capture is rejected', pass: r.status >= 400, actualStatus: r.status });
    }
 
    scenario = 'normal';
    id = await approved();
    o = await makeOrder(id);
    captureKeys.length = 0;
    scenario = 'timeout-once';
    await capture(id, o.data.orderID);
    await new Promise(r => setTimeout(r, 5));
    ({ handleApiRequest } = await import('./server.mjs?restart=' + Date.now()));
    r = await capture(id, o.data.orderID);
    findings.push({ check: 'ambiguous capture retries retain the durable key after module restart', pass: r.status === 200 && captureKeys.length === 2 && captureKeys[0] === captureKeys[1], keys: [...captureKeys], actualStatus: r.status });
 
    scenario = 'concurrent';
    id = await approved();
    before = createCalls;
    const one = makeOrder(id);
    await new Promise(r => setTimeout(r, 5));
    const two = makeOrder(id);
    const both = await Promise.all([one, two]);
    findings.push({ check: 'concurrent create produces one provider order', pass: createCalls - before === 1 && both[0].data.orderID === both[1].data.orderID, providerCalls: createCalls - before, orderIDs: both.map(x => x.data.orderID) });
 
    scenario = 'normal';
    id = await approved();
    createKeys.length = 0;
    const uniqueBefore = providerOrdersByKey.size;
    scenario = 'create-timeout-once';
    await makeOrder(id);
    ({ handleApiRequest } = await import('./server.mjs?create-restart=' + Date.now()));
    r = await makeOrder(id);
    findings.push({ check: 'ambiguous create reuses the saved request key after restart', pass: r.status === 200 && providerOrdersByKey.size - uniqueBefore === 1 && createKeys.length === 2 && createKeys[0] === createKeys[1], keys: [...createKeys], providerOrders: providerOrdersByKey.size - uniqueBefore });
 
    scenario = 'normal';
    id = await approved();
    o = await makeOrder(id);
    scenario = 'capture-inflight';
    const inFlight = capture(id, o.data.orderID);
    await new Promise(r => setTimeout(r, 5));
    const revision = await request('/api/quotes/' + id, { action: 'revise', versionNumber: 1, expectedVersion: 1, items: [{ name: 'Race revision', quantity: 1, unitPrice: 950, category: 'material' }] }, 'PUT');
    await inFlight;
    saved = await request('/api/quotes', undefined, 'GET');
    findings.push({ check: 'revision is blocked while capture is in flight', pass: revision.status >= 400 && saved.data.find(q => q.id === id)?.currentVersion === 1, revisionStatus: revision.status });
 
    scenario = 'normal';
    id = await approved();
    o = await makeOrder(id);
    scenario = 'pending-capture';
    await capture(id, o.data.orderID);
    const pendingRevision = await request('/api/quotes/' + id, { action: 'revise', versionNumber: 1, expectedVersion: 1, items: [{ name: 'Pending revision', quantity: 1, unitPrice: 950, category: 'material' }] }, 'PUT');
    saved = await request('/api/quotes', undefined, 'GET');
    findings.push({ check: 'pending capture remains unpaid and blocks revision until reconciliation', pass: pendingRevision.status >= 400 && saved.data.find(q => q.id === id)?.paymentStatus === 'unpaid', revisionStatus: pendingRevision.status });
 
    scenario = 'normal';
    id = await quote();
    await transition(id, 'send');
    await request('/api/quotes/' + id, { action: 'revise', expectedVersion: 1, versionNumber: 1, items: [{ name: 'Unseen v2', quantity: 1, unitPrice: 950, category: 'material' }] }, 'PUT');
    await transition(id, 'send', 2);
    r = await transition(id, 'approve', 1);
    findings.push({ check: 'stale customer approval cannot approve an unseen sent version', pass: r.status >= 400, actualStatus: r.status });
 
    delete process.env.AI_API_KEY;
    r = await request('/api/ai/extract', { prompt: '48-inch oak desk with one drawer and workshop pickup (no delivery).' });
    findings.push({ check: 'local extraction preserves one drawer and excludes delivery', pass: r.status === 200 && r.data.extracted?.drawers === 1 && r.data.extracted?.includeDelivery === false, actual: r.data.extracted });
 
    process.env.AI_API_KEY = 'test-only-ai-key';
    process.env.AI_BASE_URL = 'https://ai.invalid/v1';
    process.env.AI_MODEL = 'test-model';
    aiReply = { dimensions: '999-inch desk', material: 'Maple', drawers: -1, includeDelivery: 'yes', notes: 'Malformed result', paymentStatus: 'paid', totalAmount: 0 };
    r = await request('/api/ai/extract', { prompt: 'Ambiguous desk' });
    findings.push({ check: 'malformed model fields and payment/price fields are rejected', pass: r.status >= 400, actualStatus: r.status });
 
    aiReply = { dimensions: null, material: null, drawers: 0, includeDelivery: false, notes: 'Needs owner clarification' };
    r = await request('/api/ai/extract', { prompt: 'Ambiguous desk' });
    findings.push({ check: 'valid unresolved model draft remains unresolved', pass: r.status === 200 && r.data.extracted?.dimensions === null && r.data.extracted?.material === null, actualStatus: r.status });
 
    process.exitCode = findings.some(f => !f.pass) ? 1 : 0;
    console.log(JSON.stringify({ source: 'Read-only snapshot of Admas saved server.mjs; all provider calls replaced with fakes; no real PayPal calls', findings }, null, 2));
  } finally {
    globalThis.fetch = realFetch;
    await new Promise(r => server.close(r));
  }
}
 
runAuditTests().catch(err => {
  console.error('Audit test failed:', err);
  process.exit(1);
});
 
