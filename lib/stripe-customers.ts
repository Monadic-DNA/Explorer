/**
 * Stripe customer lookup by wallet address.
 *
 * Customers are found with customers.search, which can lag about a minute behind
 * creates and metadata updates. To keep a new wallet from getting a second customer
 * during that window, creates use a wallet-based idempotency key: for 24 hours Stripe
 * returns the same customer for every create with that key. After that, search has
 * long since indexed the customer.
 */

import Stripe from 'stripe';

export async function searchWalletCustomers(stripe: Stripe, walletAddress: string, limit = 100) {
  const result = await stripe.customers.search({
    query: `metadata['walletAddress']:'${walletAddress.toLowerCase()}'`,
    limit,
  });
  return result.data;
}

export async function createWalletCustomer(stripe: Stripe, walletAddress: string): Promise<Stripe.Customer> {
  const normalizedWallet = walletAddress.toLowerCase();
  // Params must be identical on every call, or Stripe rejects the reused idempotency key
  const params = { metadata: { walletAddress: normalizedWallet } };

  try {
    const created = await stripe.customers.create(params, { idempotencyKey: `customer:${normalizedWallet}` });
    // A replayed create returns the original response, so fetch current metadata by id
    const customer = await stripe.customers.retrieve(created.id);
    if (!customer.deleted) {
      return customer;
    }
    console.warn(`[Stripe] Idempotent customer ${created.id} was deleted; creating a new one`);
  } catch (error) {
    // Stripe also replays errors for the same key, so do not let one failure block the wallet for a day
    console.warn('[Stripe] Idempotent customer create failed; retrying without key:', error);
  }

  return stripe.customers.create(params);
}

export async function getOrCreateWalletCustomer(stripe: Stripe, walletAddress: string): Promise<Stripe.Customer> {
  const [existing] = await searchWalletCustomers(stripe, walletAddress, 1);
  return existing ?? createWalletCustomer(stripe, walletAddress);
}
