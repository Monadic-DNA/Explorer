"use client";

import { useEffect, useState } from "react";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import PremiumFeatureHeader from "../components/PremiumFeatureHeader";
import { PremiumPaywall } from "../components/PremiumPaywall";
import LLMChatInline from "../components/LLMChatInline";
import GuidedTour, { hasCompletedTour } from "../components/GuidedTour";
import { dnaChatTour } from "../components/tours/tourContent";

export default function DNAChatPage() {
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    if (!hasCompletedTour(dnaChatTour.id)) {
      setTourOpen(true);
    }
  }, []);

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page premium-feature-page dna-chat-page">
        <PremiumFeatureHeader
          featureName="DNA Chat"
          description="Ask private questions about your saved genetic results."
        />
        <div style={{ textAlign: "right", padding: "0 1rem" }}>
          <button className="tour-trigger-link" onClick={() => setTourOpen(true)}>
            Take the tour
          </button>
        </div>
        <PremiumPaywall>{null}</PremiumPaywall>

        <section className="premium-section premium-feature-section dna-chat-section">
          <LLMChatInline />
        </section>
      </main>
      <Footer />
      <GuidedTour tour={dnaChatTour} isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
