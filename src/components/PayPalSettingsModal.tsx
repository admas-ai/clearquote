import React, { useState } from 'react';
import type { BusinessSettings } from '../types';
import { ShieldCheck, X, Check } from 'lucide-react';
 
interface PayPalSettingsModalProps {
  settings: BusinessSettings;
  onUpdateSettings: (newSettings: BusinessSettings) => void;
  onClose: () => void;
}
 
export const PayPalSettingsModal: React.FC<PayPalSettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onClose
}) => {
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const [savedSuccess, setSavedSuccess] = useState(false);
 
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      ...settings,
      businessName,
      ownerName
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };
 
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-slate-200 space-y-6 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
        
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl ${settings.paypalConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900">Business & PayPal Server Settings</h3>
              <p className="text-xs text-slate-500">Configure business profile & view server environment status</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
 
        {savedSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Settings saved successfully.</span>
          </div>
        )}
 
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Business Name:</label>
            <input
              type="text"
              required
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-xl p-2.5 outline-none focus:border-emerald-600"
            />
          </div>
 
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Owner Name:</label>
            <input
              type="text"
              required
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-xl p-2.5 outline-none focus:border-emerald-600"
            />
          </div>
 
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800">PayPal Sandbox Status:</span>
              <span className={`px-2.5 py-1 rounded-full font-semibold ${settings.paypalConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {settings.paypalConnected ? 'Connected (Server Environment)' : 'Not Connected (Missing Server Credentials)'}
              </span>
            </div>
            <p className="text-slate-600">
              PayPal credentials remain server environment-only (<code className="bg-slate-200 px-1 py-0.5 rounded">PAYPAL_CLIENT_ID</code> & <code className="bg-slate-200 px-1 py-0.5 rounded">PAYPAL_CLIENT_SECRET</code>). Mode: <span className="font-semibold">Sandbox</span>.
            </p>
          </div>
 
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md transition"
            >
              <Check className="w-4 h-4" />
              <span>Save Settings</span>
            </button>
          </div>
        </form>
 
      </div>
    </div>
  );
};
 
