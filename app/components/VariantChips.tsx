"use client";

import { useGenotype } from "./UserDataUpload";
import { CheckIcon } from "./Icons";

type VariantChipsProps = {
  snps: string | null;
  riskAllele: string | null;
};

export default function VariantChips({ snps, riskAllele }: VariantChipsProps) {
  const { genotypeData, isUploaded } = useGenotype();

  // Extract SNP ID from risk allele (e.g., "rs7903146-T" -> "rs7903146")
  const riskSnpId = riskAllele?.split('-')[0] || null;
  const hasRiskAllele = riskSnpId !== null && riskSnpId.length > 0;

  // Check if user has data for this specific risk SNP
  const userHasData = isUploaded && genotypeData && riskSnpId ? genotypeData.has(riskSnpId) : false;

  return (
    <div className="variant-cell">
      {hasRiskAllele ? (
        <a
          className={`variant-chip variant-link ${userHasData ? 'has-user-data' : ''}`}
          href={`https://www.ncbi.nlm.nih.gov/snp/${encodeURIComponent(riskSnpId)}`}
          target="_blank"
          rel="noreferrer"
          title={userHasData ? `${riskAllele} - You have data for this variant` : riskAllele || undefined}
          aria-label={userHasData ? `${riskAllele} - You have data for this variant` : riskAllele || riskSnpId}
        >
          {riskAllele}
          {userHasData && (
            <span className="user-data-indicator" aria-hidden="true">
              <CheckIcon size={12} />
            </span>
          )}
        </a>
      ) : (
        <span className="variant-chip variant-chip--placeholder">Not reported</span>
      )}
    </div>
  );
}
