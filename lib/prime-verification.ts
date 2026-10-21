import { coreCall } from "./core";

export function isPrime(n: number): boolean { return Number.isSafeInteger(n) && n >= 0 && coreCall("prime", n); }
export function isDelicatePrime(n: number): boolean { return Number.isSafeInteger(n) && n >= 0 && coreCall("delicate_prime", n); }
export function verifyPromoCode(code: string): { valid: boolean; discount: number; message: string } { return coreCall("promo", code); }

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
