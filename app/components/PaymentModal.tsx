"use client";

import { useState, useEffect } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { parseEther, parseUnits, encodeFunctionData } from 'viem';
import { verifyPromoCode } from '@/lib/prime-verification';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Currency = 'ETH' | 'USDC';
type Step = 'choice' | 'promo' | 'amount' | 'currency' | 'confirm' | 'processing';

export default function PaymentModal({ isOpen, onClose, onSuccess }: PaymentModalProps) {
  const { primaryWallet } = useDynamicContext();
  const [step, setStep] = useState<Step>('choice');
  const [amount, setAmount] = useState('4.99');
  const [currency, setCurrency] = useState<Currency>('USDC');
  const [connectedChain, setConnectedChain] = useState<string>('');
  const [ethPrice, setEthPrice] = useState<number>(3000);
  const [loadingPrice, setLoadingPrice] = useState(true);
  const [error, setError] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoMessage, setPromoMessage] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });

  const paymentWallet = process.env.NEXT_PUBLIC_EVM_PAYMENT_WALLET_ADDRESS || '';

  const USDC_CONTRACTS: Record<string, string> = {
    'Ethereum': process.env.NEXT_PUBLIC_USDC_CONTRACT_ETHEREUM || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'Base': process.env.NEXT_PUBLIC_USDC_CONTRACT_BASE || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'Arbitrum One': process.env.NEXT_PUBLIC_USDC_CONTRACT_ARBITRUM || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    'OP Mainnet': process.env.NEXT_PUBLIC_USDC_CONTRACT_OPTIMISM || '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  };

  // Fetch ETH price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch('/api/get-eth-price');
        if (response.ok) {
          const data = await response.json();
          setEthPrice(data.price || 3000);
        }
      } catch (err) {
        console.error('Failed to fetch ETH price:', err);
      } finally {
        setLoadingPrice(false);
      }
    };
    fetchPrice();
  }, []);

  // Detect connected chain
  useEffect(() => {
    const detectChain = async () => {
      if (primaryWallet) {
        try {
          const walletClient = await primaryWallet.getWalletClient();
          if (walletClient && 'chain' in walletClient && walletClient.chain) {
            setConnectedChain(walletClient.chain.name);
          }
        } catch (err) {
          console.error('Failed to detect chain:', err);
        }
      }
    };
    detectChain();
  }, [primaryWallet]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('choice');
      setAmount('4.99');
      setCurrency('USDC');
      setError('');
      setPromoCode('');
      setPromoMessage({ type: '', text: '' });
    }
  }, [isOpen]);

  // Detect wallet disconnect and close modal
  useEffect(() => {
    if (isOpen && !primaryWallet && step !== 'choice' && step !== 'promo') {
      // User disconnected wallet during payment flow
      setError('Wallet disconnected. Please reconnect to continue.');
      setStep('choice');
    }
  }, [primaryWallet, isOpen, step]);

  const handlePromoSubmit = () => {
    const result = verifyPromoCode(promoCode);

    if (result.valid && result.discount === 0) {
      // Free access granted!
      localStorage.setItem('promo_access', JSON.stringify({ code: promoCode, granted: Date.now() }));
      setPromoMessage({ type: 'success', text: result.message });

      // Success - trigger callback and close modal
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } else {
      setPromoMessage({ type: 'error', text: result.message });
    }
  };

  const handleSendPayment = async () => {
    if (!primaryWallet) {
      setError('Please connect your wallet first');
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 1) {
      setError('Minimum payment is $1 USD');
      return;
    }

    setStep('processing');
    setError('');

    try {
      const walletClient = await primaryWallet.getWalletClient();
      if (!walletClient || !('sendTransaction' in walletClient)) {
        throw new Error('Wallet client not available');
      }

      let txHash: string;

      if (currency === 'ETH') {
        // Send ETH
        const ethAmount = (amountNum / ethPrice).toFixed(18);
        txHash = await walletClient.sendTransaction({
          to: paymentWallet as `0x${string}`,
          value: parseEther(ethAmount),
        });
      } else {
        // Send USDC (ERC-20 token)
        const usdcContract = USDC_CONTRACTS[connectedChain];
        if (!usdcContract) {
          throw new Error(`USDC not supported on ${connectedChain}`);
        }

        // USDC has 6 decimals
        const usdcAmount = parseUnits(amount, 6);

        // Encode ERC-20 transfer function call properly
        const transferData = encodeFunctionData({
          abi: [{
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ type: 'bool' }]
          }],
          functionName: 'transfer',
          args: [paymentWallet as `0x${string}`, usdcAmount]
        });

        txHash = await walletClient.sendTransaction({
          to: usdcContract as `0x${string}`,
          data: transferData,
        });
      }

      // Success
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);

    } catch (err: any) {
      console.error('Payment failed:', err);

      // Check if it's a USDC balance issue
      if (currency === 'USDC' && (
        err.message?.includes('gas required exceeds allowance') ||
        err.message?.includes('insufficient funds') ||
        err.details?.includes('gas required exceeds allowance') ||
        err.shortMessage?.includes('insufficient funds')
      )) {
        setError(`Insufficient USDC balance. Please ensure you have at least ${amount} USDC in your wallet, or go back and switch to ETH payment.`);
      } else {
        setError(err.shortMessage || err.message || 'Payment failed. Please try again.');
      }

      setStep('confirm');
    }
  };

  const daysOfAccess = Math.round((parseFloat(amount || '0') / 4.99) * 30);
  const tokenAmount = currency === 'ETH'
    ? (parseFloat(amount || '0') / ethPrice).toFixed(6)
    : amount;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content payment-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-header">
          <h2>💳 Subscribe to Premium</h2>
          <p>Get AI Chat, Run All Analysis, and more</p>
        </div>

        {step === 'choice' && (
          <div className="payment-step">
            <h3>How would you like to subscribe?</h3>
            <p className="step-description">Choose payment method or use a promo code</p>

            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            <div className="choice-options">
              <button
                className="choice-option"
                onClick={() => setStep('amount')}
              >
                <div className="choice-icon">💳</div>
                <div className="choice-details">
                  <div className="choice-title">Pay with Crypto</div>
                  <div className="choice-description">Use ETH or USDC to subscribe</div>
                </div>
              </button>

              <div className="choice-divider">
                <span>OR</span>
              </div>

              <button
                className="choice-option"
                onClick={() => setStep('promo')}
              >
                <div className="choice-icon">🎟️</div>
                <div className="choice-details">
                  <div className="choice-title">Use Promo Code</div>
                  <div className="choice-description">Have a promotional code? Enter it here</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 'promo' && (
          <div className="payment-step">
            <button className="back-button" onClick={() => setStep('choice')}>← Back</button>

            <h3>Enter Promo Code</h3>
            <p className="step-description">Enter your promotional code to unlock premium access</p>

            <div className="promo-input-group">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePromoSubmit()}
                placeholder="Enter promo code"
                className="promo-input"
                autoFocus
              />
            </div>

            {promoMessage.text && (
              <div className={`message-box ${promoMessage.type}`}>
                {promoMessage.text}
              </div>
            )}

            <button
              className="btn-primary"
              onClick={handlePromoSubmit}
              disabled={!promoCode.trim()}
            >
              Apply Promo Code
            </button>
          </div>
        )}

        {step === 'amount' && (
          <div className="payment-step">
            <div className="step-indicator">
              <div className="step active">1</div>
              <div className="step-line"></div>
              <div className="step">2</div>
              <div className="step-line"></div>
              <div className="step">3</div>
            </div>

            <button className="back-button" onClick={() => setStep('choice')}>← Back</button>

            <h3>How much would you like to pay?</h3>
            <p className="step-description">$4.99 = 30 days of access</p>

            <div className="amount-input-group">
              <span className="currency-symbol">$</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="amount-input"
                placeholder="4.99"
                autoFocus
              />
              <span className="currency-label">USD</span>
            </div>

            <div className="amount-info">
              <span>≈ {daysOfAccess} days of premium access</span>
            </div>

            <div className="quick-amounts">
              <button onClick={() => setAmount('4.99')} className={amount === '4.99' ? 'active' : ''}>
                $4.99<br/><small>1 month</small>
              </button>
              <button onClick={() => setAmount('10')} className={amount === '10' ? 'active' : ''}>
                $10<br/><small>2 months</small>
              </button>
              <button onClick={() => setAmount('25')} className={amount === '25' ? 'active' : ''}>
                $25<br/><small>5 months</small>
              </button>
              <button onClick={() => setAmount('50')} className={amount === '50' ? 'active' : ''}>
                $50<br/><small>10 months</small>
              </button>
            </div>

            <button
              className="btn-primary"
              onClick={() => setStep('currency')}
              disabled={!amount || parseFloat(amount) < 1}
            >
              Continue →
            </button>
          </div>
        )}

        {step === 'currency' && (
          <div className="payment-step">
            <div className="step-indicator">
              <div className="step completed">✓</div>
              <div className="step-line completed"></div>
              <div className="step active">2</div>
              <div className="step-line"></div>
              <div className="step">3</div>
            </div>

            <button className="back-button" onClick={() => setStep('amount')}>← Back</button>

            <h3>Choose payment method</h3>
            <p className="step-description">Select ETH or USDC</p>

            {connectedChain && (
              <div className="chain-badge">
                Connected to: <strong>{connectedChain}</strong>
              </div>
            )}

            <div className="currency-options">
              <button
                className={`currency-option ${currency === 'ETH' ? 'active' : ''}`}
                onClick={() => setCurrency('ETH')}
              >
                <div className="currency-icon">Ξ</div>
                <div className="currency-details">
                  <div className="currency-name">Ethereum (ETH)</div>
                  <div className="currency-amount">
                    {loadingPrice ? 'Loading...' : `≈ ${tokenAmount} ETH`}
                  </div>
                  {!loadingPrice && (
                    <div className="currency-rate">1 ETH = ${ethPrice.toLocaleString()}</div>
                  )}
                </div>
              </button>

              <button
                className={`currency-option ${currency === 'USDC' ? 'active' : ''}`}
                onClick={() => setCurrency('USDC')}
              >
                <div className="currency-icon">$</div>
                <div className="currency-details">
                  <div className="currency-name">USD Coin (USDC)</div>
                  <div className="currency-amount">
                    {tokenAmount} USDC
                  </div>
                  <div className="currency-rate">1 USDC = $1.00</div>
                </div>
              </button>
            </div>

            <button
              className="btn-primary"
              onClick={() => setStep('confirm')}
            >
              Continue →
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="payment-step">
            <div className="step-indicator">
              <div className="step completed">✓</div>
              <div className="step-line completed"></div>
              <div className="step completed">✓</div>
              <div className="step-line completed"></div>
              <div className="step active">3</div>
            </div>

            <button className="back-button" onClick={() => setStep('currency')}>← Back</button>

            <h3>Confirm payment</h3>
            <p className="step-description">Review and confirm your subscription</p>

            <div className="payment-summary">
              <div className="summary-row">
                <span>Amount</span>
                <strong>${amount} USD</strong>
              </div>
              <div className="summary-row">
                <span>Payment method</span>
                <strong>{tokenAmount} {currency}</strong>
              </div>
              <div className="summary-row">
                <span>Network</span>
                <strong>{connectedChain || 'Unknown'}</strong>
              </div>
              <div className="summary-divider"></div>
              <div className="summary-row highlight">
                <span>Premium access</span>
                <strong>{daysOfAccess} days</strong>
              </div>
            </div>

            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            <div className="payment-notes">
              <p><strong>Note:</strong></p>
              <ul>
                <li>Payment will be sent from your connected wallet</li>
                <li>Subscription activates after blockchain confirmation (~1-2 min)</li>
                <li>Refresh the page after payment to update status</li>
              </ul>
            </div>

            <button
              className="btn-primary btn-large"
              onClick={handleSendPayment}
            >
              💳 Pay ${amount} in {currency}
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="payment-step processing">
            <div className="spinner-large"></div>
            <h3>Processing payment...</h3>
            <p>Please confirm the transaction in your wallet</p>
            <p className="processing-note">This may take a moment. Do not close this window.</p>
          </div>
        )}

        <style jsx>{`
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 1rem;
          }

          .modal-content {
            background: white;
            border-radius: 16px;
            max-width: 500px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          }

          .modal-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            font-size: 2rem;
            cursor: pointer;
            color: #666;
            line-height: 1;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.2s;
          }

          .modal-close:hover {
            background: #f3f4f6;
            color: #000;
          }

          .modal-header {
            padding: 2rem 2rem 1rem;
            border-bottom: 1px solid #e5e7eb;
            text-align: center;
          }

          .modal-header h2 {
            margin: 0 0 0.5rem 0;
            font-size: 1.75rem;
            color: #111;
          }

          .modal-header p {
            margin: 0;
            color: #6b7280;
            font-size: 0.875rem;
          }

          .payment-step {
            padding: 2rem;
          }

          .step-indicator {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 2rem;
          }

          .step {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #e5e7eb;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            color: #9ca3af;
            transition: all 0.3s;
          }

          .step.active {
            background: #3b82f6;
            color: white;
          }

          .step.completed {
            background: #10b981;
            color: white;
          }

          .step-line {
            width: 60px;
            height: 2px;
            background: #e5e7eb;
            transition: all 0.3s;
          }

          .step-line.completed {
            background: #10b981;
          }

          .payment-step h3 {
            margin: 0 0 0.5rem 0;
            font-size: 1.5rem;
            text-align: center;
            color: #111;
          }

          .step-description {
            text-align: center;
            color: #6b7280;
            margin: 0 0 2rem 0;
            font-size: 0.875rem;
          }

          .back-button {
            background: none;
            border: none;
            color: #3b82f6;
            cursor: pointer;
            font-size: 0.875rem;
            padding: 0.5rem 0;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }

          .back-button:hover {
            color: #2563eb;
          }

          .amount-input-group {
            position: relative;
            display: flex;
            align-items: center;
            margin-bottom: 1rem;
          }

          .currency-symbol {
            position: absolute;
            left: 1.25rem;
            font-size: 1.5rem;
            color: #6b7280;
            font-weight: 600;
          }

          .amount-input {
            flex: 1;
            padding: 1.25rem 1rem 1.25rem 3rem;
            font-size: 1.5rem;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            text-align: center;
            font-weight: 600;
            transition: all 0.2s;
          }

          .amount-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }

          .currency-label {
            position: absolute;
            right: 1.25rem;
            font-size: 1rem;
            color: #6b7280;
            font-weight: 600;
          }

          .amount-info {
            text-align: center;
            color: #6b7280;
            font-size: 0.875rem;
            margin-bottom: 2rem;
          }

          .quick-amounts {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.75rem;
            margin-bottom: 2rem;
          }

          .quick-amounts button {
            padding: 1rem 0.5rem;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            background: white;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s;
          }

          .quick-amounts button:hover {
            border-color: #3b82f6;
            background: #eff6ff;
          }

          .quick-amounts button.active {
            border-color: #3b82f6;
            background: #3b82f6;
            color: white;
          }

          .quick-amounts small {
            font-size: 0.75rem;
            opacity: 0.8;
          }

          .chain-badge {
            background: #eff6ff;
            border: 1px solid #3b82f6;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            text-align: center;
            margin-bottom: 1.5rem;
            font-size: 0.875rem;
            color: #1e40af;
          }

          .currency-options {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin-bottom: 2rem;
          }

          .currency-option {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1.25rem;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            background: white;
            cursor: pointer;
            transition: all 0.2s;
            text-align: left;
          }

          .currency-option:hover {
            border-color: #3b82f6;
            background: #eff6ff;
          }

          .currency-option.active {
            border-color: #3b82f6;
            background: #eff6ff;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }

          .currency-icon {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: #f3f4f6;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: 600;
            flex-shrink: 0;
          }

          .currency-details {
            flex: 1;
          }

          .currency-name {
            font-weight: 600;
            color: #111;
            margin-bottom: 0.25rem;
          }

          .currency-amount {
            color: #3b82f6;
            font-weight: 600;
            font-size: 0.875rem;
          }

          .currency-rate {
            color: #6b7280;
            font-size: 0.75rem;
            margin-top: 0.125rem;
          }

          .payment-summary {
            background: #f9fafb;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 0.75rem 0;
          }

          .summary-row span {
            color: #6b7280;
          }

          .summary-row.highlight {
            color: #3b82f6;
            font-size: 1.125rem;
          }

          .summary-divider {
            height: 1px;
            background: #e5e7eb;
            margin: 0.5rem 0;
          }

          .payment-notes {
            background: #fffbeb;
            border: 1px solid #fbbf24;
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            font-size: 0.875rem;
          }

          .payment-notes p {
            margin: 0 0 0.5rem 0;
            font-weight: 600;
            color: #92400e;
          }

          .payment-notes ul {
            margin: 0;
            padding-left: 1.25rem;
            color: #78350f;
          }

          .payment-notes li {
            margin: 0.25rem 0;
          }

          .btn-primary {
            width: 100%;
            padding: 1rem;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
          }

          .btn-primary:hover:not(:disabled) {
            background: #2563eb;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          }

          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .btn-large {
            padding: 1.25rem;
            font-size: 1.125rem;
          }

          .processing {
            text-align: center;
            padding: 3rem 2rem;
          }

          .spinner-large {
            width: 60px;
            height: 60px;
            border: 4px solid #e5e7eb;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 2rem;
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          .processing h3 {
            margin-bottom: 0.5rem;
          }

          .processing p {
            color: #6b7280;
            margin: 0.5rem 0;
          }

          .processing-note {
            font-size: 0.875rem;
            color: #9ca3af;
          }

          .error-message {
            background: #fee2e2;
            border: 1px solid #fca5a5;
            color: #991b1b;
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1.5rem;
            font-size: 0.875rem;
          }

          .choice-options {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          .choice-option {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1.5rem;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            background: white;
            cursor: pointer;
            transition: all 0.2s;
            text-align: left;
            width: 100%;
          }

          .choice-option:hover {
            border-color: #3b82f6;
            background: #eff6ff;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
          }

          .choice-icon {
            font-size: 2.5rem;
            flex-shrink: 0;
          }

          .choice-details {
            flex: 1;
          }

          .choice-title {
            font-weight: 600;
            font-size: 1.125rem;
            color: #111;
            margin-bottom: 0.25rem;
          }

          .choice-description {
            color: #6b7280;
            font-size: 0.875rem;
          }

          .choice-divider {
            text-align: center;
            position: relative;
            margin: 0.5rem 0;
          }

          .choice-divider span {
            background: white;
            padding: 0 1rem;
            color: #9ca3af;
            font-size: 0.875rem;
            font-weight: 600;
            position: relative;
            z-index: 1;
          }

          .choice-divider::before {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            top: 50%;
            height: 1px;
            background: #e5e7eb;
            z-index: 0;
          }

          .promo-input-group {
            margin-bottom: 1.5rem;
          }

          .promo-input {
            width: 100%;
            padding: 1rem;
            font-size: 1rem;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            transition: all 0.2s;
            text-align: center;
            font-weight: 500;
          }

          .promo-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }

          .message-box {
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1.5rem;
            font-size: 0.875rem;
          }

          .message-box.success {
            background: #d1fae5;
            border: 1px solid #10b981;
            color: #065f46;
          }

          .message-box.error {
            background: #fee2e2;
            border: 1px solid #fca5a5;
            color: #991b1b;
          }
        `}</style>
      </div>
    </div>
  );
}
