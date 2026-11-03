import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Exercise the real API payload through the real React view, without provider calls.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clearquote-workflow-'));
for (const name of ['server.mjs', 'runtime-access.mjs']) {
  await fs.copyFile(new URL(name, import.meta.url), path.join(root, name));
}
await fs.mkdir(path.join(root, 'src/data'), { recursive: true });
await fs.copyFile(new URL('src/data/initialData.ts', import.meta.url), path.join(root, 'src/data/initialData.ts'));
await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
process.env.PUBLIC_ORIGIN = '';
process.env.DEMO_APP_ORIGIN = '';
process.env.DEMO_ACCESS_TOKEN = '';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
const { handleApiRequest } = await import(pathToFileURL(path.join(root, 'server.mjs')).href);
const server = http.createServer((req, res) => {
  if (!handleApiRequest(req, res)) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const vite = await createServer({
  root: path.dirname(fileURLToPath(import.meta.url)),
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
const { OwnerDashboard } = await vite.ssrLoadModule('/src/components/OwnerDashboard.tsx');
after(async () => {
  await vite.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});
const render = quote => renderToStaticMarkup(React.createElement(OwnerDashboard, {
  businessName: 'Synthetic test workshop', quotes: [quote], prices: [],
  onUpdateQuote: async value => value, onCreateQuote: async value => value,
  onOpenCustomerViewForQuote: () => {},
}));
async function request(route, body) {
  const response = await fetch(base + route, {
    method: route === '/api/quotes' ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}

test('a quote created by the real API exposes owner review and Send to Customer', async () => {
  const quote = await request('/api/quotes', {
    customerName: 'Workflow integration fixture',
    items: [{ name: 'Desk', category: 'material', quantity: 1, unitPrice: 825 }],
  });
  assert.equal(quote.versions[0].status, 'draft');
  const html = render(quote);
  assert.ok(html.includes('<span>Send to Customer</span>'));
  assert.ok(html.includes('Review itemized estimate, edit if needed, then send to customer for approval.'));
  const sent = await request('/api/quotes/' + quote.id, { action: 'send', expectedVersion: 1 });
  assert.equal(sent.versions[0].status, 'sent_to_customer');
  assert.ok(!render(sent).includes('<span>Send to Customer</span>'));
});

test('a customer revision returned by the API can be reviewed and sent again', async () => {
  let quote = await request('/api/quotes', {
    customerName: 'Revision integration fixture',
    items: [{ name: 'Desk', category: 'material', quantity: 1, unitPrice: 1130 }],
  });
  quote = await request('/api/quotes/' + quote.id, { action: 'send', expectedVersion: 1 });
  quote = await request('/api/quotes/' + quote.id, {
    action: 'revise', expectedVersion: 1,
    customerRequestSummary: 'One drawer and pickup',
    items: [{ name: 'Desk', category: 'material', quantity: 1, unitPrice: 825 }],
  });
  assert.equal(quote.currentVersion, 2);
  assert.equal(quote.versions[1].status, 'draft');
  assert.ok(render(quote).includes('<span>Send to Customer</span>'));
  quote = await request('/api/quotes/' + quote.id, { action: 'send', expectedVersion: 2 });
  quote = await request('/api/quotes/' + quote.id, { action: 'approve', expectedVersion: 2 });
  assert.equal(quote.versions[1].status, 'approved');
  assert.ok(!render(quote).includes('<span>Send to Customer</span>'));
});

test('the local pending-review workflow retains its Send action', () => {
  const html = render({
    id: 'local-fixture', quoteNumber: 'LOCAL-1', customerName: 'Local fixture',
    customerEmail: '', customerPhone: '', currentVersion: 1,
    paymentStatus: 'unpaid', versions: [{ versionNumber: 1, status: 'pending_review',
      items: [], totalAmount: 825, notes: '', customerRequestSummary: 'Local draft' }],
  });
  assert.ok(html.includes('<span>Send to Customer</span>'));
});
