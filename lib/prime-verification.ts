/**
 * Prime number verification for discount codes
 * Uses Miller-Rabin primality test for fast verification
 */

/**
 * Modular exponentiation (a^b mod m)
 * Used in Miller-Rabin primality test
 */
function modPow(base: number, exp: number, mod: number): number {
  if (mod === 1) return 0;
  let result = 1;
  base = base % mod;
  while (exp > 0) {
    if (exp % 2 === 1) {
      result = (result * base) % mod;
    }
    exp = Math.floor(exp / 2);
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Miller-Rabin primality test
 * Deterministic for n < 3,317,044,064,679,887,385,961,981
 */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2 || n === 3) return true;
  if (n % 2 === 0) return false;
  if (n < 9) return true;

  // Small prime divisibility check (optimization)
  const smallPrimes = [3, 5, 7, 11, 13, 17, 19, 23, 29];
  for (const p of smallPrimes) {
    if (n % p === 0) return n === p;
  }

  // Write n-1 as d * 2^r
  let r = 0, d = n - 1;
  while (d % 2 === 0) {
    d /= 2;
    r++;
  }

  // Witnesses to test (deterministic for our range)
  const witnesses = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

  witnessLoop: for (const a of witnesses) {
    if (a >= n) continue;

    let x = modPow(a, d, n);
    if (x === 1 || x === n - 1) continue;

    for (let i = 0; i < r - 1; i++) {
      x = modPow(x, 2, n);
      if (x === n - 1) continue witnessLoop;
    }

    return false;
  }
  return true;
}

/**
 * Check if a number is a delicate prime
 * A delicate prime is a prime where changing any single digit makes it composite
 *
 * Known delicate primes: 294001, 505447, 584141, 604171, 971767, 1062599, ...
 * See: https://oeis.org/A050998
 */
export function isDelicatePrime(n: number): boolean {
  // First check if n itself is prime
  if (!isPrime(n)) return false;

  const str = n.toString();
  const digits = str.split('');

  // For each digit position
  for (let i = 0; i < digits.length; i++) {
    const originalDigit = digits[i];

    // Try replacing with each digit 0-9 (except the original)
    for (let d = 0; d <= 9; d++) {
      const newDigit = d.toString();
      if (newDigit === originalDigit) continue;

      digits[i] = newDigit;
      const modifiedStr = digits.join('');
      const modified = parseInt(modifiedStr);

      // Skip if leading zero created invalid number
      if (modifiedStr.length !== str.length) {
        digits[i] = originalDigit;
        continue;
      }

      // If ANY modification is prime, then N is not a delicate prime
      if (isPrime(modified)) {
        return false;
      }

      digits[i] = originalDigit;
    }
  }

  return true;
}

/**
 * Verify a promo code and return discount multiplier
 * Currently supports delicate primes for free access
 * Can be extended to support other prime categories for different tiers
 */
export function verifyPromoCode(code: string): { valid: boolean; discount: number; message: string } {
  const trimmed = code.trim();

  // Must be a valid number
  const num = parseInt(trimmed);
  if (isNaN(num) || num.toString() !== trimmed) {
    return { valid: false, discount: 1.0, message: 'Invalid code format' };
  }

  // Must be positive and reasonable size
  if (num < 1 || num > 999999999) {
    return { valid: false, discount: 1.0, message: 'Code out of valid range' };
  }

  // Check if it's a delicate prime (grants free access)
  if (isDelicatePrime(num)) {
    return {
      valid: true,
      discount: 0, // 0 = free (100% discount)
      message: '🎉 Valid promo code! Free access granted.'
    };
  }

  // Future: Add other prime categories here
  // if (isBalancedPrime(num)) return { valid: true, discount: 0.5, message: '50% off with balanced prime!' };
  // if (isSafePrime(num)) return { valid: true, discount: 0.25, message: '25% off with safe prime!' };

  return { valid: false, discount: 1.0, message: 'Not a valid promo code' };
}

/**
 * Get list of known delicate primes for testing
 * First 20 delicate primes from OEIS A050998
 */
export const KNOWN_DELICATE_PRIMES = [
  294001,
  505447,
  584141,
  604171,
  971767,
  1062599,
  1282529,
  1524181,
  2017963,
  2474431,
  2690201,
  3085553,
  3326489,
  4393139,
  5152507,
  5564453,
  5575259,
  6173731,
  6191371,
  6236179,
];
