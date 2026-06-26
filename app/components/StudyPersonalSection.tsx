"use client";

import { useResults } from "./ResultsContext";
import StudyPersonalResultBanner from "./StudyPersonalResultBanner";
import StudyInlineAnalysis from "./StudyInlineAnalysis";

type Props = {
  studyId: number;
  studyAccession: string | null;
  snps: string | null;
  traitName: string;
  studyTitle: string;
  riskAllele?: string | null;
  orOrBeta?: string | null;
  ciText?: string | null;
  isAnalyzable: boolean;
  nonAnalyzableReason?: string;
  pubmedId?: string | null;
  mappedGene?: string | null;
  reportedTrait?: string | null;
  pValue?: string | null;
  pValueMlog?: string | null;
  initialSampleSize?: string | null;
  replicationSampleSize?: string | null;
};

export default function StudyPersonalSection({
  studyId,
  studyAccession,
  snps,
  traitName,
  studyTitle,
  riskAllele,
  orOrBeta,
  ciText,
  isAnalyzable,
  nonAnalyzableReason,
  pubmedId,
  mappedGene,
  reportedTrait,
  pValue,
  pValueMlog,
  initialSampleSize,
  replicationSampleSize,
}: Props) {
  const { hasResult, getResult } = useResults();
  const result = getResult(studyId);

  return (
    <>
      <StudyPersonalResultBanner
        studyId={studyId}
        studyAccession={studyAccession}
        snps={snps}
        traitName={traitName}
        studyTitle={studyTitle}
        riskAllele={riskAllele}
        orOrBeta={orOrBeta}
        ciText={ciText}
        isAnalyzable={isAnalyzable}
        nonAnalyzableReason={nonAnalyzableReason}
        pValue={pValue}
        pValueMlog={pValueMlog}
        initialSampleSize={initialSampleSize}
        replicationSampleSize={replicationSampleSize}
      />
      {hasResult(studyId) && result && (
        <StudyInlineAnalysis
          result={result}
          pubmedId={pubmedId}
          mappedGene={mappedGene}
          reportedTrait={reportedTrait}
        />
      )}
    </>
  );
}
