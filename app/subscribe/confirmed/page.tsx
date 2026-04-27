"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MenuBar from "../../components/MenuBar";
import Footer from "../../components/Footer";
import { useAuth } from "../../components/AuthProvider";

function SubscribeConfirmedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSubscription } = useAuth();
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    refreshSubscription(true);
    window.dispatchEvent(new CustomEvent("premiumAccessUpdated"));
  }, [refreshSubscription]);

  return (
    <div className="app-container">
      <MenuBar />
      <main className="confirmation-page">
        <section className="confirmation-card">
          <div className="success-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <span className="conversion-label">Subscription confirmed</span>
          <h1>Premium is ready</h1>
          <p>
            Your Monadic DNA Premium subscription has been activated. You now
            have access to DNA Chat and Overview Report.
          </p>

          {sessionId && (
            <div className="session-details">
              <span>Stripe session</span>
              <code>{sessionId}</code>
            </div>
          )}

          <div className="confirmation-actions">
            <button onClick={() => router.push("/dna-chat")}>Open DNA Chat</button>
            <button onClick={() => router.push("/overview-report")}>
              Open Overview Report
            </button>
          </div>
        </section>
      </main>
      <Footer />

      <style jsx>{`
        .confirmation-page {
          min-height: calc(100vh - 220px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4rem 1rem;
          background:
            radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 30rem),
            linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }

        .confirmation-card {
          width: min(560px, 100%);
          padding: 3rem;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.14);
          text-align: center;
        }

        .success-mark {
          width: 72px;
          height: 72px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1.5rem;
          border-radius: 50%;
          background: #10b981;
          color: #ffffff;
        }

        .success-mark svg {
          width: 38px;
          height: 38px;
          fill: none;
          stroke: currentColor;
          stroke-width: 3;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .conversion-label {
          display: block;
          margin-bottom: 0.75rem;
          color: #2563eb;
          font-size: 0.78rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        h1 {
          margin: 0 0 1rem;
          color: #111827;
          font-size: 2.5rem;
          line-height: 1;
          letter-spacing: 0;
        }

        p {
          margin: 0;
          color: #6b7280;
          font-size: 1.05rem;
          line-height: 1.65;
        }

        .session-details {
          margin-top: 1.75rem;
          padding: 1rem;
          border-radius: 8px;
          background: #f8fafc;
          color: #64748b;
          text-align: left;
        }

        .session-details span {
          display: block;
          margin-bottom: 0.4rem;
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .session-details code {
          display: block;
          overflow-wrap: anywhere;
          font-size: 0.78rem;
        }

        .confirmation-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 2rem;
        }

        .confirmation-actions button {
          flex: 1;
          padding: 0.95rem 1rem;
          border: 0;
          border-radius: 8px;
          background: #2563eb;
          color: #ffffff;
          font-weight: 800;
          cursor: pointer;
        }

        .confirmation-actions button:last-child {
          background: #111827;
        }

        @media (max-width: 560px) {
          .confirmation-card {
            padding: 2rem;
          }

          .confirmation-actions {
            flex-direction: column;
          }

          h1 {
            font-size: 2rem;
          }
        }
      `}</style>
    </div>
  );
}

export default function SubscribeConfirmedPage() {
  return (
    <Suspense fallback={null}>
      <SubscribeConfirmedContent />
    </Suspense>
  );
}
