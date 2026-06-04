"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import { useResults } from "../components/ResultsContext";
import { useGenotype } from "../components/UserDataUpload";
import { useCustomization } from "../components/CustomizationContext";

const STOP_WORDS = new Set([
  'and', 'or', 'the', 'of', 'with', 'in', 'to', 'a', 'an', 'for', 'by', 'at', 'on',
  'is', 'it', 'its', 'as', 'my', 'our', 'their', 'has', 'have', 'had',
  // Generic medical terms that match too broadly
  'disease', 'disorder', 'syndrome', 'condition', 'related', 'associated',
  'chronic', 'acute', 'primary', 'secondary', 'other', 'type', 'stage',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreMatch(keywords: string[], traitName: string): number {
  const trait = traitName.toLowerCase();
  return keywords.reduce((sum, kw) => sum + (trait.includes(kw) ? 1 : 0), 0);
}

export default function ExplorePage() {
  const router = useRouter();
  const { savedResults } = useResults();
  const { isUploaded } = useGenotype();
  const { customization } = useCustomization();
  const [navigating, setNavigating] = useState(false);
  const [shownIncreased, setShownIncreased] = useState(5);
  const [shownDecreased, setShownDecreased] = useState(5);
  const [healthCardPages, setHealthCardPages] = useState<Record<string, number>>({});

  const INITIAL_SHOW = 5;
  const PAGE_SIZE = 5;
  const hasResults = savedResults.length > 0;

  const stats = useMemo(() => {
    if (!hasResults) return null;
    const increased = savedResults.filter(r => r.riskLevel === "increased").length;
    const decreased = savedResults.filter(r => r.riskLevel === "decreased").length;
    const neutral = savedResults.filter(r => r.riskLevel === "neutral").length;

    // Sort by absolute log(OR) — effect magnitude on a symmetric scale.
    // Requires OR > 1.15 or < 0.87 to filter out near-neutral results.
    const isValidOR = (r: typeof savedResults[0]) =>
      r.effectType === "OR" && r.riskScore > 0.05 && r.riskScore < 50;

    const seen = new Set<number>();
    const unique = savedResults.filter(r => {
      if (seen.has(r.studyId)) return false;
      seen.add(r.studyId);
      return true;
    });

    const topIncreased = unique
      .filter(r => r.riskLevel === "increased" && isValidOR(r) && r.riskScore >= 1.15)
      .sort((a, b) => Math.log(b.riskScore) - Math.log(a.riskScore));

    const topDecreased = unique
      .filter(r => r.riskLevel === "decreased" && isValidOR(r) && r.riskScore <= 0.87)
      .sort((a, b) => Math.log(a.riskScore) - Math.log(b.riskScore));

    return { increased, decreased, neutral, topIncreased, topDecreased, unique };
  }, [savedResults, hasResults]);

  const healthMatches = useMemo(() => {
    if (!hasResults || !customization || !stats) return [];
    const conditions = [
      ...(customization.personalConditions ?? []).map(c => ({ label: c, type: 'personal' as const })),
      ...(customization.familyConditions ?? []).map(c => ({ label: c, type: 'family' as const })),
    ];
    if (conditions.length === 0) return [];

    return conditions
      .map(({ label, type }) => {
        const keywords = extractKeywords(label);
        if (keywords.length === 0) return null;
        const matches = stats.unique
          .map(r => ({ result: r, score: scoreMatch(keywords, r.traitName) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map(({ result }) => result);
        if (matches.length === 0) return null;
        return { label, type, matches };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [hasResults, customization, stats]);

  const handleRandom = () => {
    if (!hasResults) return;
    setNavigating(true);
    const result = savedResults[Math.floor(Math.random() * savedResults.length)];
    router.push(`/study/${result.studyId}`);
  };

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page">

        {/* Page header */}
        <div className="explore-page-header">
          <h1 className="explore-page-title">Explore Your DNA</h1>
          <p className="explore-page-subtitle">
            Discover what your genome says about thousands of traits and conditions — all privately, in your browser.
          </p>
        </div>

        {hasResults ? (
          <>
            {/* Stats bar */}
            <div className="explore-stats-bar">
              <div className="explore-stat">
                <span className="explore-stat-value">{savedResults.length.toLocaleString()}</span>
                <span className="explore-stat-label">results analyzed</span>
              </div>
              <div className="explore-stat-divider" />
              <div className="explore-stat">
                <span className="explore-stat-value explore-stat-value--increased">{stats!.increased}</span>
                <span className="explore-stat-label">elevated risk</span>
              </div>
              <div className="explore-stat-divider" />
              <div className="explore-stat">
                <span className="explore-stat-value explore-stat-value--decreased">{stats!.decreased}</span>
                <span className="explore-stat-label">reduced risk</span>
              </div>
              <div className="explore-stat-divider" />
              <div className="explore-stat">
                <span className="explore-stat-value">{stats!.neutral}</span>
                <span className="explore-stat-label">neutral</span>
              </div>
            </div>

            {/* Discovery card */}
            <div className="explore-discovery-card">
              <div className="explore-discovery-content">
                <div className="explore-discovery-icon">🎲</div>
                <div>
                  <h2 className="explore-discovery-title">Discover a random result</h2>
                  <p className="explore-discovery-body">
                    Jump to a study from your analyzed results. Each click surfaces a different genetic association — a great way to stumble on something surprising.
                  </p>
                </div>
              </div>
              <button
                className="explore-discovery-button"
                onClick={handleRandom}
                disabled={navigating}
              >
                {navigating ? "Loading..." : "Take me somewhere →"}
              </button>
            </div>

            {/* Highlights */}
            {(stats!.topIncreased.length > 0 || stats!.topDecreased.length > 0) && (
              <div className="explore-highlights">
                {stats!.topIncreased.length > 0 && (
                  <div className="explore-highlight-group">
                    <h3 className="explore-highlight-heading">Largest elevated effect sizes in your results</h3>
                    <div className="explore-highlight-list">
                      {stats!.topIncreased.slice(0, shownIncreased).map(r => (
                        <Link key={r.studyId} href={`/study/${r.studyId}`} className="explore-highlight-item explore-highlight-item--increased">
                          <span className="explore-highlight-trait" title={r.traitName}>{r.traitName}</span>
                          <span className="explore-highlight-score">{r.riskScore.toFixed(2)}x ↑</span>
                        </Link>
                      ))}
                    </div>
                    {shownIncreased < stats!.topIncreased.length && (
                      <button className="explore-show-more" onClick={() => setShownIncreased(n => n + PAGE_SIZE)}>
                        Show {Math.min(PAGE_SIZE, stats!.topIncreased.length - shownIncreased)} more
                      </button>
                    )}
                  </div>
                )}
                {stats!.topDecreased.length > 0 && (
                  <div className="explore-highlight-group">
                    <h3 className="explore-highlight-heading">Largest protective effect sizes in your results</h3>
                    <div className="explore-highlight-list">
                      {stats!.topDecreased.slice(0, shownDecreased).map(r => (
                        <Link key={r.studyId} href={`/study/${r.studyId}`} className="explore-highlight-item explore-highlight-item--decreased">
                          <span className="explore-highlight-trait" title={r.traitName}>{r.traitName}</span>
                          <span className="explore-highlight-score">{r.riskScore.toFixed(2)}x ↓</span>
                        </Link>
                      ))}
                    </div>
                    {shownDecreased < stats!.topDecreased.length && (
                      <button className="explore-show-more" onClick={() => setShownDecreased(n => n + PAGE_SIZE)}>
                        Show {Math.min(PAGE_SIZE, stats!.topDecreased.length - shownDecreased)} more
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Health history matches */}
            {healthMatches.length > 0 && (
              <div className="explore-health-section">
                <h2 className="explore-section-title">Based on your health history</h2>
                <div className="explore-health-grid">
                  {healthMatches.map(({ label, type, matches }) => {
                    const page = healthCardPages[label] ?? 0;
                    const pageSize = 5;
                    const pageMatches = matches.slice(page * pageSize, (page + 1) * pageSize);
                    const hasPrev = page > 0;
                    const hasNext = (page + 1) * pageSize < matches.length;
                    return (
                      <div key={label} className="explore-health-card">
                        <div className="explore-health-card-header">
                          <span className="explore-health-condition">{label}</span>
                          <span className={`explore-health-tag explore-health-tag--${type}`}>
                            {type === 'personal' ? 'Your history' : 'Family history'}
                          </span>
                        </div>
                        <div className="explore-highlight-list">
                          {pageMatches.map(r => (
                            <Link
                              key={r.studyId}
                              href={`/study/${r.studyId}`}
                              className={`explore-highlight-item explore-highlight-item--${r.riskLevel}`}
                            >
                              <span className="explore-highlight-trait" title={r.traitName}>{r.traitName}</span>
                              <span className="explore-highlight-score">
                                {r.riskLevel === 'increased' ? `${r.riskScore.toFixed(2)}x ↑`
                                  : r.riskLevel === 'decreased' ? `${r.riskScore.toFixed(2)}x ↓`
                                  : '→'}
                              </span>
                            </Link>
                          ))}
                        </div>
                        {(hasPrev || hasNext) && (
                          <div className="explore-health-card-nav">
                            <button
                              className="explore-health-card-nav-btn"
                              onClick={() => setHealthCardPages(p => ({ ...p, [label]: page - 1 }))}
                              disabled={!hasPrev}
                              aria-label="Previous"
                            >
                              ←
                            </button>
                            <span className="explore-health-card-nav-count">
                              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, matches.length)} of {matches.length}
                            </span>
                            <button
                              className="explore-health-card-nav-btn"
                              onClick={() => setHealthCardPages(p => ({ ...p, [label]: page + 1 }))}
                              disabled={!hasNext}
                              aria-label="Next"
                            >
                              →
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Browse CTA */}
            <div className="explore-browse-cta">
              <p>Want to search by trait, filter by significance, or run new analyses?</p>
              <Link href="/browse" className="explore-browse-link">Go to Browse →</Link>
            </div>
          </>
        ) : (
          <>
            {/* Empty state — how it works */}
            <div className="explore-how-it-works">
              <h2 className="explore-section-title">How it works</h2>
              <div className="explore-steps">
                <div className={`explore-step ${isUploaded ? "explore-step--done" : "explore-step--active"}`}>
                  <div className="explore-step-number">{isUploaded ? "✓" : "1"}</div>
                  <div className="explore-step-content">
                    <h3>Load your DNA data</h3>
                    <p>
                      Upload your raw DNA file from 23andMe, AncestryDNA, or another provider using the <strong>My Data</strong> button at the top of the page. Your data never leaves your device.
                    </p>
                    {!isUploaded && (
                      <p className="explore-step-note">
                        Need to download your raw data?{" "}
                        <a href="https://monadicdna.com/guide/23andme" target="_blank" rel="noopener noreferrer">23andMe guide</a>
                        {" · "}
                        <a href="https://monadicdna.com/guide/ancestry" target="_blank" rel="noopener noreferrer">AncestryDNA guide</a>
                      </p>
                    )}
                  </div>
                </div>

                <div className="explore-step explore-step--waiting">
                  <div className="explore-step-number">2</div>
                  <div className="explore-step-content">
                    <h3>Run All in Browse</h3>
                    <p>
                      Head to <Link href="/browse">Browse</Link> and click <strong>Run All</strong>. The app will match your DNA against thousands of GWAS studies — finding every genetic association in the catalog that overlaps with your variants.
                    </p>
                    <p className="explore-step-note">This takes about 30–60 seconds depending on your device.</p>
                  </div>
                </div>

                <div className="explore-step explore-step--waiting">
                  <div className="explore-step-number">3</div>
                  <div className="explore-step-content">
                    <h3>Explore your results</h3>
                    <p>
                      Come back here to browse your personal results, discover random associations, and get AI-powered interpretations of what each finding means for you specifically.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* What you'll discover */}
            <div className="explore-preview-cards">
              <h2 className="explore-section-title">What you'll discover</h2>
              <div className="explore-preview-grid">
                <div className="explore-preview-card">
                  <span className="explore-preview-icon">🧬</span>
                  <h3>Trait associations</h3>
                  <p>See which genetic variants you carry and what traits they're linked to — from height and cholesterol to sleep patterns and immune response.</p>
                </div>
                <div className="explore-preview-card">
                  <span className="explore-preview-icon">🔬</span>
                  <h3>Study-level detail</h3>
                  <p>Each result links to the full published study — with sample sizes, p-values, effect sizes, and links to PubMed and the GWAS Catalog.</p>
                </div>
                <div className="explore-preview-card">
                  <span className="explore-preview-icon">🤖</span>
                  <h3>Private AI interpretation</h3>
                  <p>Get a plain-language explanation of what each result means for your biology, with follow-up suggestions tailored to your background.</p>
                </div>
              </div>
            </div>

            {/* CTA */}
            <div className="explore-empty-cta">
              <Link href="/browse" className="primary-button">
                Go to Browse and Run All →
              </Link>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
