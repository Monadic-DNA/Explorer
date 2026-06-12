"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthButton, useAuth } from "./AuthProvider";
import { clearPromoAccess, hasValidPromoAccess } from "@/lib/promo-access";
import { trackOverviewReportTabViewed } from "@/lib/analytics";

type PremiumFeatureHeaderProps = {
  featureName: string;
  description: string;
  gateTitle?: string;       // overrides default "featureName is a premium tab" / "Premium subscription required"
  gateDescription?: string; // overrides default "Subscribe for $4.99/month to access featureName."
};

export default function PremiumFeatureHeader({
  featureName,
  description,
  gateTitle,
  gateDescription,
}: PremiumFeatureHeaderProps) {
  const {
    isAuthenticated,
    hasActiveSubscription,
    subscriptionData,
    checkingSubscription,
    user,
    initializeDynamic,
    isDynamicInitialized,
    refreshSubscription,
    openAuthModal,
  } = useAuth();
  const [showSubscriptionMenu, setShowSubscriptionMenu] = useState(false);
  const [hasPromoAccess, setHasPromoAccess] = useState(false);
  const tabViewTrackedRef = useRef(false);

  useEffect(() => {
    if (!isDynamicInitialized) {
      initializeDynamic();
    }
    setHasPromoAccess(hasValidPromoAccess());
  }, [initializeDynamic, isDynamicInitialized]);

  useEffect(() => {
    const refreshPromoAccess = () => {
      setHasPromoAccess(hasValidPromoAccess());
    };

    window.addEventListener('premiumAccessUpdated', refreshPromoAccess);
    return () => window.removeEventListener('premiumAccessUpdated', refreshPromoAccess);
  }, []);

  const hasPremiumAccess = hasActiveSubscription || hasPromoAccess;

  useEffect(() => {
    if (tabViewTrackedRef.current) return;
    tabViewTrackedRef.current = true;
    trackOverviewReportTabViewed(hasPremiumAccess);
  }, [featureName, hasPremiumAccess]);

  return (
    <section className="premium-compact-header">
      <div className="premium-header-content">
        {!isAuthenticated && !hasPromoAccess ? (
          <div className="auth-prompt-inline">
            <div className="subscription-message">
              <strong>{gateTitle ?? `${featureName} is a premium tab`}</strong>
              <span>{description}</span>
            </div>
            <button
              onClick={openAuthModal}
              className="subscribe-button"
            >
              Sign In
            </button>
          </div>
        ) : !hasPremiumAccess ? (
          <div className="subscription-prompt-inline">
            <div className="subscription-message">
              <strong>{gateTitle ?? 'Premium subscription required'}</strong>
              <span>{gateDescription ?? `Subscribe for $4.99/month to access ${featureName}.`}</span>
            </div>
            <Link href="/subscribe" className="subscribe-button">
              Subscribe
            </Link>
          </div>
        ) : (
          <div className="subscription-active-inline">
            <span>Premium access active</span>
          </div>
        )}

        <div className="premium-wallet-section">
          <AuthButton />
        </div>

        {(subscriptionData || hasPromoAccess) && (
          <div className="subscription-menu-container">
            <button
              onClick={() => setShowSubscriptionMenu(!showSubscriptionMenu)}
              className="subscription-menu-button"
              title="Subscription options"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"/>
                <circle cx="12" cy="12" r="2"/>
                <circle cx="12" cy="19" r="2"/>
              </svg>
            </button>

            {showSubscriptionMenu && (
              <>
                <div
                  className="subscription-menu-backdrop"
                  onClick={() => setShowSubscriptionMenu(false)}
                />
                <div className="subscription-menu-dropdown">
                  <div className="subscription-menu-header">
                    <div className="subscription-menu-info">
                      <strong>Premium Access</strong>
                      {(subscriptionData?.daysRemaining ?? 0) > 0 && (
                        <span>{subscriptionData?.daysRemaining} days remaining in current cycle</span>
                      )}
                      {subscriptionData?.expiresAt && (
                        <span className="expires-date">Renews {new Date(subscriptionData.expiresAt).toLocaleDateString()}</span>
                      )}
                      {hasPromoAccess && (
                        <span>Promo access enabled</span>
                      )}
                    </div>
                  </div>
                  <div className="subscription-menu-divider"></div>
                  {subscriptionData && (
                    <>
                      <button
                        onClick={async () => {
                          setShowSubscriptionMenu(false);
                          try {
                            await refreshSubscription(true);
                            alert('Subscription status refreshed.');
                          } catch (error) {
                            console.error('Failed to refresh subscription:', error);
                            alert('Failed to refresh subscription. Please try again.');
                          }
                        }}
                        className="subscription-menu-item"
                        disabled={checkingSubscription}
                      >
                        {checkingSubscription ? 'Checking...' : 'Refresh Subscription'}
                      </button>
                      <button
                        onClick={async () => {
                          setShowSubscriptionMenu(false);
                          if (!confirm('Are you sure you want to cancel your subscription? It will remain active until the end of your billing period.')) {
                            return;
                          }
                          try {
                            const walletAddress = user?.verifiedCredentials?.[0]?.address;
                            if (!walletAddress) {
                              alert('Could not find wallet address');
                              return;
                            }
                            const response = await fetch('/api/stripe/cancel-subscription', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ walletAddress }),
                            });
                            const data = await response.json();
                            if (response.ok) {
                              alert(data.message || 'Subscription cancelled successfully');
                              window.location.reload();
                            } else {
                              alert(data.error || 'Failed to cancel subscription');
                            }
                          } catch (error) {
                            alert('Error cancelling subscription');
                            console.error(error);
                          }
                        }}
                        className="subscription-menu-item cancel"
                      >
                        Cancel Subscription
                      </button>
                    </>
                  )}
                  {hasPromoAccess && (
                    <button
                      onClick={() => {
                        setShowSubscriptionMenu(false);
                        if (!confirm('Are you sure you want to remove your promo code? You will lose premium access immediately.')) {
                          return;
                        }
                        clearPromoAccess();
                        setHasPromoAccess(false);
                        alert('Promo code removed');
                        window.location.reload();
                      }}
                      className="subscription-menu-item cancel"
                    >
                      Remove Promo Code
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
