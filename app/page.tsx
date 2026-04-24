import type { Metadata } from "next";
import MenuBar from "./components/MenuBar";
import Footer from "./components/Footer";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "Monadic DNA Explorer - Explore Your Genetic Data",
  description: "Discover genetic associations from the GWAS Catalog, analyze your DNA data with privacy-focused AI insights, and explore thousands of genetic traits.",
  keywords: ["GWAS", "genetics", "DNA analysis", "genome explorer", "genetic traits", "personal genomics", "23andMe", "AncestryDNA"],
  openGraph: {
    title: "Monadic DNA Explorer - Explore Your Genetic Data",
    description: "Discover genetic associations from the GWAS Catalog and analyze your DNA data with privacy-focused AI",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <div className="app-container">
      <MenuBar />
      <LandingClient />
      <Footer />
    </div>
  );
}
