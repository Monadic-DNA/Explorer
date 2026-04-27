"use client";

import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import PremiumFeatureHeader from "../components/PremiumFeatureHeader";
import { PremiumPaywall } from "../components/PremiumPaywall";
import LLMChatInline from "../components/LLMChatInline";

export default function LLMChatPage() {
  return (
    <div className="app-container">
      <MenuBar />
      <main className="page premium-feature-page">
        <PremiumFeatureHeader
          featureName="LLM Chat"
          description="Ask private questions about your saved genetic results."
        />
        <PremiumPaywall>{null}</PremiumPaywall>

        <section className="premium-section premium-feature-section">
          <div className="premium-feature-intro">
            <div>
              <div className="premium-feature-title-row">
                <h2>LLM Chat</h2>
                <span className="premium-tab-badge">Premium</span>
              </div>
              <p>
                Ask questions about your saved results, compare traits, and get a
                plain-language read on what your DNA analysis suggests.
              </p>
            </div>
          </div>

          <LLMChatInline />
        </section>
      </main>
      <Footer />
    </div>
  );
}
