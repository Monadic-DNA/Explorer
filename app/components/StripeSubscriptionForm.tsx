'use client';

import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface SubscriptionFormProps {
  clientSecret: string;
  walletAddress: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function SubscriptionForm({ clientSecret, walletAddress, onSuccess, onCancel }: SubscriptionFormProps) {
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
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred');
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stripe-form">
      <div className="payment-element-container">
        <PaymentElement />
      </div>

      {errorMessage && (
        <div className="error-message" style={{ color: '#dc3545', marginTop: '1rem', fontSize: '0.9rem' }}>
          {errorMessage}
        </div>
      )}

      <div className="form-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="btn-secondary"
          style={{ flex: 1 }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="btn-primary"
          style={{ flex: 1 }}
        >
          {isProcessing ? 'Processing...' : 'Subscribe ($4.99/month)'}
        </button>
      </div>

      <style jsx>{`
        .stripe-form {
          width: 100%;
        }
        .payment-element-container {
          margin-bottom: 1rem;
        }
        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: opacity 0.2s;
        }
        .btn-primary:hover:not(:disabled) {
          opacity: 0.9;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: #6c757d;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: opacity 0.2s;
        }
        .btn-secondary:hover:not(:disabled) {
          opacity: 0.9;
        }
        .btn-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    console.log('[StripeForm] Initializing subscription for wallet:', walletAddress);

    // Create subscription on mount
    fetch('/api/stripe/create-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        console.log('[StripeForm] Subscription response:', data);

        if (data.success && data.clientSecret) {
          setClientSecret(data.clientSecret);
          console.log('[StripeForm] Client secret received, rendering payment form');
        } else {
          setError(data.error || 'Failed to initialize payment');
          console.error('[StripeForm] Failed to get client secret:', data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError('Network error. Please try again.');
        console.error('[StripeForm] Network error:', err);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p>Loading payment form...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p style={{ color: '#dc3545', marginBottom: '1rem' }}>{error}</p>
        <button onClick={onCancel} className="btn-secondary">
          Go Back
        </button>
      </div>
    );
  }

  if (!clientSecret) {
    return null;
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'night' as const,
      variables: {
        colorPrimary: '#667eea',
      },
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <SubscriptionForm
        clientSecret={clientSecret}
        walletAddress={walletAddress}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </Elements>
  );
}
