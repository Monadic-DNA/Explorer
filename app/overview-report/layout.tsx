import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview Report - Monadic DNA Explorer",
  description: "Generate an AI-powered report synthesizing your saved genetic results into patterns, themes, and suggested next steps.",
  keywords: ["DNA overview report", "genetic analysis report", "AI genetics", "personal genomics report"],
  alternates: {
    canonical: "https://explorer.monadicdna.com/overview-report",
  },
  openGraph: {
    title: "Overview Report - Monadic DNA Explorer",
    description: "Generate an AI-powered report synthesizing your saved genetic results into patterns, themes, and suggested next steps.",
    type: "website",
    url: "https://explorer.monadicdna.com/overview-report",
    siteName: "Monadic DNA Explorer",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Overview Report - Monadic DNA Explorer",
    description: "Generate an AI-powered report synthesizing your saved genetic results into patterns, themes, and suggested next steps.",
    creator: "@MonadicDNA",
  },
};

export default function OverviewReportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
