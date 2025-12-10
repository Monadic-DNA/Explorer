'use client';

import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface DiscountInfo {
  originalAmount: string;
  discountAmount: string;
  finalAmount: string;
  promotionCode: string | null;
}

interface SubscriptionFormProps {
  clientSecret: string;
  walletAddress: string;
  couponCode: string;
  discount: DiscountInfo | null;
  isSetupIntent: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

function SubscriptionForm({ clientSecret, walletAddress, couponCode, discount, isSetupIntent, onSuccess, onCancel }: SubscriptionFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      if (isSetupIntent) {
        // This is a setup intent (for $0 invoices with discount codes)
        // We're just collecting the payment method for future charges
        const { error, setupIntent } = await stripe.confirmSetup({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/payment/success`,
          },
          redirect: 'if_required',
        });

        if (error) {
          setErrorMessage(error.message || 'Failed to save payment method');
          setIsProcessing(false);
        } else if (setupIntent) {
          console.log('[StripeForm] Payment method saved, status:', setupIntent.status);
          if (setupIntent.status === 'succeeded') {
            console.log('[StripeForm] Setup succeeded, activating subscription');
            onSuccess();
          } else {
            setErrorMessage(`Setup status: ${setupIntent.status}`);
            setIsProcessing(false);
          }
        } else {
          console.log('[StripeForm] No setup intent returned, closing anyway');
          onSuccess();
        }
      } else {
        // This is a payment intent (normal payment flow)
        const { error, paymentIntent } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/payment/success`,
          },
          redirect: 'if_required',
        });

        if (error) {
          setErrorMessage(error.message || 'Payment failed');
          setIsProcessing(false);
        } else if (paymentIntent) {
          // Check payment status
          console.log('[StripeForm] Payment intent status:', paymentIntent.status);
          if (paymentIntent.status === 'succeeded') {
            // Payment succeeded - close modal immediately
            // Webhook will record payment in background
            console.log('[StripeForm] Payment succeeded, closing modal');
            onSuccess();
          } else if (paymentIntent.status === 'processing') {
            // Payment is processing
            setErrorMessage('Payment is processing. This may take a moment...');
            // Wait a bit then close
            setTimeout(() => {
              onSuccess();
            }, 3000);
          } else {
            setErrorMessage(`Payment status: ${paymentIntent.status}`);
            setIsProcessing(false);
          }
        } else {
          // No error and no paymentIntent - shouldn't happen
          console.log('[StripeForm] No payment intent returned, closing anyway');
          onSuccess();
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred');
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stripe-form">
      {/* Pricing Summary */}
      <div className="pricing-card">
        <div className="pricing-header">
          <h4>Premium Subscription</h4>
          <div className="price-display">
            <span className="current-price">$4.99</span>
            <span className="billing-period">/month</span>
          </div>
        </div>

        <div className="features-list">
          <div className="feature-item">
            <span className="feature-icon">✓</span>
            <span>LLM Chat Assistant</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">✓</span>
            <span>Run All Analysis</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">✓</span>
            <span>Overview Report</span>
          </div>
        </div>

        {couponCode && discount && (
          <div className="promo-applied">
            <div className="promo-header">
              <span className="promo-icon">🎉</span>
              <span className="promo-text">Promo code "{couponCode}" applied!</span>
            </div>
            <div className="promo-details">
              <div className="promo-row">
                <span>First payment:</span>
                <span>
                  <span className="original-amount">${discount.originalAmount}</span>
                  <strong className="discounted-amount">${discount.finalAmount}</strong>
                </span>
              </div>
              <div className="promo-row">
                <span>You save:</span>
                <strong className="savings-amount">${discount.discountAmount}</strong>
              </div>
            </div>
            <div className="promo-note">
              Then $4.99/month after promotional period
            </div>
          </div>
        )}
      </div>

      {/* Payment Element */}
      <div className="payment-section">
        <PaymentElement />
      </div>

      {errorMessage && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          {errorMessage}
        </div>
      )}

      <div className="form-actions">
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="btn-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="btn-subscribe"
        >
          {isProcessing ? (
            <>
              <span className="spinner"></span>
              Processing...
            </>
          ) : (
            'Subscribe Now'
          )}
        </button>
      </div>

      <div className="secure-notice">
        <span className="lock-icon">🔒</span>
        <span>Secured by Stripe • Cancel anytime</span>
      </div>

      <style jsx>{`
        .stripe-form {
          width: 100%;
        }

        .pricing-card {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          color: white;
        }

        .pricing-header {
          margin-bottom: 1.25rem;
        }

        .pricing-header h4 {
          margin: 0 0 0.5rem 0;
          font-size: 1.25rem;
          font-weight: 600;
        }

        .price-display {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }

        .original-price {
          font-size: 1.5rem;
          text-decoration: line-through;
          opacity: 0.7;
        }

        .discounted-price,
        .current-price {
          font-size: 2rem;
          font-weight: 700;
        }

        .billing-period {
          font-size: 1rem;
          opacity: 0.9;
        }

        .features-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem 0;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        .feature-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.95rem;
        }

        .feature-icon {
          width: 20px;
          height: 20px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 700;
        }

        .promo-applied {
          margin-top: 1rem;
          padding: 1rem;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          font-size: 0.9rem;
        }

        .promo-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        .promo-icon {
          font-size: 1.25rem;
        }

        .promo-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .promo-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.9rem;
        }

        .original-amount {
          text-decoration: line-through;
          opacity: 0.7;
          margin-right: 0.5rem;
          font-size: 0.85rem;
        }

        .discounted-amount {
          color: #fbbf24;
          font-weight: 700;
          font-size: 1rem;
        }

        .savings-amount {
          color: #fbbf24;
          font-weight: 700;
        }

        .promo-note {
          font-size: 0.8rem;
          opacity: 0.85;
          text-align: center;
          padding-top: 0.75rem;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
        }

        .payment-section {
          margin-bottom: 1.5rem;
        }

        .error-banner {
          background: #fee2e2;
          border: 1px solid #fca5a5;
          color: #991b1b;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
        }

        .error-icon {
          font-size: 1.25rem;
        }

        .form-actions {
          display: grid;
          grid-template-columns: 1fr 2fr;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .btn-cancel {
          background: white;
          color: #6b7280;
          border: 2px solid #e5e7eb;
          padding: 0.875rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 1rem;
          transition: all 0.2s;
        }

        .btn-cancel:hover:not(:disabled) {
          background: #f9fafb;
          border-color: #d1d5db;
        }

        .btn-cancel:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-subscribe {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 0.875rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 1rem;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }

        .btn-subscribe:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
        }

        .btn-subscribe:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .secure-notice {
          text-align: center;
          color: #6b7280;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .lock-icon {
          font-size: 1rem;
        }
      `}</style>
    </form>
  );
}

