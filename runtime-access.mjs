import { timingSafeEqual } from 'node:crypto';

function same(a, b) {
  const left = Buffer.from(a || ''); const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createRequestGuard({ publicOrigin = '', accessToken = '', appOrigin = '' } = {}) {
  if (publicOrigin) {
    const value = new URL(publicOrigin);
    if (value.protocol !== 'https:' || value.origin !== publicOrigin || value.username || value.password) throw new Error('PUBLIC_ORIGIN must be one exact HTTPS origin');
    if (!/^[A-Za-z0-9_-]{40,}$/.test(accessToken)) throw new Error('A private demo access token is required with PUBLIC_ORIGIN');
  }
  if (appOrigin) {
    const value = new URL(appOrigin);
    if (!publicOrigin || value.protocol !== 'https:' || value.origin !== appOrigin || value.username || value.password) throw new Error('DEMO_APP_ORIGIN requires a public demo and one exact HTTPS origin');
  }
  return (req, res) => {
    const fail = message => { res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: message })); return false; };
    const host = req.headers.host || '';
    let parsed;
    try { parsed = new URL('http://' + host); } catch {}
    if (!parsed || parsed.host !== host.toLowerCase() || parsed.username || parsed.password || parsed.pathname !== '/' ||
        parsed.search || parsed.hash || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || Number(parsed.port || 80) !== req.socket.localPort) return fail('Forbidden host or port');
    const localOrigin = `http://${host}`;
    const url = new URL(req.url, localOrigin);
    // The approved frontend sends only the run-scoped demo token. PayPal and AI credentials never cross this boundary.
    if (appOrigin && req.headers.origin === appOrigin && url.pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', appOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') {
        const headers = (req.headers['access-control-request-headers'] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!['GET','POST','PUT'].includes(req.headers['access-control-request-method']) || headers.some(name => !['content-type','x-clearquote-access','accept'].includes(name))) return fail('Unsupported demo preflight');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ClearQuote-Access');
        res.writeHead(204); res.end(); return false;
      }
      if (!same(req.headers['x-clearquote-access'], accessToken)) return fail('Private demo access required');
      return true;
    }
    if (req.headers.origin && req.headers.origin !== localOrigin && req.headers.origin !== publicOrigin) return fail('Cross-origin request rejected');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (accessToken) {
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/__clearquote_access' && req.method === 'GET') {
        if (!same(url.searchParams.get('key'), accessToken)) return fail('Private demo access required');
        res.writeHead(303, { Location: '/', 'Set-Cookie': `cq_demo_access=${accessToken}; HttpOnly; SameSite=Lax; Path=/${publicOrigin ? '; Secure' : ''}` });
        res.end(); return false;
      }
      const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('cq_demo_access='));
      if (!same(cookie?.slice('cq_demo_access='.length), accessToken)) return fail('Open ClearQuote from the launcher to access this private demo');
    }
    return true;
  };
}
