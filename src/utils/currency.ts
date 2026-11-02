const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(value: number): string {
  return Number.isFinite(value) ? usd.format(value) : '—';
}

export function moneyToCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 1e-7 ? cents : null;
}

export function itemTotal(items: Array<{ quantity: number; unitPrice: number }>): number | null {
  if (!items.length) return null;
  let total = 0;
  for (const item of items) {
    const cents = moneyToCents(item.unitPrice);
    if (cents === null || !Number.isSafeInteger(item.quantity) || item.quantity < 1) return null;
    total += cents * item.quantity;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total > 0 ? total / 100 : null;
}
