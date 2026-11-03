import React, { useState } from 'react';
import type { Quote, PriceItem, QuoteItem, QuoteVersion } from '../types';
import { apiExtractAiPrompt } from '../api';
import { Sparkles, Send, Eye, Edit3, RefreshCw, Check, AlertCircle, FileText, Clock3, CircleCheck } from 'lucide-react';
import { parseNaturalLanguagePrompt } from '../utils/calculator';
import { calculateDraft, canConfirmDraft, parseDrawerInput } from '../utils/draft';
import { formatMoney, itemTotal } from '../utils/currency';
import { Dialog } from './Dialog';
 
interface OwnerDashboardProps {
  businessName: string;
  quotes: Quote[];
  prices: PriceItem[];
  onUpdateQuote: (updatedQuote: Quote) => Promise<Quote>;
  onCreateQuote: (newQuote: Quote) => Promise<Quote>;
  onOpenCustomerViewForQuote: (quoteId: string) => void;
}
 
export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  businessName,
  quotes,
  prices,
  onUpdateQuote,
  onCreateQuote,
  onOpenCustomerViewForQuote
}) => {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>(quotes[0]?.id || '');
  const [search, setSearch] = useState('');
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [customerNameInput, setCustomerNameInput] = useState('');
  const [customerEmailInput, setCustomerEmailInput] = useState('');
  const [customerPhoneInput, setCustomerPhoneInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
 
  // Pre-finalization editable confirmation state
  const [pendingDraft, setPendingDraft] = useState<{
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    prompt: string;
    dimensions: string;
    drawers: number;
    material: string;
    includeDelivery: boolean;
    isUncertain: boolean;
    uncertainWarning: string;
    items: QuoteItem[];
    notes: string;
    totalAmount: number;
    source: string;
  } | null>(null);
 
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editItems, setEditItems] = useState<QuoteItem[]>([]);
 
  const selectedQuote = quotes.find(q => q.id === selectedQuoteId) || quotes[0];
  const activeVersion = selectedQuote ? selectedQuote.versions.find(v => v.versionNumber === selectedQuote.currentVersion) || selectedQuote.versions[selectedQuote.versions.length - 1] : null;
 
  const handleStartEditing = () => {
    if (!activeVersion) return;
    setEditItems(JSON.parse(JSON.stringify(activeVersion.items)));
    setEditNotes(activeVersion.notes);
    setIsEditing(true);
  };
 
  const handleSaveRevision = async () => {
    if (!selectedQuote || !activeVersion) return;
    setInlineError(null);
    setIsSubmittingAction(true);
    try {
      const newTotal = itemTotal(editItems);
      if (newTotal === null) throw new Error('Review item quantities and prices before saving.');
      const newVersionNumber = selectedQuote.versions.length + 1;
 
      const newVersion: QuoteVersion = {
        versionNumber: newVersionNumber,
        createdAt: new Date().toISOString(),
        customerRequestSummary: activeVersion.customerRequestSummary + ' (Edited & Revised by Owner)',
        items: editItems,
        totalAmount: newTotal,
        notes: editNotes,
        status: 'pending_review'
      };
 
      const updatedVersions = selectedQuote.versions.map(v => ({
        ...v,
        status: v.status === 'approved' ? 'superseded' : v.status
      } as QuoteVersion));
 
      const updatedQuote: Quote = {
        ...selectedQuote,
        currentVersion: newVersionNumber,
        updatedAt: new Date().toISOString(),
        versions: [...updatedVersions, newVersion]
      };
 
      const serverRes = await onUpdateQuote(updatedQuote);
      setSelectedQuoteId(serverRes.id);
      setIsEditing(false);
    } catch (e: any) {
      setInlineError(`Failed to save revision: ${e.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  };
 
  const handleSendToCustomer = async () => {
    if (!selectedQuote || !activeVersion) return;
    setInlineError(null);
    setIsSubmittingAction(true);
    try {
      const updatedVersions = selectedQuote.versions.map(v => 
        v.versionNumber === activeVersion.versionNumber 
          ? { ...v, status: 'sent_to_customer' as const }
          : v
      );
 
      const updatedQuote: Quote = {
        ...selectedQuote,
        updatedAt: new Date().toISOString(),
        versions: updatedVersions
      };
 
      const serverRes = await onUpdateQuote(updatedQuote);
      setSelectedQuoteId(serverRes.id);
    } catch (e: any) {
      setInlineError(`Failed to send to customer: ${e.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  };
 
  const updateDraftWithCalculation = (draft: NonNullable<typeof pendingDraft>) => calculateDraft(prices, draft);

  const handleAiGenerateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || !customerNameInput.trim()) return;
 
    setIsAnalyzing(true);
    setInlineError(null);
    let extractionStatus = 'fallback_local';
 
    try {
      const aiRes = await apiExtractAiPrompt(aiPrompt);
      if (aiRes?.status === 'success' && aiRes.extracted) {
        const ext = aiRes.extracted;
        extractionStatus = aiRes.status === 'success' ? 'success' : 'fallback_local';
        const rawDraft = {
          customerName: customerNameInput,
          customerEmail: customerEmailInput.trim() || '',
          customerPhone: customerPhoneInput.trim() || '',
          prompt: aiPrompt,
          dimensions: ext.dimensions || '',
          drawers: ext.drawers ?? 2,
          material: ext.material || '',
          includeDelivery: ext.includeDelivery ?? false,
          isUncertain: !ext.dimensions || !ext.material,
          uncertainWarning: (!ext.dimensions || !ext.material) ? 'Please specify dimensions and material.' : '',
          items: [],
          totalAmount: 0,
          source: aiRes.source || 'AI provider',
          notes: extractionStatus === 'success' ? `AI draft via ${aiRes.source || 'configured AI provider'} — prices from catalog; review required` : 'Draft via local rule-based helper (no AI request)'
        };
        setPendingDraft(updateDraftWithCalculation(rawDraft));
        setIsAnalyzing(false);
        setIsAiModalOpen(false);
        return;
      }
    } catch (err) {
      setInlineError(`${err instanceof Error ? err.message : 'AI request unavailable.'} A local helper draft was prepared for review.`);
    }
 
    const extracted = parseNaturalLanguagePrompt(aiPrompt, prices);
    const rawDraft = {
      customerName: customerNameInput,
      customerEmail: customerEmailInput.trim() || '',
      customerPhone: customerPhoneInput.trim() || '',
      prompt: aiPrompt,
      dimensions: extracted.dimensions,
      drawers: extracted.drawers,
      material: extracted.material,
      includeDelivery: extracted.includeDelivery,
      isUncertain: extracted.isUncertain,
      uncertainWarning: extracted.uncertainWarning,
      items: [],
      totalAmount: 0,
      source: 'Local helper',
      notes: 'Draft prepared with the local helper.'
    };
 
    setPendingDraft(updateDraftWithCalculation(rawDraft));
    setIsAnalyzing(false);
    setIsAiModalOpen(false);
  };
 
  const isSupportedDraft = (draft: NonNullable<typeof pendingDraft>) => canConfirmDraft(draft);

  const handleConfirmAndCreateQuote = async () => {
    if (!pendingDraft || !isSupportedDraft(pendingDraft)) return;
    setInlineError(null);
    setIsSubmittingAction(true);
 
    try {
      const derived = updateDraftWithCalculation(pendingDraft);
      if (!isSupportedDraft(derived)) {
        setPendingDraft(derived);
        setInlineError(derived.uncertainWarning);
        return;
      }
      const total = derived.totalAmount;
      const sequence = Math.max(0, ...quotes.map(quote => Number(quote.quoteNumber.split('-').at(-1)) || 0)) + 1;
      const newQuoteNum = `CQ-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`;
 
      const newQuote: Quote = {
        id: `q-${crypto.randomUUID()}`,
        quoteNumber: newQuoteNum,
        customerName: derived.customerName,
        customerEmail: derived.customerEmail,
        customerPhone: derived.customerPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentVersion: 1,
        paymentStatus: 'unpaid',
        versions: [
          {
            versionNumber: 1,
            createdAt: new Date().toISOString(),
            customerRequestSummary: derived.prompt,
            items: derived.items,
            totalAmount: total,
            notes: derived.notes,
            status: 'pending_review'
          }
        ]
      };
 
      const created = await onCreateQuote(newQuote);
      setSelectedQuoteId(created.id);
      setPendingDraft(null);
      setAiPrompt('');
      setCustomerNameInput('');
      setCustomerEmailInput('');
      setCustomerPhoneInput('');
    } catch (e: any) {
      setInlineError(`Failed to create quote: ${e.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  };
 
  const currentVersion = (quote: Quote) => quote.versions.find(version => version.versionNumber === quote.currentVersion) || quote.versions.at(-1);
  const awaitingApproval = quotes.filter(quote => quote.paymentStatus !== 'paid' && currentVersion(quote)?.status === 'sent_to_customer').length;
  const approvedValue = quotes.filter(quote => quote.paymentStatus !== 'paid' && currentVersion(quote)?.status === 'approved')
    .reduce((total, quote) => total + (currentVersion(quote)?.totalAmount || 0), 0);
  const visibleQuotes = quotes.filter(quote => `${quote.quoteNumber} ${quote.customerName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const statusLabels: Record<string,string> = {draft:'Draft',pending_review:'Draft',sent_to_customer:'Awaiting approval',approved:'Approved',superseded:'Previous version',rejected:'Changes requested'};
  const statusLabel = (quote: Quote) => quote.paymentStatus === 'paid' ? 'Paid' : (statusLabels[currentVersion(quote)?.status || 'pending_review'] || 'Draft');

  return (
    <div className="cq-workspace">
      <div className="cq-workspace-heading">
        <div><p className="cq-eyebrow">{businessName}</p><h1>Quote workspace</h1><p>Clear estimates. Confident approvals. Simpler payments.</p></div>
        <button type="button" onClick={() => setIsAiModalOpen(true)} className="cq-primary"><Sparkles size={16} />New quote</button>
      </div>
      <div className="cq-metrics" aria-label="Quote overview">
        <div className="cq-metric"><div><div className="cq-metric-label">Total quotes</div><p className="cq-metric-value">{quotes.length}</p></div><span className="cq-metric-icon"><FileText size={18} /></span></div>
        <div className="cq-metric"><div><div className="cq-metric-label">Awaiting approval</div><p className="cq-metric-value">{awaitingApproval}</p></div><span className="cq-metric-icon"><Clock3 size={18} /></span></div>
        <div className="cq-metric"><div><div className="cq-metric-label">Approved to pay</div><p className="cq-metric-value">{formatMoney(approvedValue)}</p></div><span className="cq-metric-icon"><CircleCheck size={18} /></span></div>
      </div>
      {inlineError && <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs flex items-center justify-between mb-5"><span>{inlineError}</span><button type="button" onClick={() => setInlineError(null)} className="underline ml-3">Dismiss</button></div>}
      <div className="cq-quote-layout">
        <aside className="cq-list-panel" aria-label="Quotes">
          <div className="cq-list-heading"><h2>All quotes</h2><span>{quotes.length} total</span></div>
          <div className="cq-search"><input type="search" aria-label="Search quotes" placeholder="Search name or quote…" value={search} onChange={event => setSearch(event.target.value)} /></div>
          {visibleQuotes.map(quote => {
            const version = currentVersion(quote);
            const selected = selectedQuote?.id === quote.id;
            return <article key={quote.id} className={`cq-quote-row${selected ? ' is-selected' : ''}`}>
              <button type="button" className="cq-quote-select" aria-pressed={selected} onClick={() => { setSelectedQuoteId(quote.id); setIsEditing(false); }}>
                <small>{quote.quoteNumber}</small><strong>{quote.customerName}</strong>
                <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${quote.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : version?.status === 'approved' ? 'bg-indigo-100 text-indigo-700' : version?.status === 'sent_to_customer' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{statusLabel(quote)}</span>
              </button>
              <div className="cq-quote-row-foot"><span>v{quote.currentVersion} · {formatMoney(version?.totalAmount || 0)}</span><button type="button" aria-label={`Open customer portal for ${quote.customerName}`} onClick={() => onOpenCustomerViewForQuote(quote.id)}><Eye size={13} />Portal</button></div>
            </article>;
          })}
          {!visibleQuotes.length && <div className="cq-empty">{search ? 'No matching quotes. Try another name or quote number.' : 'Your first quote starts here. Choose New quote to prepare an estimate.'}</div>}
        </aside>

        {/* Right Detail View */}
        <div className="space-y-6 min-w-0">
          {selectedQuote && activeVersion ? (
            <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-stone-200 space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-stone-200 gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-stone-900">{selectedQuote.quoteNumber}</h2>
                    <span className="bg-stone-100 text-stone-700 text-xs px-2.5 py-1 rounded-full font-semibold tabular-nums">
                      Version {activeVersion.versionNumber} ({activeVersion.status.replace(/_/g, ' ')})
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 mt-1">
                    Customer: <span className="font-semibold text-stone-800">{selectedQuote.customerName}</span> ({selectedQuote.customerEmail || 'No email'}) • Phone: {selectedQuote.customerPhone || 'N/A'}
                  </p>
                </div>
 
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenCustomerViewForQuote(selectedQuote.id)}
                    className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 px-3.5 py-2 rounded-xl text-xs font-semibold transition"
                  >
                    <Eye className="w-4 h-4 text-stone-600" />
                    <span>View Customer Portal</span>
                  </button>
                </div>
              </div>
 
              {/* Owner Workflow Actions */}
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold text-stone-700 block mb-0.5">Workflow Actions:</span>
                  <p className="text-[11px] text-stone-500">
                    {(activeVersion.status === 'draft' || activeVersion.status === 'pending_review') && 'Review itemized estimate, edit if needed, then send to customer for approval.'}
                    {activeVersion.status === 'sent_to_customer' && 'Waiting for customer review and approval.'}
                    {activeVersion.status === 'approved' && 'Customer approved this version. Ready for secure PayPal sandbox checkout.'}
                    {activeVersion.status === 'superseded' && 'This version has been superseded by a newer revision.'}
                  </p>
                </div>
 
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {(activeVersion.status === 'draft' || activeVersion.status === 'pending_review') && (
                    <button
                      onClick={handleSendToCustomer}
                      disabled={isSubmittingAction}
                      className="flex items-center gap-2 bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition disabled:opacity-50"
                    >
                      {isSubmittingAction ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      <span>Send to Customer</span>
                    </button>
                  )}
 
                  {!isEditing ? (
                    <button
                      onClick={handleStartEditing}
                      disabled={selectedQuote.paymentStatus === 'paid'}
                      className="flex items-center gap-2 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 px-4 py-2 rounded-xl text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Edit3 className="w-4 h-4 text-stone-500" />
                      <span>Edit / Revise</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-2 bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
              </div>
 
              {/* Request Summary */}
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
                <div className="flex items-center gap-2 text-indigo-900 font-semibold text-xs mb-1">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>Customer Request Summary:</span>
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
                      {(!isEditing ? activeVersion.items : editItems).map((item, i) => (
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
                          <td className="p-3 text-center tabular-nums">
                            {isEditing ? (
                              <input
                                type="number"
                                min="1"
                                step="1"
                                aria-label={`Quantity for ${item.name}`}
                                value={Number.isNaN(item.quantity) ? '' : item.quantity}
                                onChange={(e) => {
                                  const val = e.target.value === '' ? NaN : Number(e.target.value);
                                  const copy = [...editItems];
                                  copy[i].quantity = val;
                                  setEditItems(copy);
                                }}
                                className="w-16 border border-stone-300 rounded p-1 text-center tabular-nums text-xs"
                              />
                            ) : item.quantity}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                aria-label={`Unit price for ${item.name}`}
                                value={Number.isNaN(item.unitPrice) ? '' : item.unitPrice}
                                onChange={(e) => {
                                  const val = e.target.value === '' ? NaN : Number(e.target.value);
                                  const copy = [...editItems];
                                  copy[i].unitPrice = val;
                                  setEditItems(copy);
                                }}
                                className="w-24 border border-stone-300 rounded p-1 text-right tabular-nums text-xs"
                              />
                            ) : formatMoney(item.unitPrice)}
                          </td>
                          <td className="p-3 text-right tabular-nums font-semibold text-stone-900">
                            {formatMoney(item.quantity * item.unitPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-stone-50 font-bold border-t border-stone-200">
                        <td colSpan={4} className="p-3 text-right text-stone-700">Total Price:</td>
                        <td className="p-3 text-right tabular-nums text-xl text-indigo-900">
                          {!isEditing ? formatMoney(activeVersion.totalAmount) : itemTotal(editItems) === null ? 'Review items' : formatMoney(itemTotal(editItems)!)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
 
                {isEditing && (
                  <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-stone-200">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 bg-white border border-stone-300 rounded-xl text-xs font-semibold text-stone-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveRevision}
                      disabled={isSubmittingAction || itemTotal(editItems) === null}
                      className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-md disabled:opacity-50"
                    >
                      {isSubmittingAction ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      <span>Save & Create New Revision Version</span>
                    </button>
                  </div>
                )}
              </div>
 
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center text-stone-500 border border-stone-200">
              <p>No quote selected.</p>
            </div>
          )}
        </div>
 
      </div>
 
      {isAiModalOpen && <Dialog title="Create quote" description="Start with the customer's request. Review the specification and catalog prices next."
        onClose={() => setIsAiModalOpen(false)} onSubmit={handleAiGenerateQuote} busy={isAnalyzing}
        footer={<><button type="button" onClick={() => setIsAiModalOpen(false)} className="cq-secondary" disabled={isAnalyzing}>Cancel</button><button type="submit" className="cq-primary" disabled={isAnalyzing}>{isAnalyzing ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}{isAnalyzing ? 'Preparing draft…' : 'Prepare estimate'}</button></>}>
        <div className="space-y-4">
          <label className="cq-field">Customer name<input data-autofocus required autoComplete="name" value={customerNameInput} onChange={event => setCustomerNameInput(event.target.value)} placeholder="e.g. Alex Morgan" /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="cq-field">Email <span className="font-normal text-slate-400">(optional)</span><input type="email" autoComplete="email" value={customerEmailInput} onChange={event => setCustomerEmailInput(event.target.value)} placeholder="alex@example.com" /></label>
            <label className="cq-field">Phone <span className="font-normal text-slate-400">(optional)</span><input type="tel" autoComplete="tel" value={customerPhoneInput} onChange={event => setCustomerPhoneInput(event.target.value)} placeholder="(555) 234-5678" /></label>
          </div>
          <label className="cq-field">What would they like?<textarea required maxLength={8000} value={aiPrompt} onChange={event => setAiPrompt(event.target.value)} placeholder="A 48-inch white oak desk, two drawers, and delivery to my home." /></label>
          <button type="button" className="text-xs text-indigo-600 font-semibold" onClick={() => { setAiPrompt('A 48-inch white oak desk with two drawers and white glove delivery.'); if (!customerNameInput) setCustomerNameInput('Alex Morgan'); }}>Use an example request</button>
          <div className="cq-message">AI organizes the request. Your catalog determines the price. You review the draft before it is sent.</div>
        </div>
      </Dialog>}

      {pendingDraft && <Dialog wide title="Review estimate" description={`${pendingDraft.customerName} · Check every detail before creating the quote.`}
        onClose={() => setPendingDraft(null)} busy={isSubmittingAction}
        footer={<><button type="button" onClick={() => setPendingDraft(null)} className="cq-secondary" disabled={isSubmittingAction}>Cancel</button><button type="button" onClick={handleConfirmAndCreateQuote} className="cq-primary" disabled={isSubmittingAction || !isSupportedDraft(pendingDraft)}>{isSubmittingAction ? <RefreshCw size={15} className="animate-spin" /> : <Check size={16} />}Create quote</button></>}>
        <div className="space-y-5">
          <div className="cq-message">Prepared with {pendingDraft.source}. Prices are calculated from the catalog. Review required.</div>
          {pendingDraft.isUncertain && <p role="alert" className="bg-amber-50 border border-amber-200 text-indigo-900 rounded-lg p-3 text-xs flex gap-2"><AlertCircle size={16} className="shrink-0" />{pendingDraft.uncertainWarning}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="cq-field">Desk size<select data-autofocus value={pendingDraft.dimensions} onChange={event => setPendingDraft(updateDraftWithCalculation({...pendingDraft, dimensions:event.target.value}))}><option value="">Choose a size</option><option>48-inch Compact Desk</option><option>60-inch Standard Desk</option></select></label>
            <label className="cq-field">Wood material<select value={pendingDraft.material} onChange={event => setPendingDraft(updateDraftWithCalculation({...pendingDraft, material:event.target.value}))}><option value="">Choose a material</option><option>White Oak Hardwood (Solid)</option><option>Black Walnut Upgrade</option></select></label>
            <label className="cq-field">Drawer count<input type="number" min={0} max={6} step={1} aria-invalid={!Number.isInteger(pendingDraft.drawers) || pendingDraft.drawers < 0 || pendingDraft.drawers > 6} value={Number.isNaN(pendingDraft.drawers) ? '' : pendingDraft.drawers} onChange={event => setPendingDraft(updateDraftWithCalculation({...pendingDraft, drawers:parseDrawerInput(event.target.value)}))} /><span className="cq-field-hint">Choose a whole number from 0 to 6.</span></label>
            <label className="flex items-start gap-3 sm:pt-7 text-sm text-slate-600"><input type="checkbox" className="mt-1 h-4 w-4" checked={pendingDraft.includeDelivery} onChange={event => setPendingDraft(updateDraftWithCalculation({...pendingDraft, includeDelivery:event.target.checked}))} /><span>White glove delivery<span className="block text-xs text-slate-400 mt-1">Use the catalog delivery rate.</span></span></label>
          </div>
          <div className="cq-draft-summary"><p className="cq-eyebrow">Estimate breakdown</p>
            {pendingDraft.items.map(item => <div className="cq-draft-line" key={item.id}><span>{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</span><span>{formatMoney(item.quantity * item.unitPrice)}</span></div>)}
            <div className="cq-draft-total"><span>Estimated total <small className="block text-slate-400 font-normal mt-1">USD · Customer approval required</small></span><strong>{pendingDraft.isUncertain ? '—' : formatMoney(pendingDraft.totalAmount)}</strong></div>
          </div>
          <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Original customer request</summary><p className="mt-2 leading-relaxed">{pendingDraft.prompt}</p></details>
        </div>
      </Dialog>}
    </div>
  );
};
 
