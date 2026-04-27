"use client";

import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import PremiumFeatureHeader from "../components/PremiumFeatureHeader";
import { PremiumPaywall } from "../components/PremiumPaywall";
import LLMChatInline from "../components/LLMChatInline";

export default function DNAChatPage() {
  return (
    <div className="app-container">
      <MenuBar />
      <main className="page premium-feature-page dna-chat-page">
        <PremiumFeatureHeader
          featureName="DNA Chat"
          description="Ask private questions about your saved genetic results."
        />
        <PremiumPaywall>{null}</PremiumPaywall>

        <section className="premium-section premium-feature-section dna-chat-section">
          <LLMChatInline />
        </section>
      </main>
      <Footer />
    </div>
  );
}
