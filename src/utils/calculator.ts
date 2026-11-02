import type { PriceItem, QuoteItem } from '../types';
import { moneyToCents } from './currency.ts';
 
export interface ExtractionResult {
  dimensions: string; // e.g. '48-inch Compact Desk', '60-inch Standard Desk', or '' if unresolved
  material: string;   // e.g. 'White Oak Hardwood (Solid)', 'Black Walnut Upgrade', or '' if unresolved
  drawers: number;    // 0 to 6
  includeDelivery: boolean;
  isUncertain: boolean;
  uncertainWarning: string;
}
 
export function parseNaturalLanguagePrompt(prompt: string, prices: PriceItem[]): ExtractionResult {
  const lower = prompt.toLowerCase();
 
  // Dimensions
  let dimensions = '';
  const has48 = lower.includes('48') || lower.includes('compact') || lower.includes('smaller') || lower.includes('48-inch') || lower.includes('48 inch');
  const has60 = lower.includes('60') || lower.includes('standard') || lower.includes('60-inch') || lower.includes('60 inch');
  
  // Check for unsupported dimensions like 72
  const hasUnsupportedSize = lower.includes('72') || lower.includes('72-inch') || lower.includes('72 inch') || lower.includes('84') || lower.includes('36');
  if (hasUnsupportedSize) {
    dimensions = ''; // unresolved
  } else if (has48 && !has60) {
    dimensions = '48-inch Compact Desk';
  } else if (has60 && !has48) {
    dimensions = '60-inch Standard Desk';
  } else {
    dimensions = '';
  }
 
  // Material
  let material = '';
  const isWalnut = lower.includes('walnut') || lower.includes('black walnut');
  const isOak = lower.includes('oak') || lower.includes('white oak');
  const isMaple = lower.includes('maple');
 
  if (isMaple) {
    material = ''; // unsupported -> unresolved
  } else if (isWalnut) {
    const walnutItem = prices.find(p => p.name.toLowerCase().includes('walnut') && p.category === 'material');
    material = walnutItem ? walnutItem.name : 'Black Walnut Upgrade';
  } else if (isOak) {
    const oakItem = prices.find(p => p.name.toLowerCase().includes('oak') && p.category === 'material');
    material = oakItem ? oakItem.name : 'White Oak Hardwood (Solid)';
  } else {
    material = ''; // Unresolved if not mentioned
  }
 
  // Drawers (0..6 using escape-free word/number parser)
  const drawerWords: Record<string,number> = {zero:0,no:0,one:1,single:1,two:2,three:3,four:4,five:5,six:6};
  const drawerMatch = lower.match(/(?:^|[^a-z0-9.,+/-])(zero|no|one|single|two|three|four|five|six|[0-9]+)[ ]*drawers?(?:$|[^a-z])/i);
  let drawers = lower.includes('drawer') ? -1 : 2;
  if (drawerMatch) {
    const token = drawerMatch[1];
    const value = Object.prototype.hasOwnProperty.call(drawerWords,token) ? drawerWords[token] : Number(token);
    drawers = Number.isInteger(value) && value >= 0 && value <= 6 ? value : -1;
  }
 
  // Delivery
  const isPickup = lower.includes('no delivery') || lower.includes('pickup') || lower.includes('pick up') || lower.includes('leave delivery out') || lower.includes('without delivery') || lower.includes('exclude delivery');
  const isDeliveryRequested = lower.includes('delivery') || lower.includes('white glove') || lower.includes('deliver');
  
  let includeDelivery: boolean | null = null;
  if (isPickup) {
    includeDelivery = false;
  } else if (isDeliveryRequested) {
    includeDelivery = true;
  }
 
  const isUncertain = !dimensions || !material || drawers < 0 || (hasUnsupportedSize && !!prompt);
  const uncertainWarning = isUncertain ? 'Please specify valid dimensions (48-inch or 60-inch) and supported material (White Oak or Black Walnut with 0-6 drawers).' : '';
 
  return {
    dimensions,
    material,
    drawers,
    includeDelivery: includeDelivery !== null ? includeDelivery : false,
    isUncertain,
    uncertainWarning
  };
}
 
export function calculateQuoteItems(
  prices: PriceItem[], dimensions: string, material: string, drawers: number, includeDelivery: boolean
): { items: QuoteItem[]; totalAmount: number; notes: string; isUncertain: boolean } {
  const unresolved = (notes: string) => ({ items: [], totalAmount: 0, notes, isUncertain: true });
  if (!['48-inch Compact Desk', '60-inch Standard Desk'].includes(dimensions)) return unresolved('Choose a supported desk size.');
  if (!Number.isInteger(drawers) || drawers < 0 || drawers > 6) return unresolved('Enter a whole number of drawers from 0 to 6.');
  const materialItem = prices.find(item => item.name === material && item.category === 'material');
  if (!materialItem) return unresolved('Choose a material available in the catalog.');
  const base = moneyToCents(materialItem.basePrice);
  if (base === null || (dimensions.startsWith('48') && base < 10000)) return unresolved('The material price needs review in the catalog.');
  const items: QuoteItem[] = [{ id: 'i-mat-1', name: material, quantity: 1,
    unitPrice: (base - (dimensions.startsWith('48') ? 10000 : 0)) / 100, category: 'material', notes: dimensions }];
  const addCatalogItem = (item: PriceItem | undefined, quantity: number, id: string, notes: string) => {
    if (!item) return false;
    const cents = moneyToCents(item.basePrice);
    if (cents === null) return false;
    items.push({ id, name: item.name, quantity, unitPrice: cents / 100, category: item.category, notes });
    return true;
  };
  if (drawers > 0 && !addCatalogItem(prices.find(item => item.category === 'hardware'), drawers, 'i-draw-1', `${drawers} custom dovetail drawer(s) with soft-close`)) return unresolved('The drawer hardware price is missing or invalid.');
  if (!addCatalogItem(prices.find(item => item.category === 'labor'), 1, 'i-finish-1', 'Protective natural oil finish')) return unresolved('The finish labor price is missing or invalid.');
  if (includeDelivery && !addCatalogItem(prices.find(item => item.category === 'shipping' && item.name.includes('White Glove')), 1, 'i-ship-1', 'White glove delivery & setup')) return unresolved('The delivery price is missing or invalid.');
  const totalCents = items.reduce((sum, item) => sum + moneyToCents(item.unitPrice)! * item.quantity, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return unresolved('The quote total needs review in the catalog.');
  return { items, totalAmount: totalCents / 100, isUncertain: false,
    notes: `Configured ${dimensions}; ${material}; ${drawers} drawer(s). ${includeDelivery ? 'Includes white glove delivery & setup.' : 'Workshop pickup (delivery fee excluded).'}` };
}
