/**
 * Fetch polyfill to fix Alchemy SDK compatibility in Next.js server-side code
 * MUST be imported before any code that uses fetch (especially Alchemy SDK)
 *
 * The issue: ethers.js (used by Alchemy SDK) sets referrer: "client" which is
 * valid in browsers but causes "Referrer 'client' is not a valid URL" in Node.js
 */

if (typeof globalThis !== 'undefined' && globalThis.fetch) {
  // Store original fetch
  const originalFetch = globalThis.fetch;

  // Create patched version (arrow function to avoid 'this' context issues)
  const patchedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Always remove referrer to avoid issues
    if (init && typeof init === 'object') {
      const newInit = { ...init };
      delete (newInit as any).referrer;
      return originalFetch(input, newInit);
    }
    return originalFetch(input, init);
  };

  // Override global fetch using defineProperty for better reliability
  try {
    Object.defineProperty(globalThis, 'fetch', {
      value: patchedFetch,
      writable: true,
      configurable: true,
    });
    console.log('[Fetch Polyfill] ✅ Applied fetch polyfill for Alchemy SDK');
  } catch (err) {
    console.error('[Fetch Polyfill] ❌ Failed to apply polyfill:', err);
    // Fallback: try direct assignment
    globalThis.fetch = patchedFetch as any;
    console.log('[Fetch Polyfill] ⚠️  Applied polyfill via direct assignment');
  }
}

export {};
