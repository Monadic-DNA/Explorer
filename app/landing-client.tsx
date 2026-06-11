"use client";

import Link from "next/link";
import { useGenotype } from "./components/UserDataUpload";
import { trackGetStartedClicked } from "@/lib/analytics";

const SCHEDULE_CALL_URL = "https://calendar.app.google/eVDN4d44GreUjR8p8";

const featureCopy = [
  {
    label: "Explore",
    href: "/explore",
    text: "Explore your results trait by trait. Browse elevated and protective associations ranked by effect size, and see which traits connect to conditions in your personal and family health history.",
  },
  {
    label: "DNA Chat",
    href: "/dna-chat",
    text: "Ask questions about your genetic results in plain English. Get explanations of specific traits, genes, and what population studies say about your variants.",
  },
  {
    label: "Browse",
    href: "/browse",
    text: "Browse studies from the GWAS Catalog with advanced filtering by trait, sample size, and significance. View a heatmap of your SNP matches across selected studies.",
  },
  {
    label: "Analyze",
    href: "/overview-report",
    text: "Generate AI-written reports that synthesize patterns across your results, surface hypotheses about your biology, and connect findings to your health history. Premium feature.",
  },
  {
    label: "Privacy first",
    href: null,
    text: "Your DNA stays in your browser. We do not store, transmit, or sell your raw genetic data. AI runs in Trusted Execution Environments for maximum anonymity.",
  },
];

export default function LandingClient() {
  const { error } = useGenotype();

  return (
    <main className="page landing-page landing-home-page">
      <section className="landing-home-intro" style={{ display: 'block', padding: '2rem 2.5rem' }}>
        <div className="landing-home-copy">
          <h1 style={{ maxWidth: 'none' }}>Understand your DNA without giving it away.</h1>

          <div className="landing-home-explainer" aria-label="Monadic DNA Explorer features" style={{ maxWidth: 'none' }}>
            {featureCopy.map((item) => (
              <p key={item.label}>
                <span>
                  {item.href ? (
                    <Link href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </span>
                {item.text}
              </p>
            ))}
          </div>

          {error && <p className="landing-upload-error">{error}</p>}

          <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            New to the app?{' '}
            <a
              href={SCHEDULE_CALL_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}
              onClick={() => trackGetStartedClicked("schedule_video_call")}
            >
              Book a free help call.
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
