"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import MenuBar from "../../components/MenuBar";
import Footer from "../../components/Footer";
import VariantChips from "../../components/VariantChips";
import StudyPersonalResultBanner from "../../components/StudyPersonalResultBanner";
import { useResults } from "../../components/ResultsContext";
import StudyInlineAnalysis from "../../components/StudyInlineAnalysis";

type Study = {
  id: number;
  study_accession: string | null;
  study: string | null;
  disease_trait: string | null;
  mapped_trait: string | null;
  mapped_trait_uri: string | null;
  mapped_gene: string | null;
  first_author: string | null;
  date: string | null;
  journal: string | null;
  pubmedid: string | null;
  link: string | null;
  initial_sample_size: string | null;
  replication_sample_size: string | null;
  p_value: string | null;
  pvalue_mlog: string | null;
  or_or_beta: string | null;
  ci_text: string | null;
  risk_allele_frequency: string | null;
  strongest_snp_risk_allele: string | null;
  snps: string | null;
  sampleSize: number | null;
  sampleSizeLabel: string;
  pValueNumeric: number | null;
  pValueLabel: string;
  logPValue: number | null;
  qualityFlags: Array<{ message: string; severity: string }>;
  isLowQuality: boolean;
  confidenceBand: "high" | "medium" | "low";
  publicationDate: number | null;
  isAnalyzable: boolean;
  nonAnalyzableReason?: string;
};

