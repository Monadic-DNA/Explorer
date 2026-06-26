import Link from "next/link";
import { notFound } from "next/navigation";
import MenuBar from "../../components/MenuBar";
import Footer from "../../components/Footer";
import VariantChips from "../../components/VariantChips";
import StudyNavButtons from "../../components/StudyNavButtons";
import StudyPersonalSection from "../../components/StudyPersonalSection";
import { fetchStudyById } from "@/lib/study-service";

function interpretSampleSize(n: number | null): string {
  if (n === null) return "";
  if (n >= 100000) return "Very large study";
  if (n >= 10000) return "Large study";
  if (n >= 1000) return "Mid-size study";
  return "Smaller study";
}

function interpretPValue(logP: number | null): string {
  if (logP === null) return "";
  if (logP >= 10) return "Exceptionally strong evidence";
  if (logP >= 7.3) return "Very strong evidence";
  if (logP >= 5) return "Strong evidence";
  if (logP >= 3) return "Moderate evidence";
  return "Suggestive evidence";
}

function interpretEffectSize(orBeta: string | null): string {
  if (!orBeta) return "";
  const val = parseFloat(orBeta);
  if (isNaN(val)) return "";
  if (val >= 2 || val <= 0.5) return "Large effect";
  if (val >= 1.3 || val <= 0.77) return "Moderate effect";
  if (val >= 1.1 || val <= 0.91) return "Subtle effect";
  return "Very subtle effect";
}

function formatDisplayDate(dateStr: string): string {
  const ts = Date.parse(dateStr);
  if (Number.isNaN(ts)) return dateStr;
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function StudyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studyPk = parseInt(id);

  if (isNaN(studyPk) || studyPk <= 0) notFound();

  const study = await fetchStudyById(studyPk);
  if (!study) notFound();

  const reportedTrait = study.disease_trait?.trim() || null;
  const mappedTrait = study.mapped_trait?.trim() || null;
  const trait = mappedTrait ?? reportedTrait ?? "Unknown trait";
  const gwasLink = study.study_accession
    ? `https://www.ebi.ac.uk/gwas/studies/${study.study_accession}`
    : null;
  const pubmedLink = study.pubmedid
    ? `https://pubmed.ncbi.nlm.nih.gov/${study.pubmedid}`
    : null;

  return (
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
          <StudyNavButtons />
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
            {reportedTrait && mappedTrait && mappedTrait !== reportedTrait && (
              <span className="study-meta-item"><strong>Reported trait:</strong> {reportedTrait}</span>
            )}
            {study.first_author && (
              <span className="study-meta-item"><strong>Author:</strong> {study.first_author}</span>
            )}
            {study.date && (
              <span className="study-meta-item"><strong>Date:</strong> {formatDisplayDate(study.date)}</span>
            )}
            {study.journal && (
              <span className="study-meta-item"><strong>Journal:</strong> {study.journal}</span>
            )}
            {study.study_accession && (
              <span className="study-meta-item"><strong>Accession:</strong> {study.study_accession}</span>
            )}
            {study.mapped_gene && (
              <span className="study-meta-item"><strong>Gene:</strong> {study.mapped_gene}</span>
            )}
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

        {/* Personal result banner + inline analysis (client-rendered, reads from browser) */}
        <StudyPersonalSection
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
          pubmedId={study.pubmedid}
          mappedGene={study.mapped_gene}
          reportedTrait={study.disease_trait}
          pValue={study.p_value}
          pValueMlog={study.pvalue_mlog}
          initialSampleSize={study.initial_sample_size}
          replicationSampleSize={study.replication_sample_size}
        />

        {/* Study Details */}
        <section className="study-details-card">
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

          {study.snps && (
            <div className="study-variants-row">
              <span className="study-variants-label">Variants tested</span>
              <VariantChips snps={study.snps} riskAllele={study.strongest_snp_risk_allele} />
            </div>
          )}

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
          <StudyNavButtons />
        </div>
      </main>
      <Footer />
    </div>
  );
}