interface StripeSubscriptionFormProps {
  walletAddress: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function StripeSubscriptionForm({ walletAddress, onSuccess, onCancel }: StripeSubscriptionFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [discount, setDiscount] = useState<DiscountInfo | null>(null);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [isSetupIntent, setIsSetupIntent] = useState(false);

  React.useEffect(() => {
    // Initialize payment on mount (without coupon initially)
    initializePayment('');
  }, [walletAddress]);

  const initializePayment = (promoCode: string) => {
    setIsInitializing(true);
    setError(null);

    console.log('[StripeForm] Initializing subscription for wallet:', walletAddress);

    // Create subscription
    fetch('/api/stripe/create-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        couponCode: promoCode.trim() || undefined
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('[StripeForm] Subscription response:', data);

        if (data.success) {
          if (data.clientSecret) {
            setClientSecret(data.clientSecret);
            setIsSetupIntent(data.isSetupIntent || false);
            if (promoCode) {
              setAppliedCoupon(promoCode);
            }
            // Set discount info from API response
            if (data.discount) {
              setDiscount(data.discount);
              console.log('[StripeForm] Discount info:', data.discount);
            }
            console.log('[StripeForm] Client secret received, isSetupIntent:', data.isSetupIntent);
          } else {
            setError('Failed to initialize payment');
            console.error('[StripeForm] No client secret received');
          }
        } else {
          setError(data.error || 'Failed to initialize payment');
          console.error('[StripeForm] Failed to initialize:', data);
        }
      })
      .catch((err) => {
        setError('Network error. Please try again.');
        console.error('[StripeForm] Network error:', err);
      })
      .finally(() => {
        setIsInitializing(false);
      });
  };

