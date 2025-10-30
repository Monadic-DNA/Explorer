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
  const [promoCode, setPromoCode] = useState('');
  const [promoMessage, setPromoMessage] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });
  const [hasPromoAccess, setHasPromoAccess] = useState(false);


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
          setPromoMessage({ type: 'success', text: '✓ Promo code active' });
        } else {
          // Code no longer valid, clear storage
          localStorage.removeItem('promo_access');
        }
      } catch (err) {
        localStorage.removeItem('promo_access');
      }
    }
  }, []);

  const handlePromoSubmit = () => {
    const result = verifyPromoCode(promoCode);

    if (result.valid && result.discount === 0) {
      // Free access granted!
      setPromoMessage({ type: 'success', text: result.message });
      setHasPromoAccess(true);
      // Store in localStorage for persistence
      localStorage.setItem('promo_access', JSON.stringify({ code: promoCode, granted: Date.now() }));
    } else {
      setPromoMessage({ type: 'error', text: result.message });
      setHasPromoAccess(false);
    }
  };

  const handleRemovePromoCode = () => {
    localStorage.removeItem('promo_access');
    setHasPromoAccess(false);
    setPromoCode('');
    setPromoMessage({ type: '', text: '' });
  };

  // Always show content, with subscription banner if needed
  return (
    <>
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={() => {
          setTimeout(() => refreshSubscription(), 5000);
        }}
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

      {/* Promo Code Section - Always available */}
      <div style={{ marginTop: '2rem', maxWidth: '500px', margin: '2rem auto 0' }}>
        <div style={{
              marginTop: '1.5rem',
              padding: '1rem',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Have a promo code?</h3>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
                Enter your promotional code to unlock premium access
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePromoSubmit()}
                  placeholder="Enter code"
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '1rem'
                  }}
                />
                <button
                  onClick={handlePromoSubmit}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    fontWeight: '500'
                  }}
                >
                  Apply
                </button>
              </div>
              {promoMessage.text && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  backgroundColor: promoMessage.type === 'success' ? '#d1fae5' : '#fee2e2',
                  color: promoMessage.type === 'success' ? '#065f46' : '#991b1b',
                  border: `1px solid ${promoMessage.type === 'success' ? '#6ee7b7' : '#fca5a5'}`
                }}>
                  {promoMessage.text}
                </div>
              )}
        </div>
      </div>
    </>
  );
}
