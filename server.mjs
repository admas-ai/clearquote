import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createRequestGuard } from './runtime-access.mjs';
 
try {
  loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'));
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error('Error loading .env file:', e);
  }
}
 
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
 
import { INITIAL_QUOTES, INITIAL_PRICES, INITIAL_SETTINGS } from './src/data/initialData.ts';
 
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json');
const PRICES_FILE = path.join(DATA_DIR, 'prices.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
 
function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e);
    throw e;
  }
  return fallback;
}
 
function saveJson(file, data) {
  const tmp = path.join(path.dirname(file), 'tmp-' + randomUUID());
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
      fd = undefined;
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}
function assertStateShape(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 ||
      !Array.isArray(value.quotes) || !Array.isArray(value.prices) || !Array.isArray(value.payments) ||
      !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) {
    throw new Error('Invalid or unsupported persisted state');
  }
}
let quotes, prices, settings, payments;
if (fs.existsSync(STATE_FILE)) {
  const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  assertStateShape(value);
  ({quotes, prices, settings, payments} = value);
} else {
  const value = {schemaVersion: 1,
    quotes: loadJson(QUOTES_FILE, INITIAL_QUOTES),
    prices: loadJson(PRICES_FILE, INITIAL_PRICES),
    settings: loadJson(SETTINGS_FILE, INITIAL_SETTINGS),
    payments: loadJson(PAYMENTS_FILE, [])};
  assertStateShape(value);
  saveJson(STATE_FILE, value);
  ({quotes, prices, settings, payments} = value);
}
function persistAll() {
  const value = {schemaVersion: 1, quotes, prices, settings, payments};
  assertStateShape(value);
  saveJson(STATE_FILE, value);
}
 
const activeCreations = new Map();
const activeCaptures = new Map();
 
function validateCaptureResult(captureData, paymentAttempt, version) {
  if (!captureData || captureData.id !== paymentAttempt.orderID) {
    return { valid: false, error: 'Order ID mismatch or missing capture data.' };
  }
  const units = captureData?.purchase_units;
  if (!Array.isArray(units) || units.length !== 1) {
    return { valid: false, error: 'Expected exactly 1 purchase unit.' };
  }
  const unit = units[0];
  const expectedRefId = `${paymentAttempt.quoteId}-v${paymentAttempt.versionNumber}`;
  if (unit.reference_id !== expectedRefId) {
    return { valid: false, error: 'Purchase unit reference_id mismatch.' };
  }
  const children = unit.payments?.captures;
  if (!Array.isArray(children) || children.length !== 1 || !children[0]?.id) {
    return { valid: false, error: 'Expected exactly 1 child capture with nonempty ID.' };
  }
  const captureObj = children[0];
  const captureStatus = captureObj?.status;
  if (captureStatus !== 'COMPLETED') {
    return { valid: false, error: 'Capture not completed.' };
  }
 
  const capturedAmountVal = captureObj?.amount?.value;
  const capturedCurrency = captureObj?.amount?.currency_code;
 
  if (capturedCurrency !== 'USD') {
    return { valid: false, error: `Currency mismatch: expected USD, got ${capturedCurrency}` };
  }
 
  if (typeof capturedAmountVal !== 'string' || !/^[0-9]+[.][0-9]{2}$/.test(capturedAmountVal)) {
    return { valid: false, error: 'Invalid captured amount format.' };
  }
 
  const [dollarsStr, centsStr] = capturedAmountVal.split('.');
  const parsedDollars = parseInt(dollarsStr, 10);
  const parsedCents = parseInt(centsStr, 10);
  const captureAmountCents = parsedDollars * 100 + parsedCents;
 
  if (!Number.isSafeInteger(captureAmountCents) || captureAmountCents < 0) {
    return { valid: false, error: 'Invalid captured amount value.' };
  }
 
  const expectedCents = Math.round(version.totalAmount * 100);
 
  if (captureAmountCents !== paymentAttempt.amountCents || captureAmountCents !== expectedCents) {
    return { valid: false, error: `Tampered amount mismatch: captured ${captureAmountCents} cents vs expected ${expectedCents} cents.` };
  }
 
  const expectedMerchant = paymentAttempt.merchantId || process.env.PAYPAL_MERCHANT_ID;
  if (!expectedMerchant) {
    return { valid: false, error: 'Missing expected merchant ID identity; failing closed.' };
  }
 
  const capturePayeeMerchant = unit?.payee?.merchant_id;
  if (capturePayeeMerchant !== expectedMerchant) {
    return { valid: false, error: `Merchant payee mismatch: expected ${expectedMerchant}, got ${capturePayeeMerchant}` };
  }
 
  return { valid: true, captureAmountCents, orderID: captureData.id, captureData };
}
 
function validateAndMapItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Items must be a non-empty array.');
  }
  const validatedItems = [];
  let totalCents = 0;
 
  for (const i of rawItems) {
    if (!i || typeof i !== 'object') {
      throw new Error('Invalid item object.');
    }
    const quantity = i.quantity;
    const unitPrice = i.unitPrice;
 
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Item quantity must be a positive integer.');
    }
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Item unitPrice must be a finite non-negative number.');
    }
 
    const priceStr = unitPrice.toString();
    const parts = priceStr.split('.');
    if (parts.length === 2 && parts[1].length > 2) {
      throw new Error('Item unitPrice cannot have more than 2 decimal places.');
    }
 
    const unitCents = Math.round(unitPrice * 100);
    if (!Number.isSafeInteger(unitCents)) {
      throw new Error('Item unitPrice overflow.');
    }
 
    const itemTotalCents = quantity * unitCents;
    if (!Number.isSafeInteger(itemTotalCents)) {
      throw new Error('Item total amount overflow.');
    }
 
    totalCents += itemTotalCents;
    if (!Number.isSafeInteger(totalCents)) {
      throw new Error('Quote total amount overflow.');
    }
 
    validatedItems.push({
      id: i.id || 'i-' + Math.random().toString(36).substring(2, 7),
      name: String(i.name || 'Custom Item'),
      quantity,
      unitPrice,
      category: String(i.category || 'material'),
      notes: String(i.notes || '')
    });
  }
 
  return { validatedItems, totalAmount: totalCents / 100 };
}
 
async function getPayPalAccessToken(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PayPal OAuth failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return data.access_token;
  } finally {
    clearTimeout(timeoutId);
  }
}
 
const requestGuard = createRequestGuard({ publicOrigin: process.env.PUBLIC_ORIGIN, accessToken: process.env.DEMO_ACCESS_TOKEN, appOrigin: process.env.DEMO_APP_ORIGIN });

