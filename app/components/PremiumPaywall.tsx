"use client";

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from './AuthProvider';
import { trackPremiumSectionViewed } from '@/lib/analytics';
import { hasValidPromoAccess, getPromoCode, clearPromoAccess } from '@/lib/promo-access';

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
    if (hasValidPromoAccess()) {
      setHasPromoAccess(true);
      const code = getPromoCode();
      if (code) {
        setPromoCode(code);
      }
    }
  }, []);

  // Listen for payment modal trigger
  useEffect(() => {
    const handleOpenPaymentModal = () => {
      setShowPaymentModal(true);
      // Track when user views premium section
      trackPremiumSectionViewed();
    };
    window.addEventListener('openPaymentModal', handleOpenPaymentModal);
    return () => window.removeEventListener('openPaymentModal', handleOpenPaymentModal);
  }, []);

  const handleRemovePromoCode = () => {
    clearPromoAccess();
    setHasPromoAccess(false);
    setPromoCode('');
  };

  const handleModalSuccess = async () => {
    // Refresh promo access state
    if (hasValidPromoAccess()) {
      setHasPromoAccess(true);
      const code = getPromoCode();
      if (code) {
        setPromoCode(code);
      }
    }
    // Refresh subscription status in AuthProvider to update UI immediately
    await refreshSubscription();
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
