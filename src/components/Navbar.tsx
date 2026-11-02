import React from 'react';
import { Sparkles, Settings, Tag, UserCheck, Wrench, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { BusinessSettings } from '../types';
import { AiConnection } from './AiConnection';
 
interface NavbarProps {
  viewMode: 'owner' | 'customer';
  setViewMode: (mode: 'owner' | 'customer') => void;
  settings: BusinessSettings;
  onOpenSettings: () => void;
  onOpenPrices: () => void;
  onResetData: () => void;
}
 
export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  setViewMode,
  settings,
  onOpenSettings,
  onOpenPrices,
  onResetData
}) => {
  return (
    <header className="bg-slate-900 text-white shadow-md sticky top-0 z-40 border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-3">
        
        {/* Brand & Hackathon Tag */}
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2.5 rounded-xl shadow-lg flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight">ClearQuote</span>
              <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                Custom Furniture Quoting
              </span>
            </div>
            <p className="text-xs text-slate-400">Natural Language Custom Furniture Quoting & Client Estimation</p>
          </div>
        </div>
 
        {/* Mode Switcher */}
        <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700 shadow-inner">
          <button
            onClick={() => setViewMode('owner')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'owner'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>Business View ({settings.businessName})</span>
          </button>
          
          <button
            onClick={() => setViewMode('customer')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'customer'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Customer View (Demo Portal)</span>
          </button>
        </div>
 
        {/* Actions & Controls (Owner Only) */}
        {viewMode === 'owner' ? (
          <div className="flex items-center gap-2">
            <AiConnection />
            {/* PayPal Sandbox Badge */}
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition"
              title="Configure PayPal Sandbox"
            >
              {settings.paypalConnected ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="hidden sm:inline">PayPal Sandbox:</span>
                  <span className="text-emerald-400 font-semibold">Connected</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">PayPal:</span>
                  <span className="text-amber-400 font-semibold">Not Connected</span>
                </>
              )}
            </button>
 
            <button
              onClick={onOpenPrices}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition"
              title="Manage Price Catalog"
            >
              <Tag className="w-4 h-4 text-blue-400" />
              <span className="hidden sm:inline">Price List</span>
            </button>
 
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition"
              title="Settings"
            >
              <Settings className="w-4 h-4 text-slate-300" />
            </button>
 
            <button
              onClick={onResetData}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition"
              title="Reset to initial sample state"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic">Customer Portal Active</div>
        )}
 
      </div>
    </header>
  );
};
 
