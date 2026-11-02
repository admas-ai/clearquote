import React, { useState } from 'react';
import type { Quote, PriceItem, QuoteItem, QuoteVersion } from '../types';
import { apiExtractAiPrompt } from '../api';
import { Sparkles, Send, Eye, Edit3, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { parseNaturalLanguagePrompt, calculateQuoteItems } from '../utils/calculator';
 
interface OwnerDashboardProps {
  quotes: Quote[];
  prices: PriceItem[];
  onUpdateQuote: (updatedQuote: Quote) => Promise<Quote>;
  onCreateQuote: (newQuote: Quote) => Promise<Quote>;
  onOpenCustomerViewForQuote: (quoteId: string) => void;
}
 
export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  quotes,
  prices,
  onUpdateQuote,
  onCreateQuote,
  onOpenCustomerViewForQuote
}) => {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>(quotes[0]?.id || '');
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
      const newTotal = editItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
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
 
  const updateDraftWithCalculation = (draft: NonNullable<typeof pendingDraft>) => {
    const calc = calculateQuoteItems(prices, draft.dimensions, draft.material, draft.drawers, draft.includeDelivery);
    const isUncertain = !draft.dimensions || !draft.material;
    return {
      ...draft,
      isUncertain,
      uncertainWarning: isUncertain ? 'Please select valid dimensions and material before confirming.' : '',
      items: calc.items,
      notes: calc.notes
    };
  };
 
  const handleAiGenerateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || !customerNameInput.trim()) return;
 
    setIsAnalyzing(true);
    setInlineError(null);
    let extractionStatus = 'fallback_local';
 
    try {
      const aiRes = await apiExtractAiPrompt(aiPrompt);
      if (aiRes && aiRes.extracted) {
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
          includeDelivery: ext.includeDelivery ?? true,
          isUncertain: !ext.dimensions || !ext.material,
          uncertainWarning: (!ext.dimensions || !ext.material) ? 'Please specify dimensions and material.' : '',
          items: [],
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
      notes: 'Calculated via Rule-Based Local NLP Helper (Source: fallback_local)'
    };
 
    setPendingDraft(updateDraftWithCalculation(rawDraft));
    setIsAnalyzing(false);
    setIsAiModalOpen(false);
  };
 
  const isSupportedDraft = (draft: NonNullable<typeof pendingDraft>) => {
    const validSizes = ['48-inch Compact Desk', '60-inch Standard Desk'];
    const validMaterials = ['White Oak Hardwood (Solid)', 'Black Walnut Upgrade'];
    return Boolean(draft.dimensions && draft.material && validSizes.includes(draft.dimensions) && validMaterials.includes(draft.material) && !draft.isUncertain);
  };
 
  const handleConfirmAndCreateQuote = async () => {
    if (!pendingDraft || !isSupportedDraft(pendingDraft)) return;
    setInlineError(null);
    setIsSubmittingAction(true);
 
    try {
      const derived = updateDraftWithCalculation(pendingDraft);
      const total = derived.items.reduce((s, i) => s + (i.quantity * i.unitPrice), 0);
      const newQuoteNum = `CQ-2026-0${Math.floor(90 + Math.random() * 90)}`;
 
      const newQuote: Quote = {
        id: `q-${Date.now()}`,
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
 
  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      
      {/* Top Bar / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Business Owner Dashboard</h1>
            <span className="bg-amber-100 text-amber-900 text-xs px-3 py-1 rounded-full font-semibold border border-amber-200">
              Oak & Iron Custom Woodworking
            </span>
          </div>
          <p className="text-sm text-stone-600 mt-1">Review customer requests, organize with NLP quote helper, review itemized quotes, and manage studio workflows.</p>
        </div>
 
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-stone-900 to-stone-800 hover:from-stone-800 hover:to-stone-700 text-white px-5 py-2.5 rounded-xl font-medium text-xs shadow-md transition"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>New Quote</span>
          </button>
        </div>
      </div>
 
      {inlineError && (
        <div className="bg-rose-500 text-white p-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>{inlineError}</span>
          <button onClick={() => setInlineError(null)} className="underline ml-2">Dismiss</button>
        </div>
      )}
 
      {/* Main Grid: Quote List Sidebar + Detail View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Quote List Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-200">
            <h2 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3">Customer Quotes & Requests</h2>
            
            <div className="space-y-2.5">
              {quotes.map((q) => {
                const latestV = q.versions[q.versions.length - 1];
                const isSelected = q.id === selectedQuoteId;
                return (
                  <div
                    key={q.id}
                    onClick={() => {
                      setSelectedQuoteId(q.id);
                      setIsEditing(false);
                    }}
                    className={`p-3.5 rounded-xl cursor-pointer transition border ${
                      isSelected
                        ? 'bg-amber-50/70 border-amber-300 shadow-sm'
                        : 'bg-white hover:bg-stone-50 border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm text-stone-900">{q.quoteNumber}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                        q.paymentStatus === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : latestV?.status === 'approved'
                          ? 'bg-blue-100 text-blue-800'
                          : latestV?.status === 'sent_to_customer'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-stone-100 text-stone-700'
                      }`}>
                        {q.paymentStatus === 'paid' ? 'Paid' : latestV?.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-stone-800 truncate">{q.customerName}</div>
                    <div className="flex items-center justify-between text-[11px] text-stone-500 mt-2">
                      <span>Ver {q.currentVersion} • ${latestV?.totalAmount.toLocaleString()}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenCustomerViewForQuote(q.id);
                        }}
                        className="text-amber-700 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Portal</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
 
        {/* Right Detail View */}
        <div className="lg:col-span-2 space-y-6">
          {selectedQuote && activeVersion ? (
            <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-stone-200 space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-stone-200 gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-stone-900">{selectedQuote.quoteNumber}</h2>
                    <span className="bg-stone-100 text-stone-700 text-xs px-2.5 py-1 rounded-full font-semibold font-mono">
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
                    {activeVersion.status === 'pending_review' && 'Review itemized estimate, edit if needed, then send to customer for approval.'}
                    {activeVersion.status === 'sent_to_customer' && 'Waiting for customer review and approval.'}
                    {activeVersion.status === 'approved' && 'Customer approved this version. Ready for secure PayPal sandbox checkout.'}
                    {activeVersion.status === 'superseded' && 'This version has been superseded by a newer revision.'}
                  </p>
                </div>
 
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {activeVersion.status === 'pending_review' && (
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
              <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-amber-900 font-semibold text-xs mb-1">
                  <Sparkles className="w-4 h-4 text-amber-700" />
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
                          <td className="p-3 text-center font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 1;
                                  const copy = [...editItems];
                                  copy[i].quantity = val;
                                  setEditItems(copy);
                                }}
                                className="w-16 border border-stone-300 rounded p-1 text-center font-mono text-xs"
                              />
                            ) : item.quantity}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                value={item.unitPrice}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const copy = [...editItems];
                                  copy[i].unitPrice = val;
                                  setEditItems(copy);
                                }}
                                className="w-24 border border-stone-300 rounded p-1 text-right font-mono text-xs"
                              />
                            ) : `$${item.unitPrice.toLocaleString()}`}
                          </td>
                          <td className="p-3 text-right font-mono font-semibold text-stone-900">
                            ${(item.quantity * item.unitPrice).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-stone-50 font-bold border-t border-stone-200">
                        <td colSpan={4} className="p-3 text-right text-stone-700">Total Price:</td>
                        <td className="p-3 text-right font-mono text-xl text-amber-900">
                          ${(!isEditing ? activeVersion.totalAmount : editItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0)).toLocaleString()}
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
                      disabled={isSubmittingAction}
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
 
      {/* AI / Local Helper Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-stone-200 space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <div className="flex items-center gap-2">
                <div className="bg-amber-100 text-amber-800 p-2 rounded-xl">
                  <Sparkles className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-stone-900">New Quote</h3>
                  <p className="text-xs text-stone-500">Enter customer details and natural language project prompt</p>
                </div>
              </div>
              <button onClick={() => setIsAiModalOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
 
            <form onSubmit={handleAiGenerateQuote} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Customer Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={customerNameInput}
                  onChange={(e) => setCustomerNameInput(e.target.value)}
                  className="w-full text-sm border border-stone-300 rounded-xl p-2.5 outline-none focus:border-amber-700"
                />
              </div>
 
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Customer Email (Optional):</label>
                <input
                  type="email"
                  placeholder="e.g. sarah@example.com"
                  value={customerEmailInput}
                  onChange={(e) => setCustomerEmailInput(e.target.value)}
                  className="w-full text-sm border border-stone-300 rounded-xl p-2.5 outline-none focus:border-amber-700"
                />
              </div>
 
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Customer Phone (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. (555) 234-5678"
                  value={customerPhoneInput}
                  onChange={(e) => setCustomerPhoneInput(e.target.value)}
                  className="w-full text-sm border border-stone-300 rounded-xl p-2.5 outline-none focus:border-amber-700"
                />
              </div>
 
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Customer Request Prompt:</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. 48-inch oak desk with two drawers and delivery"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="w-full text-sm border border-stone-300 rounded-xl p-3 outline-none focus:border-amber-700"
                />
              </div>
 
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAiModalOpen(false)}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-xl text-xs font-semibold text-stone-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-md disabled:opacity-50"
                >
                  {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-amber-400" />}
                  <span>Generate Quote</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
 
      {/* Pre-Finalization Confirmation Modal */}
      {pendingDraft && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 md:p-8 shadow-2xl border border-stone-200 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <div className="flex items-center gap-2">
                <div className="bg-amber-100 text-amber-800 p-2 rounded-xl">
                  <Check className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-stone-900">Confirm Generated Quote Draft</h3>
                  <p className="text-xs text-stone-500">Verify extracted dimensions, material, drawers, and delivery before final creation</p>
                </div>
              </div>
              <button onClick={() => setPendingDraft(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
 
            {pendingDraft.isUncertain && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>{pendingDraft.uncertainWarning || 'Uncertain or missing specifications detected. Please select valid dimensions and material.'}</span>
              </div>
            )}
 
            <div className="space-y-4 bg-stone-50 p-4 rounded-xl border border-stone-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Dimensions / Size:</label>
                  <select
                    value={pendingDraft.dimensions}
                    onChange={(e) => setPendingDraft(updateDraftWithCalculation({ ...pendingDraft, dimensions: e.target.value }))}
                    className="w-full text-sm bg-white border border-stone-300 rounded-xl p-2.5 outline-none focus:border-amber-700"
                  >
                    <option value="">-- Select Dimensions --</option>
                    <option value="48-inch Compact Desk">48-inch Compact Desk</option>
                    <option value="60-inch Standard Desk">60-inch Standard Desk</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Wood Material:</label>
                  <select
                    value={pendingDraft.material}
                    onChange={(e) => setPendingDraft(updateDraftWithCalculation({ ...pendingDraft, material: e.target.value }))}
                    className="w-full text-sm bg-white border border-stone-300 rounded-xl p-2.5 outline-none focus:border-amber-700"
                  >
                    <option value="">-- Select Material --</option>
                    <option value="White Oak Hardwood (Solid)">White Oak Hardwood (Solid)</option>
                    <option value="Black Walnut Upgrade">Black Walnut Upgrade</option>
                  </select>
                </div>
              </div>
 
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Drawer Count (0-6):</label>
                  <input
                    type="number"
                    min="0"
                    max="6"
                    value={pendingDraft.drawers}
                    onChange={(e) => setPendingDraft(updateDraftWithCalculation({ ...pendingDraft, drawers: parseInt(e.target.value) || 0 }))}
                    className="w-full text-sm bg-white border border-stone-300 rounded-xl p-2.5 outline-none focus:border-amber-700 font-mono"
                  />
                </div>
                <div className="flex items-center pt-6">
                  <input
                    type="checkbox"
                    id="includeDeliveryCheck"
                    checked={pendingDraft.includeDelivery}
                    onChange={(e) => setPendingDraft(updateDraftWithCalculation({ ...pendingDraft, includeDelivery: e.target.checked }))}
                    className="rounded border-stone-300 text-amber-700 focus:ring-amber-700 w-4 h-4"
                  />
                  <label htmlFor="includeDeliveryCheck" className="text-xs font-semibold text-stone-800 ml-2">
                    Include White Glove Delivery & Setup (+$180)
                  </label>
                </div>
              </div>
 
              <div className="pt-2 border-t border-stone-200">
                <span className="text-xs font-bold text-stone-700 block mb-2">Itemized Breakdown Preview:</span>
                <ul className="text-xs text-stone-600 space-y-1">
                  {pendingDraft.items.map((it, i) => (
                    <li key={i} className="flex justify-between font-mono">
                      <span>{it.name} (Qty {it.quantity})</span>
                      <span>${(it.quantity * it.unitPrice).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between font-bold text-xs text-stone-900 pt-2 mt-2 border-t border-stone-200">
                  <span>Total Calculated:</span>
                  <span className="font-mono text-amber-900 text-sm">
                    ${pendingDraft.items.reduce((s, i) => s + (i.quantity * i.unitPrice), 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
 
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setPendingDraft(null)}
                className="px-4 py-2.5 bg-white border border-stone-300 rounded-xl text-xs font-semibold text-stone-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAndCreateQuote}
                disabled={isSubmittingAction || !isSupportedDraft(pendingDraft)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-md disabled:opacity-50"
              >
                {isSubmittingAction ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>Confirm & Create Quote</span>
              </button>
            </div>
          </div>
        </div>
      )}
 
    </div>
  );
};
 
