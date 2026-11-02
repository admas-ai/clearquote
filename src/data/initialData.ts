import type { PriceItem, Quote, BusinessSettings } from '../types';
 
export const INITIAL_PRICES: PriceItem[] = [
  { id: 'p1', name: 'White Oak Hardwood (Solid)', category: 'material', basePrice: 650, description: 'Premium sustainable Appalachian white oak lumber' },
  { id: 'p2', name: 'Black Walnut Upgrade', category: 'material', basePrice: 850, description: 'Deep rich figured American black walnut' },
  { id: 'p3', name: 'Custom Dovetail Drawer (Per Drawer)', category: 'hardware', basePrice: 125, description: 'Hand-crafted dovetail joinery with soft-close undermount slides' },
  { id: 'p4', name: 'Hand-rubbed Danish Oil Finish', category: 'labor', basePrice: 150, description: '3-coat water and stain resistant natural oil finish' },
  { id: 'p5', name: 'White Glove Local Delivery & Setup', category: 'shipping', basePrice: 180, description: 'Two-person delivery, room placement, and packaging removal' },
  { id: 'p6', name: 'Standard Freight Shipping', category: 'shipping', basePrice: 95, description: 'Curbside pallet freight delivery' },
  { id: 'p7', name: 'Custom Brass Inlay / Hardware', category: 'addon', basePrice: 110, description: 'Solid brass pulls and custom geometric inlay' }
];
 
export const INITIAL_SETTINGS: BusinessSettings = {
  businessName: 'Oak & Iron Custom Woodworking',
  ownerName: 'Marcus Vance',
  email: 'marcus@oakandironwood.com',
  phone: '(555) 382-9400',
  address: '42 Artisan Way, Portland, OR',
  paypalClientId: '',
  paypalConnected: false,
  paypalMode: 'sandbox',
  aiModel: 'ClearQuote Rule-Based Natural Language Assistant (Local NLP Matching)'
};
 
export const INITIAL_QUOTES: Quote[] = [
  {
    id: 'q-qa-01',
    quoteNumber: 'CQ-2026-090',
    customerName: 'Alex Morgan',
    customerEmail: 'demo.qa@example.com',
    customerPhone: '(555) 321-7654',
    createdAt: '2026-10-22T09:00:00Z',
    updatedAt: '2026-10-22T09:00:00Z',
    currentVersion: 1,
    businessNotes: 'Customer requested 48-inch solid oak desk with two drawers and self-pickup (delivery excluded).',
    paymentStatus: 'unpaid',
    versions: [
      {
        versionNumber: 1,
        createdAt: '2026-10-22T09:00:00Z',
        customerRequestSummary: 'I need a 48-inch solid oak desk with two drawers. I will pick it up myself, so please leave delivery out.',
        items: [
          { id: 'i1', name: 'White Oak Hardwood (Solid)', quantity: 1, unitPrice: 550, category: 'material', notes: 'Compact 48" x 24" desk top' },
          { id: 'i2', name: 'Custom Dovetail Drawer (Per Drawer)', quantity: 2, unitPrice: 125, category: 'hardware', notes: 'Under-desk storage drawers' },
          { id: 'i3', name: 'Hand-rubbed Danish Oil Finish', quantity: 1, unitPrice: 150, category: 'labor', notes: 'Matte satin finish' }
        ],
        totalAmount: 950,
        notes: 'Itemized estimate reflecting 48-inch compact dimensions with customer workshop pickup (delivery fee excluded per request).',
        status: 'approved'
      }
    ]
  },
  {
    id: 'q-088',
    quoteNumber: 'CQ-2026-088',
    customerName: 'Sarah Jenkins',
    customerEmail: 'sarah.j@example.com',
    customerPhone: '(555) 234-5678',
    createdAt: '2026-10-21T10:30:00Z',
    updatedAt: '2026-10-22T04:15:00Z',
    currentVersion: 2,
    businessNotes: 'Customer requested revision from full desk with delivery down to smaller desk without delivery.',
    paymentStatus: 'unpaid',
    versions: [
      {
        versionNumber: 1,
        createdAt: '2026-10-21T10:30:00Z',
        customerRequestSummary: 'I need a solid oak desk with two drawers and delivery to my apartment downtown.',
        items: [
          { id: 'i1', name: 'White Oak Hardwood (Solid)', quantity: 1, unitPrice: 650, category: 'material', notes: 'Standard 60\" x 30\" desk top' },
          { id: 'i2', name: 'Custom Dovetail Drawer (Per Drawer)', quantity: 2, unitPrice: 125, category: 'hardware', notes: 'Under-desk storage drawers' },
          { id: 'i3', name: 'Hand-rubbed Danish Oil Finish', quantity: 1, unitPrice: 150, category: 'labor', notes: 'Matte satin finish' },
          { id: 'i4', name: 'White Glove Local Delivery & Setup', quantity: 1, unitPrice: 180, category: 'shipping', notes: 'Third-floor apartment setup' }
        ],
        totalAmount: 1280,
        notes: 'Initial estimate based on full custom size with 2 drawers and delivery.',
        status: 'superseded'
      },
      {
        versionNumber: 2,
        createdAt: '2026-10-22T04:15:00Z',
        customerRequestSummary: 'Actually, could we make the desk slightly smaller (48\" instead of 60\") and remove delivery since I will pick it up?',
        items: [
          { id: 'i1', name: 'White Oak Hardwood (Solid)', quantity: 1, unitPrice: 550, category: 'material', notes: 'Adjusted to compact 48\" x 24\" size' },
          { id: 'i2', name: 'Custom Dovetail Drawer (Per Drawer)', quantity: 2, unitPrice: 125, category: 'hardware', notes: 'Under-desk storage drawers' },
          { id: 'i3', name: 'Hand-rubbed Danish Oil Finish', quantity: 1, unitPrice: 150, category: 'labor', notes: 'Matte satin finish' }
        ],
        totalAmount: 950,
        notes: 'Revised quote reflecting 48\" compact desk dimensions and customer workshop pickup (delivery fee removed).',
        status: 'approved'
      }
    ]
  }
];
 
