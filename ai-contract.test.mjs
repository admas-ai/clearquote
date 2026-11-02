import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExtraction, parseExtraction, tokenNeedsRefresh, inferenceHeaders } from './src/services/admasContract.ts';

const draft = { dimensions: '48-inch Compact Desk', material: 'White Oak Hardwood (Solid)', drawers: 1, includeDelivery: false, notes: 'Pickup' };
const token = (iat, exp = iat + 3600) => `header.${Buffer.from(JSON.stringify({iat,exp})).toString('base64url')}.signature`;

test('AI extraction accepts supported fields and unresolved dimensions', () => {
  assert.deepEqual(parseExtraction('```json\n' + JSON.stringify(draft) + '\n```'), draft);
  assert.equal(validateExtraction({...draft, dimensions:null}).dimensions, null);
});
test('AI cannot add prices, payment states, or unsupported values', () => {
  for (const changed of [{unitPrice:1},{paymentStatus:'paid'},{drawers:1.5},{drawers:7},{drawers:'2'},{material:'Plastic'},{dimensions:'72-inch Desk'},{includeDelivery:'false'}]) {
    assert.throws(() => validateExtraction({...draft,...changed}));
  }
  assert.throws(() => parseExtraction('not JSON'));
});
test('auth freshness refreshes at 12 minutes, before expiry, and on malformed tokens', () => {
  const now = 1800000000000;
  assert.equal(tokenNeedsRefresh(token(now/1000-719),now),false);
  assert.equal(tokenNeedsRefresh(token(now/1000-720),now),true);
  assert.equal(tokenNeedsRefresh(token(now/1000, now/1000+20),now),true);
  assert.equal(tokenNeedsRefresh('admas_pk_'+'a'.repeat(64),now),true);
});
test('routing metadata never substitutes for a fresh user Bearer token', () => {
  const routing='admas_pk_'+'a'.repeat(64);
  const access=token(Math.floor(Date.now()/1000));
  const headers=inferenceHeaders(access,routing,'demo-request-123');
  assert.equal(headers.Authorization,`Bearer ${access}`);
  assert.equal(headers['x-admas-project-key'],routing);
  assert.equal(headers['Idempotency-Key'],'demo-request-123');
  assert.throws(() => inferenceHeaders(routing,routing,'demo-request-123'));
});
