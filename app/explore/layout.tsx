import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore - Monadic DNA Explorer",
  description: "Discover a random study from the GWAS Catalog.",
};

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
