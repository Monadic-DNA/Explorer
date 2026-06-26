import type { Metadata } from "next";
import Link from "next/link";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "What Raw DNA Analysis Can Tell You | Monadic DNA Explorer",
  description: "A privacy-first guide to raw DNA files, GWAS associations, scientific caveats, and browser-local genetic analysis.",
  keywords: ["raw DNA analysis", "private DNA analysis", "GWAS guide", "23andMe raw data", "AncestryDNA raw data"],
};

export default function RawDNAGuidePage() {
  return (
    <div className="app-container">
      <MenuBar />
      <main className="page guide-page">
        <section className="guide-hero">
          <span className="guide-eyebrow">Privacy-safe guide</span>
          <h1>What raw DNA analysis can tell you</h1>
          <p>
            Raw DNA files from consumer tests contain genotype calls at many known variants.
            Monadic DNA Explorer compares those variants with GWAS Catalog studies in your browser.
          </p>
          <Link className="landing-primary-button" href="/">
            Analyze a raw DNA file
          </Link>
        </section>

        <section className="guide-grid" aria-label="Raw DNA analysis guide">
          <article>
            <h2>What you can learn</h2>
            <p>
              GWAS findings can show associations between variants and traits such as metabolism,
              sleep, physical traits, disease susceptibility, and medication response research.
            </p>
          </article>

          <article>
            <h2>How to read the science</h2>
            <p>
              Each finding should be read with its study, p-value, effect size, sample context,
              population context, and replication status. Most effects are probabilistic and small.
            </p>
          </article>

          <article>
            <h2>Privacy model</h2>
            <p>
              The raw DNA file is parsed locally. Results are held in browser memory unless you
              choose to export them. The app should never need a DNA account to analyze your file.
            </p>
          </article>

          <article>
            <h2>Limits</h2>
            <p>
              GWAS associations are educational research signals. They are not medical diagnosis,
              ancestry assignment, or a complete picture of health risk.
            </p>
          </article>
        </section>

        <section className="guide-provider-section">
          <h2>Download your raw file</h2>
          <div className="landing-provider-guides">
            <a href="https://monadicdna.com/guide/23andme">23andMe</a>
            <a href="https://monadicdna.com/guide/ancestry">AncestryDNA</a>
            <a href="https://monadicdna.com/guide/myheritage">MyHeritage</a>
            <a href="https://monadicdna.com/guide/ftdna">FTDNA</a>
            <a href="https://monadicdna.com/guide/livingdna">LivingDNA</a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
