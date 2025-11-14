"use client";

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from './AuthProvider';
import { verifyPromoCode } from '@/lib/prime-verification';

// Lazy load PaymentModal to reduce initial bundle size (viem + @dynamic-labs = ~86MB)
const PaymentModal = dynamic(() => import('./PaymentModal'), {
  loading: () => <div>Loading payment options...</div>,
  ssr: false
});

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

  // Listen for payment modal trigger
  useEffect(() => {
    const handleOpenPaymentModal = () => {
      setShowPaymentModal(true);
    };
    window.addEventListener('openPaymentModal', handleOpenPaymentModal);
    return () => window.removeEventListener('openPaymentModal', handleOpenPaymentModal);
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

  // Always show content
  return (
    <>
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={handleModalSuccess}
      />
      {children}
    </>
  );
}
