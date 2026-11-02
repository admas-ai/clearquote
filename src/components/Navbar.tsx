import { FileCheck2, Settings, Tag, UserCheck, Wrench, RefreshCw } from 'lucide-react';
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

export function Navbar({ viewMode, setViewMode, settings, onOpenSettings, onOpenPrices, onResetData }: NavbarProps) {
  return <header className="cq-toolbar">
    <div className="cq-toolbar-inner">
      <div className="cq-brand"><span className="cq-brand-mark"><FileCheck2 size={23} /></span><div><strong>ClearQuote</strong><small>From request to payment</small></div></div>
      <nav className="cq-view-tabs" aria-label="Workspace view">
        <button type="button" aria-pressed={viewMode === 'owner'} onClick={() => setViewMode('owner')}><Wrench size={14} />Business workspace</button>
        <button type="button" aria-pressed={viewMode === 'customer'} onClick={() => setViewMode('customer')}><UserCheck size={15} />Customer portal</button>
      </nav>
      {viewMode === 'owner' ? <div className="cq-toolbar-actions">
        <AiConnection />
        <button type="button" onClick={onOpenSettings} className="cq-toolbar-button cq-optional-action" title="View PayPal Sandbox configuration">
          <span className={`cq-status-dot${settings.paypalConnected ? ' is-ready' : ''}`} />{settings.paypalConnected ? 'Sandbox configured' : 'Payment setup'}
        </button>
        <button type="button" onClick={onOpenPrices} className="cq-icon-button" aria-label="Price catalog" title="Price catalog"><Tag size={17} /></button>
        <button type="button" onClick={onOpenSettings} className="cq-icon-button" aria-label="Workspace settings" title="Workspace settings"><Settings size={17} /></button>
        <button type="button" onClick={onResetData} className="cq-icon-button cq-optional-action" aria-label="Reset sample workspace" title="Reset sample workspace"><RefreshCw size={16} /></button>
      </div> : <div className="cq-toolbar-actions"><span className="text-xs text-slate-500 flex items-center gap-2"><span className="cq-status-dot is-ready" />Sandbox workspace</span></div>}
    </div>
  </header>;
}
