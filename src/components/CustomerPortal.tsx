import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { Quote, QuoteVersion, QuoteItem, BusinessSettings, PriceItem } from '../types';
import { CheckCircle2, ShieldCheck, Sparkles, History, CreditCard, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { apiFetchPayPalConfig, apiCreatePayPalOrder, apiCapturePayPalOrder } from '../api';
import { parseNaturalLanguagePrompt, calculateQuoteItems } from '../utils/calculator';
import { Dialog } from './Dialog';
import { formatMoney } from '../utils/currency';
 
interface CustomerPortalProps {
  quotes: Quote[];
  settings: BusinessSettings;
  prices: PriceItem[];
  onUpdateQuote: (updatedQuote: Quote) => Promise<Quote>;
  onRefreshQuote: (quoteId: string) => Promise<Quote>;
  activeQuoteId?: string;
  backendConnected: boolean;
}
 
export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  quotes,
  settings,
  prices,
  onUpdateQuote,
  onRefreshQuote,
  activeQuoteId,
  backendConnected
}) => {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>(activeQuoteId || quotes[0]?.id || '');
  const [revisionInput, setRevisionInput] = useState('');
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
 
  // Capture recovery & singleflight state / refs
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const singleflightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
 
  // Load & validate recovery triple from sessionStorage once on mount
  const [savedAttempt, setSavedAttempt] = useState<'' | {
    quoteId: string;
    versionNumber: number;
    orderID: string;
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem('clearquote_paypal_attempt');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.quoteId === 'string' &&
        parsed.quoteId.trim() !== '' &&
        typeof parsed.versionNumber === 'number' &&
        Number.isInteger(parsed.versionNumber) &&
        parsed.versionNumber > 0 &&
        typeof parsed.orderID === 'string' &&
        parsed.orderID.trim() !== ''
      ) {
        return {
          quoteId: parsed.quoteId,
          versionNumber: parsed.versionNumber,
          orderID: parsed.orderID
        };
      }
    } catch (e) {
      console.error('Failed to parse session recovery attempt:', e);
    }
    return null;
  });
 
  const boundAttemptRef = useRef(savedAttempt);
 
  // Helper to synchronously update boundAttemptRef and session storage / state
  const setAndSyncSavedAttempt = (triple: { quoteId: string; versionNumber: number; orderID: string } | null) => {
    boundAttemptRef.current = triple;
    setSavedAttempt(triple);
    if (triple) {
      sessionStorage.setItem('clearquote_paypal_attempt', JSON.stringify(triple));
    } else {
      sessionStorage.removeItem('clearquote_paypal_attempt');
    }
  };
 
  // Pre-finalization editable confirmation for customer revision
  const [pendingRevisionDraft, setPendingRevisionDraft] = useState<{
    prompt: string;
    dimensions: string;
    material: string;
    drawers: number;
    includeDelivery: boolean;
    items: QuoteItem[];
    totalAmount: number;
    notes: string;
    isUncertain: boolean;
  } | null>(null);
 
  const selectedQuote = quotes.find(q => q.id === selectedQuoteId) || quotes[0];
  const activeVersion = selectedQuote ? selectedQuote.versions.find(v => v.versionNumber === selectedQuote.currentVersion) || selectedQuote.versions[selectedQuote.versions.length - 1] : null;
  const previousVersion = selectedQuote && selectedQuote.versions.length > 1 
    ? selectedQuote.versions[selectedQuote.versions.length - 2] 
    : null;
 
  const paymentScopeRef = useRef({
    mounted: true, generation: 0,
    quoteId: selectedQuote?.id || '',
    versionNumber: activeVersion?.versionNumber || 0,
    connected: backendConnected
  });
  const nextQuoteId = selectedQuote?.id || '';
  const nextVersion = activeVersion?.versionNumber || 0;
  useLayoutEffect(() => {
    const scope = paymentScopeRef.current;
    if (scope.quoteId !== nextQuoteId || scope.versionNumber !== nextVersion || scope.connected !== backendConnected) {
      paymentScopeRef.current = { ...scope, generation: scope.generation + 1,
        quoteId: nextQuoteId, versionNumber: nextVersion, connected: backendConnected };
    }
  }, [nextQuoteId, nextVersion, backendConnected]);
  useEffect(() => {
    paymentScopeRef.current.mounted = true;
    paymentScopeRef.current.generation += 1;
    return () => {
      paymentScopeRef.current.mounted = false;
      paymentScopeRef.current.generation += 1;
    };
  }, []);
 
  const executeCaptureAndVerify = async (quoteId: string, versionNumber: number, orderID: string) => {
    const key = JSON.stringify([quoteId, versionNumber, orderID]);
    const generation = paymentScopeRef.current.generation;
    const isCurrent = () => {
      const scope = paymentScopeRef.current;
      const bound = boundAttemptRef.current;
      return scope.mounted && scope.connected && scope.generation === generation &&
        scope.quoteId === quoteId && scope.versionNumber === versionNumber &&
        (bound as any)?.quoteId === quoteId && (bound as any).versionNumber === versionNumber && (bound as any).orderID === orderID;
    };
    if (!isCurrent()) throw new Error('Checkout changed; saved payment needs confirmation.');
    if (singleflightRef.current) {
      if (singleflightRef.current.key === key) return singleflightRef.current.promise;
      throw new Error('Another payment capture/verification is already in flight.');
    }
    setIsVerifyingPayment(true);
    setInlineError(null);
    // Defer work so the matching entry exists even if an API adapter throws synchronously.
    const promise: Promise<void> = Promise.resolve().then(async () => {
      try {
        if (!isCurrent()) return;
        const captureRes = await apiCapturePayPalOrder(quoteId, versionNumber, orderID);
        if (!isCurrent()) return;
        if (captureRes.status === 'COMPLETED') {
          const refreshed = await onRefreshQuote(quoteId);
          if (!isCurrent()) return;
          if (!refreshed || refreshed.id !== quoteId || refreshed.currentVersion !== versionNumber ||
              refreshed.paymentStatus !== 'paid' || refreshed.paymentId !== orderID) {
            throw new Error('Canonical refresh verification failed: quote state does not match paid receipt.');
          }
          setAndSyncSavedAttempt(null);
          setInlineError(null);
        } else if (captureRes.status === 'PENDING') {
          setInlineError('Payment is pending verification by PayPal. Unpaid until confirmed.');
        } else {
          throw new Error('Capture returned status: ' + (captureRes.status || 'unknown'));
        }
      } catch (err: any) {
        if (isCurrent()) setInlineError('Payment confirmation is unavailable: ' + err.message);
      } finally {
        if (singleflightRef.current?.key === key) {
          singleflightRef.current = null;
          if (paymentScopeRef.current.mounted) setIsVerifyingPayment(false);
        }
      }
    });
    singleflightRef.current = { key, promise };
    return promise;
  };
 
  // PayPal SDK V5 integration
  useEffect(() => {
    let scriptTag: HTMLScriptElement | null = null;
    let buttonsInstance: any = null;
    let isMounted = true;
 
    async function loadPayPal() {
      if (!backendConnected || !settings.paypalConnected || settings.paypalMode !== 'sandbox') return;
      if (!selectedQuote || !activeVersion || activeVersion.status !== 'approved' || selectedQuote.paymentStatus === 'paid') return;
 
      try {
        const configRes = await apiFetchPayPalConfig();
        if (!isMounted || !configRes.configured || !configRes.clientId || configRes.mode !== 'sandbox') return;
 
        let paypalContainer = document.getElementById('paypal-button-container');
        if (!paypalContainer) return;
        paypalContainer.innerHTML = '';
 
        const existingScript = document.getElementById('paypal-sdk');
        if (existingScript) existingScript.remove();
 
        scriptTag = document.createElement('script');
        scriptTag.id = 'paypal-sdk';
        const params = new URLSearchParams({
          'client-id': configRes.clientId,
          'currency': 'USD',
          'intent': 'capture',
          'components': 'buttons'
        });
        scriptTag.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
        scriptTag.async = true;
 
        scriptTag.onerror = () => {
          if (isMounted) setInlineError('PayPal could not load. Please retry.');
        };
 
        scriptTag.onload = () => {
          if (!isMounted) return;
          const pp = (window as any).paypal;
          if (pp && pp.Buttons) {
            buttonsInstance = pp.Buttons({
              createOrder: async () => {
                if (!isMounted) throw new Error('Checkout changed; use the current quote.');
                // Reject if boundAttemptRef.current OR singleflightRef.current is present
                if (boundAttemptRef.current || singleflightRef.current) {
                  throw new Error('An active or unresolved payment attempt exists.');
                }
                const res = await apiCreatePayPalOrder(selectedQuote.id, activeVersion.versionNumber);
                if (!isMounted) throw new Error('Checkout changed; use the current quote.');
                if (!res || !res.orderID) {
                  throw new Error('Failed to obtain PayPal order ID');
                }
                return res.orderID;
              },
              onApprove: async (data: any) => {
                if (!isMounted) throw new Error('Checkout changed; use the current quote.');
                if (!data || typeof data.orderID !== 'string' || data.orderID.trim() === '') {
                  throw new Error('Invalid or missing orderID in approval.');
                }
                const triple = {
                  quoteId: selectedQuote.id,
                  versionNumber: activeVersion.versionNumber,
                  orderID: data.orderID
                };
                if (boundAttemptRef.current) {
                  if (
                    boundAttemptRef.current.quoteId !== triple.quoteId ||
                    boundAttemptRef.current.versionNumber !== triple.versionNumber ||
                    boundAttemptRef.current.orderID !== triple.orderID
                  ) {
                    throw new Error('Conflicting payment attempt already bound.');
                  }
                }
                setAndSyncSavedAttempt(triple);
                await executeCaptureAndVerify(triple.quoteId, triple.versionNumber, triple.orderID);
              },
              onCancel: () => {
                if (!isMounted) return;
                setInlineError(boundAttemptRef.current
                  ? 'Checkout closed; payment confirmation is still pending. Check payment status.'
                  : 'Checkout cancelled; no completion confirmed.');
              },
              onError: (err: any) => {
                console.error('PayPal checkout error:', err);
                if (isMounted) setInlineError('PayPal checkout encountered an error or was cancelled.');
              }
            });
            Promise.resolve(buttonsInstance.render('#paypal-button-container')).catch(() => {
              if (isMounted) setInlineError('PayPal could not render. Please reload checkout.');
            });
          }
        };
 
        document.body.appendChild(scriptTag);
      } catch (e) {
        console.error('Failed to load PayPal SDK:', e);
      }
    }
 
    loadPayPal();
 
    return () => {
      isMounted = false;
      if (buttonsInstance && typeof buttonsInstance.close === 'function') {
        Promise.resolve(buttonsInstance.close()).catch(() => {});
      }
      if (scriptTag) {
        scriptTag.onload = null;
        scriptTag.onerror = null;
        scriptTag.remove();
      }
      const container = document.getElementById('paypal-button-container');
      if (container) container.innerHTML = '';
    };
  }, [selectedQuote?.id, activeVersion?.versionNumber, activeVersion?.status, selectedQuote?.paymentStatus, settings.paypalConnected, settings.paypalMode, backendConnected]);
 
  const updateRevisionDraftWithCalc = (draft: NonNullable<typeof pendingRevisionDraft>) => {
    const calc = calculateQuoteItems(prices, draft.dimensions, draft.material, draft.drawers, draft.includeDelivery);
    const isUncertain = !draft.dimensions || !draft.material || calc.isUncertain;
    return {
      ...draft,
      isUncertain,
      items: calc.items,
      totalAmount: calc.totalAmount,
      notes: `Revised per customer request: "${draft.prompt}". ${calc.notes}`
    };
  };
 
  // Handle customer requesting changes in natural language with pre-finalization confirmation step
  const handleCustomerRevisionPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionInput.trim() || !selectedQuote || !activeVersion) return;
 
    setIsSubmittingRevision(true);
    setTimeout(() => {
      const parsed = parseNaturalLanguagePrompt(revisionInput, prices);
 
      // Inherit from existing active version if unambiguous
      let existingDimensions = '';
      let existingMaterial = '';
      let existingDrawers = 0;
      let existingDelivery = activeVersion.items.some(it => it.category === 'shipping');
 
      for (const it of activeVersion.items) {
        if (it.category === 'material') {
          if (it.name.includes('Oak') || it.name.includes('Walnut')) {
            existingMaterial = it.name;
          }
          const notesLower = (it.notes || '').toLowerCase();
          if (notesLower.includes('48') || notesLower.includes('compact')) {
            existingDimensions = '48-inch Compact Desk';
          } else if (notesLower.includes('60') || notesLower.includes('standard')) {
            existingDimensions = '60-inch Standard Desk';
          } else if (it.name.includes('48') || it.name.includes('Compact')) {
            existingDimensions = '48-inch Compact Desk';
          } else if (it.name.includes('60') || it.name.includes('Standard')) {
            existingDimensions = '60-inch Standard Desk';
          }
        }
        if (it.category === 'hardware') {
          existingDrawers = it.quantity;
        }
      }
 
      const promptLower = revisionInput.toLowerCase();
      const mentionsDim = promptLower.includes('48') || promptLower.includes('60') || promptLower.includes('compact') || promptLower.includes('standard') || promptLower.includes('72') || promptLower.includes('inch');
      const mentionsMat = promptLower.includes('oak') || promptLower.includes('walnut') || promptLower.includes('maple') || promptLower.includes('material');
      const mentionsDrawer = promptLower.includes('drawer');
      const mentionsDelivery = promptLower.includes('delivery') || promptLower.includes('pickup') || promptLower.includes('ship') || promptLower.includes('white glove');
 
      const dimensions = mentionsDim ? parsed.dimensions : (existingDimensions || '');
      const material = mentionsMat ? parsed.material : (existingMaterial || '');
      const drawers = mentionsDrawer ? parsed.drawers : existingDrawers;
      const includeDelivery = mentionsDelivery ? parsed.includeDelivery : existingDelivery;
 
      const initialDraft = {
        prompt: revisionInput,
        dimensions,
        material,
        drawers,
        includeDelivery,
        items: [],
        totalAmount: 0,
        notes: '',
        isUncertain: !dimensions || !material || parsed.isUncertain
      };
 
      setPendingRevisionDraft(updateRevisionDraftWithCalc(initialDraft));
      setIsSubmittingRevision(false);
    }, 600);
  };
 
  const handleConfirmAndSubmitRevision = async () => {
    if (!pendingRevisionDraft || !selectedQuote || !activeVersion || pendingRevisionDraft.isUncertain) return;
 
    setInlineError(null);
    setIsSubmittingRevision(true);
    try {
      const derived = updateRevisionDraftWithCalc(pendingRevisionDraft);
      if (derived.isUncertain) throw new Error(derived.notes);
      const newVersionNum = selectedQuote.versions.length + 1;
 
      const newVersion: QuoteVersion = {
        versionNumber: newVersionNum,
        createdAt: new Date().toISOString(),
        customerRequestSummary: pendingRevisionDraft.prompt,
        items: derived.items,
        totalAmount: derived.totalAmount,
        notes: derived.notes,
        status: 'pending_review'
      };
 
      const updatedVersions = selectedQuote.versions.map(v => ({
        ...v,
        status: v.status === 'approved' ? 'superseded' : v.status
      } as QuoteVersion));
 
      const updatedQuote: Quote = {
        ...selectedQuote,
        currentVersion: newVersionNum,
        updatedAt: new Date().toISOString(),
        versions: [...updatedVersions, newVersion]
      };
 
      await onUpdateQuote(updatedQuote);
      setRevisionInput('');
      setPendingRevisionDraft(null);
    } catch (e: any) {
      setInlineError(`Failed to submit revision: ${e.message}`);
    } finally {
      setIsSubmittingRevision(false);
    }
  };
 
  const handleApproveQuote = async () => {
    if (!selectedQuote || !activeVersion) return;
    if (activeVersion.status !== 'sent_to_customer') return;
 
    setInlineError(null);
    setIsSubmittingApproval(true);
    try {
      const updatedVersions = selectedQuote.versions.map(v =>
        v.versionNumber === activeVersion.versionNumber
          ? { ...v, status: 'approved' as const }
          : v
      );
 
      const updatedQuote: Quote = {
        ...selectedQuote,
        updatedAt: new Date().toISOString(),
        versions: updatedVersions
      };
 
      await onUpdateQuote(updatedQuote);
    } catch (e: any) {
      setInlineError(`Failed to approve quote: ${e.message}`);
    } finally {
      setIsSubmittingApproval(false);
    }
  };
 
  return (
    <div className="cq-workspace space-y-7">
      
      {/* Customer Header Banner */}
      <div className="bg-slate-900 rounded-2xl p-6 md:p-8 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-indigo-400/15 text-indigo-200 border border-indigo-300/20 text-xs px-3 py-1 rounded-full font-medium">
              CUSTOMER PORTAL
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Your quote, clearly explained</h1>
          <p className="text-stone-300 text-sm mt-1">
            Review your custom order from <span className="font-semibold text-white">{settings.businessName}</span>, examine itemized changes, and approve quote versions.
          </p>
        </div>
 
        <div className="bg-stone-900/80 p-3 rounded-2xl border border-stone-700 w-full md:w-auto">
          <label htmlFor="customer-quote" className="block text-xs font-semibold text-slate-300 mb-2">Your quote</label>
          <select
            id="customer-quote"
            value={selectedQuoteId}
            onChange={(e) => setSelectedQuoteId(e.target.value)}
            disabled={isSubmittingApproval || isSubmittingRevision || isVerifyingPayment || !!savedAttempt}
            className="w-full md:w-64 bg-stone-900 border border-stone-600 rounded-xl px-3 py-2 text-sm text-white outline-none font-medium disabled:opacity-50"
          >
            {quotes.map(q => (
              <option key={q.id} value={q.id}>
                {q.quoteNumber} - {q.customerName} ({formatMoney(q.versions.find(v=>v.versionNumber === q.currentVersion)?.totalAmount ?? 0)})
              </option>
            ))}
          </select>
        </div>
      </div>
 
      {inlineError && (
        <div className="bg-rose-500 text-white p-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>{inlineError}</span>
          <button onClick={() => setInlineError(null)} className="underline ml-2">Dismiss</button>
        </div>
      )}
 
      {selectedQuote && activeVersion ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Quote Summary & Itemized Details */}
          <div className="lg:col-span-2 space-y-6 min-w-0">
            
            <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-stone-200 space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-stone-200 gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-stone-900">{selectedQuote.quoteNumber}</span>
                    <span className="bg-stone-100 text-stone-700 text-xs px-2.5 py-1 rounded-full font-semibold tabular-nums">
                      Version {activeVersion.versionNumber}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 mt-1">
                    Prepared for <span className="font-semibold text-stone-800">{selectedQuote.customerName}</span> on {new Date(activeVersion.createdAt).toLocaleDateString()}
                  </p>
                </div>
 
                <div>
                  {selectedQuote.paymentStatus === 'paid' ? (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                      <span>Paid · confirmed</span>
                    </div>
                  ) : activeVersion.status === 'approved' ? (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                      <span>Approved · ready for checkout</span>
                    </div>
                  ) : activeVersion.status === 'sent_to_customer' ? (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-xs font-medium">
                      Ready for Your Approval
                    </div>
                  ) : (
                    <div className="bg-stone-100 border border-stone-200 text-stone-700 px-4 py-2 rounded-xl text-xs font-medium">
                      Awaiting Business Owner Review & Send
                    </div>
                  )}
                </div>
              </div>
 
              {/* Customer Request Summary */}
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
                <div className="flex items-center gap-2 text-indigo-900 font-semibold text-xs mb-1">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>Your Request Summary:</span>
                </div>
                <p className="text-sm text-stone-900 italic">
                  &ldquo;{activeVersion.customerRequestSummary}&rdquo;
                </p>
              </div>
 
              {/* Itemized Table with scrolling wrapper */}
              <div>
                <h3 className="font-bold text-stone-900 text-sm uppercase tracking-wide mb-3">Itemized Price Breakdown</h3>
                <div className="border border-stone-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm min-w-[500px]">
                    <thead>
                      <tr className="bg-stone-50 text-stone-500 font-semibold text-xs border-b border-stone-200">
                        <th className="p-3">Item & Details</th>
                        <th className="p-3 text-center">Category</th>
                        <th className="p-3 text-center">Qty</th>
                        <th className="p-3 text-right">Unit Price</th>
                        <th className="p-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {activeVersion.items.map((item, i) => (
                        <tr key={i} className="hover:bg-stone-50">
                          <td className="p-3">
                            <div className="font-medium text-stone-900">{item.name}</div>
                            {item.notes && <div className="text-xs text-stone-500">{item.notes}</div>}
                          </td>
                          <td className="p-3 text-center">
                            <span className="text-xs capitalize bg-stone-100 text-stone-700 px-2 py-0.5 rounded font-medium">
                              {item.category}
                            </span>
                          </td>
                          <td className="p-3 text-center tabular-nums">{item.quantity}</td>
                          <td className="p-3 text-right tabular-nums">{formatMoney(item.unitPrice)}</td>
                          <td className="p-3 text-right tabular-nums font-semibold text-stone-900">
                            {formatMoney(item.quantity * item.unitPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-stone-50 font-bold border-t border-stone-200">
                        <td colSpan={4} className="p-3 text-right text-stone-700">Total Price:</td>
                        <td className="p-3 text-right tabular-nums text-xl text-amber-900">
                          {formatMoney(activeVersion.totalAmount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
 
              {previousVersion && (
                <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-stone-900 font-bold text-xs uppercase tracking-wider">
                    <History className="w-4 h-4 text-indigo-600" />
                    <span>Price Difference & Change History (v{previousVersion.versionNumber} vs v{activeVersion.versionNumber})</span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="bg-white p-3.5 rounded-xl border border-stone-200">
                      <div className="text-stone-500 mb-1 font-semibold">Previous Version (v{previousVersion.versionNumber})</div>
                      <div className="text-sm font-bold text-stone-800 line-through">{formatMoney(previousVersion.totalAmount)}</div>
                      <p className="text-stone-500 mt-1 italic">&ldquo;{previousVersion.customerRequestSummary}&rdquo;</p>
                    </div>
 
                    <div className="bg-amber-50/70 p-3.5 rounded-xl border border-amber-200">
                      <div className="text-amber-900 mb-1 font-semibold">Current Version (v{activeVersion.versionNumber})</div>
                      <div className="text-sm font-bold text-stone-900">{formatMoney(activeVersion.totalAmount)}</div>
                      <div className="text-xs font-semibold text-amber-900 mt-1">
                        Exact Total Difference: {activeVersion.totalAmount < previousVersion.totalAmount ? (
                          <span className="text-emerald-700 font-bold">-{formatMoney(previousVersion.totalAmount - activeVersion.totalAmount)} reduction</span>
                        ) : activeVersion.totalAmount > previousVersion.totalAmount ? (
                          <span className="text-stone-900 font-bold">+{formatMoney(activeVersion.totalAmount - previousVersion.totalAmount)} increase</span>
                        ) : (
                          <span>No total price change</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
 
            </div>
 
          </div>
 
          {/* Right Column: Revision Request & Approval */}
          <div className="lg:col-span-1 space-y-6 min-w-0">
            
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 space-y-4">
              <div className="flex items-center gap-2 text-stone-900 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Request a change</span>
              </div>
              <p className="text-xs text-stone-600">
                Describe what you would like to change. Review the new estimate before sending it; earlier versions stay in your history.
              </p>
 
              <form onSubmit={handleCustomerRevisionPrompt} className="space-y-3">
                <textarea
                  aria-label="Describe your quote changes"
                  rows={3}
                  required
                  disabled={isSubmittingRevision || isSubmittingApproval || isVerifyingPayment || !!savedAttempt}
                  placeholder="e.g. Can we change to 1 drawer instead of 2?"
                  value={revisionInput}
                  onChange={(e) => setRevisionInput(e.target.value)}
                  className="w-full text-sm border border-stone-300 rounded-xl p-3 outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isSubmittingRevision || isSubmittingApproval || isVerifyingPayment || !!savedAttempt}
                  className="w-full flex items-center justify-center gap-2 bg-stone-900 hover:bg-stone-800 text-white py-2.5 rounded-xl text-xs font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {isSubmittingRevision ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Analyzing Request...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-indigo-300" />
                      <span>Review Revision Request</span>
                    </>
                  )}
                </button>
              </form>
            </div>
 
            {/* Approval & Payment Notice */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 space-y-4">
              <div className="flex items-center gap-2 text-stone-900 font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Approval & checkout</span>
              </div>
              
              <p className="text-xs text-stone-600">
                Approve the version sent by the business. Any changes need another review before checkout.
              </p>
 
              {activeVersion.status === 'sent_to_customer' ? (
                <button
                  onClick={handleApproveQuote}
                  disabled={isSubmittingApproval || isSubmittingRevision || isVerifyingPayment || !!savedAttempt}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl text-xs font-bold shadow-md transition disabled:opacity-50"
                >
                  {isSubmittingApproval ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Approving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Approve Version {activeVersion.versionNumber} ({formatMoney(activeVersion.totalAmount)})</span>
                    </>
                  )}
                </button>
              ) : activeVersion.status === 'approved' ? (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>Version {activeVersion.versionNumber} Approved.</span>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-xs font-semibold space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertCircle className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Approval Unavailable (Awaiting Owner Send)</span>
                  </div>
                  <p className="text-[11px] text-amber-900 font-normal">
                    The business owner must review and send this revision before customer approval can be authorized.
                  </p>
                </div>
              )}
 
              {/* REAL V5 PayPal Checkout Container or Disconnected Banner */}
              {selectedQuote.paymentStatus === 'paid' ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 text-xs text-emerald-900">
                  <strong className="block">Payment confirmed · {formatMoney(activeVersion.totalAmount)}</strong>
                  <p>Version {activeVersion.versionNumber} has been paid in PayPal Sandbox.</p>
                  {selectedQuote.paymentId && <p className="break-all">Order reference: {selectedQuote.paymentId}</p>}
                </div>
              ) : backendConnected && settings.paypalConnected && settings.paypalMode === 'sandbox' && activeVersion.status === 'approved' ? (
                <div className="space-y-3 pt-2">
                  {savedAttempt && savedAttempt.quoteId === selectedQuote.id && savedAttempt.versionNumber === activeVersion.versionNumber ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-2">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertCircle className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>Unresolved Payment Attempt Recovered</span>
                      </div>
                      <p className="text-[11px] text-stone-700">
                        Order ID: <code className="tabular-nums bg-white px-1.5 py-0.5 rounded border border-amber-200">{savedAttempt.orderID}</code>. Payment is pending confirmation or verification.
                      </p>
                      <button
                        onClick={() => executeCaptureAndVerify(savedAttempt.quoteId, savedAttempt.versionNumber, savedAttempt.orderID)}
                        disabled={isVerifyingPayment}
                        className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-xs font-bold transition disabled:opacity-50"
                      >
                        {isVerifyingPayment ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Checking Payment Status...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            <span>Check payment status</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Secure PayPal Sandbox Checkout Ready</span>
                    </div>
                  )}
                  <div id="paypal-button-container" className="w-full"></div>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-stone-600 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-900">
                      <AlertCircle className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>Demo preview: payments unavailable</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      {settings.paypalConnected ? 'Approval required before checkout.' : 'Missing backend or PayPal sandbox configuration.'}
                    </p>
                  </div>
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold bg-stone-200 text-stone-500 cursor-not-allowed"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Checkout Unavailable</span>
                  </button>
                </div>
              )}
            </div>
 
          </div>
 
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-12 text-center text-stone-500 border border-stone-200">
          <p>No quote selected.</p>
        </div>
      )}
 
      {pendingRevisionDraft && <Dialog wide title="Review changes" description="Check the updated specification before sending it to the business." onClose={() => setPendingRevisionDraft(null)} busy={isSubmittingRevision}
        footer={<><button type="button" className="cq-secondary" disabled={isSubmittingRevision} onClick={() => setPendingRevisionDraft(null)}>Cancel</button><button type="button" onClick={handleConfirmAndSubmitRevision} disabled={isSubmittingRevision || pendingRevisionDraft.isUncertain} className="cq-primary">{isSubmittingRevision ? 'Sending…' : 'Send revision for review'}</button></>}>
        <div className="space-y-5">
          <div className="cq-message">A revision returns to business review. Your previous quote stays in the history.</div>
          {pendingRevisionDraft.isUncertain && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{pendingRevisionDraft.notes}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="cq-field">Desk size<select data-autofocus value={pendingRevisionDraft.dimensions} onChange={e => setPendingRevisionDraft(updateRevisionDraftWithCalc({ ...pendingRevisionDraft, dimensions:e.target.value }))}><option value="">Choose a size</option><option value="48-inch Compact Desk">48-inch compact</option><option value="60-inch Standard Desk">60-inch standard</option></select></label>
            <label className="cq-field">Wood material<select value={pendingRevisionDraft.material} onChange={e => setPendingRevisionDraft(updateRevisionDraftWithCalc({ ...pendingRevisionDraft, material:e.target.value }))}><option value="">Choose a material</option><option value="White Oak Hardwood (Solid)">White oak hardwood</option><option value="Black Walnut Upgrade">Black walnut</option></select></label>
            <label className="cq-field">Drawers<input type="number" min="0" max="6" step="1" value={Number.isFinite(pendingRevisionDraft.drawers) ? pendingRevisionDraft.drawers : ''} onChange={e => setPendingRevisionDraft(updateRevisionDraftWithCalc({ ...pendingRevisionDraft, drawers:e.target.value === '' ? NaN : Number(e.target.value) }))} aria-invalid={!Number.isInteger(pendingRevisionDraft.drawers) || pendingRevisionDraft.drawers < 0 || pendingRevisionDraft.drawers > 6}/><span className="cq-field-hint">A whole number from 0 to 6</span></label>
            <label className="flex items-center gap-3 text-xs text-slate-600 sm:pt-6"><input type="checkbox" checked={pendingRevisionDraft.includeDelivery} onChange={e => setPendingRevisionDraft(updateRevisionDraftWithCalc({ ...pendingRevisionDraft, includeDelivery:e.target.checked }))}/>Include white glove delivery</label>
          </div>
          <div className="cq-draft-summary">{pendingRevisionDraft.items.map((item,i) => <div className="cq-draft-line" key={i}><span>{item.name} × {item.quantity}</span><span>{formatMoney(item.quantity*item.unitPrice)}</span></div>)}<div className="cq-draft-total"><span>Updated estimate · USD</span><strong>{pendingRevisionDraft.isUncertain ? 'Pending' : formatMoney(pendingRevisionDraft.totalAmount)}</strong></div></div>
        </div>
      </Dialog>}

    </div>
  );
};
 
