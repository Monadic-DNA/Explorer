/**
 * Centralized promo code access utilities
 * Ensures consistent validation across all components
 */

import { verifyPromoCode } from './prime-verification';

const PROMO_STORAGE_KEY = 'promo_access';

interface PromoAccessData {
  code: string;
  granted: number;
}

/**
 * Check if user has valid promo access
 * Re-verifies the stored code to prevent tampering
 */
export function hasValidPromoAccess(): boolean {
  if (typeof window === 'undefined') return false;

  const stored = localStorage.getItem(PROMO_STORAGE_KEY);
  if (!stored) return false;

  try {
    const data: PromoAccessData = JSON.parse(stored);

    // Must have a code
    if (!data.code) {
      localStorage.removeItem(PROMO_STORAGE_KEY);
      return false;
    }

    // Re-verify the code is actually valid
    const result = verifyPromoCode(data.code);

    if (!result.valid || result.discount !== 0) {
      // Code is no longer valid, remove it
      localStorage.removeItem(PROMO_STORAGE_KEY);
      return false;
    }

    return true;
  } catch (err) {
    // Invalid JSON or other error, clear storage
    localStorage.removeItem(PROMO_STORAGE_KEY);
    return false;
  }
}

/**
 * Get the stored promo code (if valid)
 * Returns null if no valid promo access
 */
export function getPromoCode(): string | null {
  if (!hasValidPromoAccess()) return null;

  try {
    const stored = localStorage.getItem(PROMO_STORAGE_KEY);
    if (!stored) return null;

    const data: PromoAccessData = JSON.parse(stored);
    return data.code || null;
  } catch {
    return null;
  }
}

/**
 * Store validated promo access
 */
export function setPromoAccess(code: string): void {
  const data: PromoAccessData = {
    code,
    granted: Date.now(),
  };
  localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify(data));
}

/**
 * Remove promo access
 */
export function clearPromoAccess(): void {
  localStorage.removeItem(PROMO_STORAGE_KEY);
}
