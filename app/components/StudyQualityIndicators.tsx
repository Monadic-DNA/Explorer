"use client";

import { CheckIcon, CircleIcon, WarningIcon, InfoIcon, ChartIcon } from "./Icons";

type StudyMetadata = {
  initial_sample_size: string | null;
  replication_sample_size: string | null;
  p_value: string | null;
  pvalue_mlog: string | null;
  study_accession: string | null;
  pubmedid: string | null;
  first_author: string | null;
  date: string | null;
  journal: string | null;
};

type StudyQualityIndicatorsProps = {
  metadata: StudyMetadata;
};

// Parse sample size string (e.g., "10,000 European ancestry individuals")
function parseSampleSize(sampleStr: string | null): { count: number; hasAncestry: boolean; ancestryInfo: string } {
  if (!sampleStr) return { count: 0, hasAncestry: false, ancestryInfo: '' };

  // Extract number
  const numberMatch = sampleStr.match(/[\d,]+/);
  const count = numberMatch ? parseInt(numberMatch[0].replace(/,/g, '')) : 0;

  // Check for ancestry mentions
  const ancestryKeywords = ['european', 'asian', 'african', 'hispanic', 'latino', 'east asian', 'south asian'];
  const lowerStr = sampleStr.toLowerCase();
  const hasAncestry = ancestryKeywords.some(keyword => lowerStr.includes(keyword));

  return { count, hasAncestry, ancestryInfo: hasAncestry ? sampleStr : '' };
}

function getSampleSizeQuality(count: number): { status: 'good' | 'moderate' | 'limited'; label: string } {
  if (count >= 50000) return { status: 'good', label: 'Large study' };
  if (count >= 5000) return { status: 'moderate', label: 'Medium study' };
  if (count > 0) return { status: 'limited', label: 'Small study' };
  return { status: 'limited', label: 'Unknown size' };
}

function getPValueQuality(pValue: string | null): { status: 'good' | 'moderate' | 'limited'; label: string } {
  if (!pValue) return { status: 'limited', label: 'Not reported' };

  const p = parseFloat(pValue);
  if (isNaN(p)) return { status: 'limited', label: 'Invalid p-value' };

  // Genome-wide significance threshold
  if (p <= 5e-8) return { status: 'good', label: 'Genome-wide significant' };
  if (p <= 1e-5) return { status: 'moderate', label: 'Suggestive association' };
  return { status: 'limited', label: 'Not significant' };
}

export default function StudyQualityIndicators({ metadata }: StudyQualityIndicatorsProps) {
  const initialSample = parseSampleSize(metadata.initial_sample_size);
  const replicationSample = parseSampleSize(metadata.replication_sample_size);
  const hasReplication = replicationSample.count > 0;

  const sampleQuality = getSampleSizeQuality(initialSample.count);
  const pValueQuality = getPValueQuality(metadata.p_value);

  return (
    <div className="study-quality-indicators">
      <div className="quality-header">
        <span className="quality-icon-large">
          <ChartIcon size={24} />
        </span>
        <div>
          <h3>Study Quality & Context</h3>
          <p className="quality-subtitle">
            Understanding these characteristics helps interpret the findings responsibly
          </p>
        </div>
      </div>

      <div className="quality-grid">
        <div className={`quality-item quality-${sampleQuality.status}`}>
          <div className="quality-icon">
            {sampleQuality.status === 'good' ? (
              <CheckIcon size={18} />
            ) : sampleQuality.status === 'moderate' ? (
              <CircleIcon size={18} />
            ) : (
              <WarningIcon size={18} />
            )}
          </div>
          <div className="quality-content">
            <strong>Sample Size:</strong> {initialSample.count.toLocaleString()} participants
            <span className="quality-label">({sampleQuality.label})</span>
          </div>
        </div>

        {initialSample.hasAncestry && (
          <div className="quality-item quality-limited">
            <div className="quality-icon">
              <WarningIcon size={18} />
            </div>
            <div className="quality-content">
              <strong>Ancestry:</strong> {initialSample.ancestryInfo}
              <div className="quality-note">
                Results may not generalize to other ancestries
              </div>
            </div>
          </div>
        )}

        <div className={`quality-item quality-${hasReplication ? 'good' : 'limited'}`}>
          <div className="quality-icon">
            {hasReplication ? <CheckIcon size={18} /> : <WarningIcon size={18} />}
          </div>
          <div className="quality-content">
            <strong>Replication:</strong> {hasReplication
              ? `Yes (${replicationSample.count.toLocaleString()} participants)`
              : 'No independent replication reported'}
          </div>
        </div>

        <div className={`quality-item quality-${pValueQuality.status}`}>
          <div className="quality-icon">
            {pValueQuality.status === 'good' ? (
              <CheckIcon size={18} />
            ) : pValueQuality.status === 'moderate' ? (
              <CircleIcon size={18} />
            ) : (
              <WarningIcon size={18} />
            )}
          </div>
          <div className="quality-content">
            <strong>Statistical Significance:</strong> p = {metadata.p_value || 'Not reported'}
            <span className="quality-label">({pValueQuality.label})</span>
          </div>
        </div>

        {metadata.date && (
          <div className="quality-item quality-moderate">
            <div className="quality-icon">
              <InfoIcon size={18} />
            </div>
            <div className="quality-content">
              <strong>Publication Date:</strong> {metadata.date}
              {(() => {
                const year = parseInt(metadata.date);
                const currentYear = new Date().getFullYear();
                const age = currentYear - year;
                if (age > 5) {
                  return <div className="quality-note">Older study - newer research may exist</div>;
                }
                return null;
              })()}
            </div>
          </div>
        )}
      </div>

      <div className="quality-disclaimer">
        <strong>
          <WarningIcon size={16} className="inline-icon" /> Important:
        </strong> The LLM commentary below may not fully account for these limitations.
        Study quality, ancestry differences, and the strength of evidence should all factor into how you
        interpret these results. Always consult a healthcare professional or genetic counselor for
        personalized interpretation.
      </div>
    </div>
  );
}
