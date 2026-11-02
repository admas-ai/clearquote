export interface FurnitureExtraction {
  dimensions: '48-inch Compact Desk' | '60-inch Standard Desk' | null;
  material: 'White Oak Hardwood (Solid)' | 'Black Walnut Upgrade' | null;
  drawers: number;
  includeDelivery: boolean;
  notes: string;
}

export function validateExtraction(raw: unknown): FurnitureExtraction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AI returned an invalid draft.');
  const value = raw as Record<string, unknown>;
  const keys = ['dimensions', 'material', 'drawers', 'includeDelivery', 'notes'].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, i) => key !== keys[i]) ||
      ![null, '48-inch Compact Desk', '60-inch Standard Desk'].includes(value.dimensions as string | null) ||
      ![null, 'White Oak Hardwood (Solid)', 'Black Walnut Upgrade'].includes(value.material as string | null) ||
      typeof value.drawers !== 'number' || !Number.isInteger(value.drawers) || value.drawers < 0 || value.drawers > 6 ||
      typeof value.includeDelivery !== 'boolean' || typeof value.notes !== 'string' || value.notes.length > 4000) {
    throw new Error('AI draft failed validation. Review the request with the local helper.');
  }
  return value as unknown as FurnitureExtraction;
}

export function parseExtraction(text: string): FurnitureExtraction {
  if (typeof text !== 'string' || text.length > 16000) throw new Error('AI returned an invalid draft.');
  return validateExtraction(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
}

export function tokenNeedsRefresh(token: string, now = Date.now()): boolean {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized));
    return !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) ||
      claims.iat * 1000 > now + 30000 || now - claims.iat * 1000 >= 12 * 60 * 1000 || claims.exp * 1000 <= now + 30000;
  } catch { return true; }
}

export function inferenceHeaders(accessToken: string, routingKey: string, requestId: string) {
  if (tokenNeedsRefresh(accessToken)) throw new Error('Refresh your AI sign-in and try again.');
  if (!/^admas_pk_[a-f0-9]{64}$/.test(routingKey) || accessToken === routingKey) throw new Error('AI configuration is invalid.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`,
    'x-admas-project-key': routingKey, 'Idempotency-Key': requestId };
}
