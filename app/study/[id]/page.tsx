"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import MenuBar from "../../components/MenuBar";
import Footer from "../../components/Footer";
import VariantChips from "../../components/VariantChips";
import StudyResultReveal from "../../components/StudyResultReveal";

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
  const studyId = params.id as string;
  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStudy = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch study by ID from the API
        const response = await fetch(`/api/studies?limit=1&offset=${parseInt(studyId) - 1}`);

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
              <Link href="/explore" style={{
                display: "inline-block",
                marginTop: "1rem",
                padding: "0.75rem 1.5rem",
                backgroundColor: "#667eea",
                color: "white",
                textDecoration: "none",
                borderRadius: "6px"
              }}>
                ← Back to Explore
              </Link>
            </div>
          </main>
          <Footer />
        </div>
      </>
    );
  }

  const trait = study.mapped_trait ?? study.disease_trait ?? "Unknown trait";
  const gwasLink = study.study_accession
    ? `https://www.ebi.ac.uk/gwas/studies/${study.study_accession}`
    : null;
  const pubmedLink = study.pubmedid
    ? `https://pubmed.ncbi.nlm.nih.gov/${study.pubmedid}`
    : null;
  const studyLink = gwasLink || study.link || pubmedLink;

  return (
    <>
      <div className="app-container">
        <MenuBar />
        <main className="page">
          {/* Breadcrumb */}
          <div style={{ padding: "1rem 0", fontSize: "0.9rem", color: "#666" }}>
            <Link href="/" style={{ color: "#667eea", textDecoration: "none" }}>Home</Link>
            {" > "}
            <Link href="/explore" style={{ color: "#667eea", textDecoration: "none" }}>Explore</Link>
            {" > "}
            <span>Study {study.id}</span>
          </div>

          {/* Study Header */}
          <section style={{
            padding: "2rem",
            backgroundColor: "var(--bg-secondary, #fafafa)",
            borderRadius: "8px",
            marginBottom: "2rem"
          }}>
            <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>
              {study.study || "Untitled Study"}
            </h1>

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem", marginBottom: "1.5rem" }}>
              <strong>Trait:</strong>
              <span>{trait}</span>

              {study.first_author && (
                <>
                  <strong>Author:</strong>
                  <span>{study.first_author}</span>
                </>
              )}

              {study.date && (
                <>
                  <strong>Date:</strong>
                  <span>{new Date(study.date).toLocaleDateString()}</span>
                </>
              )}

              {study.journal && (
                <>
                  <strong>Journal:</strong>
                  <span>{study.journal}</span>
                </>
              )}

              {study.study_accession && (
                <>
                  <strong>Accession:</strong>
                  <span>{study.study_accession}</span>
                </>
              )}

              {study.mapped_gene && (
                <>
                  <strong>Gene:</strong>
                  <span>{study.mapped_gene}</span>
                </>
              )}
            </div>

            {/* External Links */}
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {gwasLink && (
                <a
                  href={gwasLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#667eea",
                    color: "white",
                    textDecoration: "none",
                    borderRadius: "6px",
                    fontWeight: "500"
                  }}
                >
                  View in GWAS Catalog →
                </a>
              )}

              {pubmedLink && (
                <a
                  href={pubmedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#34a853",
                    color: "white",
                    textDecoration: "none",
                    borderRadius: "6px",
                    fontWeight: "500"
                  }}
                >
                  View on PubMed →
                </a>
              )}
            </div>
          </section>

          {/* Study Details */}
          <section style={{
            padding: "2rem",
            backgroundColor: "white",
            borderRadius: "8px",
            marginBottom: "2rem",
            border: "1px solid #e0e0e0"
          }}>
            <h2 style={{ marginBottom: "1.5rem" }}>Study Details</h2>

            <div style={{ display: "grid", gap: "2rem" }}>
              {/* Genetic Variants */}
              <div>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Genetic Variants</h3>
                <VariantChips snps={study.snps} riskAllele={study.strongest_snp_risk_allele} />
              </div>

              {/* Statistical Significance */}
              <div>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Statistical Significance</h3>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
                  {study.pValueNumeric !== null && (
                    <>
                      <strong>P-value:</strong>
                      <span>{study.pValueLabel}</span>
                    </>
                  )}

                  {study.logPValue !== null && (
                    <>
                      <strong>-log₁₀(p):</strong>
                      <span>{study.logPValue.toFixed(2)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Sample Size */}
              <div>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Sample Size</h3>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
                  {study.sampleSize !== null && (
                    <>
                      <strong>Total:</strong>
                      <span>{study.sampleSizeLabel}</span>
                    </>
                  )}

                  {study.initial_sample_size && (
                    <>
                      <strong>Initial:</strong>
                      <span>{study.initial_sample_size}</span>
                    </>
                  )}

                  {study.replication_sample_size && (
                    <>
                      <strong>Replication:</strong>
                      <span>{study.replication_sample_size}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Effect Size */}
              <div>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Effect Size</h3>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
                  {study.or_or_beta && (
                    <>
                      <strong>OR/Beta:</strong>
                      <span>{study.or_or_beta}</span>
                    </>
                  )}

                  {study.ci_text && (
                    <>
                      <strong>Confidence Interval:</strong>
                      <span>{study.ci_text}</span>
                    </>
                  )}

                  {study.risk_allele_frequency && (
                    <>
                      <strong>Risk Allele Frequency:</strong>
                      <span>{study.risk_allele_frequency}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Quality Assessment */}
              <div>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Quality Assessment</h3>
                <div style={{ marginBottom: "1rem" }}>
                  <span className={`quality-pill ${study.confidenceBand}`}>
                    {study.confidenceBand === "high" ? "High Confidence" :
                     study.confidenceBand === "medium" ? "Medium Confidence" :
                     "Lower Confidence"}
                  </span>
                </div>

                {study.qualityFlags.length > 0 && (
                  <div style={{ marginTop: "0.5rem" }}>
                    {study.qualityFlags.map((flag, index) => (
                      <div key={index} className={`quality-flag quality-flag-${flag.severity}`} style={{
                        marginTop: "0.25rem",
                        padding: "0.5rem",
                        backgroundColor: flag.severity === "major" ? "#fff3cd" : "#d1ecf1",
                        borderRadius: "4px"
                      }}>
                        {flag.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Your Personal Result */}
              <div>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Your Personal Result</h3>
                <StudyResultReveal
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
              </div>
            </div>
          </section>

          {/* Back Button */}
          <div style={{ marginBottom: "2rem" }}>
            <Link href="/explore" style={{
              display: "inline-block",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#667eea",
              color: "white",
              textDecoration: "none",
              borderRadius: "6px"
            }}>
              ← Back to Explore
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
