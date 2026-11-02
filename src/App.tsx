import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { OwnerDashboard } from './components/OwnerDashboard';
import { CustomerPortal } from './components/CustomerPortal';
import { PayPalSettingsModal } from './components/PayPalSettingsModal';
import { PriceCatalogModal } from './components/PriceCatalogModal';
import { INITIAL_QUOTES, INITIAL_PRICES, INITIAL_SETTINGS } from './data/initialData';
import type { Quote, PriceItem, BusinessSettings } from './types';
import {
  checkApiHealth,
  apiFetchQuotes,
  apiCreateQuote,
  apiUpdateQuote,
  apiFetchPrices,
  apiUpdatePrices,
  apiFetchPayPalConfig
} from './api';
import { AlertTriangle } from 'lucide-react';
 
const STORAGE_KEY_QUOTES = 'clearquote_quotes_v1';
const STORAGE_KEY_PRICES = 'clearquote_prices_v1';
const STORAGE_KEY_SETTINGS = 'clearquote_settings_v1';
 
export function App() {
  const [viewMode, setViewMode] = useState<'owner' | 'customer'>('owner');
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  
  const [quotes, setQuotes] = useState<Quote[]>(INITIAL_QUOTES);
  const [prices, setPrices] = useState<PriceItem[]>(INITIAL_PRICES);
  const [settings, setSettings] = useState<BusinessSettings>(INITIAL_SETTINGS);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPricesOpen, setIsPricesOpen] = useState(false);
  const [activeQuoteId, setActiveQuoteId] = useState<string>(() => INITIAL_QUOTES[0]?.id || '');
  const [inlineError, setInlineError] = useState<string | null>(null);
 
  // Initialize and hydrate from server API when available, otherwise fall back to localStorage demo
  useEffect(() => {
    let mounted = true;
    async function initApp() {
      const health = await checkApiHealth();
      if (!mounted) return;
 
      if (health.available) {
        setBackendStatus('connected');
        try {
          const [fetchedQuotes, fetchedPrices, ppConfig] = await Promise.all([
            apiFetchQuotes(),
            apiFetchPrices(),
            apiFetchPayPalConfig()
          ]);
          if (!mounted) return;
          setQuotes(fetchedQuotes || []);
          setPrices(fetchedPrices || []);
          if (ppConfig) {
            setSettings(prev => ({
              ...prev,
              paypalConnected: ppConfig.configured,
              paypalClientId: ppConfig.clientId || prev.paypalClientId,
              paypalMode: (ppConfig.mode || 'sandbox') as ('sandbox' | 'live')
            }));
          }
        } catch (e) {
          console.error('Error hydrating from server:', e);
          setInlineError('Connected to API server, but failed to load initial records.');
        }
      } else {
        setBackendStatus('disconnected');
        // Fallback to localStorage demo
        try {
          const savedQuotes = localStorage.getItem(STORAGE_KEY_QUOTES);
          if (savedQuotes) setQuotes(JSON.parse(savedQuotes));
          const savedPrices = localStorage.getItem(STORAGE_KEY_PRICES);
          if (savedPrices) setPrices(JSON.parse(savedPrices));
          const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
          if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            setSettings({
              ...parsed,
              paypalConnected: false,
              paypalClientId: '',
              paypalMode: 'sandbox'
            });
          }
        } catch {}
      }
    }
    initApp();
    return () => { mounted = false; };
  }, []);
 
  // Save to localStorage as backup/demo fallback
  useEffect(() => {
    if (backendStatus === 'disconnected') {
      try {
        localStorage.setItem(STORAGE_KEY_QUOTES, JSON.stringify(quotes));
      } catch {}
    }
  }, [quotes, backendStatus]);
 
  useEffect(() => {
    if (backendStatus === 'disconnected') {
      try {
        localStorage.setItem(STORAGE_KEY_PRICES, JSON.stringify(prices));
      } catch {}
    }
  }, [prices, backendStatus]);
 
  useEffect(() => {
    if (backendStatus === 'disconnected') {
      try {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
      } catch {}
    }
  }, [settings, backendStatus]);
 
  // Async API Handlers with inline error surfacing and correct expectedVersion
  const handleUpdateQuote = async (updatedQuote: Quote): Promise<Quote> => {
    setInlineError(null);
    if (backendStatus === 'checking') {
      const err = new Error('Backend status checking. Request rejected.');
      setInlineError(err.message);
      throw err;
    }
    if (backendStatus === 'connected') {
      try {
        const prevQuote = quotes.find(q => q.id === updatedQuote.id);
        const expectedVersion = prevQuote ? prevQuote.currentVersion : updatedQuote.currentVersion;
        const activeVer = updatedQuote.versions.find(v => v.versionNumber === updatedQuote.currentVersion) || updatedQuote.versions[updatedQuote.versions.length - 1];
        let action: 'send' | 'approve' | 'revise' | undefined = undefined;
        if (activeVer?.status === 'sent_to_customer') action = 'send';
        if (activeVer?.status === 'approved') action = 'approve';
        if (prevQuote && updatedQuote.versions.length > prevQuote.versions.length) {
          action = 'revise';
        }
 
        const serverRes = await apiUpdateQuote(updatedQuote.id, {
          action,
          expectedVersion,
          customerName: updatedQuote.customerName,
          customerEmail: updatedQuote.customerEmail,
          customerPhone: updatedQuote.customerPhone,
          items: activeVer?.items,
          notes: activeVer?.notes,
          customerRequestSummary: activeVer?.customerRequestSummary
        });
        setQuotes(prev => prev.map(q => q.id === serverRes.id ? serverRes : q));
        return serverRes;
      } catch (e: any) {
        setInlineError(`Failed to update quote on server: ${e.message}`);
        throw e;
      }
    } else {
      setQuotes(prev => prev.map(q => q.id === updatedQuote.id ? updatedQuote : q));
      return updatedQuote;
    }
  };
 
  const handleCreateQuote = async (suppliedQuote: Quote): Promise<Quote> => {
    setInlineError(null);
    if (backendStatus === 'checking') {
      const err = new Error('Backend status checking. Request rejected.');
      setInlineError(err.message);
      throw err;
    }
    const activeVer = suppliedQuote.versions?.[0] || {
      customerRequestSummary: 'Initial estimate request',
      items: [],
      notes: ''
    };
 
    if (backendStatus === 'connected') {
      try {
        const payload = {
          customerName: suppliedQuote.customerName || 'Valued Customer',
          customerEmail: suppliedQuote.customerEmail || '',
          customerPhone: suppliedQuote.customerPhone || '',
          customerRequestSummary: activeVer.customerRequestSummary,
          items: activeVer.items,
          notes: activeVer.notes
        };
        const created = await apiCreateQuote(payload);
        setQuotes(prev => [created, ...prev]);
        setActiveQuoteId(created.id);
        return created;
      } catch (e: any) {
        setInlineError(`Failed to create quote on server: ${e.message}`);
        throw e;
      }
    } else {
      const fallbackQuote: Quote = {
        id: suppliedQuote.id || 'q-' + Date.now(),
        quoteNumber: suppliedQuote.quoteNumber || 'CQ-2026-' + Math.floor(100 + Math.random() * 900),
        customerName: suppliedQuote.customerName || 'Valued Customer',
        customerEmail: suppliedQuote.customerEmail || '',
        customerPhone: suppliedQuote.customerPhone || '',
        createdAt: suppliedQuote.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentVersion: suppliedQuote.currentVersion || 1,
        paymentStatus: suppliedQuote.paymentStatus || 'unpaid',
        versions: suppliedQuote.versions && suppliedQuote.versions.length > 0 ? suppliedQuote.versions : [
          {
            versionNumber: 1,
            createdAt: new Date().toISOString(),
            customerRequestSummary: activeVer.customerRequestSummary || 'Initial estimate request',
            items: activeVer.items || [],
            totalAmount: (activeVer.items || []).reduce((acc: number, i: any) => acc + (i.quantity * i.unitPrice), 0),
            notes: activeVer.notes || '',
            status: 'pending_review'
          }
        ]
      };
      setQuotes(prev => [fallbackQuote, ...prev]);
      setActiveQuoteId(fallbackQuote.id);
      return fallbackQuote;
    }
  };
 
  const handleRefreshQuote = async (quoteId: string): Promise<Quote> => {
    if (backendStatus !== 'connected') {
      throw new Error('Backend not connected');
    }
    const fetched = await apiFetchQuotes();
    setQuotes(fetched || []);
    const found = fetched.find(q => q.id === quoteId);
    if (!found) {
      throw new Error('Quote not found on server refresh');
    }
    return found;
  };
 
  const handleUpdatePrices = async (newPrices: PriceItem[]) => {
    setInlineError(null);
    if (backendStatus === 'connected') {
      try {
        const updated = await apiUpdatePrices(newPrices);
        setPrices(updated);
      } catch (e: any) {
        setInlineError(`Failed to update price catalog on server: ${e.message}`);
      }
    } else {
      setPrices(newPrices);
    }
  };
 
  const handleResetData = () => {
    if (window.confirm('Reset all quotes and catalog items to initial sample state?')) {
      setQuotes(INITIAL_QUOTES);
      setPrices(INITIAL_PRICES);
      setSettings(INITIAL_SETTINGS);
      setActiveQuoteId(INITIAL_QUOTES[0]?.id || '');
      localStorage.removeItem(STORAGE_KEY_QUOTES);
      localStorage.removeItem(STORAGE_KEY_PRICES);
      localStorage.removeItem(STORAGE_KEY_SETTINGS);
    }
  };
 
  const handleOpenCustomerViewForQuote = (quoteId: string) => {
    setActiveQuoteId(quoteId);
    setViewMode('customer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
 
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans text-stone-900 selection:bg-amber-700 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenPrices={() => setIsPricesOpen(true)}
        onResetData={handleResetData}
      />
 
      {/* Backend Status Banner if disconnected or checking */}
      {backendStatus === 'disconnected' && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-xs font-semibold text-center flex items-center justify-center gap-2 shadow-inner">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Demo preview: payments unavailable</span>
        </div>
      )}
 
      {inlineError && (
        <div className="bg-rose-500 text-white px-4 py-2 text-xs font-semibold text-center flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{inlineError}</span>
          <button onClick={() => setInlineError(null)} className="underline ml-2 hover:opacity-80">Dismiss</button>
        </div>
      )}
 
      {/* Main Content Area */}
      <main className="flex-1">
        {viewMode === 'owner' ? (
          <OwnerDashboard
            quotes={quotes}
            prices={prices}
            onUpdateQuote={handleUpdateQuote}
            onCreateQuote={handleCreateQuote}
            onOpenCustomerViewForQuote={handleOpenCustomerViewForQuote}
          />
        ) : (
          <CustomerPortal
            quotes={quotes}
            settings={settings}
            prices={prices}
            onUpdateQuote={handleUpdateQuote}
            onRefreshQuote={handleRefreshQuote}
            activeQuoteId={activeQuoteId}
            backendConnected={backendStatus === 'connected'}
          />
        )}
      </main>
 
      {/* Modals */}
      {isSettingsOpen && (
        <PayPalSettingsModal
          settings={settings}
          onUpdateSettings={setSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
 
      {isPricesOpen && (
        <PriceCatalogModal
          prices={prices}
          onUpdatePrices={handleUpdatePrices}
          onClose={() => setIsPricesOpen(false)}
        />
      )}
 
      {/* Footer */}
      <footer className="bg-stone-900 text-stone-400 py-6 border-t border-stone-800 text-xs mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-stone-200">ClearQuote</span>
            <span>— Natural Language Custom Furniture Quoting & Durable Node API</span>
          </div>
          <div className="flex items-center gap-4">
            <span>{backendStatus === 'connected' ? 'Durable Node Backend Active' : 'Demo preview: payments unavailable'}</span>
            <span className={`px-2.5 py-1 rounded font-mono font-medium ${backendStatus === 'connected' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
              {backendStatus === 'connected' ? 'API Connected' : 'Demo Mode'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
 
export default App;
 
