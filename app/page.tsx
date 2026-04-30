import type { Metadata } from "next";
import MenuBar from "./components/MenuBar";
import Footer from "./components/Footer";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "Monadic DNA | Personal DNA insights with privacy, autonomy, and boundless curiosity",
  description: "Private DNA insights from trusted genetic research. Learn from your DNA while your data remains private, protected, and entirely in your hands.",
  keywords: ["GWAS", "genetics", "DNA analysis", "genome explorer", "genetic traits", "personal genomics", "23andMe", "AncestryDNA"],
  openGraph: {
    title: "Monadic DNA | Personal DNA insights with privacy, autonomy, and boundless curiosity",
    description: "Private DNA insights from trusted genetic research. Learn from your DNA while your data remains private, protected, and entirely in your hands.",
    type: "website",
    url: "https://explorer.monadicdna.com",
    siteName: "Monadic DNA Explorer",
    locale: "en_US",
    images: [
      {
        url: "https://monadicdna.com/og-image.png",
        width: 1199,
        height: 630,
        alt: "Monadic DNA Explorer - Private DNA insights from trusted genetic research",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Monadic DNA | Personal DNA insights with privacy, autonomy, and boundless curiosity",
    description: "Private DNA insights from trusted genetic research. Learn from your DNA while your data remains private, protected, and entirely in your hands.",
    images: ["https://monadicdna.com/og-image.png"],
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
