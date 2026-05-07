import type { Metadata } from "next";
import { cache } from "react";
import { executeQuerySingle } from "@/lib/db";

type StudyMetadataRow = {
  study_accession: string | null;
  study: string | null;
  disease_trait: string | null;
  mapped_trait: string | null;
  mapped_gene: string | null;
  first_author: string | null;
  date: string | null;
  journal: string | null;
  pubmedid: string | null;
  strongest_snp_risk_allele: string | null;
  snps: string | null;
};

const SITE_URL = "https://explorer.monadicdna.com";

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function getYear(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b\d{4}\b/);
  return match?.[0] ?? null;
}

const getStudyMetadata = cache(async function getStudyMetadata(studyId: string): Promise<StudyMetadataRow | null> {
  if (!/^\d+$/.test(studyId)) return null;

  try {
    return await executeQuerySingle<StudyMetadataRow>(
      `
        SELECT
          study_accession,
          study,
          disease_trait,
          mapped_trait,
          mapped_gene,
          first_author,
          date,
          journal,
          pubmedid,
          strongest_snp_risk_allele,
          snps
        FROM gwas_catalog
        WHERE id = $1
      `,
      [studyId]
    );
  } catch (error) {
    console.error("[Study Metadata] Failed to generate study Open Graph metadata:", error);
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id: studyId } = await params;
  const study = await getStudyMetadata(studyId);
  const studyUrl = `${SITE_URL}/study/${studyId}`;

  if (!study) {
    return {
      title: `GWAS Study ${studyId} | Monadic DNA Explorer`,
      description: `Explore GWAS Catalog study ${studyId} with privacy-first DNA interpretation in Monadic DNA Explorer.`,
      alternates: {
        canonical: studyUrl,
      },
      openGraph: {
        title: `GWAS Study ${studyId} | Monadic DNA Explorer`,
        description: `Explore GWAS Catalog study ${studyId} with privacy-first DNA interpretation in Monadic DNA Explorer.`,
        type: "article",
        url: studyUrl,
        siteName: "Monadic DNA Explorer",
        locale: "en_US",
      },
      twitter: {
        card: "summary",
        title: `GWAS Study ${studyId} | Monadic DNA Explorer`,
        description: `Explore GWAS Catalog study ${studyId} with privacy-first DNA interpretation in Monadic DNA Explorer.`,
      },
    };
  }

  const trait = cleanText(study.mapped_trait) ?? cleanText(study.disease_trait) ?? "genetic trait";
  const studyTitle = cleanText(study.study);
  const reportedTrait = cleanText(study.disease_trait);
  const mappedTrait = cleanText(study.mapped_trait);
  const gene = cleanText(study.mapped_gene);
  const snp = cleanText(study.strongest_snp_risk_allele) ?? cleanText(study.snps);
  const accession = cleanText(study.study_accession);
  const year = getYear(study.date);
  const prefix = accession ?? "GWAS";
  const traitParts = [
    reportedTrait ?? trait,
    mappedTrait && mappedTrait !== reportedTrait ? mappedTrait : null,
    snp ? `SNP ${snp}` : null,
    gene ? `Gene ${gene}` : null,
  ].filter(Boolean);
  const title = truncate(`${prefix}: ${traitParts.join(" | ")}`, 140);
  const description = truncate(
    [
      studyTitle ?? `GWAS Catalog study${accession ? ` ${accession}` : ""}.`,
      study.first_author ? `Author: ${cleanText(study.first_author)}.` : null,
      year ? `Year: ${year}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    200
  );

  return {
    title,
    description,
    keywords: [
      "GWAS study",
      "genetic association",
      "SNP analysis",
      "genetic variants",
      trait,
      gene,
      accession,
    ].filter((keyword): keyword is string => Boolean(keyword)),
    alternates: {
      canonical: studyUrl,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: studyUrl,
      siteName: "Monadic DNA Explorer",
      locale: "en_US",
      publishedTime: study.date ?? undefined,
      authors: study.first_author ? [study.first_author] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
    other: {
      "citation_title": studyTitle ?? title,
      "citation_publication_date": study.date ?? "",
      "citation_journal_title": study.journal ?? "",
      "citation_author": study.first_author ?? "",
      "citation_pmid": study.pubmedid ?? "",
      "monadic:gwas_accession": study.study_accession ?? "",
      "monadic:trait": trait,
      "monadic:gene": study.mapped_gene ?? "",
    },
  };
}

export default async function StudyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: studyId } = await params;
  const study = await getStudyMetadata(studyId);
  const studyUrl = `${SITE_URL}/study/${studyId}`;

  const jsonLd = study
    ? {
        "@context": "https://schema.org",
        "@type": "ScholarlyArticle",
        "headline": study.study || `GWAS Study ${studyId}`,
        "about": study.mapped_trait || study.disease_trait || undefined,
        "author": study.first_author ? { "@type": "Person", "name": study.first_author } : undefined,
        "datePublished": study.date || undefined,
        "isPartOf": study.journal ? { "@type": "Periodical", "name": study.journal } : undefined,
        "identifier": [
          study.study_accession ? { "@type": "PropertyValue", "propertyID": "GWAS Accession", "value": study.study_accession } : null,
          study.pubmedid ? { "@type": "PropertyValue", "propertyID": "PubMed", "value": study.pubmedid } : null,
        ].filter(Boolean),
        "url": studyUrl,
        "sameAs": [
          study.study_accession ? `https://www.ebi.ac.uk/gwas/studies/${study.study_accession}` : null,
          study.pubmedid ? `https://pubmed.ncbi.nlm.nih.gov/${study.pubmedid}` : null,
        ].filter(Boolean),
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
