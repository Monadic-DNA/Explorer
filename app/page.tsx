import type { Metadata } from "next";
import { Suspense } from "react";
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
        url: "/og-image.png",
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
    images: ["/og-image.png"],
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Monadic DNA",
  "url": "https://explorer.monadicdna.com",
  "logo": "https://explorer.monadicdna.com/explorer-logo.png",
  "sameAs": ["https://x.com/MonadicDNA"],
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Monadic DNA Explorer",
  "url": "https://explorer.monadicdna.com",
  "description": "Private DNA insights from trusted genetic research.",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://explorer.monadicdna.com/explore?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export default function HomePage() {
  return (
    <div className="app-container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <MenuBar />
      <Suspense>
        <LandingClient />
      </Suspense>
      <Footer />
    </div>
  );
}
