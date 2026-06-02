import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse GWAS Studies - Monadic DNA Explorer",
  description: "Search and filter millions of genetic associations from the GWAS Catalog. Upload your DNA data to see personalized results.",
  keywords: ["GWAS", "genetic studies", "DNA research", "genome-wide association", "genetic variants", "SNP analysis"],
  openGraph: {
    title: "Browse GWAS Studies - Monadic DNA Explorer",
    description: "Search millions of genetic associations and analyze your DNA data",
    type: "website",
  },
};

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
