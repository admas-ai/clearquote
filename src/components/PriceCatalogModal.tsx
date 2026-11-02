import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PriceItem } from '../types';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { Dialog } from './Dialog';
import { moneyToCents } from '../utils/currency';

interface PriceCatalogModalProps {
  prices: PriceItem[];
  onUpdatePrices: (prices: PriceItem[]) => Promise<void>;
  onClose: () => void;
}

export function PriceCatalogModal({ prices, onUpdatePrices, onClose }: PriceCatalogModalProps) {
  const [items, setItems] = useState<PriceItem[]>(prices);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<PriceItem['category']>('addon');
  const [newPrice, setNewPrice] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = items.length > 0 && items.every(item => item.name.trim() && moneyToCents(item.basePrice) !== null);
  const addItem = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || !newPrice.trim() || moneyToCents(Number(newPrice)) === null) return;
    setItems(current => [...current, {id:crypto.randomUUID(),name:newName.trim(),category:newCategory,basePrice:Number(newPrice),description:newDescription.trim()}]);
    setNewName(''); setNewPrice(''); setNewDescription('');
  };
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setError('');
    try { await onUpdatePrices(items); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The catalog could not be saved. Please try again.'); }
    finally { setBusy(false); }
  };
  return <Dialog wide title="Price catalog" description="Update the rates used for new estimates. Existing quote versions keep their agreed prices." onClose={onClose} busy={busy}
    footer={<><button type="button" className="cq-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="cq-primary" onClick={save} disabled={busy || !valid}>{busy && <RefreshCw size={15} className="animate-spin" />}Save catalog</button></>}>
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[480px] text-left text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="p-3">Catalog item</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3 text-right">Base price · USD</th><th scope="col" className="p-3"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{items.map(item => <tr key={item.id}>
          <td className="p-3"><strong className="font-semibold text-slate-700">{item.name}</strong><p className="text-slate-400 mt-1 leading-relaxed">{item.description}</p></td>
          <td className="p-3 capitalize text-slate-500">{item.category}</td>
          <td className="p-3 text-right"><input aria-label={`Price for ${item.name}`} aria-invalid={moneyToCents(item.basePrice) === null} type="number" min="0" step="0.01" value={Number.isNaN(item.basePrice) ? '' : item.basePrice} onChange={event => setItems(current => current.map(row => row.id === item.id ? {...row,basePrice:event.target.value === '' ? NaN : Number(event.target.value)} : row))} className="w-24 text-right rounded-lg border border-slate-200 p-2.5 tabular-nums" disabled={busy} /></td>
          <td className="p-3"><button type="button" onClick={() => setItems(current => current.filter(row => row.id !== item.id))} className="cq-icon-button text-rose-600" aria-label={`Remove ${item.name}`} disabled={busy}><Trash2 size={15} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!valid && <p role="alert" className="text-xs text-amber-800">Enter valid non-negative prices with no more than two decimal places.</p>}
      <details className="rounded-xl border border-slate-200 p-4"><summary className="text-sm font-semibold cursor-pointer">Add a catalog item</summary>
        <form onSubmit={addItem} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><label className="cq-field">Item name<input required value={newName} onChange={event => setNewName(event.target.value)} /></label><label className="cq-field">Category<select value={newCategory} onChange={event => setNewCategory(event.target.value as PriceItem['category'])}><option value="material">Material</option><option value="hardware">Hardware</option><option value="labor">Labor</option><option value="shipping">Delivery</option><option value="addon">Add-on</option></select></label></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><label className="cq-field">Base price · USD<input type="number" min="0" step="0.01" required value={newPrice} onChange={event => setNewPrice(event.target.value)} /></label><label className="cq-field">Description<input value={newDescription} onChange={event => setNewDescription(event.target.value)} /></label></div>
          <button type="submit" className="cq-secondary" disabled={busy}><Plus size={15} />Add item</button>
        </form>
      </details>
      <p className="text-xs text-slate-400 leading-relaxed">Changes are saved together. If a required material, hardware, finish, or delivery rate is missing, the quote builder will ask you to review the catalog.</p>
    </div>
  </Dialog>;
}
