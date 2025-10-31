/**
 * Tests for prime verification
 * Run in browser console to test
 */

import { isPrime, isDelicatePrime, verifyPromoCode, KNOWN_DELICATE_PRIMES } from '../prime-verification';

console.log('=== Prime Verification Tests ===\n');

// Test isPrime
console.log('Testing isPrime:');
console.log('  isPrime(2):', isPrime(2)); // true
console.log('  isPrime(17):', isPrime(17)); // true
console.log('  isPrime(100):', isPrime(100)); // false
console.log('  isPrime(97):', isPrime(97)); // true
console.log('');

// Test known delicate primes
console.log('Testing known delicate primes:');
KNOWN_DELICATE_PRIMES.slice(0, 5).forEach(n => {
  console.time(`  ${n}`);
  const result = isDelicatePrime(n);
  console.timeEnd(`  ${n}`);
  console.log(`  ${n}: ${result ? '✓' : '✗'}`);
});
console.log('');

// Test non-delicate primes
console.log('Testing non-delicate numbers:');
[123456, 7, 13, 100].forEach(n => {
  const result = isDelicatePrime(n);
  console.log(`  ${n}: ${result ? '✓ FAIL (should be false)' : '✗ PASS'}`);
});
console.log('');

// Test verifyPromoCode
console.log('Testing verifyPromoCode:');
const testCodes = [
  '294001', // Valid delicate prime
  '505447', // Valid delicate prime
  '123456', // Invalid
  'abc',    // Invalid format
  '',       // Empty
];

testCodes.forEach(code => {
  const result = verifyPromoCode(code);
  console.log(`  "${code}": ${result.valid ? '✓' : '✗'} - ${result.message}`);
});
