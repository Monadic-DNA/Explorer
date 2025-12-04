"use client";

import { useState, useEffect } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { parseUnits, encodeFunctionData, createPublicClient, http, formatUnits } from 'viem';
import { mainnet, base, arbitrum, optimism, polygon, sepolia } from 'viem/chains';
import { verifyPromoCode } from '@/lib/prime-verification';
import StripeSubscriptionForm from './StripeSubscriptionForm';
import { trackSubscribedWithPromoCode, trackSubscribedWithCreditCard, trackSubscribedWithStablecoin } from '@/lib/analytics';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Currency = 'USDC' | 'USDT' | 'DAI';
type PaymentType = 'stablecoin' | 'card' | 'promo';
type Step = 'choice' | 'promo' | 'amount' | 'currency' | 'confirm' | 'processing' | 'confirming' | 'card-payment' | 'card-success';

export default function PaymentModal({ isOpen, onClose, onSuccess }: PaymentModalProps) {
  const { primaryWallet } = useDynamicContext();
  const [step, setStep] = useState<Step>('choice');
  const [paymentType, setPaymentType] = useState<PaymentType>('stablecoin');
  const [amount, setAmount] = useState('4.99');
  const [currency, setCurrency] = useState<Currency>('USDC');
  const [connectedChain, setConnectedChain] = useState<string>('');
  const [error, setError] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoMessage, setPromoMessage] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });
  const [transactionHash, setTransactionHash] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const [successfulChecks, setSuccessfulChecks] = useState(0);

  const paymentWallet = process.env.NEXT_PUBLIC_EVM_PAYMENT_WALLET_ADDRESS || '';
  const testnetEnabled = process.env.NEXT_PUBLIC_ENABLE_TESTNET_CHAINS === 'true';

  // Block explorer URLs for each chain
  const BLOCK_EXPLORERS: Record<string, string> = {
    'Ethereum': 'https://etherscan.io',
    'Base': 'https://basescan.org',
    'Arbitrum One': 'https://arbiscan.io',
    'OP Mainnet': 'https://optimistic.etherscan.io',
    'Polygon': 'https://polygonscan.com',
    'Sepolia': 'https://sepolia.etherscan.io',
  };

  const getBlockExplorerLink = (txHash: string, chain: string): string => {
    const baseUrl = BLOCK_EXPLORERS[chain] || 'https://etherscan.io';
    return `${baseUrl}/tx/${txHash}`;
  };

  const USDC_CONTRACTS: Record<string, string> = {
    'Ethereum': process.env.NEXT_PUBLIC_USDC_CONTRACT_ETHEREUM || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'Base': process.env.NEXT_PUBLIC_USDC_CONTRACT_BASE || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'Arbitrum One': process.env.NEXT_PUBLIC_USDC_CONTRACT_ARBITRUM || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    'OP Mainnet': process.env.NEXT_PUBLIC_USDC_CONTRACT_OPTIMISM || '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    'Polygon': process.env.NEXT_PUBLIC_USDC_CONTRACT_POLYGON || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    ...(testnetEnabled ? {
      'Sepolia': process.env.NEXT_PUBLIC_USDC_CONTRACT_SEPOLIA || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    } : {}),
  };

  const USDT_CONTRACTS: Record<string, string> = {
    'Ethereum': process.env.NEXT_PUBLIC_USDT_CONTRACT_ETHEREUM || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'Base': process.env.NEXT_PUBLIC_USDT_CONTRACT_BASE || '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    'Arbitrum One': process.env.NEXT_PUBLIC_USDT_CONTRACT_ARBITRUM || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    'OP Mainnet': process.env.NEXT_PUBLIC_USDT_CONTRACT_OPTIMISM || '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    'Polygon': process.env.NEXT_PUBLIC_USDT_CONTRACT_POLYGON || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    ...(testnetEnabled ? {
      'Sepolia': process.env.NEXT_PUBLIC_USDT_CONTRACT_SEPOLIA || '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
    } : {}),
  };

  const DAI_CONTRACTS: Record<string, string> = {
    'Ethereum': process.env.NEXT_PUBLIC_DAI_CONTRACT_ETHEREUM || '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    'Base': process.env.NEXT_PUBLIC_DAI_CONTRACT_BASE || '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    'Arbitrum One': process.env.NEXT_PUBLIC_DAI_CONTRACT_ARBITRUM || '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    'OP Mainnet': process.env.NEXT_PUBLIC_DAI_CONTRACT_OPTIMISM || '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    'Polygon': process.env.NEXT_PUBLIC_DAI_CONTRACT_POLYGON || '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    ...(testnetEnabled ? {
      'Sepolia': process.env.NEXT_PUBLIC_DAI_CONTRACT_SEPOLIA || '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357',
    } : {}),
  };

  // Map chain names to viem chain objects
  const CHAIN_MAP: Record<string, any> = {
    'Ethereum': mainnet,
    'Base': base,
    'Arbitrum One': arbitrum,
    'OP Mainnet': optimism,
    'Polygon': polygon,
    ...(testnetEnabled ? {
      'Sepolia': sepolia,
    } : {}),
  };

  // Check token balance for user's wallet
  const checkTokenBalance = async (
    walletAddress: string,
    tokenContract: string,
    chainName: string
  ): Promise<bigint> => {
    const chain = CHAIN_MAP[chainName];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainName}`);
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    // ERC20 balanceOf function
    const balance = await publicClient.readContract({
      address: tokenContract as `0x${string}`,
      abi: [{
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }]
      }],
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    });

    return balance as bigint;
  };

  // Detect connected chain
  useEffect(() => {
    const detectChain = async () => {
      if (primaryWallet) {
        try {
          // Try multiple methods to get chain info (compatibility with smart wallets and regular wallets)

          // Method 1: Try connector.getNetwork() for smart wallets
          if ((primaryWallet as any).connector?.getNetwork) {
            const network = await (primaryWallet as any).connector.getNetwork();
            if (network?.name) {
              setConnectedChain(network.name);
              return;
            }
          }

          // Method 2: Try getWalletClient for regular wallets
          if ((primaryWallet as any).getWalletClient) {
            const walletClient = await (primaryWallet as any).getWalletClient();
            if (walletClient && 'chain' in walletClient && walletClient.chain) {
              setConnectedChain(walletClient.chain.name);
              return;
            }
          }

          // Method 3: Fall back to checking connector chain directly
          if ((primaryWallet as any).connector?.chain?.name) {
            setConnectedChain((primaryWallet as any).connector.chain.name);
            return;
          }

          console.log('Could not detect chain, will default to user selection');
        } catch (err) {
          console.error('Failed to detect chain:', err);
          // Non-critical error - user can still manually select chain
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

      // Track promo code subscription
      trackSubscribedWithPromoCode(promoCode);

      // Success - trigger callback and close modal
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } else {
      setPromoMessage({ type: 'error', text: result.message });
    }
  };

  // Poll subscription status after blockchain payment
  const pollSubscriptionStatus = async (walletAddress: string, maxAttempts: number = 12) => {
    const POLL_INTERVAL = 10000; // 10 seconds
    let consecutiveSuccessfulChecks = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setRetryCount(attempt);

      try {
        console.log(`[PaymentModal] Checking subscription status (attempt ${attempt}/${maxAttempts})...`);

        // Query API directly
        const response = await fetch('/api/check-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        });

        if (response.ok) {
          const result = await response.json();

          if (result.success) {
            consecutiveSuccessfulChecks++;
            setSuccessfulChecks(consecutiveSuccessfulChecks);

            if (result.subscription.isActive) {
              console.log('[PaymentModal] ✅ Subscription activated!');
              // Success! Subscription is active
              setTimeout(() => {
                onSuccess();
                onClose();
              }, 1000);
              return;
            } else {
              console.log(`[PaymentModal] ⏳ API responded successfully but subscription not yet active (check ${consecutiveSuccessfulChecks})`);
              console.log('[PaymentModal] This is normal - blockchain indexer needs time to process the transaction');
            }
          } else {
            console.warn('[PaymentModal] ⚠️ API returned success=false:', result.error);
          }
        } else {
          console.error('[PaymentModal] ❌ API request failed with status:', response.status);
        }
      } catch (error) {
        console.error('[PaymentModal] ❌ Error checking subscription:', error);
      }

      // Wait before next attempt (unless it's the last attempt)
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    // Max attempts reached - show timeout message
    setError(`Transaction submitted to blockchain but not yet indexed. This can take a few minutes. You can close this modal and refresh the page in 2-3 minutes to check your subscription status, or view your transaction on the block explorer using the link above.`);
  };

  const handleCardPaymentSuccess = () => {
    // Clear subscription cache so next check will fetch fresh data
    if (primaryWallet?.address) {
      localStorage.removeItem(`subscription_${primaryWallet.address.toLowerCase()}`);
    }
    // Show success message
    setStep('card-success');

    // Track credit card subscription
    const durationDays = Math.round((parseFloat(amount || '0') / 4.99) * 30);
    trackSubscribedWithCreditCard(durationDays);

    // Close modal after 3 seconds and trigger success callback
    setTimeout(() => {
      onClose();
      onSuccess();
    }, 3000);
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
      // Type assertion for getWalletClient which exists at runtime but not in types
      const walletClient = await (primaryWallet as any).getWalletClient?.();
      if (!walletClient || !('sendTransaction' in walletClient)) {
        throw new Error('Wallet client not available');
      }

      // Detect current chain from wallet client (don't rely on state)
      let currentChain: string = '';
      if ('chain' in walletClient && walletClient.chain) {
        currentChain = walletClient.chain.name;
      }

      // Check if chain is detected
      if (!currentChain) {
        throw new Error('Unable to detect connected network. Please make sure your wallet is connected to a supported network.');
      }

      // Get the appropriate contract address for the selected stablecoin
      let tokenContract: string | undefined;
      let decimals: number;

      if (currency === 'USDC') {
        tokenContract = USDC_CONTRACTS[currentChain];
        decimals = 6;
      } else if (currency === 'USDT') {
        tokenContract = USDT_CONTRACTS[currentChain];
        decimals = 6;
      } else if (currency === 'DAI') {
        tokenContract = DAI_CONTRACTS[currentChain];
        decimals = 18;
      } else {
        throw new Error(`Unsupported currency: ${currency}`);
      }

      if (!tokenContract) {
        const supportedChains = Object.keys(USDC_CONTRACTS).join(', ');
        throw new Error(`${currency} is not supported on "${currentChain}". Supported networks: ${supportedChains}`);
      }

      // Parse token amount with appropriate decimals
      const tokenAmount = parseUnits(amount, decimals);

      // Check if user has sufficient balance
      const userBalance = await checkTokenBalance(
        primaryWallet.address!,
        tokenContract,
        currentChain
      );

      if (userBalance < tokenAmount) {
        const balanceFormatted = formatUnits(userBalance, decimals);
        throw new Error(
          `Insufficient ${currency} balance. You have ${balanceFormatted} ${currency} but need ${amount} ${currency}. Please use the Dynamic wallet (top right) to transfer or purchase ${currency}.`
        );
      }

      // Encode ERC-20 transfer function call
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
        args: [paymentWallet as `0x${string}`, tokenAmount]
      });

      const txHash = await walletClient.sendTransaction({
        to: tokenContract as `0x${string}`,
        data: transferData,
      });

      // Track stablecoin subscription
      const durationDays = Math.round((parseFloat(amount || '0') / 4.99) * 30);
      trackSubscribedWithStablecoin(durationDays);

      // Store transaction hash and switch to confirming step
      setTransactionHash(txHash);
      setStep('confirming');
      setRetryCount(0);
      setSuccessfulChecks(0);

      // Start polling for subscription status
      await pollSubscriptionStatus(primaryWallet.address!);

    } catch (err: any) {
      console.error('Payment failed:', err);

      // Check if it's a stablecoin balance issue (proactive check or transaction failure)
      if (
        err.message?.includes('Insufficient') ||
        err.message?.includes('gas required exceeds allowance') ||
        err.message?.includes('insufficient funds') ||
        err.details?.includes('gas required exceeds allowance') ||
        err.shortMessage?.includes('insufficient funds')
      ) {
        // Use our custom message if it's from the proactive balance check
        if (err.message?.includes('Dynamic wallet')) {
          setError(err.message);
        } else {
          setError(`Insufficient ${currency} balance. Please use the Dynamic wallet (top right) to transfer or purchase ${currency}.`);
        }
      } else {
        setError(err.shortMessage || err.message || 'Payment failed. Please try again.');
      }

      setStep('confirm');
    }
  };

  const daysOfAccess = Math.round((parseFloat(amount || '0') / 4.99) * 30);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content payment-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-header">
          <h2>💳 Subscribe to Premium</h2>
          <p>Get LLM Chat, Run All Analysis, and more</p>
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
                onClick={() => { setPaymentType('stablecoin'); setStep('amount'); }}
              >
                <div className="choice-icon">💵</div>
                <div className="choice-details">
                  <div className="choice-title">Pay with Stablecoin</div>
                  <div className="choice-description">Use USDC, USDT, or DAI to subscribe</div>
                </div>
              </button>

              <button
                className="choice-option"
                onClick={() => { setPaymentType('card'); setStep('card-payment'); }}
              >
                <div className="choice-icon">💳</div>
                <div className="choice-details">
                  <div className="choice-title">Pay with Card</div>
                  <div className="choice-description">$4.99/month subscription (Stripe)</div>
                </div>
              </button>

              <div className="choice-divider">
                <span>OR</span>
              </div>

              <button
                className="choice-option"
                onClick={() => { setPaymentType('promo'); setStep('promo'); }}
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

            <h3>Choose stablecoin</h3>
            <p className="step-description">Select USDC, USDT, or DAI</p>

            {connectedChain && (
              <div className="chain-badge">
                Connected to: <strong>{connectedChain}</strong>
                {connectedChain === 'Sepolia' && <span style={{ marginLeft: '0.5rem' }}>🧪 TESTNET</span>}
              </div>
            )}

            <div className="currency-options">
              <button
                className={`currency-option ${currency === 'USDC' ? 'active' : ''}`}
                onClick={() => setCurrency('USDC')}
              >
                <div className="currency-icon">💵</div>
                <div className="currency-details">
                  <div className="currency-name">USD Coin (USDC)</div>
                  <div className="currency-amount">
                    {amount} USDC
                  </div>
                  <div className="currency-rate">1 USDC = $1.00</div>
                </div>
              </button>

              <button
                className={`currency-option ${currency === 'USDT' ? 'active' : ''}`}
                onClick={() => setCurrency('USDT')}
              >
                <div className="currency-icon">₮</div>
                <div className="currency-details">
                  <div className="currency-name">Tether (USDT)</div>
                  <div className="currency-amount">
                    {amount} USDT
                  </div>
                  <div className="currency-rate">1 USDT = $1.00</div>
                </div>
              </button>

              <button
                className={`currency-option ${currency === 'DAI' ? 'active' : ''}`}
                onClick={() => setCurrency('DAI')}
              >
                <div className="currency-icon">◈</div>
                <div className="currency-details">
                  <div className="currency-name">Dai Stablecoin (DAI)</div>
                  <div className="currency-amount">
                    {amount} DAI
                  </div>
                  <div className="currency-rate">1 DAI = $1.00</div>
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
                <strong>{amount} {currency}</strong>
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
              💳 Pay {amount} {currency}
            </button>
          </div>
        )}

        {step === 'card-payment' && primaryWallet?.address && (
          <div className="payment-step">
            <button className="back-button" onClick={() => setStep('choice')}>← Back</button>

            <h3>Subscribe with Card</h3>
            <p className="step-description">$4.99/month • Recurring subscription via Stripe</p>

            <div className="payment-notes" style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.9rem', color: '#888' }}>
                Wallet: {primaryWallet.address.slice(0, 6)}...{primaryWallet.address.slice(-4)}
              </p>
            </div>

            <StripeSubscriptionForm
              walletAddress={primaryWallet.address}
              onSuccess={handleCardPaymentSuccess}
              onCancel={() => setStep('choice')}
            />
          </div>
        )}

        {step === 'card-success' && (
          <div className="payment-step processing">
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>✓</div>
            <h3>Payment Successful!</h3>
            <p>Your subscription is now active.</p>
            <p className="processing-note">Thank you for subscribing to Premium!</p>
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

        {step === 'confirming' && (
          <div className="payment-step processing">
            <div className="spinner-large"></div>
            <h3>Waiting for confirmation...</h3>
            <p>Your transaction has been sent to the blockchain</p>

            {transactionHash && connectedChain && (
              <div style={{ margin: '1.5rem 0', padding: '1rem', background: '#f3f4f6', borderRadius: '8px' }}>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                  Transaction Hash:
                </p>
                <a
                  href={getBlockExplorerLink(transactionHash, connectedChain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.875rem',
                    color: '#3b82f6',
                    wordBreak: 'break-all',
                    textDecoration: 'underline',
                  }}
                >
                  {transactionHash.slice(0, 10)}...{transactionHash.slice(-8)}
                </a>
              </div>
            )}

            <p className="processing-note">
              Checking subscription status... (attempt {retryCount} of 12)
            </p>
            {successfulChecks > 0 && (
              <p className="processing-note" style={{ fontSize: '0.875rem', marginTop: '0.5rem', color: '#3b82f6' }}>
                ✓ Blockchain indexer processing transaction ({successfulChecks} {successfulChecks === 1 ? 'check' : 'checks'} completed)
              </p>
            )}
            <p className="processing-note" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
              Usually takes 1-2 minutes. Do not close this window.
            </p>

            {error && (
              <div className="error-message" style={{ marginTop: '1rem' }}>
                ⚠️ {error}
              </div>
            )}
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