  const handleApplyCoupon = () => {
    if (!couponCode.trim()) return;

    // Reinitialize with coupon
    setClientSecret(null);
    initializePayment(couponCode);
    setShowCouponInput(false);
  };

  if (isInitializing) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading payment form...</p>
        <style jsx>{`
          .loading-container {
            text-align: center;
            padding: 3rem 2rem;
          }
          .loading-spinner {
            width: 48px;
            height: 48px;
            border: 4px solid #e5e7eb;
            border-top-color: #667eea;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 1rem;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          p {
            color: #6b7280;
            font-size: 0.95rem;
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error-icon">⚠️</div>
        <p className="error-message">{error}</p>
        <div className="error-actions">
          <button onClick={() => { setError(null); initializePayment(appliedCoupon); }} className="btn-retry">
            Try Again
          </button>
          <button onClick={onCancel} className="btn-back">
            Go Back
          </button>
        </div>
        <style jsx>{`
          .error-container {
            text-align: center;
            padding: 2rem;
          }
          .error-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
          }
          .error-message {
            color: #dc2626;
            margin-bottom: 1.5rem;
            font-size: 0.95rem;
          }
          .error-actions {
            display: flex;
            gap: 1rem;
            justify-content: center;
          }
          .btn-retry, .btn-back {
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.95rem;
          }
          .btn-retry {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
          }
          .btn-retry:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
          }
          .btn-back {
            background: white;
            color: #6b7280;
            border: 2px solid #e5e7eb;
          }
          .btn-back:hover {
            background: #f9fafb;
          }
        `}</style>
      </div>
    );
  }

  if (!clientSecret) {
    return null;
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'stripe' as const,
      variables: {
        colorPrimary: '#667eea',
        colorBackground: '#ffffff',
        colorText: '#1f2937',
        colorDanger: '#dc2626',
        fontFamily: 'system-ui, sans-serif',
        spacingUnit: '4px',
        borderRadius: '8px',
      },
    },
  };

  return (
    <div>
      {!appliedCoupon && (
        <div className="coupon-section">
          {!showCouponInput ? (
            <button
              type="button"
              onClick={() => setShowCouponInput(true)}
              className="coupon-toggle"
            >
              <span className="coupon-icon">🎟️</span>
              Have a promo code?
            </button>
          ) : (
            <div className="coupon-input-container">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                placeholder="Enter promo code"
                className="coupon-input"
                autoFocus
              />
              <button
                onClick={handleApplyCoupon}
                disabled={!couponCode.trim()}
                className="coupon-apply-btn"
              >
                Apply
              </button>
              <button
                onClick={() => setShowCouponInput(false)}
                className="coupon-cancel-btn"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      <Elements stripe={stripePromise} options={options}>
        <SubscriptionForm
          clientSecret={clientSecret}
          walletAddress={walletAddress}
          couponCode={appliedCoupon}
          discount={discount}
          isSetupIntent={isSetupIntent}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      </Elements>

      <style jsx>{`
        .coupon-section {
          margin-bottom: 1.5rem;
        }

        .coupon-toggle {
          background: none;
          border: none;
          color: #667eea;
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0.5rem 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.2s;
        }

        .coupon-toggle:hover {
          color: #764ba2;
        }

        .coupon-icon {
          font-size: 1.1rem;
        }

        .coupon-input-container {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .coupon-input {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          font-size: 0.95rem;
          transition: all 0.2s;
        }

        .coupon-input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .coupon-apply-btn {
          padding: 0.75rem 1.25rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }

        .coupon-apply-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }

        .coupon-apply-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .coupon-cancel-btn {
          padding: 0.75rem;
          background: white;
          color: #6b7280;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 1rem;
          line-height: 1;
        }

        .coupon-cancel-btn:hover {
          background: #f9fafb;
        }
      `}</style>
    </div>
  );
}
