import products from '../../shared/billing-catalog.json';
import type { PaidReportType } from '../report-access';

export type Store = 'apple' | 'google';
export type Product = { id: string; kind: 'subscription' | 'consumable'; reportType?: PaidReportType; title: string; description: string };
export const catalog = products as Product[];
export function productFor(id: string): Product {
  const product = catalog.find(item => item.id === id);
  if (!product) throw new BillingError('Unknown store product', 400);
  return product;
}
export class BillingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface VerifiedPurchase {
  store: Store;
  purchaseId: string;
  accountId: string;
  productId: string;
  kind: Product['kind'];
  reportType?: PaidReportType;
  validUntil: Date | null;
  revoked: boolean;
  proof: string;
}
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new BillingError('Store billing is not configured', 503);
  return value;
}
