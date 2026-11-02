import type { PriceItem, QuoteItem } from '../types';
 
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
  const drawerMatch = lower.match(/(?:^|[^a-z0-9])(zero|no|one|single|two|three|four|five|six|[0-9]+)[ ]*drawers?(?:$|[^a-z])/i);
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
    includeDelivery: includeDelivery !== null ? includeDelivery : true,
    isUncertain,
    uncertainWarning
  };
}
 
export function calculateQuoteItems(
  prices: PriceItem[],
  dimensions: string,
  material: string,
  drawers: number,
  includeDelivery: boolean
): { items: QuoteItem[]; totalAmount: number; notes: string; isUncertain: boolean } {
  const items: QuoteItem[] = [];
  const is48 = dimensions.includes('48');
 
  // Validate drawers 0..6
  const validDrawers = Number.isInteger(drawers) && Number.isFinite(drawers) && drawers >= 0 && drawers <= 6 ? drawers : -1;
  const matPriceItem = prices.find(p => p.name === material && p.category === 'material');
 
  // Missing applicable catalog entries or unsupported dimensions/material must make draft unresolved
  const isSupportedDim = dimensions === '48-inch Compact Desk' || dimensions === '60-inch Standard Desk';
  const isSupportedMat = !!matPriceItem;
  const isUncertain = !isSupportedDim || !isSupportedMat || validDrawers < 0;
 
  if (isUncertain) {
    return { items: [], totalAmount: 0, notes: 'Unresolved or unsupported configuration.', isUncertain: true };
  }
 
  let baseMatPrice = matPriceItem!.basePrice;
  if (is48) {
    // Documented compact adjustment 100 below current standard catalog base
    baseMatPrice = baseMatPrice - 100;
  }
 
  items.push({
    id: 'i-mat-1',
    name: material,
    quantity: 1,
    unitPrice: baseMatPrice,
    category: 'material',
    notes: dimensions
  });
 
  if (validDrawers > 0) {
    const drawerItem = prices.find(p => p.category === 'hardware');
    if (!drawerItem) {
      return { items: [], totalAmount: 0, notes: 'Missing hardware catalog entry.', isUncertain: true };
    }
    items.push({
      id: 'i-draw-1',
      name: drawerItem.name,
      quantity: validDrawers,
      unitPrice: drawerItem.basePrice,
      category: 'hardware',
      notes: `${validDrawers} custom dovetail drawer(s) with soft-close`
    });
  }
 
  const laborItem = prices.find(p => p.category === 'labor');
  if (!laborItem) {
    return { items: [], totalAmount: 0, notes: 'Missing labor catalog entry.', isUncertain: true };
  }
  items.push({
    id: 'i-finish-1',
    name: laborItem.name,
    quantity: 1,
    unitPrice: laborItem.basePrice,
    category: 'labor',
    notes: 'Protective natural oil finish'
  });
 
  if (includeDelivery) {
    const shipItem = prices.find(p => p.category === 'shipping' && p.name.includes('White Glove'));
    if (!shipItem) {
      return { items: [], totalAmount: 0, notes: 'Missing shipping catalog entry.', isUncertain: true };
    }
    items.push({
      id: 'i-ship-1',
      name: shipItem.name,
      quantity: 1,
      unitPrice: shipItem.basePrice,
      category: 'shipping',
      notes: 'White glove delivery & setup'
    });
  }
 
  const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  
  let notes = `Configured ${dimensions}; ${material}; ${validDrawers} drawer(s). `;
  if (includeDelivery) {
    notes += 'Includes white glove delivery & setup.';
  } else {
    notes += 'Workshop pickup (delivery fee excluded).';
  }
 
  return { items, totalAmount, notes, isUncertain: false };
}
 
