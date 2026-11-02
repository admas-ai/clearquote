import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { aiIdentity, sendAiEmail, verifyAiEmail, signOutAi } from '../services/admasAi';

export function AiConnection() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    aiIdentity().then(state => { if (mounted) { setConfigured(state.configured); setAccount(state.email); } })
      .catch(() => { if (mounted) setError('AI configuration is unavailable.'); });
    return () => { mounted = false; };
  }, []);
  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await operation(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  const close = () => { setOpen(false); setConfirmation(''); };
  return <>
    <button type="button" onClick={() => setOpen(true)} className="cq-toolbar-button"><span className={`cq-status-dot${account ? ' is-ready' : ''}`} />{account ? 'AI account' : 'AI sign-in'}</button>
    {open && <Dialog title="ClearQuote AI" description="AI prepares the specification. You review the estimate." onClose={close} busy={busy}>
      <div className="space-y-4">
        {!configured ? <p className="text-sm text-slate-500">Email sign-in is not configured in this build. Quote drafts use the available server or local helper.</p> : account ? <>
          <div className="cq-message">Signed in as <strong>{account}</strong>. Every AI draft still needs your review.</div>
          <button type="button" className="cq-secondary" disabled={busy} onClick={() => act(async () => { await signOutAi(); setAccount(null); setSentTo(''); setConfirmation(''); })}>Sign out of AI</button>
        </> : <>
          <p className="text-xs text-slate-500 leading-relaxed">Sign in with email to use AdmasLLM. Your first sign-in creates a ClearQuote app account.</p>
          <form onSubmit={event => { event.preventDefault(); void act(async () => { await sendAiEmail(email); setSentTo(email.trim()); setMessage('Check your inbox. Paste the sign-in link here without opening it, or enter the code if your email includes one.'); }); }} className="space-y-3">
            <label className="cq-field">Email<input data-autofocus aria-label="AI sign-in email" type="email" required value={email} onChange={event => { setEmail(event.target.value); setSentTo(''); }} autoComplete="email" /></label>
            <button type="submit" disabled={busy} className="cq-primary">Send sign-in email</button>
          </form>
          {sentTo && <form onSubmit={event => { event.preventDefault(); void act(async () => { try { await verifyAiEmail(sentTo, confirmation); const state = await aiIdentity(); setAccount(state.email); setMessage('Signed in. You can now request an AI quote draft.'); } finally { setConfirmation(''); } }); }} className="space-y-3">
            <label className="cq-field">Email link or code<input aria-label="AI email link or code" type="password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>
            <button type="submit" disabled={busy} className="cq-primary">Verify sign-in</button>
          </form>}
        </>}
        {message && <p role="status" className="text-xs text-emerald-700 leading-relaxed">{message}</p>}
        {error && <p role="alert" className="text-xs text-rose-700 leading-relaxed">{error}</p>}
        {busy && <p role="status" className="text-xs text-slate-500">Working…</p>}
      </div>
    </Dialog>}
  </>;
}
