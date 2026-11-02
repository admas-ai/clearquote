import { useState } from 'react';
import type { FormEvent } from 'react';
import type { BusinessSettings } from '../types';
import { ShieldCheck } from 'lucide-react';
import { Dialog } from './Dialog';

interface PayPalSettingsModalProps {
  settings: BusinessSettings;
  onUpdateSettings: (settings: BusinessSettings) => void;
  onClose: () => void;
}

export function PayPalSettingsModal({ settings, onUpdateSettings, onClose }: PayPalSettingsModalProps) {
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!businessName.trim() || !ownerName.trim()) return;
    onUpdateSettings({...settings,businessName:businessName.trim(),ownerName:ownerName.trim()});
    onClose();
  };
  return <Dialog title="Workspace settings" description="Manage your display profile and check payment configuration." onClose={onClose} onSubmit={save}
    footer={<><button type="button" onClick={onClose} className="cq-secondary">Cancel</button><button type="submit" className="cq-primary">Save profile</button></>}>
    <div className="space-y-5">
      <label className="cq-field">Business name<input data-autofocus required maxLength={160} value={businessName} onChange={event => setBusinessName(event.target.value)} autoComplete="organization" /></label>
      <label className="cq-field">Contact name<input required maxLength={160} value={ownerName} onChange={event => setOwnerName(event.target.value)} autoComplete="name" /></label>
      <p className="text-xs text-slate-400">Display preferences are saved in this browser.</p>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} className={settings.paypalConnected ? 'text-emerald-600' : 'text-amber-600'} />PayPal Sandbox<span className="ml-auto text-xs font-medium text-slate-500">{settings.paypalConnected ? 'Configured' : 'Setup needed'}</span></div>
        <p className="text-xs text-slate-500 leading-relaxed mt-3">{settings.paypalConnected ? 'Server credentials are available. A completed Sandbox checkout verifies the payment connection.' : 'Run the supplied application server with the Sandbox credentials to enable checkout. Setup instructions are included with the project.'}</p>
        <p className="text-xs text-slate-500 leading-relaxed mt-2">Credentials stay on the server. This demo uses simulated funds.</p>
      </div>
    </div>
  </Dialog>;
}
