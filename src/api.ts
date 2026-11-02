import type { Quote, PriceItem } from './types';
import { extractWithAdmas } from './services/admasAi';
import { createApiFetch, readDemoConnection } from './services/demoRuntime';
const apiRequest = createApiFetch(readDemoConnection());
 
export async function checkApiHealth(): Promise<{ available: boolean; backend?: string; paypal?: any; ai?: any }> {
  try {
    const res = await apiRequest('/api/health', { method: 'GET', headers: { 'Accept': 'application/json' } });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      return { available: true, ...data };
    }
  } catch {}
  return { available: false };
}
 
export async function apiFetchQuotes(): Promise<Quote[]> {
  const res = await apiRequest('/api/quotes');
  if (!res.ok) throw new Error('Failed to fetch quotes from server');
  return res.json();
}
 
export async function apiCreateQuote(payload: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerRequestSummary?: string;
  items: Array<{ id?: string; name: string; quantity: number; unitPrice: number; category: string; notes?: string }>;
  notes?: string;
  businessNotes?: string;
}): Promise<Quote> {
  const res = await apiRequest('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create quote' }));
    throw new Error(err.error || 'Failed to create quote');
  }
  return res.json();
}
 
export async function apiUpdateQuote(id: string, payload: {
  action?: 'send' | 'approve' | 'revise';
  expectedVersion?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerRequestSummary?: string;
  items?: Array<{ id?: string; name: string; quantity: number; unitPrice: number; category: string; notes?: string }>;
  notes?: string;
  businessNotes?: string;
}): Promise<Quote> {
  const res = await apiRequest(`/api/quotes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to update quote' }));
    throw new Error(err.error || 'Failed to update quote');
  }
  return res.json();
}
 
export async function apiFetchPrices(): Promise<PriceItem[]> {
  const res = await apiRequest('/api/prices');
  if (!res.ok) throw new Error('Failed to fetch prices');
  return res.json();
}
 
export async function apiUpdatePrices(prices: PriceItem[]): Promise<PriceItem[]> {
  const res = await apiRequest('/api/prices', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prices)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to update prices' }));
    throw new Error(err.error || 'Failed to update prices');
  }
  return res.json();
}
 
export async function apiFetchPayPalConfig(): Promise<{ configured: boolean; clientId: string; mode: string }> {
  try {
    const res = await apiRequest('/api/paypal/config');
    if (res.ok) return res.json();
  } catch {}
  return { configured: false, clientId: '', mode: 'sandbox' };
}
 
export async function apiCreatePayPalOrder(quoteId: string, versionNumber: number): Promise<{ orderID: string; status: string; clientId: string }> {
  const res = await apiRequest('/api/paypal/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, versionNumber })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create PayPal order' }));
    throw new Error(err.error || 'Failed to create PayPal order');
  }
  return res.json();
}
 
export async function apiCapturePayPalOrder(quoteId: string, versionNumber: number, orderID: string): Promise<any> {
  const res = await apiRequest('/api/paypal/capture-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, versionNumber, orderID })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to capture PayPal payment' }));
    throw new Error(err.error || 'Failed to capture PayPal payment');
  }
  return res.json();
}
 
export async function apiExtractAiPrompt(prompt: string): Promise<any> {
  const managed = await extractWithAdmas(prompt);
  if (managed) return managed;
  const res = await apiRequest('/api/ai/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'AI extraction failed' }));
    throw new Error(err.error || 'AI extraction failed');
  }
  return res.json();
}
 
