"use client";

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from './AuthProvider';
import { trackPremiumSectionViewed } from '@/lib/analytics';

// Lazy load PaymentModal to reduce initial bundle size (viem + @dynamic-labs = ~86MB)
const PaymentModal = dynamic(() => import('./PaymentModal'), {
  loading: () => <div>Loading payment options...</div>,
  ssr: false
});

interface PremiumPaywallProps {
  children: React.ReactNode;
}

export function PremiumPaywall({ children }: PremiumPaywallProps) {
  const { refreshSubscription } = useAuth();
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Listen for payment modal trigger (with optional promo code)
  const [initialPromoCode, setInitialPromoCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    const handleOpenPaymentModal = (event: Event) => {
      const customEvent = event as CustomEvent<{ promoCode?: string }>;
      const promoCodeFromEvent = customEvent.detail?.promoCode;

      if (promoCodeFromEvent) {
        setInitialPromoCode(promoCodeFromEvent);
      }

      setShowPaymentModal(true);
      // Track when user views premium section
      trackPremiumSectionViewed();
    };
    window.addEventListener('openPaymentModal', handleOpenPaymentModal as EventListener);
    return () => window.removeEventListener('openPaymentModal', handleOpenPaymentModal as EventListener);
  }, []);

  const handleModalSuccess = async () => {
    // Refresh subscription status in AuthProvider to update UI immediately
    await refreshSubscription();
    window.dispatchEvent(new CustomEvent('premiumAccessUpdated'));
  };

  // Always show content
  return (
    <>
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setInitialPromoCode(undefined); // Clear initial promo code on close
        }}
        onSuccess={handleModalSuccess}
        initialPromoCode={initialPromoCode}
      />
      {children}
    </>
  );
}
