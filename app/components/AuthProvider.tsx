"use client";

import { DynamicContextProvider, DynamicWidget, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { ZeroDevSmartWalletConnectors } from '@dynamic-labs/ethereum-aa';
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { trackUserLoggedIn } from '@/lib/analytics';
import { hasValidPromoAccess } from '@/lib/promo-access';

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
  initializeDynamic: () => void;
  isDynamicInitialized: boolean;
  openAuthModal: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  hasActiveSubscription: false,
  checkingSubscription: true,
  subscriptionData: null,
  refreshSubscription: async () => {},
  initializeDynamic: () => {},
  isDynamicInitialized: false,
  openAuthModal: () => {},
});

export const useAuth = () => useContext(AuthContext);

// Inner component to sync Dynamic context with Auth context
// NOTE: No longer automatically checks subscription - must be triggered manually
function AuthStateSync({
  onAuthStateChange,
  onOpenAuthModal,
}: {
  onAuthStateChange: (isAuth: boolean, user: any) => void;
  onOpenAuthModal: (openFn: () => void) => void;
}) {
  const { user: dynamicUser, setShowAuthFlow } = useDynamicContext();

  useEffect(() => {
    console.log('[AuthStateSync] Dynamic state:', {
      hasUser: !!dynamicUser,
      userAddress: dynamicUser?.verifiedCredentials?.[0]?.address
    });

    // If we have a user with a wallet, treat them as authenticated
    const isAuth = !!dynamicUser;

    // Sync Dynamic's auth state with our context
    onAuthStateChange(isAuth, dynamicUser);
  }, [dynamicUser, onAuthStateChange]);

  // Provide the openAuthModal function to the parent
  useEffect(() => {
    if (setShowAuthFlow) {
      onOpenAuthModal(() => setShowAuthFlow(true));
    }
  }, [setShowAuthFlow, onOpenAuthModal]);

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [checkingSubscription, setCheckingSubscription] = useState(false); // Changed default to false
  const [isDynamicInitialized, setIsDynamicInitialized] = useState(false);
  const [openAuthModalFn, setOpenAuthModalFn] = useState<(() => void) | null>(null);

  // If environment ID is not set, render without Dynamic (useful for CI/CD builds)
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;
  const isDynamicEnabled = !!environmentId;

  const checkSubscription = useCallback(async (walletAddress: string) => {
    try {
      console.log('[AuthProvider] Checking subscription for:', walletAddress);
      setCheckingSubscription(true);

      // OPTIMIZATION: Check promo code first (client-side, instant)
      if (hasValidPromoAccess()) {
        console.log('[AuthProvider] ✅ Valid promo code found - skipping API call');
        setHasActiveSubscription(true);
        setSubscriptionData({
          isActive: true,
          expiresAt: null,
          daysRemaining: 999, // Promo access (no expiration currently)
          totalDaysPurchased: 0,
          totalPaid: 0,
          paymentCount: 0,
        });
        setCheckingSubscription(false);
        return;
      }

      console.log('[AuthProvider] No promo code, checking Stripe/blockchain...');

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

  // Initialize Dynamic and trigger subscription check
  const initializeDynamic = useCallback(() => {
    if (!isDynamicEnabled) {
      console.log('[AuthProvider] Dynamic not enabled (missing environment ID)');
      return;
    }

    if (isDynamicInitialized) {
      console.log('[AuthProvider] Dynamic already initialized');
      return;
    }

    console.log('[AuthProvider] Initializing Dynamic...');
    setIsDynamicInitialized(true);

    // If we already have a user (from previous session), check subscription
    if (user) {
      const walletAddress = user?.verifiedCredentials?.[0]?.address;
      if (walletAddress) {
        console.log('[AuthProvider] Checking subscription for existing user:', walletAddress);
        checkSubscription(walletAddress);
      }
    }
  }, [isDynamicEnabled, isDynamicInitialized, user, checkSubscription]);

  const handleAuthStateChange = useCallback((isAuth: boolean, dynamicUser: any) => {
    console.log('[AuthProvider] Auth state changed:', { isAuth, hasUser: !!dynamicUser, userAddress: dynamicUser?.verifiedCredentials?.[0]?.address });

    const wasAuthenticated = isAuthenticated;
    setIsAuthenticated(isAuth);
    setUser(dynamicUser);

    if (!isAuth) {
      // User logged out
      setHasActiveSubscription(false);
      setSubscriptionData(null);
      setCheckingSubscription(false);
    } else if (dynamicUser && isDynamicInitialized) {
      // User logged in
      const walletAddress = dynamicUser?.verifiedCredentials?.[0]?.address;
      if (walletAddress) {
        console.log('[AuthProvider] User logged in, checking subscription:', walletAddress);

        // Track login event (only on new login, not on page refresh)
        if (!wasAuthenticated) {
          trackUserLoggedIn();
        }

        checkSubscription(walletAddress);
      }
    }
  }, [isDynamicInitialized, checkSubscription, isAuthenticated]);

  const handleOpenAuthModal = useCallback((openFn: () => void) => {
    setOpenAuthModalFn(() => openFn);
  }, []);

  const openAuthModal = useCallback(() => {
    if (openAuthModalFn) {
      openAuthModalFn();
    }
  }, [openAuthModalFn]);

  // If Dynamic is not enabled (no environment ID), render children with default auth context
  if (!isDynamicEnabled) {
    return (
      <AuthContext.Provider
        value={{
          isAuthenticated: false,
          user: null,
          hasActiveSubscription: false,
          checkingSubscription: false,
          subscriptionData: null,
          refreshSubscription: async () => {},
          initializeDynamic: () => {},
          isDynamicInitialized: false,
          openAuthModal: () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  // Render without Dynamic until explicitly initialized
  if (!isDynamicInitialized) {
    return (
      <AuthContext.Provider
        value={{
          isAuthenticated,
          user,
          hasActiveSubscription,
          checkingSubscription,
          subscriptionData,
          refreshSubscription,
          initializeDynamic,
          isDynamicInitialized,
          openAuthModal: () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId: environmentId,
        walletConnectors: [EthereumWalletConnectors, ZeroDevSmartWalletConnectors],
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
        onOpenAuthModal={handleOpenAuthModal}
      />
      <AuthContext.Provider
        value={{
          isAuthenticated,
          user,
          hasActiveSubscription,
          checkingSubscription,
          subscriptionData,
          refreshSubscription,
          initializeDynamic,
          isDynamicInitialized,
          openAuthModal,
        }}
      >
        {children}
      </AuthContext.Provider>
    </DynamicContextProvider>
  );
}

export function AuthButton() {
  const { isDynamicInitialized } = useAuth();

  // Don't render widget if Dynamic is not initialized yet
  if (!isDynamicInitialized) {
    return null;
  }

  return <DynamicWidget />;
}
