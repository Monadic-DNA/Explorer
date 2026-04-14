import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // Note: In a production app, you'd fetch the actual study data here
  // For now, we'll use generic metadata
  const { id: studyId } = await params;

  return {
    title: `Study ${studyId} - Monadic DNA Explorer`,
    description: `View detailed information about GWAS study ${studyId}, including genetic variants, statistical significance, and personalized results.`,
    keywords: ["GWAS study", "genetic association", "SNP analysis", "genetic variants"],
    openGraph: {
      title: `Study ${studyId} - Monadic DNA Explorer`,
      description: `Detailed genetic association study information and personalized analysis`,
      type: "article",
    },
  };
}

export default function StudyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
