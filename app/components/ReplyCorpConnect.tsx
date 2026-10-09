"use client";

/**
 * ReplyCorp Connect-on-X integration (client side)
 *
 * ReplyCorpBridge loads ReplyCorp's pixel and links the connected X account to the
 * signed-in wallet. ReplyCorpConnectOffer renders the optional Connect button with the
 * 10% discount offer. Conversions are reported from the server, never from here.
 */

import { useCallback, useEffect, useState } from 'react';
import Script from 'next/script';
import { getAuthToken } from '@dynamic-labs/sdk-react-core';

const BRAND_ID = process.env.NEXT_PUBLIC_REPLYCORP_BRAND_ID;
const IDENTITY_KEY = 'replycorp_x_identity';
const IDENTITY_CHANGED_EVENT = 'replycorp:identity-changed';

interface XIdentity {
  userId: string;
  handle: string;
}

function readIdentity(): XIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function linkedKey(walletAddress: string, userId: string) {
  return `replycorp_linked_${walletAddress.toLowerCase()}_${userId}`;
}

/**
 * Reports a completed purchase so the server can verify it with Stripe and forward it to
 * ReplyCorp. Fire-and-forget: tracking failures must never affect the purchase flow.
 */
export function reportReplyCorpPurchase(
  walletAddress: string,
  purchase: { subscriptionId: string } | { checkoutSessionId: string }
) {
  if (!BRAND_ID) return;
  const authToken = getAuthToken();
  if (!authToken) return;

  fetch('/api/replycorp/conversion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ walletAddress, ...purchase }),
  }).catch(err => console.warn('[ReplyCorp] Failed to report purchase:', err));
}

export function ReplyCorpBridge({ walletAddress }: { walletAddress: string | null }) {
  // Remember the X identity the widget reports, so it can be linked once the user signs in
  useEffect(() => {
    if (!BRAND_ID) return;

    const onConnected = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.provider !== 'x' || !detail.userId) return;
      localStorage.setItem(IDENTITY_KEY, JSON.stringify({ userId: String(detail.userId), handle: detail.handle || '' }));
      window.dispatchEvent(new Event(IDENTITY_CHANGED_EVENT));
    };
    const onLogout = () => {
      localStorage.removeItem(IDENTITY_KEY);
      window.dispatchEvent(new Event(IDENTITY_CHANGED_EVENT));
    };

    window.addEventListener('replycorp:connected', onConnected);
    window.addEventListener('replycorp:logout', onLogout);
    return () => {
      window.removeEventListener('replycorp:connected', onConnected);
      window.removeEventListener('replycorp:logout', onLogout);
    };
  }, []);

  // Link the X identity to the wallet once both are known
  useEffect(() => {
    if (!BRAND_ID || !walletAddress) return;

    const link = async () => {
      const identity = readIdentity();
      if (!identity || localStorage.getItem(linkedKey(walletAddress, identity.userId))) return;

      const authToken = getAuthToken();
      if (!authToken) return;

      try {
        const response = await fetch('/api/replycorp/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ walletAddress, twitterId: identity.userId, handle: identity.handle }),
        });
        if (response.ok) {
          localStorage.setItem(linkedKey(walletAddress, identity.userId), '1');
          window.dispatchEvent(new Event(IDENTITY_CHANGED_EVENT));
        } else {
          console.warn('[ReplyCorp] Linking X account failed:', response.status);
        }
      } catch (err) {
        console.warn('[ReplyCorp] Linking X account failed:', err);
      }
    };

    link();
    window.addEventListener(IDENTITY_CHANGED_EVENT, link);
    return () => window.removeEventListener(IDENTITY_CHANGED_EVENT, link);
  }, [walletAddress]);

  if (!BRAND_ID) return null;

  return (
    <Script
      id="replycorp-pixel"
      src="https://cdn.replycorp.io/pixel.js"
      strategy="afterInteractive"
      data-brand-id={BRAND_ID}
      data-api-base="https://prod.api.replycorp.io"
    />
  );
}

/**
 * Optional Connect-on-X offer. The pixel renders its button into the data-replycorp-connect element.
 */
export function ReplyCorpConnectOffer() {
  const [identity, setIdentity] = useState<XIdentity | null>(null);

  const refresh = useCallback(() => setIdentity(readIdentity()), []);

  useEffect(() => {
    if (!BRAND_ID) return;
    refresh();
    window.addEventListener(IDENTITY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(IDENTITY_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!BRAND_ID) return null;

  return (
    <div className="replycorp-offer">
      {identity ? (
        <p className="replycorp-offer-text">
          X account {identity.handle || 'connected'} is linked. You get 10% off your first month and your first one-time report.
        </p>
      ) : (
        <p className="replycorp-offer-text">
          Connect your X account to get 10% off your first month or your first one-time report.
        </p>
      )}
      <div data-replycorp-connect></div>
      <style jsx>{`
        .replycorp-offer {
          margin: 0 0 1rem;
          padding: 0.75rem 1rem;
          border: 1px dashed var(--border-color, #d1d5db);
          border-radius: 8px;
          text-align: center;
        }
        .replycorp-offer-text {
          margin: 0 0 0.5rem;
          font-size: 0.9rem;
          color: var(--text-secondary, #4b5563);
        }
      `}</style>
    </div>
  );
}
