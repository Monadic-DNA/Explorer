import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { BillingError, required, type Store, type VerifiedPurchase } from './catalog';
import { verifyStorePurchase } from './verification';
import { PAID_REPORT_TYPES, type PaidReportType } from '../report-access';

export function mobileBillingEnabled() { return process.env.MOBILE_BILLING_ENABLED === 'true'; }
export function tokenKey() {
  const key = Buffer.from(required('MOBILE_BILLING_TOKEN_KEY'), 'base64');
  if (key.length !== 32) throw new BillingError('Invalid billing storage configuration', 503);
  return key;
}
function encrypt(proof: string, accountId: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  cipher.setAAD(Buffer.from(accountId));
  const ciphertext = Buffer.concat([cipher.update(proof, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
function decrypt(proof: string, accountId: string) {
  const bytes = Buffer.from(proof, 'base64'), cipher = createDecipheriv('aes-256-gcm', tokenKey(), bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(accountId)); cipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
export async function billingAccount(wallet: string): Promise<string> {
  const result = await getDb().query<{id:string}>(`INSERT INTO mobile_billing_accounts(id,wallet) VALUES($1,$2)
    ON CONFLICT(wallet) DO UPDATE SET wallet=EXCLUDED.wallet RETURNING id`, [randomUUID(), wallet.toLowerCase()]);
  return result.rows[0].id;
}
export async function recordPurchase(purchase: VerifiedPurchase) {
  const result = await getDb().query(`INSERT INTO mobile_store_purchases(store,purchase_id,account_id,product_id,kind,report_type,proof,valid_until,revoked)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(store,purchase_id) DO UPDATE SET product_id=EXCLUDED.product_id, proof=EXCLUDED.proof,
      valid_until=EXCLUDED.valid_until, revoked=EXCLUDED.revoked, verified_at=now()
    WHERE mobile_store_purchases.account_id=EXCLUDED.account_id AND mobile_store_purchases.kind=EXCLUDED.kind
    RETURNING purchase_id`, [purchase.store,purchase.purchaseId,purchase.accountId,purchase.productId,purchase.kind,purchase.reportType ?? null,encrypt(purchase.proof,purchase.accountId),purchase.validUntil,purchase.revoked]);
  if (!result.rowCount) throw new BillingError('Purchase is already bound to another account', 409);
}
interface Row { store: Store; purchase_id: string; account_id: string; product_id: string; proof: string }
export async function refreshPurchases(wallet: string) {
  const result = await getDb().query<Row>(`SELECT p.* FROM mobile_store_purchases p JOIN mobile_billing_accounts a ON a.id=p.account_id
    WHERE a.wallet=$1 AND ((p.kind='subscription' AND (NOT p.revoked OR p.valid_until IS NOT NULL)) OR (p.kind='consumable' AND p.consumed_at IS NULL AND NOT p.revoked))`, [wallet.toLowerCase()]);
  // Every access rechecks current store state. No entitlement is based on a client flag or stale receipt expiry.
  for (const row of result.rows) {
    try { await recordPurchase(await verifyStorePurchase(row.store,decrypt(row.proof,row.account_id),row.product_id,row.account_id)); }
    catch (error) {
      if (!(error instanceof BillingError) || error.status !== 410) throw error;
      // Stores stop serving old purchase tokens. Retire only a definitive 404/410; network failures never become grants.
      await getDb().query('UPDATE mobile_store_purchases SET revoked=true,valid_until=NULL,verified_at=now() WHERE store=$1 AND purchase_id=$2',[row.store,row.purchase_id]);
    }
  }
}
export async function mobileEntitlements(wallet: string, refresh = true) {
  const availableReports = Object.fromEntries(PAID_REPORT_TYPES.map(type => [type,0])) as Record<PaidReportType, number>;
  if (!mobileBillingEnabled()) return { isActive:false, expiresAt:null as Date | null, availableReports };
  if (refresh) await refreshPurchases(wallet);
  const result = await getDb().query<{kind:string;report_type:PaidReportType;valid_until:Date|null}>(`SELECT kind,report_type,valid_until FROM mobile_store_purchases p
    JOIN mobile_billing_accounts a ON a.id=p.account_id WHERE a.wallet=$1 AND NOT revoked
    AND ((kind='subscription' AND valid_until>now()) OR (kind='consumable' AND consumed_at IS NULL))`, [wallet.toLowerCase()]);
  let expiresAt: Date | null = null;
  for (const row of result.rows) {
    if (row.kind === 'consumable') availableReports[row.report_type]++;
    else if (row.valid_until && (!expiresAt || row.valid_until > expiresAt)) expiresAt = row.valid_until;
  }
  return { isActive:expiresAt !== null, expiresAt, availableReports };
}
export async function consumeMobileReport(wallet: string, reportType: PaidReportType): Promise<boolean> {
  if (!mobileBillingEnabled()) return false;
  // Caller must have refreshed purchases and authenticated the wallet before entering this function.
  const result = await getDb().query(`UPDATE mobile_store_purchases SET consumed_at=now() WHERE (store,purchase_id)=(
    SELECT p.store,p.purchase_id FROM mobile_store_purchases p JOIN mobile_billing_accounts a ON a.id=p.account_id
    WHERE a.wallet=$1 AND p.kind='consumable' AND p.report_type=$2 AND NOT p.revoked AND p.consumed_at IS NULL
    ORDER BY p.created_at FOR UPDATE OF p SKIP LOCKED LIMIT 1) RETURNING purchase_id`, [wallet.toLowerCase(),reportType]);
  return !!result.rowCount;
}
