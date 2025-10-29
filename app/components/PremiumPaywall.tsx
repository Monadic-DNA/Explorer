"use client";

import { useState } from 'react';
import { useAuth } from './AuthProvider';

interface PremiumPaywallProps {
  children: React.ReactNode;
}

export function PremiumPaywall({ children }: PremiumPaywallProps) {
  const { isAuthenticated, user, hasActiveSubscription, checkingSubscription, subscriptionData, refreshSubscription } = useAuth();
  const [showCryptoInstructions, setShowCryptoInstructions] = useState(false);
  const [selectedChain, setSelectedChain] = useState<'ethereum' | 'base' | 'arbitrum' | 'optimism'>('base');

  const paymentWallet = process.env.NEXT_PUBLIC_EVM_PAYMENT_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

  const chainInfo = {
    ethereum: { name: 'Ethereum', rpc: 'https://mainnet.infura.io/v3/YOUR_KEY' },
    base: { name: 'Base', rpc: 'https://mainnet.base.org' },
    arbitrum: { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc' },
    optimism: { name: 'Optimism', rpc: 'https://mainnet.optimism.io' },
  };

  // Show loading state while checking subscription
  if (checkingSubscription) {
    return (
      <div className="premium-paywall">
        <div className="paywall-container">
          <p>Checking subscription status...</p>
        </div>
      </div>
    );
  }

  // If user has active subscription, show content
  if (hasActiveSubscription) {
    return <>{children}</>;
  }

  // Show paywall
  return (
    <div className="premium-paywall">
      <div className="paywall-container">
        <h2>🔒 Premium Features</h2>
        <p>Subscribe to access premium features including AI Chat, Run All Analysis, and more.</p>

        <div className="pricing-card">
          <div className="price">
            <span className="amount">$4.99</span>
            <span className="period">/month</span>
          </div>
          <ul className="features-list">
            <li>✓ AI-powered genetic analysis chat</li>
            <li>✓ Run all GWAS studies at once</li>
            <li>✓ Comprehensive health reports</li>
            <li>✓ Priority support</li>
          </ul>
        </div>

        {!isAuthenticated ? (
          <div className="auth-required">
            <p>Please connect your wallet to subscribe</p>
            <p className="hint">Click the "Connect" button in the top right</p>
          </div>
        ) : (
          <div className="payment-options">
            <h3>Pay with ETH or USDC</h3>

            {/* Show blockchain payment instructions */}
            <div className="blockchain-payment-instructions">
              <h4>Send ETH or USDC</h4>
              <p>Send ETH or USDC to the address below from your connected wallet.</p>
              <p className="conversion-note">
                Your payment will be converted to subscription days based on USD value at the time of payment.
                <br />
                <strong>$4.99 = 30 days</strong> (e.g., $10 = ~60 days, $2.50 = ~15 days)
              </p>

              <div className="chain-selector">
                <label>Select Chain:</label>
                <select
                  value={selectedChain}
                  onChange={(e) => setSelectedChain(e.target.value as any)}
                  style={{
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    fontSize: '1rem',
                    width: '100%',
                  }}
                >
                  <option value="base">Base (Recommended - Low fees)</option>
                  <option value="optimism">Optimism</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="ethereum">Ethereum</option>
                </select>
              </div>

              <div className="payment-address">
                <label>Payment Address:</label>
                <div className="address-box">
                  <code>{paymentWallet}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(paymentWallet)}
                    className="copy-button"
                  >
                    📋 Copy
                  </button>
                </div>
              </div>

              <div className="payment-instructions-warning">
                <p>⚠️ Important:</p>
                <ul>
                  <li><strong>Send from your connected wallet</strong> ({user?.verifiedCredentials?.[0]?.address || user?.walletPublicKey || 'Connect wallet first'})</li>
                  <li>Only send ETH or USDC on supported chains (Ethereum, Base, Arbitrum, Optimism)</li>
                  <li>Minimum payment: $1 USD</li>
                  <li>Subscription activates automatically after blockchain confirmation (~1-2 minutes)</li>
                  <li>Refresh the page after payment to update your subscription status</li>
                </ul>
              </div>

              {subscriptionData && subscriptionData.paymentCount > 0 && (
                <div className="payment-history" style={{
                  marginTop: '1.5rem',
                  padding: '1rem',
                  backgroundColor: '#f0f9ff',
                  borderRadius: '8px',
                  border: '1px solid #0ea5e9'
                }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>📊 Your Subscription History</h4>
                  <p style={{ margin: '0.25rem 0' }}>Total paid: <strong>${subscriptionData.totalPaid.toFixed(2)}</strong></p>
                  <p style={{ margin: '0.25rem 0' }}>Total days purchased: <strong>{subscriptionData.totalDaysPurchased}</strong></p>
                  <p style={{ margin: '0.25rem 0' }}>Payments made: <strong>{subscriptionData.paymentCount}</strong></p>
                  {subscriptionData.expiresAt && (
                    <p style={{ margin: '0.25rem 0' }}>
                      Expires: <strong>{new Date(subscriptionData.expiresAt).toLocaleDateString()}</strong>
                    </p>
                  )}
                  <button
                    onClick={refreshSubscription}
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 1rem',
                      backgroundColor: '#0ea5e9',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 Refresh Status
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
