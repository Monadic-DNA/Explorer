"use client";

import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { verifyPromoCode } from '@/lib/prime-verification';
import PaymentModal from './PaymentModal';

interface PremiumPaywallProps {
  children: React.ReactNode;
}

export function PremiumPaywall({ children }: PremiumPaywallProps) {
  const { isAuthenticated, hasActiveSubscription, subscriptionData, refreshSubscription } = useAuth();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [hasPromoAccess, setHasPromoAccess] = useState(false);
  const [promoCode, setPromoCode] = useState('');

  // Check localStorage for existing promo access on mount
  useEffect(() => {
    const stored = localStorage.getItem('promo_access');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        // Re-verify the code (in case logic changed)
        const result = verifyPromoCode(data.code);
        if (result.valid && result.discount === 0) {
          setHasPromoAccess(true);
          setPromoCode(data.code);
        } else {
          // Code no longer valid, clear storage
          localStorage.removeItem('promo_access');
        }
      } catch (err) {
        localStorage.removeItem('promo_access');
      }
    }
  }, []);

  const handleRemovePromoCode = () => {
    localStorage.removeItem('promo_access');
    setHasPromoAccess(false);
    setPromoCode('');
  };

  const handleModalSuccess = () => {
    // Refresh promo access state
    const stored = localStorage.getItem('promo_access');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setHasPromoAccess(true);
        setPromoCode(data.code);
      } catch (err) {
        // Ignore
      }
    }
    // Also refresh subscription
    setTimeout(() => refreshSubscription(), 5000);
  };

  // Always show content, with subscription banner if needed
  return (
    <>
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={handleModalSuccess}
      />

      {!hasActiveSubscription && !hasPromoAccess && (
        <div style={{
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          backgroundColor: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '6px',
          fontSize: '0.875rem',
          color: '#92400e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem'
        }}>
          <span>
            <strong>Premium subscription required</strong> — Subscribe for $4.99/month to access AI Chat, Run All Analysis, and more.
          </span>
          <button
            onClick={() => setShowPaymentModal(true)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#f59e0b',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
              whiteSpace: 'nowrap'
            }}
          >
            Subscribe
          </button>
        </div>
      )}

      {hasPromoAccess && (
        <div style={{
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          backgroundColor: '#d1fae5',
          border: '1px solid #10b981',
          borderRadius: '6px',
          fontSize: '0.875rem',
          color: '#065f46',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span>✓ Premium access active (promo code: {promoCode})</span>
          <button
            onClick={handleRemovePromoCode}
            style={{
              padding: '0.25rem 0.5rem',
              backgroundColor: '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: '500'
            }}
          >
            Remove
          </button>
        </div>
      )}

      {children}
    </>
  );
}