export function handleApiRequest(req, res, next) {
  if (!requestGuard(req, res)) return true;
  const hostHeader = req.headers.host || '';
  let parsedHost;
  try { parsedHost = new URL('http://' + hostHeader); } catch {}
  if (!parsedHost || parsedHost.host !== hostHeader.toLowerCase() ||
      parsedHost.username || parsedHost.password || parsedHost.pathname !== '/' ||
      parsedHost.search || parsedHost.hash ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsedHost.hostname) ||
      Number(parsedHost.port || 80) !== req.socket.localPort) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden host or port' }));
    return true;
  }
  const localOrigin = `http://${hostHeader}`;
  const originHeader = req.headers.origin;
  if (originHeader) {
    if (originHeader !== localOrigin && originHeader !== process.env.PUBLIC_ORIGIN && originHeader !== process.env.DEMO_APP_ORIGIN) {
      if (req.method === 'OPTIONS') {
        res.writeHead(403);
        res.end();
        return true;
      }
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cross-origin request rejected' }));
      return true;
    }
    res.setHeader('Access-Control-Allow-Origin', originHeader);
  }
 
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, PayPal-Request-Id');
 
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
 
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const contentType = req.headers['content-type'] || '';
    if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mutating requests require application/json content-type' }));
      return true;
    }
  }
 
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  const pathname = parsedUrl.pathname;
 
  if (!pathname.startsWith('/api')) {
    if (typeof next === 'function') return next();
    return false;
  }
 
  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
 
  const parseBody = () => new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 102400) {
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Malformed JSON request'));
      }
    });
    req.on('error', () => reject(new Error('Request stream error')));
  });
 
  (async () => {
    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        const clientId = process.env.PAYPAL_CLIENT_ID || settings.paypalClientId;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
        const aiKey = process.env.AI_API_KEY;
 
        sendJson(200, {
          status: 'ok',
          backend: 'node_durable',
          paypal: {
            configured: Boolean(clientId && clientSecret),
            mode: 'sandbox',
            endpoint: 'https://api-m.sandbox.paypal.com'
          },
          ai: {
            configured: Boolean(aiKey),
            model: process.env.AI_MODEL || settings.aiModel || 'gpt-4o-mini'
          },
          timestamp: new Date().toISOString()
        });
        return;
      }
 
      if (pathname === '/api/quotes' && req.method === 'GET') {
        sendJson(200, quotes);
        return;
      }
 
      if (pathname === '/api/quotes' && req.method === 'POST') {
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
 
        if (body.paymentStatus || body.paymentId || body.paidAt) {
          sendJson(400, { error: 'Client cannot set payment status or payment receipt fields.' });
          return;
        }
 
        let validated;
        try {
          validated = validateAndMapItems(body.items);
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
 
        const id = 'q-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const quoteNumber = 'CQ-' + new Date().getFullYear() + '-' + Math.floor(100 + Math.random() * 900);
        
        const newQuote = {
          id,
          quoteNumber,
          customerName: typeof body.customerName === 'string' ? body.customerName.trim() : 'Valued Customer',
          customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail.trim() : '',
          customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone.trim() : '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentVersion: 1,
          businessNotes: typeof body.businessNotes === 'string' ? body.businessNotes : '',
          paymentStatus: 'unpaid',
          versions: [
            {
              versionNumber: 1,
              createdAt: new Date().toISOString(),
              customerRequestSummary: body.customerRequestSummary || 'Initial estimate request',
              items: validated.validatedItems,
              totalAmount: validated.totalAmount,
              notes: String(body.notes || ''),
              status: 'draft'
            }
          ]
        };
 
        quotes.unshift(newQuote);
        persistAll();
        sendJson(201, newQuote);
        return;
      }
 
      if (pathname.match(/^\/api\/quotes\/[^/]+$/) && req.method === 'PUT') {
        const id = pathname.split('/')[3];
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
 
        const index = quotes.findIndex(q => q.id === id);
        if (index === -1) {
          sendJson(404, { error: 'Quote not found' });
          return;
        }
 
        const quote = quotes[index];
        const activeAttempt = payments.find(p => p.quoteId === id);
        const captureState = activeAttempt?.captureState;
        if (['IN_FLIGHT', 'UNCERTAIN', 'PENDING', 'REVIEW_REQUIRED'].includes(captureState)) {
          sendJson(409, { error: 'Quote has an active or unresolved capture state and is locked against modifications.' });
          return;
        }
 
        if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== quote.currentVersion) {
          sendJson(409, { error: 'Version mismatch or missing expectedVersion.' });
          return;
        }
 
        if (quote.paymentStatus === 'paid') {
          sendJson(400, { error: 'Cannot modify a quote that has been paid and completed.' });
          return;
        }
 
        const action = body.action;
 
        if (action === 'send') {
          const curVer = quote.versions.find(v => v.versionNumber === quote.currentVersion);
          if (!curVer) {
            sendJson(400, { error: 'Current version not found' });
            return;
          }
          curVer.status = 'sent_to_customer';
          quote.updatedAt = new Date().toISOString();
          persistAll();
          sendJson(200, quote);
          return;
        }
 
        if (action === 'approve') {
          const curVer = quote.versions.find(v => v.versionNumber === quote.currentVersion);
          if (!curVer || curVer.status !== 'sent_to_customer') {
            sendJson(409, { error: 'Current version must be sent to customer before approval' });
            return;
          }
          curVer.status = 'approved';
          quote.updatedAt = new Date().toISOString();
          persistAll();
          sendJson(200, quote);
          return;
        }
 
        if (action === 'revise' || body.versions || body.items) {
          const rawItems = Array.isArray(body.items) ? body.items : (quote.versions.find(v => v.versionNumber === quote.currentVersion)?.items || []);
          let validated;
          try {
            validated = validateAndMapItems(rawItems);
          } catch (e) {
            sendJson(400, { error: e.message });
            return;
          }
 
          const nextVersionNumber = (Math.max(...quote.versions.map(v => v.versionNumber)) || 0) + 1;
          quote.versions.forEach(v => {
            if (v.status === 'draft' || v.status === 'sent_to_customer' || v.status === 'approved') {
              v.status = 'superseded';
            }
          });
 
          const newVersion = {
            versionNumber: nextVersionNumber,
            createdAt: new Date().toISOString(),
            customerRequestSummary: String(body.customerRequestSummary || 'Revised quote version'),
            items: validated.validatedItems,
            totalAmount: validated.totalAmount,
            notes: String(body.notes || ''),
            status: 'draft'
          };
 
          quote.versions.push(newVersion);
          quote.currentVersion = nextVersionNumber;
          quote.updatedAt = new Date().toISOString();
          if (body.customerName) quote.customerName = String(body.customerName).trim();
          if (body.customerEmail) quote.customerEmail = String(body.customerEmail).trim();
          if (body.customerPhone) quote.customerPhone = String(body.customerPhone).trim();
 
          persistAll();
          sendJson(200, quote);
          return;
        }
 
        if (body.customerName) quote.customerName = String(body.customerName).trim();
        if (body.customerEmail) quote.customerEmail = String(body.customerEmail).trim();
        if (body.customerPhone) quote.customerPhone = String(body.customerPhone).trim();
        quote.updatedAt = new Date().toISOString();
        persistAll();
        sendJson(200, quote);
        return;
      }
 
      if (pathname === '/api/prices' && req.method === 'GET') {
        sendJson(200, prices);
        return;
      }
      if (pathname === '/api/prices' && req.method === 'PUT') {
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
        prices = Array.isArray(body) ? body : prices;
        persistAll();
        sendJson(200, prices);
        return;
      }
 
      if (pathname === '/api/settings' && req.method === 'GET') {
        sendJson(200, settings);
        return;
      }
      if (pathname === '/api/settings' && req.method === 'PUT') {
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
        settings = { ...settings, ...body };
        persistAll();
        sendJson(200, settings);
        return;
      }
 
      if (pathname === '/api/paypal/config' && req.method === 'GET') {
        const clientId = process.env.PAYPAL_CLIENT_ID || settings.paypalClientId;
        const configured = Boolean(clientId && process.env.PAYPAL_CLIENT_SECRET);
        sendJson(200, {
          configured,
          clientId: configured ? clientId : '',
          mode: 'sandbox'
        });
        return;
      }
 
      if (pathname === '/api/paypal/create-order' && req.method === 'POST') {
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
 
        const { quoteId, versionNumber } = body;
        const clientId = process.env.PAYPAL_CLIENT_ID || settings.paypalClientId;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
 
        if (!clientId || !clientSecret) {
          sendJson(503, { error: 'PayPal sandbox credentials not configured. Actionable 503.' });
          return;
        }
 
        const quote = quotes.find(q => q.id === quoteId);
        if (!quote) {
          sendJson(404, { error: 'Quote not found' });
          return;
        }
 
        if (quote.currentVersion !== versionNumber) {
          sendJson(400, { error: 'Version mismatch: requested version is not the current quote version.' });
          return;
        }
 
        const version = quote.versions.find(v => v.versionNumber === versionNumber);
        if (!version) {
          sendJson(404, { error: 'Quote version not found' });
          return;
        }
 
        if (version.status !== 'approved') {
          sendJson(400, { error: 'Cannot checkout unapproved version. Customer must have approved this version.' });
          return;
        }
 
        const totalCents = Math.round(version.totalAmount * 100);
 
        const lockKey = `${quoteId}-v${versionNumber}`;
        while (activeCreations.has(lockKey)) {
          await activeCreations.get(lockKey);
        }
 
        let resolveLock;
        const lockPromise = new Promise(r => { resolveLock = r; });
        activeCreations.set(lockKey, lockPromise);
 
        try {
          payments.forEach(p => {
            if (p.quoteId === quoteId && p.versionNumber === versionNumber && !p.currency) {
              p.currency = 'USD';
            }
          });
 
          let existingPayment = payments.find(p => p.quoteId === quoteId && p.versionNumber === versionNumber && p.amountCents === totalCents && p.currency === 'USD');
 
          if (existingPayment) {
            if (existingPayment.orderID) {
              sendJson(200, {
                orderID: existingPayment.orderID,
                status: existingPayment.status,
                amountCents: totalCents,
                currency: 'USD',
                versionNumber,
                quoteId,
                clientId
              });
              return;
            }
          } else {
            existingPayment = {
              requestId: `create-${randomUUID()}`,
              quoteId,
              versionNumber,
              amountCents: totalCents,
              currency: 'USD',
              orderID: null,
              merchantId: null,
              status: 'CREATED',
              createdAt: new Date().toISOString()
            };
            payments.push(existingPayment);
            persistAll();
          }
 
          const requestId = existingPayment.requestId;
 
          const accessToken = await getPayPalAccessToken(clientId, clientSecret);
 
          const orderPayload = {
            intent: 'CAPTURE',
            purchase_units: [
              {
                reference_id: `${quoteId}-v${versionNumber}`,
                description: `${quote.quoteNumber} (Version ${versionNumber}) - ${quote.customerName}`,
                amount: {
                  currency_code: 'USD',
                  value: (totalCents / 100).toFixed(2)
                }
              }
            ]
          };
 
          const createController = new AbortController();
          const createTimeout = setTimeout(() => createController.abort(), 15000);
          let ppRes;
          try {
            ppRes = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'PayPal-Request-Id': requestId,
                'Prefer': 'return=representation'
              },
              body: JSON.stringify(orderPayload),
              signal: createController.signal
            });
          } finally {
            clearTimeout(createTimeout);
          }
 
          if (!ppRes.ok) {
            const errText = await ppRes.text();
            existingPayment.status = 'FAILED';
            persistAll();
            sendJson(502, { error: `PayPal order creation failed: ${errText}` });
            return;
          }
 
          const orderData = await ppRes.json();
          const serverMerchantId = orderData.purchase_units?.[0]?.payee?.merchant_id || process.env.PAYPAL_MERCHANT_ID || null;
 
          existingPayment.orderID = orderData.id;
          existingPayment.merchantId = serverMerchantId;
          existingPayment.status = orderData.status;
          persistAll();
 
          const result = {
            orderID: orderData.id,
            status: orderData.status,
            amountCents: totalCents,
            currency: 'USD',
            versionNumber,
            quoteId,
            clientId
          };
 
          sendJson(200, result);
          return;
        } finally {
          activeCreations.delete(lockKey);
          resolveLock();
        }
      }
 
      if (pathname === '/api/paypal/capture-order' && req.method === 'POST') {
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
 
        const { quoteId, versionNumber, orderID } = body;
        const clientId = process.env.PAYPAL_CLIENT_ID || settings.paypalClientId;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
 
        if (!clientId || !clientSecret) {
          sendJson(503, { error: 'PayPal credentials missing' });
          return;
        }
 
        const captureLockKey = `${quoteId}`;
        while (activeCaptures.has(captureLockKey)) {
          await activeCaptures.get(captureLockKey);
        }
 
        let resolveCaptureLock;
        const captureLockPromise = new Promise(r => { resolveCaptureLock = r; });
        activeCaptures.set(captureLockKey, captureLockPromise);
 
        try {
          const quote = quotes.find(q => q.id === quoteId);
          if (!quote) {
            sendJson(404, { error: 'Quote not found' });
            return;
          }
 
          const version = quote.versions.find(v => v.versionNumber === versionNumber);
          if (!version) {
            sendJson(404, { error: 'Version not found' });
            return;
          }
 
          if (quote.currentVersion !== versionNumber) {
            sendJson(400, { error: 'Version mismatch: cannot capture non-current version or superseded version.' });
            return;
          }
          if (version.status !== 'approved') {
            sendJson(400, { error: 'Version is not approved. Cannot capture.' });
            return;
          }
 
          if (quote.paymentStatus === 'paid' && quote.paymentId === orderID) {
            sendJson(200, {
              status: 'COMPLETED',
              orderID,
              message: 'Duplicate capture request returned existing valid receipt.',
              quoteId,
              paidAt: quote.paidAt
            });
            return;
          }
 
          const paymentAttempt = payments.find(p => p.quoteId === quoteId && p.versionNumber === versionNumber && p.orderID === orderID);
          if (!paymentAttempt) {
            sendJson(400, { error: 'No matching payment order attempt found for this quote and version.' });
            return;
          }
 
          if (!paymentAttempt.captureRequestId) {
            paymentAttempt.captureRequestId = `cap-${orderID}`;
          }
          paymentAttempt.captureState = 'IN_FLIGHT';
          persistAll();
 
          let accessToken;
          try {
            accessToken = await getPayPalAccessToken(clientId, clientSecret);
          } catch (e) {
            paymentAttempt.captureState = 'UNCERTAIN';
            persistAll();
            sendJson(502, { error: `PayPal OAuth failure: ${e.message}` });
            return;
          }
 
          let orderData;
          const getController = new AbortController();
          const getTimeout = setTimeout(() => getController.abort(), 10000);
          try {
            const getRes = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}`, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              signal: getController.signal
            });
            if (!getRes.ok) throw new Error('Order reconciliation unavailable');
            orderData = await getRes.json();
          } catch (e) {
            paymentAttempt.captureState = 'UNCERTAIN';
            persistAll();
            sendJson(502, { error: 'Order reconciliation failed. Payment remains unresolved.' });
            return;
          } finally {
            clearTimeout(getTimeout);
          }
 
          const units = orderData?.purchase_units;
          const unit = Array.isArray(units) && units.length === 1 ? units[0] : null;
          const rawAmount = unit?.amount?.value;
          const decimal = typeof rawAmount === 'string' && /^[0-9]+[.][0-9]{2}$/.test(rawAmount);
          const cents = decimal ? Number(rawAmount.split('.')[0]) * 100 + Number(rawAmount.split('.')[1]) : NaN;
          const expectedMerchant = paymentAttempt.merchantId || process.env.PAYPAL_MERCHANT_ID;
          if (orderData?.id !== paymentAttempt.orderID || !unit ||
              unit.reference_id !== `${paymentAttempt.quoteId}-v${paymentAttempt.versionNumber}` ||
              !expectedMerchant || unit.payee?.merchant_id !== expectedMerchant ||
              unit.amount?.currency_code !== 'USD' || !Number.isSafeInteger(cents) ||
              cents !== paymentAttempt.amountCents || cents !== Math.round(version.totalAmount * 100)) {
            paymentAttempt.captureState = 'REVIEW_REQUIRED';
            persistAll();
            sendJson(400, { error: 'Reconciled order does not match the saved payment.' });
            return;
          }
          const children = unit.payments?.captures;
          if (children !== undefined && (!Array.isArray(children) || children.length > 1)) {
            paymentAttempt.captureState = 'REVIEW_REQUIRED';
            persistAll();
            sendJson(400, { error: 'Unexpected capture evidence.' });
            return;
          }
          if (children?.length) {
            if (children[0].status === 'PENDING') {
              paymentAttempt.captureState = 'PENDING';
              paymentAttempt.status = 'PENDING';
              persistAll();
              sendJson(202, { status: 'PENDING', orderID, quoteId, versionNumber });
              return;
            }
            const validation = validateCaptureResult(orderData, paymentAttempt, version);
            if (!validation.valid) {
              paymentAttempt.captureState = 'REVIEW_REQUIRED';
              persistAll();
              sendJson(400, { error: validation.error });
              return;
            }
            quote.paymentStatus = 'paid';
            quote.paymentId = orderID;
            quote.paidAt = new Date().toISOString();
            quote.updatedAt = quote.paidAt;
            paymentAttempt.status = 'COMPLETED';
            paymentAttempt.captureState = 'COMPLETED';
            persistAll();
            sendJson(200, { status: 'COMPLETED', orderID, amountCents: validation.captureAmountCents,
              quoteId, versionNumber, paidAt: quote.paidAt, receipt: orderData });
            return;
          }
          if (orderData.status !== 'APPROVED') {
            paymentAttempt.captureState = 'UNCERTAIN';
            persistAll();
            sendJson(409, { error: 'Order is not ready for capture.' });
            return;
          }
 
          const captureRequestId = paymentAttempt.captureRequestId;
 
          const captureController = new AbortController();
          const captureTimeout = setTimeout(() => captureController.abort(), 15000);
          let ppRes;
          try {
            ppRes = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}/capture`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'PayPal-Request-Id': captureRequestId,
                'Prefer': 'return=representation'
              },
              signal: captureController.signal
            });
          } catch (e) {
            paymentAttempt.captureState = 'UNCERTAIN';
            persistAll();
            sendJson(502, { error: `PayPal capture network error: ${e.message}` });
            return;
          } finally {
            clearTimeout(captureTimeout);
          }
 
          if (!ppRes.ok) {
            const errText = await ppRes.text();
            paymentAttempt.captureState = 'UNCERTAIN';
            persistAll();
            sendJson(502, { error: `PayPal capture failed: ${errText}` });
            return;
          }
 
          let captureData = await ppRes.json();

          // PayPal may return a minimal capture resource. Resolve the same order
          // before applying the existing strict merchant/amount/version checks.
          // Never repeat capture merely to obtain missing receipt fields.
          if (captureData?.id === orderID && captureData?.status === 'COMPLETED' &&
              !captureData?.purchase_units?.[0]?.payee?.merchant_id) {
            const receiptController = new AbortController();
            const receiptTimeout = setTimeout(() => receiptController.abort(), 10000);
            try {
              const receiptRes = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                signal: receiptController.signal
              });
              if (!receiptRes.ok) throw new Error('Full receipt unavailable');
              captureData = await receiptRes.json();
            } catch {
              paymentAttempt.captureState = 'UNCERTAIN';
              persistAll();
              sendJson(502, { error: 'Capture receipt reconciliation unavailable. Check payment status; do not pay again.' });
              return;
            } finally {
              clearTimeout(receiptTimeout);
            }
          }
 
          const postChildren = captureData?.purchase_units?.[0]?.payments?.captures;
          if (postChildren?.length && postChildren[0].status === 'PENDING') {
            paymentAttempt.captureState = 'PENDING';
            paymentAttempt.status = 'PENDING';
            persistAll();
            sendJson(202, { status: 'PENDING', orderID, quoteId, versionNumber });
            return;
          }
 
          const validation = validateCaptureResult(captureData, paymentAttempt, version);
 
          if (!validation.valid) {
            paymentAttempt.captureState = 'REVIEW_REQUIRED';
            persistAll();
            sendJson(400, { error: validation.error });
            return;
          }
 
          quote.paymentStatus = 'paid';
          quote.paymentId = orderID;
          quote.paidAt = new Date().toISOString();
          quote.updatedAt = new Date().toISOString();
          paymentAttempt.status = 'COMPLETED';
          paymentAttempt.captureState = 'COMPLETED';
 
          persistAll();
 
          sendJson(200, {
            status: 'COMPLETED',
            orderID,
            amountCents: validation.captureAmountCents,
            quoteId,
            versionNumber,
            paidAt: quote.paidAt,
            receipt: captureData
          });
          return;
        } finally {
          activeCaptures.delete(captureLockKey);
          resolveCaptureLock();
        }
      }
 
      if (pathname === '/api/ai/extract' && req.method === 'POST') {
        let body;
        try {
          body = await parseBody();
        } catch (e) {
          sendJson(400, { error: e.message });
          return;
        }
 
        const { prompt } = body;
        const aiKey = process.env.AI_API_KEY;
        const aiBaseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
        const aiModel = process.env.AI_MODEL || settings.aiModel || 'gpt-4o-mini';
 
        if (!aiKey) {
          const lower = (prompt || '').toLowerCase().trim();
          if (!lower) {
            sendJson(200, {
              status: 'fallback_local',
              unconfigured: true,
              message: 'AI API key not configured. Empty prompt returned unresolved defaults.',
              extracted: {
                dimensions: null,
                material: null,
                drawers: 2,
                includeDelivery: false,
                notes: 'Unresolved prompt input'
              }
            });
            return;
          }
 
          const is48 = lower.includes('48') || lower.includes('compact') || lower.includes('small');
          const is60 = lower.includes('60') || lower.includes('standard') || lower.includes('large');
          const dimensions = is48 ? '48-inch Compact Desk' : (is60 ? '60-inch Standard Desk' : null);
 
          const isWalnut = lower.includes('walnut');
          const isOak = lower.includes('oak');
          const material = isWalnut ? 'Black Walnut Upgrade' : (isOak ? 'White Oak Hardwood (Solid)' : null);
 
          const isPickup = lower.includes('pickup') || lower.includes('no delivery') || lower.includes('without delivery') || lower.includes('leave delivery out') || lower.includes('exclude delivery');
          const isApartmentOnly = lower.includes('apartment') && !lower.includes('delivery') && !lower.includes('ship');
          const isDelivery = (lower.includes('delivery') || lower.includes('ship')) && !isPickup;
          const includeDelivery = isDelivery ? true : false;
 
          const drawersMatch = lower.match(/(?:zero|one|single|two|three|four|five|six|[0-9]+)[ ]*drawer/);
          let drawers = 0;
          if (drawersMatch) {
            const word = drawersMatch[0];
            if (word.includes('zero')) drawers = 0;
            else if (word.includes('one') || word.includes('single')) drawers = 1;
            else if (word.includes('two')) drawers = 2;
            else if (word.includes('three')) drawers = 3;
            else if (word.includes('four')) drawers = 4;
            else if (word.includes('five')) drawers = 5;
            else if (word.includes('six')) drawers = 6;
            else {
              const num = parseInt(word);
              if (!isNaN(num)) drawers = Math.min(6, Math.max(0, num));
            }
          }
 
          sendJson(200, {
            status: 'fallback_local',
            unconfigured: true,
            message: 'AI API key not configured. Used strict local rule-based extractor without unwarranted assumptions.',
            extracted: {
              dimensions,
              material,
              drawers,
              includeDelivery,
              notes: `Extracted via local rules from: "${prompt}"`
            }
          });
          return;
        }
 
        try {
          const aiController = new AbortController();
          const aiTimeout = setTimeout(() => aiController.abort(), 20000);
          let aiRes;
          try {
            aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${aiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: aiModel,
                messages: [
                  {
                    role: 'system',
                    content: 'Extract custom furniture quote JSON with ONLY fields: dimensions (string or null, e.g. \\"48-inch Compact Desk\\" or \\"60-inch Standard Desk\\"), material (string or null, e.g. \\"White Oak Hardwood (Solid)\\" or \\"Black Walnut Upgrade\\"), drawers (integer 0-6), includeDelivery (boolean), notes (string). Do not include any extra price, status, or action fields. Return strictly valid JSON.'
                  },
                  {
                    role: 'user',
                    content: prompt
                  }
                ],
                temperature: 0.1
              }),
              signal: aiController.signal
            });
          } finally {
            clearTimeout(aiTimeout);
          }
 
          if (!aiRes.ok) {
            const errText = await aiRes.text();
            sendJson(502, { error: `AI provider error: ${errText}` });
            return;
          }
 
          const aiJson = await aiRes.json();
          const contentText = aiJson.choices?.[0]?.message?.content || '{}';
          let parsed;
          try {
            const cleanText = contentText.replace(/```json/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleanText);
          } catch {
            sendJson(422, { error: 'Malformed AI response JSON schema.' });
            return;
          }
 
          const validatedExtracted = (() => {
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            const keys = Object.keys(parsed).sort();
            const expectedKeys = ['dimensions', 'material', 'drawers', 'includeDelivery', 'notes'].sort();
            if (keys.length !== expectedKeys.length || !keys.every((k, i) => k === expectedKeys[i])) return null;
 
            const dims = parsed.dimensions;
            if (dims !== null && dims !== '48-inch Compact Desk' && dims !== '60-inch Standard Desk') return null;
 
            const mat = parsed.material;
            if (mat !== null && mat !== 'White Oak Hardwood (Solid)' && mat !== 'Black Walnut Upgrade') return null;
 
            const drw = parsed.drawers;
            if (!Number.isInteger(drw) || drw < 0 || drw > 6) return null;
 
            const incDel = parsed.includeDelivery;
            if (typeof incDel !== 'boolean') return null;
 
            const nts = parsed.notes;
            if (typeof nts !== 'string') return null;
 
            return {
              dimensions: dims,
              material: mat,
              drawers: drw,
              includeDelivery: incDel,
              notes: nts
            };
          })();
 
          if (!validatedExtracted) {
            sendJson(422, { error: 'Generic schema error: invalid model extraction schema.' });
            return;
          }
 
          sendJson(200, {
            status: 'success',
            extracted: validatedExtracted
          });
          return;
        } catch (e) {
          sendJson(500, { error: `AI extraction error: ${e.message}` });
          return;
        }
      }
 
      if (typeof next === 'function') {
        return next();
      }
      sendJson(404, { error: 'API endpoint not found' });
    } catch (e) {
      console.error('API Error:', e);
      sendJson(500, { error: e.message || 'Internal server error' });
    }
  })();
  return true;
}
 
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const PORT = process.env.PORT || 3000;
  const DIST_DIR = path.resolve(__dirname, 'dist');
 
  const server = http.createServer((req, res) => {
    if (handleApiRequest(req, res)) return;
 
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;
    if (pathname === '/') pathname = '/index.html';
 
    if (pathname.includes('..') || pathname.includes('.env') || pathname.includes('/data/') || pathname.endsWith('.mjs') || pathname.endsWith('.ts')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access forbidden');
      return;
    }
 
    let filePath = path.resolve(path.join(DIST_DIR, pathname));
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
 
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dist not built or file not found. Run npm run build first.');
      } else {
        const ext = path.extname(filePath);
        const map = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': map[ext] || 'application/octet-stream' });
        res.end(data);
      }
    });
  });
 
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`ClearQuote Server running at http://127.0.0.1:${PORT}`);
  });
}
 
