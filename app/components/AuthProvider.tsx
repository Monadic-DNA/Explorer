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

// Inner component to sync Dynamic context with Auth context
function AuthStateSync({
  onAuthStateChange,
  onCheckSubscription,
}: {
  onAuthStateChange: (isAuth: boolean, user: any) => void;
  onCheckSubscription: (walletAddress: string) => Promise<void>;
}) {
  const { user: dynamicUser } = useDynamicContext();

  useEffect(() => {
    console.log('[AuthStateSync] Dynamic state:', {
      hasUser: !!dynamicUser,
      userAddress: dynamicUser?.verifiedCredentials?.[0]?.address
    });

    // If we have a user with a wallet, treat them as authenticated
    const isAuth = !!dynamicUser;

    // Sync Dynamic's auth state with our context
    onAuthStateChange(isAuth, dynamicUser);

    // If we have a user with wallet address, check subscription
    if (dynamicUser) {
      const walletAddress = dynamicUser?.verifiedCredentials?.[0]?.address;
      if (walletAddress) {
        console.log('[AuthStateSync] Checking subscription for wallet:', walletAddress);
        onCheckSubscription(walletAddress);
      } else {
        console.warn('[AuthStateSync] User exists but no wallet address found');
      }
    }
  }, [dynamicUser, onAuthStateChange, onCheckSubscription]);

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

      // Query API directly - no caching
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

      console.log('[AuthProvider] Subscription check complete:', {
        isActive: subData.isActive,
        daysRemaining: subData.daysRemaining,
      });

    } catch (error) {
      console.error('[AuthProvider] Failed to check subscription:', error);
      setHasActiveSubscription(false);
      setSubscriptionData(null);
    } finally {
      setCheckingSubscription(false);
    }
  }, []);

  const refreshSubscription = async () => {
    const walletAddress = user?.verifiedCredentials?.[0]?.address;
    if (walletAddress) {
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
