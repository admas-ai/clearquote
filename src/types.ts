export interface PriceItem {
  id: string;
  name: string;
  category: 'material' | 'hardware' | 'labor' | 'shipping' | 'addon';
  basePrice: number;
  description: string;
}
 
export interface QuoteItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  category: 'material' | 'hardware' | 'labor' | 'shipping' | 'addon';
  notes?: string;
}
 
export interface QuoteVersion {
  versionNumber: number;
  createdAt: string;
  items: QuoteItem[];
  totalAmount: number;
  notes: string;
  status: 'draft' | 'pending_review' | 'sent_to_customer' | 'approved' | 'paid' | 'rejected' | 'superseded';
  customerRequestSummary: string;
}
 
export interface Quote {
  id: string;
  quoteNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  versions: QuoteVersion[];
  businessNotes?: string;
  paymentStatus: 'unpaid' | 'processing' | 'paid' | 'refunded';
  paymentId?: string;
  paidAt?: string;
}
 
export interface BusinessSettings {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  address: string;
  paypalClientId: string;
  paypalConnected: boolean;
  paypalMode: 'sandbox' | 'live';
  aiModel: string;
}
 