export default function StudyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const studyId = params.id as string;
  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { savedResults, hasResult, getResult } = useResults();
  const [totalStudies, setTotalStudies] = useState<number | null>(null);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    if (savedResults.length > 0) return;
    fetch("/api/studies?limit=1")
      .then(r => r.json())
      .then(data => { if (data.total) setTotalStudies(data.total); })
      .catch(() => {});
  }, [savedResults.length]);

  const handleNextRandom = () => {
    setNavigating(true);
    if (savedResults.length > 0) {
      const result = savedResults[Math.floor(Math.random() * savedResults.length)];
      router.push(`/study/${result.studyId}`);
    } else if (totalStudies !== null) {
      router.push(`/study/${Math.floor(Math.random() * totalStudies) + 1}`);
    }
  };

  useEffect(() => {
    const fetchStudy = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch study by ID from the API
        const response = await fetch(`/api/studies?id=${parseInt(studyId)}`);

        if (!response.ok) {
          throw new Error('Failed to fetch study details');
        }

        const data = await response.json();

        if (data.data && data.data.length > 0) {
          setStudy(data.data[0]);
        } else {
          setError('Study not found');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    if (studyId) {
      fetchStudy();
    }
  }, [studyId]);

  if (loading) {
    return (
      <>
        <div className="app-container">
          <MenuBar />
          <main className="page">
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <p>Loading study details...</p>
            </div>
          </main>
          <Footer />
        </div>
      </>
    );
  }

  if (error || !study) {
    return (
      <>
        <div className="app-container">
          <MenuBar />
          <main className="page">
            <div style={{ padding: "2rem" }}>
              <h2>Study Not Found</h2>
              <p>{error || 'The requested study could not be found.'}</p>
              <Link href="/browse" style={{
                display: "inline-block",
                marginTop: "1rem",
                padding: "0.75rem 1.5rem",
                backgroundColor: "#667eea",
                color: "white",
                textDecoration: "none",
                borderRadius: "6px"
              }}>
                ← Back to Browse
              </Link>
            </div>
          </main>
          <Footer />
        </div>
      </>
    );
  }

  const reportedTrait = study.disease_trait?.trim() || null;
  const mappedTrait = study.mapped_trait?.trim() || null;
  const trait = mappedTrait ?? reportedTrait ?? "Unknown trait";
  const gwasLink = study.study_accession
    ? `https://www.ebi.ac.uk/gwas/studies/${study.study_accession}`
    : null;
  const pubmedLink = study.pubmedid
    ? `https://pubmed.ncbi.nlm.nih.gov/${study.pubmedid}`
    : null;
  const studyLink = gwasLink || study.link || pubmedLink;

  const interpretSampleSize = (n: number | null): string => {
    if (n === null) return "";
    if (n >= 100000) return "Very large study";
    if (n >= 10000) return "Large study";
    if (n >= 1000) return "Mid-size study";
    return "Smaller study";
  };

  const interpretPValue = (logP: number | null): string => {
    if (logP === null) return "";
    if (logP >= 10) return "Exceptionally strong evidence";
    if (logP >= 7.3) return "Very strong evidence";
    if (logP >= 5) return "Strong evidence";
    if (logP >= 3) return "Moderate evidence";
    return "Suggestive evidence";
  };

  const interpretEffectSize = (orBeta: string | null): string => {
    if (!orBeta) return "";
    const val = parseFloat(orBeta);
    if (isNaN(val)) return "";
    // OR interpretation
    if (val >= 2 || val <= 0.5) return "Large effect";
    if (val >= 1.3 || val <= 0.77) return "Moderate effect";
    if (val >= 1.1 || val <= 0.91) return "Subtle effect";
    return "Very subtle effect";
  };

  const navButtons = (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
      <Link href="/browse" style={{
        display: "inline-block",
        padding: "0.5rem 1rem",
        backgroundColor: "#667eea",
        color: "white",
        textDecoration: "none",
        borderRadius: "6px",
        fontSize: "0.85rem",
        fontWeight: 600,
      }}>
        ← Back to Browse
      </Link>
      <button
        onClick={handleNextRandom}
        disabled={navigating || (savedResults.length === 0 && totalStudies === null)}
        style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", background: "linear-gradient(135deg, #667eea, #764ba2)", border: "none", color: "white", borderRadius: "6px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600, boxShadow: "0 2px 6px rgba(102,126,234,0.4)", opacity: (navigating || (savedResults.length === 0 && totalStudies === null)) ? 0.5 : 1 }}
      >
        {navigating ? "Loading..." : "Next Random Study →"}
      </button>
    </div>
  );

  return (
    <>
      <div className="app-container">
        <MenuBar />
        <main className="page">
          {/* Breadcrumb + top nav */}
          <div style={{ padding: "1rem 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.9rem", color: "#666" }}>
              <Link href="/" style={{ color: "#667eea", textDecoration: "none" }}>Home</Link>
              {" > "}
              <Link href="/browse" style={{ color: "#667eea", textDecoration: "none" }}>Browse</Link>
              {" > "}
              <span>Study {study.id}</span>
            </span>
            {navButtons}
          </div>

          {/* Study Header */}
          <section className="study-header-card">
            <div style={{ marginBottom: "0.75rem" }}>
              <span style={{ display: "inline-block", fontSize: "1.1rem", fontWeight: 700, color: "#667eea", background: "rgba(102,126,234,0.1)", border: "1px solid rgba(102,126,234,0.25)", borderRadius: "6px", padding: "0.3rem 0.8rem", letterSpacing: "0.01em" }}>
                {trait}
              </span>
            </div>
            <h1 className="study-header-title">{study.study || "Untitled Study"}</h1>

            <div className="study-header-meta">
              {reportedTrait && mappedTrait && mappedTrait !== reportedTrait && <span className="study-meta-item"><strong>Reported trait:</strong> {reportedTrait}</span>}
              {study.first_author && <span className="study-meta-item"><strong>Author:</strong> {study.first_author}</span>}
              {study.date && <span className="study-meta-item"><strong>Date:</strong> {new Date(study.date).toLocaleDateString()}</span>}
              {study.journal && <span className="study-meta-item"><strong>Journal:</strong> {study.journal}</span>}
              {study.study_accession && <span className="study-meta-item"><strong>Accession:</strong> {study.study_accession}</span>}
              {study.mapped_gene && <span className="study-meta-item"><strong>Gene:</strong> {study.mapped_gene}</span>}
            </div>

            <div className="study-header-links">
              {gwasLink && (
                <a href={gwasLink} target="_blank" rel="noopener noreferrer" className="study-ext-link study-ext-link--gwas">
                  <span className="study-ext-link-title">Source data →</span>
                  <span className="study-ext-link-desc">Full dataset on GWAS Catalog</span>
                </a>
              )}
              {pubmedLink && (
                <a href={pubmedLink} target="_blank" rel="noopener noreferrer" className="study-ext-link study-ext-link--pubmed">
                  <span className="study-ext-link-title">Research paper →</span>
                  <span className="study-ext-link-desc">Published article on PubMed</span>
                </a>
              )}
            </div>
          </section>

          {/* Personal Result Banner */}
          <StudyPersonalResultBanner
            studyId={study.id}
            studyAccession={study.study_accession}
            snps={study.snps}
            traitName={trait}
            studyTitle={study.study || "Untitled study"}
            riskAllele={study.strongest_snp_risk_allele}
            orOrBeta={study.or_or_beta}
            ciText={study.ci_text}
            isAnalyzable={study.isAnalyzable}
            nonAnalyzableReason={study.nonAnalyzableReason}
          />

          {/* Inline LLM analysis when a saved result exists for this study */}
          {hasResult(study.id) && getResult(study.id) && (
            <StudyInlineAnalysis result={getResult(study.id)!} pubmedId={study.pubmedid} />
          )}

          {/* Study Details */}
          <section className="study-details-card">
            {/* Stat grid */}
            <div className="study-stats-grid">
              {study.date && (
                <div className="study-stat-tile">
                  <span className="sst-label">Published</span>
                  <span className="sst-value">{new Date(study.date).getFullYear()}</span>
                  <span className="sst-context">{study.journal || "Peer-reviewed"}</span>
                </div>
              )}
              {study.sampleSize !== null && (
                <div className="study-stat-tile">
                  <span className="sst-label">Participants</span>
                  <span className="sst-value">{study.sampleSizeLabel}</span>
                  <span className="sst-context">{interpretSampleSize(study.sampleSize)}</span>
                </div>
              )}
              {study.pValueNumeric !== null && (
                <div className="study-stat-tile" title="How statistically significant the finding is">
                  <span className="sst-label">P-value</span>
                  <span className="sst-value">{study.pValueLabel}</span>
                  <span className="sst-context">{interpretPValue(study.logPValue)}</span>
                </div>
              )}
              {study.or_or_beta && (
                <div className="study-stat-tile" title="How strongly this variant influences the trait">
                  <span className="sst-label">Effect size</span>
                  <span className="sst-value">
                    {study.or_or_beta}
                    {study.ci_text ? <span className="sst-ci"> {study.ci_text}</span> : null}
                  </span>
                  <span className="sst-context">{interpretEffectSize(study.or_or_beta)}</span>
                </div>
              )}
              {study.risk_allele_frequency && (
                <div className="study-stat-tile" title="How common this genetic variant is in the population">
                  <span className="sst-label">Variant frequency</span>
                  <span className="sst-value">{study.risk_allele_frequency}</span>
                  <span className="sst-context">In population</span>
                </div>
              )}
              <div className="study-stat-tile">
                <span className="sst-label">Confidence</span>
                <span className="sst-value">
                  <span className={`quality-pill ${study.confidenceBand}`}>
                    {study.confidenceBand === "high" ? "High" : study.confidenceBand === "medium" ? "Medium" : "Lower"}
                  </span>
                </span>
                <span className="sst-context">
                  {study.confidenceBand === "high" ? "Well-replicated" : study.confidenceBand === "medium" ? "Some caveats" : "Interpret carefully"}
                </span>
              </div>
            </div>

            {/* Genetic variants */}
            {study.snps && (
              <div className="study-variants-row">
                <span className="study-variants-label">Variants tested</span>
                <VariantChips snps={study.snps} riskAllele={study.strongest_snp_risk_allele} />
              </div>
            )}

            {/* Sample breakdown */}
            {(study.initial_sample_size || study.replication_sample_size) && (
              <div className="study-sample-detail">
                {study.initial_sample_size && (
                  <p className="study-sample-row">
                    <span className="study-sample-key">Initial sample</span>
                    <span>{study.initial_sample_size}</span>
                  </p>
                )}
                {study.replication_sample_size && (
                  <p className="study-sample-row">
                    <span className="study-sample-key">Replication</span>
                    <span>{study.replication_sample_size}</span>
                  </p>
                )}
              </div>
            )}

            {/* Quality flags */}
            {study.qualityFlags.length > 0 && (
              <div className="study-quality-flags">
                {study.qualityFlags.map((flag, index) => (
                  <div key={index} className={`quality-flag quality-flag-${flag.severity}`}>
                    {flag.message}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Bottom nav */}
          <div style={{ marginBottom: "2rem" }}>
            {navButtons}
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
