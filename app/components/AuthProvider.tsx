"use client";

import { DynamicContextProvider, DynamicWidget } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface SubscriptionData {
  isActive: boolean;
  expiresAt: string | null;
  daysRemaining: number;
  totalDaysPurchased: number;
  totalPaid: number;
  paymentCount: number;
}

interface CachedSubscription {
  data: SubscriptionData;
  timestamp: number;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: any | null;
  hasActiveSubscription: boolean;
  checkingSubscription: boolean;
  subscriptionData: SubscriptionData | null;
  refreshSubscription: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  hasActiveSubscription: false,
  checkingSubscription: true,
  subscriptionData: null,
  refreshSubscription: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// Cache duration: 1 hour (configurable via env var)
const CACHE_DURATION_MS = parseInt(process.env.NEXT_PUBLIC_SUBSCRIPTION_CACHE_HOURS || '1') * 60 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [checkingSubscription, setCheckingSubscription] = useState(true);

  const checkSubscription = async (walletAddress: string) => {
    try {
      setCheckingSubscription(true);

      // Check localStorage cache first
      const cacheKey = `subscription_${walletAddress.toLowerCase()}`;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        try {
          const parsedCache: CachedSubscription = JSON.parse(cached);
          const cacheAge = Date.now() - parsedCache.timestamp;

          // If cache is fresh, use it
          if (cacheAge < CACHE_DURATION_MS) {
            setHasActiveSubscription(parsedCache.data.isActive);
            setSubscriptionData(parsedCache.data);
            setCheckingSubscription(false);
            console.log(`Using cached subscription status (age: ${Math.round(cacheAge / 60000)} minutes)`);
            return;
          }
        } catch (err) {
          console.warn('Failed to parse cached subscription data:', err);
        }
      }

      // Cache miss or stale - query API
      console.log('Fetching fresh subscription status from blockchain...');
      const response = await fetch('/api/check-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      const subData = result.subscription;
      setHasActiveSubscription(subData.isActive);
      setSubscriptionData(subData);

      // Update cache
      const cacheData: CachedSubscription = {
        data: subData,
        timestamp: Date.now(),
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheData));

    } catch (error) {
      console.error('Failed to check subscription:', error);
      setHasActiveSubscription(false);
      setSubscriptionData(null);
    } finally {
      setCheckingSubscription(false);
    }
  };

  const refreshSubscription = async () => {
    // Get wallet address from user object (Dynamic.xyz provides this)
    const walletAddress = user?.verifiedCredentials?.[0]?.address || user?.walletPublicKey;
    if (walletAddress) {
      // Clear cache to force fresh fetch
      const cacheKey = `subscription_${walletAddress.toLowerCase()}`;
      localStorage.removeItem(cacheKey);
      await checkSubscription(walletAddress);
    }
  };

  return (
    <DynamicContextProvider
      settings={{
        environmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID || '',
        walletConnectors: [EthereumWalletConnectors],
        events: {
          onAuthSuccess: async (args) => {
            setIsAuthenticated(true);
            setUser(args.user);
            // Get wallet address from authenticated user
            const walletAddress = args.user?.verifiedCredentials?.[0]?.address || args.user?.walletPublicKey;
            if (walletAddress) {
              await checkSubscription(walletAddress);
            } else {
              // No wallet connected yet, mark as not subscribed
              setCheckingSubscription(false);
            }
          },
          onLogout: () => {
            setIsAuthenticated(false);
            setUser(null);
            setHasActiveSubscription(false);
            setSubscriptionData(null);
            setCheckingSubscription(true);
          },
        },
      }}
    >
      <AuthContext.Provider
        value={{
          isAuthenticated,
          user,
          hasActiveSubscription,
          checkingSubscription,
          subscriptionData,
          refreshSubscription,
        }}
      >
        {children}
      </AuthContext.Provider>
    </DynamicContextProvider>
  );
}

export function AuthButton() {
  return <DynamicWidget />;
}
