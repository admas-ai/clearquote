import React, { useState } from 'react';
import type { PriceItem } from '../types';
import { Tag, Plus, Trash2, X } from 'lucide-react';
 
interface PriceCatalogModalProps {
  prices: PriceItem[];
  onUpdatePrices: (prices: PriceItem[]) => void;
  onClose: () => void;
}
 
export const PriceCatalogModal: React.FC<PriceCatalogModalProps> = ({
  prices,
  onUpdatePrices,
  onClose
}) => {
  const [items, setItems] = useState<PriceItem[]>(prices);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<'material' | 'hardware' | 'labor' | 'shipping' | 'addon'>('material');
  const [newPrice, setNewPrice] = useState('');
  const [newDesc, setNewDesc] = useState('');
 
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPrice) return;
 
    const newItem: PriceItem = {
      id: `p-${Date.now()}`,
      name: newName,
      category: newCategory,
      basePrice: parseFloat(newPrice) || 0,
      description: newDesc
    };
 
    const updated = [...items, newItem];
    setItems(updated);
    onUpdatePrices(updated);
    setNewName('');
    setNewPrice('');
    setNewDesc('');
  };
 
  const handleDeleteItem = (id: string) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    onUpdatePrices(updated);
  };
 
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 md:p-8 shadow-2xl border border-slate-200 space-y-6 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
        
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-100 text-blue-600 p-2 rounded-xl">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900">Editable Price List & Catalog</h3>
              <p className="text-xs text-slate-500">Manage base materials, hardware, labor rates, and shipping fees</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
 
        {/* Existing Prices Table */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current Catalog Items</h4>
          <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="p-3">Item Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3 text-right">Base Price</th>
                  <th className="p-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-3">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      <div className="text-[11px] text-slate-500">{item.description}</div>
                    </td>
                    <td className="p-3 capitalize">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                        {item.category}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">${item.basePrice}</td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-rose-600 hover:text-rose-800 p-1 rounded"
                        title="Delete item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
 
        {/* Add New Price Item Form */}
        <form onSubmit={handleAddItem} className="space-y-4 pt-4 border-t border-slate-200">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Add New Price Item</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Item Name:</label>
              <input
                type="text"
                required
                placeholder="e.g. Maple Wood Upgrade"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-xl p-2.5 outline-none focus:border-blue-600"
              />
            </div>
 
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Category:</label>
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value as any)}
                className="w-full text-sm border border-slate-300 rounded-xl p-2.5 outline-none focus:border-blue-600 bg-white"
              >
                <option value="material">Material</option>
                <option value="hardware">Hardware</option>
                <option value="labor">Labor</option>
                <option value="shipping">Shipping</option>
                <option value="addon">Addon</option>
              </select>
            </div>
          </div>
 
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Base Price ($):</label>
              <input
                type="number"
                required
                min="0"
                placeholder="150"
                value={newPrice}
                onChange={e => setNewPrice(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-xl p-2.5 outline-none focus:border-blue-600 font-mono"
              />
            </div>
 
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Description:</label>
              <input
                type="text"
                placeholder="Short description..."
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-xl p-2.5 outline-none focus:border-blue-600"
              />
            </div>
          </div>
 
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add to Catalog</span>
            </button>
          </div>
        </form>
 
      </div>
    </div>
  );
};
 
