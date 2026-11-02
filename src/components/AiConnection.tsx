import { useEffect, useState } from 'react';
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
  return <>
    <button onClick={() => setOpen(true)} className="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs border border-slate-700">
      {account ? 'AI account' : 'AI sign-in'}
    </button>
    {open && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ai-signin-title">
      <div className="bg-white text-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center"><h2 id="ai-signin-title" className="font-bold text-xl">ClearQuote AI</h2><button aria-label="Close AI sign-in" onClick={() => { setOpen(false); setConfirmation(''); }} disabled={busy}>Close</button></div>
        {!configured ? <p>AI configuration is not ready. You can continue with the local quote helper.</p> : account ? <>
          <p>Signed in as {account}. AI drafts still need your review.</p>
          <button className="rounded-lg px-4 py-2 bg-slate-900 text-white" disabled={busy} onClick={() => act(async () => { await signOutAi(); setAccount(null); setSentTo(''); setConfirmation(''); })}>Sign out of AI</button>
        </> : <>
          <p className="text-sm text-slate-600">Sign in with email to use AdmasLLM. Your first sign-in creates a ClearQuote app account.</p>
          <form onSubmit={event => { event.preventDefault(); void act(async () => { await sendAiEmail(email); setSentTo(email.trim()); setMessage('Check your inbox. Paste the sign-in link here without opening it, or enter the code if your email includes one.'); }); }} className="space-y-3">
            <label className="block text-sm">Email<input aria-label="AI sign-in email" type="email" required value={email} onChange={event => { setEmail(event.target.value); setSentTo(''); }} autoComplete="email" className="mt-1 block w-full border rounded-lg p-2" /></label>
            <button type="submit" disabled={busy} className="bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Send sign-in email</button>
          </form>
          {sentTo && <form onSubmit={event => { event.preventDefault(); void act(async () => { try { await verifyAiEmail(sentTo, confirmation); const state = await aiIdentity(); setAccount(state.email); setMessage('Signed in. You can now request an AI quote draft.'); } finally { setConfirmation(''); } }); }} className="space-y-3">
            <label className="block text-sm">Email link or code<input aria-label="AI email link or code" type="password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" className="mt-1 block w-full border rounded-lg p-2" /></label>
            <button type="submit" disabled={busy} className="bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Verify sign-in</button>
          </form>}
        </>}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {busy && <p role="status" className="text-sm">Working…</p>}
      </div>
    </div>}
  </>;
}
