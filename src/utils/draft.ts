import type { PriceItem } from '../types';
import { calculateQuoteItems } from './calculator.ts';

interface DraftConfiguration {
  dimensions: string;
  material: string;
  drawers: number;
  includeDelivery: boolean;
  source?: string;
}

export function parseDrawerInput(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

export function calculateDraft<T extends DraftConfiguration>(prices: PriceItem[], draft: T) {
  const result = calculateQuoteItems(prices, draft.dimensions, draft.material, draft.drawers, draft.includeDelivery);
  return {
    ...draft,
    ...result,
    uncertainWarning: result.isUncertain ? result.notes : '',
    notes: result.isUncertain ? result.notes : `${result.notes}${draft.source ? ` Draft prepared with ${draft.source}; prices from catalog.` : ''}`,
  };
}

export function canConfirmDraft(draft: { isUncertain: boolean; totalAmount: number }): boolean {
  return !draft.isUncertain && Number.isFinite(draft.totalAmount) && draft.totalAmount > 0;
}
