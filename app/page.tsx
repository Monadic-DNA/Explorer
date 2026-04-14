import Link from "next/link";
import type { Metadata } from "next";
import MenuBar from "./components/MenuBar";
import Footer from "./components/Footer";
import MobileBlocker from "./components/MobileBlocker";

export const metadata: Metadata = {
  title: "Monadic DNA Explorer - Explore Your Genetic Data",
  description: "Discover genetic associations from the GWAS Catalog, analyze your DNA data with privacy-focused AI insights, and explore thousands of genetic traits.",
  keywords: ["GWAS", "genetics", "DNA analysis", "genome explorer", "genetic traits", "personal genomics", "23andMe", "AncestryDNA"],
  openGraph: {
    title: "Monadic DNA Explorer - Explore Your Genetic Data",
    description: "Discover genetic associations from the GWAS Catalog and analyze your DNA data with privacy-focused AI",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <>
      <MobileBlocker />
      <div className="app-container">
        <MenuBar />
        <main className="page">
          {/* Hero Section */}
          <section style={{
            padding: "4rem 2rem",
            textAlign: "center",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            borderRadius: "8px",
            marginBottom: "3rem"
          }}>
            <h1 style={{ fontSize: "3rem", marginBottom: "1rem", fontWeight: "bold" }}>
              Monadic DNA Explorer
            </h1>
            <p style={{ fontSize: "1.5rem", marginBottom: "2rem", opacity: 0.95 }}>
              Explore thousands of genetic traits from the GWAS Catalog
            </p>
            <p style={{ fontSize: "1.2rem", marginBottom: "2.5rem", opacity: 0.9 }}>
              Analyze your DNA data with privacy-focused AI insights
            </p>
            <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/explore" style={{
                padding: "1rem 2.5rem",
                fontSize: "1.2rem",
                backgroundColor: "white",
                color: "#667eea",
                textDecoration: "none",
                borderRadius: "8px",
                fontWeight: "600",
                boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                transition: "transform 0.2s, box-shadow 0.2s"
              }}>
                Explore Studies
              </Link>
              <Link href="/premium" style={{
                padding: "1rem 2.5rem",
                fontSize: "1.2rem",
                backgroundColor: "rgba(255,255,255,0.2)",
                color: "white",
                textDecoration: "none",
                borderRadius: "8px",
                fontWeight: "600",
                border: "2px solid white",
                transition: "all 0.2s"
              }}>
                Premium Features
              </Link>
            </div>
          </section>

          {/* Features Grid */}
          <section style={{ padding: "2rem 0" }}>
            <h2 style={{ textAlign: "center", fontSize: "2rem", marginBottom: "3rem" }}>
              Powerful Features for Genetic Exploration
            </h2>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "2rem",
              marginBottom: "3rem"
            }}>
              {/* Feature 1: Explore */}
              <div style={{
                padding: "2rem",
                borderRadius: "8px",
                border: "1px solid #e0e0e0",
                backgroundColor: "var(--bg-secondary, #fafafa)"
              }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "#667eea" }}>
                  🔍 Study Explorer
                </h3>
                <p style={{ marginBottom: "1rem", lineHeight: "1.6" }}>
                  Search and filter through millions of genetic associations from the GWAS Catalog with semantic search powered by AI.
                </p>
                <ul style={{ listStyle: "none", padding: 0, lineHeight: "1.8" }}>
                  <li>✓ Semantic search - finds related studies</li>
                  <li>✓ Quality filters & confidence bands</li>
                  <li>✓ Upload your DNA data (23andMe, AncestryDNA)</li>
                  <li>✓ See your personal genetic results</li>
                </ul>
                <Link href="/explore" style={{
                  display: "inline-block",
                  marginTop: "1rem",
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#667eea",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontWeight: "500"
                }}>
                  Start Exploring →
                </Link>
              </div>

              {/* Feature 2: Premium */}
              <div style={{
                padding: "2rem",
                borderRadius: "8px",
                border: "2px solid #667eea",
                backgroundColor: "var(--bg-secondary, #fafafa)",
                position: "relative",
                overflow: "hidden"
              }}>
                <div style={{
                  position: "absolute",
                  top: "1rem",
                  right: "1rem",
                  padding: "0.25rem 0.75rem",
                  backgroundColor: "#667eea",
                  color: "white",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  fontWeight: "600"
                }}>
                  PREMIUM
                </div>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "#667eea" }}>
                  🤖 AI-Powered Analysis
                </h3>
                <p style={{ marginBottom: "1rem", lineHeight: "1.6" }}>
                  Unlock advanced features with privacy-preserving LLM analysis of your genetic data.
                </p>
                <ul style={{ listStyle: "none", padding: 0, lineHeight: "1.8" }}>
                  <li>✓ LLM Chat - Ask questions about your DNA</li>
                  <li>✓ Run All - Analyze all 1M+ traits</li>
                  <li>✓ Overview Report - Comprehensive insights</li>
                  <li>✓ Privacy-first - Trusted Execution Environment</li>
                </ul>
                <Link href="/premium" style={{
                  display: "inline-block",
                  marginTop: "1rem",
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#667eea",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontWeight: "500"
                }}>
                  View Premium →
                </Link>
              </div>

              {/* Feature 3: Privacy */}
              <div style={{
                padding: "2rem",
                borderRadius: "8px",
                border: "1px solid #e0e0e0",
                backgroundColor: "var(--bg-secondary, #fafafa)"
              }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "#667eea" }}>
                  🔒 Privacy-Focused
                </h3>
                <p style={{ marginBottom: "1rem", lineHeight: "1.6" }}>
                  Your genetic data never leaves your browser except for LLM analysis in a secure TEE.
                </p>
                <ul style={{ listStyle: "none", padding: 0, lineHeight: "1.8" }}>
                  <li>✓ Client-side analysis</li>
                  <li>✓ No data storage on servers</li>
                  <li>✓ Encrypted LLM processing (nilAI)</li>
                  <li>✓ Open source & transparent</li>
                </ul>
                <Link href="https://github.com/Monadic-DNA/Explorer" target="_blank" rel="noopener noreferrer" style={{
                  display: "inline-block",
                  marginTop: "1rem",
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#667eea",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontWeight: "500"
                }}>
                  View Source →
                </Link>
              </div>
            </div>
          </section>

          {/* Stats Section */}
          <section style={{
            padding: "3rem 2rem",
            textAlign: "center",
            backgroundColor: "var(--bg-secondary, #fafafa)",
            borderRadius: "8px",
            marginBottom: "2rem"
          }}>
            <h2 style={{ fontSize: "2rem", marginBottom: "2rem" }}>
              Comprehensive Genetic Database
            </h2>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "2rem"
            }}>
              <div>
                <div style={{ fontSize: "3rem", fontWeight: "bold", color: "#667eea" }}>1M+</div>
                <div style={{ fontSize: "1.2rem", marginTop: "0.5rem" }}>Genetic Associations</div>
              </div>
              <div>
                <div style={{ fontSize: "3rem", fontWeight: "bold", color: "#667eea" }}>10K+</div>
                <div style={{ fontSize: "1.2rem", marginTop: "0.5rem" }}>Unique Traits</div>
              </div>
              <div>
                <div style={{ fontSize: "3rem", fontWeight: "bold", color: "#667eea" }}>100%</div>
                <div style={{ fontSize: "1.2rem", marginTop: "0.5rem" }}>Privacy Protected</div>
              </div>
            </div>
          </section>

          {/* CTA Section */}
          <section style={{ padding: "3rem 0", textAlign: "center" }}>
            <h2 style={{ fontSize: "2rem", marginBottom: "1.5rem" }}>
              Ready to Explore Your Genetics?
            </h2>
            <p style={{ fontSize: "1.2rem", marginBottom: "2rem", color: "#666" }}>
              Start by browsing the study database or upload your DNA data for personalized insights
            </p>
            <Link href="/explore" style={{
              display: "inline-block",
              padding: "1rem 3rem",
              fontSize: "1.3rem",
              backgroundColor: "#667eea",
              color: "white",
              textDecoration: "none",
              borderRadius: "8px",
              fontWeight: "600",
              boxShadow: "0 4px 12px rgba(102, 126, 234, 0.3)"
            }}>
              Get Started Free
            </Link>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
