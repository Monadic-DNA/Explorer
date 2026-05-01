"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import PaymentModal from "../components/PaymentModal";
import { AuthButton, useAuth } from "../components/AuthProvider";
import { trackSubscribePageViewed } from "@/lib/analytics";

function SubscribeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageViewTrackedRef = useRef(false);
  const {
    isAuthenticated,
    user,
    hasActiveSubscription,
    checkingSubscription,
    subscriptionData,
    refreshSubscription,
    initializeDynamic,
    isDynamicInitialized,
    openAuthModal,
  } = useAuth();

  useEffect(() => {
    if (!isDynamicInitialized) {
      initializeDynamic();
    }
  }, [initializeDynamic, isDynamicInitialized]);

  const handlePaymentSuccess = async () => {
    await refreshSubscription(true);
    window.dispatchEvent(new CustomEvent("premiumAccessUpdated"));
    router.push("/subscribe/confirmed");
  };

  const paymentCancelled = searchParams.get("payment") === "cancelled";
  const walletAddress = user?.verifiedCredentials?.[0]?.address;
  const subscribeState = hasActiveSubscription ? "subscribed" : isAuthenticated ? "signed_in" : "signed_out";

  useEffect(() => {
    if (pageViewTrackedRef.current || checkingSubscription) return;
    pageViewTrackedRef.current = true;
    trackSubscribePageViewed(subscribeState);
  }, [checkingSubscription, subscribeState]);

  return (
    <div className="app-container">
      <MenuBar />
      <main className="subscribe-page">
        <section className="subscribe-hero">
          <div className="subscribe-copy">
            <span className="premium-eyebrow">Premium</span>
            <h1>Subscribe to Monadic DNA Premium</h1>
            <p>$4.99/month</p>
          </div>

          <div className="subscribe-auth">
            <AuthButton />
          </div>
        </section>

        {paymentCancelled && (
          <div className="subscribe-notice">
            Payment was cancelled. No charge was made.
          </div>
        )}

        {hasActiveSubscription ? (
          <section className="subscribe-status-card">
            <h2>Premium access is active</h2>
            <p>
              Your subscription is ready for DNA Chat and Overview Report.
              {subscriptionData?.expiresAt
                ? ` Your current billing period renews ${new Date(subscriptionData.expiresAt).toLocaleDateString()}.`
                : ""}
            </p>
            <div className="subscribe-actions">
              <button onClick={() => router.push("/dna-chat")}>Open DNA Chat</button>
              <button onClick={() => router.push("/overview-report")}>Open Overview Report</button>
            </div>
          </section>
        ) : !isAuthenticated ? (
          <section className="subscribe-status-card">
            <h2>Sign in to subscribe</h2>
            <p>
              Sign in with your wallet first so your subscription can be tied
              to your Monadic DNA account.
            </p>
            <button className="primary-action" onClick={openAuthModal}>
              Sign In
            </button>
          </section>
        ) : !walletAddress ? (
          <section className="subscribe-status-card">
            <h2>Connect a wallet</h2>
            <p>
              A wallet connection is required so the subscription can be
              verified against your account.
            </p>
            <div className="wallet-widget">
              <AuthButton />
            </div>
          </section>
        ) : (
          <PaymentModal
            display="page"
            onSuccess={handlePaymentSuccess}
            onClose={() => router.push("/")}
          />
        )}

        {checkingSubscription && (
          <p className="checking-note">Checking subscription status...</p>
        )}
      </main>
      <Footer />

      <style jsx>{`
        .subscribe-page {
          width: min(1040px, calc(100% - 32px));
          margin: 0 auto;
          padding: 4rem 0 5rem;
        }

        .subscribe-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .premium-eyebrow {
          display: inline-flex;
          align-items: center;
          margin-bottom: 0.75rem;
          color: #2563eb;
          font-size: 0.78rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .subscribe-copy h1 {
          margin: 0;
          max-width: 760px;
          color: var(--text-primary);
          font-size: 4rem;
          line-height: 0.95;
          letter-spacing: 0;
        }

        .subscribe-copy p {
          max-width: 620px;
          margin: 1rem 0 0;
          color: var(--text-secondary);
          font-size: 1.05rem;
          line-height: 1.6;
        }

        .subscribe-auth {
          min-width: 170px;
          display: flex;
          justify-content: flex-end;
        }

        .subscribe-notice {
          max-width: 640px;
          margin: 0 auto 1rem;
          padding: 0.9rem 1rem;
          border: 1px solid #f59e0b;
          border-radius: 8px;
          background: #fffbeb;
          color: #92400e;
          font-weight: 600;
        }

        .subscribe-status-card {
          max-width: 640px;
          margin: 0 auto;
          padding: 2rem;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
        }

        .subscribe-status-card h2 {
          margin: 0 0 0.75rem;
          color: #111827;
          font-size: 1.5rem;
        }

        .subscribe-status-card p {
          margin: 0 0 1.5rem;
          color: #6b7280;
          line-height: 1.6;
        }

        .primary-action,
        .subscribe-actions button {
          padding: 0.9rem 1.2rem;
          border: 0;
          border-radius: 8px;
          background: #2563eb;
          color: white;
          font-weight: 700;
          cursor: pointer;
        }

        .subscribe-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
        }

        .wallet-widget {
          display: flex;
          justify-content: flex-start;
        }

        .checking-note {
          text-align: center;
          color: var(--text-secondary);
          margin-top: 1rem;
        }

        @media (max-width: 720px) {
          .subscribe-page {
            padding-top: 2rem;
          }

          .subscribe-hero {
            grid-template-columns: 1fr;
          }

          .subscribe-auth {
            justify-content: flex-start;
          }

          .subscribe-copy h1 {
            font-size: 2.45rem;
            line-height: 1;
          }
        }
      `}</style>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeContent />
    </Suspense>
  );
}
