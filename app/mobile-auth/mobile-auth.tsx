'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getAuthToken } from '@dynamic-labs/sdk-react-core';
import { useAuth } from '@/app/components/AuthProvider';
import { coreCall } from '@/lib/core';

const entropy = (count: number) => btoa(Array.from(crypto.getRandomValues(new Uint8Array(count)), b => String.fromCharCode(b)).join(''));
const url64 = (text: string) => btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** System-browser login UI. Only encrypted, state-bound data enters the callback URL. */
export default function MobileAuth() {
  const params = useSearchParams();
  const auth = useAuth();
  const [error, setError] = useState('');
  const publicKey = params.get('publicKey') || '';
  const state = params.get('state') || '';
  const valid = /^[A-Za-z0-9_-]{43}$/.test(publicKey) && /^[A-Za-z0-9_-]{43}$/.test(state);

  function connect() {
    try {
      if (!valid) throw new Error('Invalid device sign-in request. Start sign-in from the native app.');
      const token = getAuthToken();
      const credentials = auth.user?.verifiedCredentials || [];
      const walletAddress = credentials.find((item: { address?: string }) => /^0x[a-fA-F0-9]{40}$/.test(item.address || ''))?.address;
      if (!token || !walletAddress) throw new Error('Sign in and connect an EVM wallet before continuing.');
      const encodedPayload = token.split('.')[1];
      const jwt = JSON.parse(atob(encodedPayload.replaceAll('-', '+').replaceAll('_', '/')));
      const expiresAt = Math.min(Date.now() + 300_000, Number(jwt.exp) * 1000);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Sign-in expired. Sign in again.');
      const sealed = coreCall<{ publicKey: string; iv: string; ciphertext: string }>('auth_seal', {
        publicKey, state, entropy: entropy(32), iv: entropy(12),
        plaintext: JSON.stringify({ token, walletAddress, expiresAt }),
      });
      const callback = new URL('monadicexplorer://auth');
      callback.searchParams.set('state', state);
      callback.hash = new URLSearchParams({ payload: url64(JSON.stringify(sealed)) }).toString();
      window.location.assign(callback.toString());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to connect device.'); }
  }

  return <main style={{ maxWidth: 560, margin: '64px auto', padding: 24 }}>
    <h1>Connect Explorer on your device</h1>
    <p>Continue only if you started sign-in from the Android or iOS Explorer app.</p>
    <p>Your signed-in account will be connected to that device. Raw DNA and saved results are not transferred during sign-in.</p>
    {!valid ? <p role="alert">Invalid device request. Start again from the native app.</p> : <>
      <button type="button" onClick={auth.openAuthModal}>{auth.isAuthenticated ? 'Change account or connect wallet' : 'Sign in with Dynamic'}</button>
      <button type="button" disabled={!auth.isAuthenticated} onClick={connect}>Connect this device</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
