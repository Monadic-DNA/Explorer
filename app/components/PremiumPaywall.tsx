"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trackPremiumSectionViewed } from '@/lib/analytics';

interface PremiumPaywallProps {
  children: React.ReactNode;
}

export function PremiumPaywall({ children }: PremiumPaywallProps) {
  const router = useRouter();

  useEffect(() => {
    const handleOpenPaymentModal = () => {
      // Track when user views premium section
      trackPremiumSectionViewed();
      router.push('/subscribe');
    };
    window.addEventListener('openPaymentModal', handleOpenPaymentModal as EventListener);
    return () => window.removeEventListener('openPaymentModal', handleOpenPaymentModal as EventListener);
  }, [router]);

  // Always show content
  return <>{children}</>;
}
