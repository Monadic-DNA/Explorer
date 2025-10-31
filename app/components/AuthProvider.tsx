"use client";

import { DynamicContextProvider, DynamicWidget, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

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

// Inner component to sync Dynamic context with Auth context
function AuthStateSync({
  onAuthStateChange,
  onCheckSubscription,
}: {
  onAuthStateChange: (isAuth: boolean, user: any) => void;
  onCheckSubscription: (walletAddress: string) => Promise<void>;
}) {
  const { user: dynamicUser, isAuthenticated: dynamicIsAuthenticated } = useDynamicContext();

  useEffect(() => {
    console.log('[AuthStateSync] Dynamic state:', {
      isAuthenticated: dynamicIsAuthenticated,
      hasUser: !!dynamicUser,
      userAddress: dynamicUser?.verifiedCredentials?.[0]?.address || dynamicUser?.walletPublicKey
    });

    // If we have a user with a wallet, treat them as authenticated
    // Dynamic sometimes returns undefined for isAuthenticated initially
    const isAuth = dynamicUser ? true : (dynamicIsAuthenticated || false);

    // Sync Dynamic's auth state with our context
    onAuthStateChange(isAuth, dynamicUser);

    // If we have a user with wallet address, check subscription
    if (dynamicUser) {
      const walletAddress = dynamicUser?.verifiedCredentials?.[0]?.address || dynamicUser?.walletPublicKey;
      if (walletAddress) {
        console.log('[AuthStateSync] Checking subscription for wallet:', walletAddress);
        onCheckSubscription(walletAddress);
      } else {
        console.warn('[AuthStateSync] User exists but no wallet address found');
      }
    }
  }, [dynamicIsAuthenticated, dynamicUser, onAuthStateChange, onCheckSubscription]);

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [checkingSubscription, setCheckingSubscription] = useState(true);

  const checkSubscription = useCallback(async (walletAddress: string) => {
    try {
      console.log('[AuthProvider] Checking subscription for:', walletAddress);
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
  }, []);

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

  // On mount, if no user is authenticated, stop checking subscription
  useEffect(() => {
    if (!isAuthenticated && !user) {
      setCheckingSubscription(false);
    }
  }, [isAuthenticated, user]);

  const handleAuthStateChange = useCallback((isAuth: boolean, dynamicUser: any) => {
    console.log('[AuthProvider] Auth state changed:', { isAuth, hasUser: !!dynamicUser, userAddress: dynamicUser?.verifiedCredentials?.[0]?.address });
    setIsAuthenticated(isAuth);
    setUser(dynamicUser);

    if (!isAuth) {
      // User logged out
      setHasActiveSubscription(false);
      setSubscriptionData(null);
      setCheckingSubscription(false);
    }
  }, []);

  return (
    <DynamicContextProvider
      settings={{
        environmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID || '',
        walletConnectors: [EthereumWalletConnectors],
        events: {
          onLogout: () => {
            setIsAuthenticated(false);
            setUser(null);
            setHasActiveSubscription(false);
            setSubscriptionData(null);
            setCheckingSubscription(false);
          },
        },
      }}
    >
      <AuthStateSync
        onAuthStateChange={handleAuthStateChange}
        onCheckSubscription={checkSubscription}
      />
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
