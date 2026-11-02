export interface DemoConnection { origin: string; access: string }
const storageKey = 'clearquote_demo_connection';

export function parseDemoConnection(value: unknown): DemoConnection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.origin !== 'string' || typeof candidate.access !== 'string' || !/^[A-Za-z0-9_-]{40,}$/.test(candidate.access)) return null;
  try {
    const url = new URL(candidate.origin);
    if (url.protocol !== 'https:' || url.origin !== candidate.origin || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) || url.hostname === 'api.trycloudflare.com') return null;
    return { origin: url.origin, access: candidate.access };
  } catch { return null; }
}

export function readDemoConnection(): DemoConnection | null {
  if (typeof window === 'undefined') return null;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const supplied = fragment.has('clearquote_api') || fragment.has('clearquote_access');
  if (supplied) {
    const connection = parseDemoConnection({origin:fragment.get('clearquote_api'),access:fragment.get('clearquote_access')});
    // A URL fragment is never sent to the hosting service or in a Referer header. Remove it before rendering.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      if (connection) window.sessionStorage.setItem(storageKey, JSON.stringify(connection));
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* The current page can still use its in-memory connection. */ }
    return connection;
  }
  try { return parseDemoConnection(JSON.parse(window.sessionStorage.getItem(storageKey) || 'null')); }
  catch { return null; }
}

export function createApiFetch(connection: DemoConnection | null, transport: typeof fetch = fetch) {
  return (path: string, options: RequestInit = {}) => {
    if (!path.startsWith('/api/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid application API path');
    if (!connection) return transport(path, options);
    const headers = new Headers(options.headers);
    // App-user AI authentication is managed separately and is never sent to the payment server.
    headers.delete('Authorization');
    headers.set('X-ClearQuote-Access', connection.access);
    return transport(connection.origin + path, {...options,headers,credentials:'omit',referrerPolicy:'no-referrer'});
  };
}
